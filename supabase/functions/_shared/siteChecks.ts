/**
 * The repository checklist behind "Add a site" and "Check connection".
 *
 * Every step reports rather than throws, so one failure never hides the rest: the
 * dashboard shows the whole list with a tick or a cross and a plain-English fix on
 * each line. Secrets are reported by presence and length only.
 */
import { CONTENT_PATH, isPlainObject } from "../../../shared/contentFile.ts";
import { SCHEMA_PATH, validateSiteSchema, type SiteSchema } from "../../../shared/schema.ts";
import { validateContentTree } from "../../../shared/contentValidation.ts";
import type { ConnectionCheck } from "../../../shared/publishTypes.ts";
import type { Env } from "./env.ts";
import {
  createAppJwt,
  describeAppEnv,
  findInstallationForRepo,
  loadAppConfig,
  requestInstallationToken,
  type AppConfig,
  type InstallationInfo,
} from "./githubApp.ts";
import { createGithubProbe, type GithubProbe, type RepoConfig } from "./githubRepo.ts";

export type RepoCheckInput = {
  env: Env;
  fetch?: typeof fetch;
  repoOwner: string;
  repoName: string;
  branch: string;
  /** Installation ids the agency has linked through github-setup. */
  linkedInstallationIds: number[];
  /** Test seam: build the read-only probe for a repository. */
  makeProbe?: (config: RepoConfig) => GithubProbe;
};

export type RepoCheckResult = {
  checks: ConnectionCheck[];
  allPassed: boolean;
  installation?: InstallationInfo;
  headSha?: string;
  schema?: SiteSchema;
  content?: unknown;
  warnings: string[];
};

const SECRETS_FIX =
  "In Supabase open Edge Functions → Secrets and add the value, then redeploy the functions (docs/SETUP.md, part B). Secrets only reach functions deployed after they were saved.";

const ORDER: { id: string; label: (input: RepoCheckInput) => string }[] = [
  { id: "app-config", label: () => "GitHub App secrets reached this function" },
  { id: "app-key", label: () => "The App's private key can be read" },
  { id: "installation", label: (i) => `The App is installed on ${i.repoOwner}/${i.repoName}` },
  { id: "installation-linked", label: () => "That installation is linked to your agency" },
  { id: "installation-token", label: () => "GitHub issued an access token for the repository" },
  { id: "repo-access", label: () => "The App can write to the repository" },
  { id: "branch", label: (i) => `The branch "${i.branch}" exists` },
  { id: "schema-file", label: () => `${SCHEMA_PATH} is present and valid` },
  { id: "content-file", label: () => `${CONTENT_PATH} is present and valid` },
];

export async function runRepoChecks(input: RepoCheckInput): Promise<RepoCheckResult> {
  const fetchImpl = input.fetch ?? fetch;
  const makeProbe = input.makeProbe ?? ((config: RepoConfig) => createGithubProbe(config, fetchImpl));
  const checks: ConnectionCheck[] = [];
  const warnings: string[] = [];
  const labelFor = (id: string) => ORDER.find((entry) => entry.id === id)?.label(input) ?? id;

  const pass = (id: string, detail: string) =>
    checks.push({ id, label: labelFor(id), status: "ok", detail });
  const fail = (id: string, detail: string, fix: string) =>
    checks.push({ id, label: labelFor(id), status: "fail", detail, fix });
  const finish = (result: Omit<RepoCheckResult, "checks" | "allPassed" | "warnings">): RepoCheckResult => {
    const done = new Set(checks.map((check) => check.id));
    for (const entry of ORDER) {
      if (!done.has(entry.id)) {
        checks.push({
          id: entry.id,
          label: entry.label(input),
          status: "skipped",
          detail: "Not checked, because a step above did not pass.",
        });
      }
    }
    return { ...result, checks, warnings, allPassed: checks.every((check) => check.status === "ok") };
  };

  // 1. secrets present
  const envReport = describeAppEnv(input.env);
  if (envReport.missing.length > 0) {
    fail(
      "app-config",
      `Missing: ${envReport.missing.join(", ")}`,
      `The function cannot talk to GitHub without ${envReport.missing.join(" and ")}. ${SECRETS_FIX}`,
    );
    return finish({});
  }
  pass(
    "app-config",
    `GITHUB_APP_ID set; GITHUB_APP_PRIVATE_KEY set (${envReport.privateKeyLength} characters); GITHUB_APP_SLUG set`,
  );

  // 2. key parses and signs
  let app: AppConfig;
  try {
    app = loadAppConfig(input.env);
    await createAppJwt(app);
    pass("app-key", "Signed a test token with the private key");
  } catch (error) {
    fail(
      "app-key",
      error instanceof Error ? error.message : "The private key could not be used",
      "Open the GitHub App's settings, generate a new private key, open the downloaded .pem file in a text editor and paste its entire contents (including the BEGIN and END lines) into the GITHUB_APP_PRIVATE_KEY secret. Then redeploy the functions.",
    );
    return finish({});
  }

  // 3. installed on the repo?
  const found = await findInstallationForRepo(app, input.repoOwner, input.repoName, fetchImpl);
  if (!found.installation) {
    const detail = `HTTP ${found.status || "no response"} from GitHub — ${found.message}`;
    const fix =
      found.status === 404
        ? `GitHub says the App is not installed on ${input.repoOwner}/${input.repoName}, or the repository does not exist. Install the App on the GitHub account that owns the repository and make sure this repository is included in the installation's "Repository access". Check the owner and repository name for typos — they are case-sensitive.`
        : found.status === 401
          ? "GitHub rejected the App's credentials. GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must come from the same App."
          : "GitHub could not be reached. Try again in a minute; if it persists, check https://www.githubstatus.com.";
    fail("installation", detail, fix);
    return finish({});
  }
  const installation = found.installation;
  if (installation.suspended) {
    fail(
      "installation",
      `Installation #${installation.id} on ${installation.account.login} is suspended`,
      "Someone suspended the App on GitHub. Open the GitHub account's Settings → Applications → Installed GitHub Apps and unsuspend it.",
    );
    return finish({ installation });
  }
  pass(
    "installation",
    `Installation #${installation.id} on ${installation.account.login} (${installation.account.type})`,
  );

  // 4. linked to this agency?
  if (!input.linkedInstallationIds.includes(installation.id)) {
    fail(
      "installation-linked",
      `Installation #${installation.id} is not linked to your agency`,
      `Go to Fleet → Add a site → "Install the GitHub App" and finish the installation from this dashboard, so it is recorded for your agency. If the App was installed directly on GitHub, open it there and press "Configure": GitHub will send you back here to finish linking.`,
    );
    return finish({ installation });
  }
  pass("installation-linked", "Recorded for your agency");

  // 5. token
  const tokenResult = await requestInstallationToken(app, installation.id, input.repoName, fetchImpl);
  if (!tokenResult.token) {
    fail(
      "installation-token",
      tokenResult.message,
      "Open the App's installation on GitHub (Settings → Applications → Installed GitHub Apps → Configure) and confirm this repository is selected and that the App has Contents: Read and write. If the App's permissions were changed recently, GitHub asks the installer to approve the new permissions.",
    );
    return finish({ installation });
  }
  pass("installation-token", "Token issued (scoped to this repository, expires in one hour)");

  const repoConfig: RepoConfig = {
    token: tokenResult.token.token,
    repo: `${input.repoOwner}/${input.repoName}`,
    branch: input.branch,
  };
  const probe = makeProbe(repoConfig);

  // 6. repo reachable with the token, and the token carries Contents: write.
  // The write decision comes from the permissions GitHub granted the token, not
  // from `permissions.push` on the repository response: that flag is not a
  // reliable signal for App installation tokens and reads false even when the
  // token was issued with Contents: write.
  const repository = await probe.repository();
  if (!repository.ok) {
    fail(
      "repo-access",
      `HTTP ${repository.status || "no response"} from GET /repos/${repoConfig.repo} — ${repository.message}`,
      "GitHub did not let the App read the repository. Check the repository name and that it is included in the installation.",
    );
    return finish({ installation });
  }
  const contentsPermission = tokenResult.token.permissions["contents"];
  if (contentsPermission !== "write") {
    fail(
      "repo-access",
      contentsPermission
        ? `The token's Contents permission is "${contentsPermission}", not "write" — the App can read but not write`
        : "The token carries no Contents permission — the App can read but not write",
      "The App needs Contents: Read and write. Open the App's settings on GitHub → Permissions & events → Repository permissions → Contents → Read and write, save, then approve the new permissions on the installation.",
    );
    return finish({ installation });
  }
  pass("repo-access", "The token carries Contents: write");

  // 7. branch
  const branch = await probe.branch();
  if (!branch.ok || !branch.sha) {
    fail(
      "branch",
      `HTTP ${branch.status || "no response"} for branch ${input.branch} — ${branch.message}`,
      `GitHub has no branch called "${input.branch}" in this repository. Branch names are case-sensitive and include any slashes. The default is usually "main".`,
    );
    return finish({ installation });
  }
  pass("branch", `${input.branch} is at ${branch.sha.slice(0, 7)}`);
  const headSha = branch.sha;

  // 8. schema
  const schemaFile = await probe.file(SCHEMA_PATH, headSha);
  if (!schemaFile.ok || typeof schemaFile.text !== "string") {
    fail(
      "schema-file",
      `HTTP ${schemaFile.status || "no response"} — ${schemaFile.message}`,
      `${SCHEMA_PATH} is missing from the "${input.branch}" branch (or is larger than 1 MB). The site's developer needs to add it — see docs/SITE_CONTRACT.md.`,
    );
    return finish({ installation, headSha });
  }
  let schemaRaw: unknown;
  try {
    schemaRaw = JSON.parse(schemaFile.text);
  } catch {
    fail(
      "schema-file",
      `${SCHEMA_PATH} is not valid JSON`,
      "Open the file and fix the JSON (a missing comma or quote is the usual cause), commit, and try again.",
    );
    return finish({ installation, headSha });
  }
  const schemaReport = validateSiteSchema(schemaRaw);
  if (!schemaReport.schema) {
    fail(
      "schema-file",
      schemaReport.errors.slice(0, 5).join("\n") +
        (schemaReport.errors.length > 5 ? `\n…and ${schemaReport.errors.length - 5} more` : ""),
      "The schema does not follow the site contract. Fix the problems listed, commit, and try again. docs/SITE_CONTRACT.md describes every rule.",
    );
    return finish({ installation, headSha });
  }
  warnings.push(...schemaReport.warnings);
  const pageCount = schemaReport.schema.pages.length;
  pass("schema-file", `armatureContract ${schemaReport.schema.armatureContract}, ${pageCount} page${pageCount === 1 ? "" : "s"}`);

  // 9. content
  const contentFile = await probe.file(CONTENT_PATH, headSha);
  if (!contentFile.ok || typeof contentFile.text !== "string") {
    fail(
      "content-file",
      `HTTP ${contentFile.status || "no response"} — ${contentFile.message}`,
      `${CONTENT_PATH} is missing from the "${input.branch}" branch (or is larger than 1 MB). The site's developer needs to add it with a value for every field in the schema.`,
    );
    return finish({ installation, headSha, schema: schemaReport.schema });
  }
  let contentRaw: unknown;
  try {
    contentRaw = JSON.parse(contentFile.text);
  } catch {
    fail(
      "content-file",
      `${CONTENT_PATH} is not valid JSON`,
      "Open the file and fix the JSON, commit, and try again.",
    );
    return finish({ installation, headSha, schema: schemaReport.schema });
  }
  if (!isPlainObject(contentRaw)) {
    fail("content-file", `${CONTENT_PATH} is not a JSON object`, "The file must be an object keyed by page slug.");
    return finish({ installation, headSha, schema: schemaReport.schema });
  }
  const contentReport = validateContentTree(contentRaw, schemaReport.schema.pages);
  if (contentReport.errors.length > 0) {
    fail(
      "content-file",
      contentReport.errors.slice(0, 5).join("\n") +
        (contentReport.errors.length > 5 ? `\n…and ${contentReport.errors.length - 5} more` : ""),
      "Every field the schema declares needs a value of the right shape in the content file. Fix the problems listed, commit, and try again.",
    );
    return finish({ installation, headSha, schema: schemaReport.schema, content: contentRaw });
  }
  warnings.push(...contentReport.warnings);
  pass(
    "content-file",
    `${contentReport.checked} field${contentReport.checked === 1 ? "" : "s"} present and well-shaped` +
      (contentReport.warnings.length > 0 ? ` (${contentReport.warnings.length} warning${contentReport.warnings.length === 1 ? "" : "s"})` : ""),
  );

  return finish({ installation, headSha, schema: schemaReport.schema, content: contentRaw });
}
