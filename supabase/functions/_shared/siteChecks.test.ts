// deno-lint-ignore-file require-await -- fake fetch stubs return responses synchronously
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { utf8ToBase64 } from "../../../shared/base64.ts";
import type { ConnectionCheck } from "../../../shared/publishTypes.ts";
import { runRepoChecks, type RepoCheckInput } from "./siteChecks.ts";
import { generateTestKeyPair } from "./testKeys.ts";
import exampleSchema from "../../../shared/example/schema.json" with { type: "json" };
import exampleContent from "../../../shared/example/pages.json" with { type: "json" };

const keys = await generateTestKeyPair();
const ENV = {
  GITHUB_APP_ID: "12345",
  GITHUB_APP_PRIVATE_KEY: keys.pkcs1Pem,
  GITHUB_APP_SLUG: "armature-test",
};

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

type Overrides = Partial<Record<string, () => Response>>;

/** A fake GitHub for one repository, with per-endpoint overrides. */
function fakeGithub(overrides: Overrides = {}, files: Record<string, unknown> = {}) {
  const schema = files["schema"] ?? exampleSchema;
  const content = files["content"] ?? exampleContent;
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    const method = init?.method ?? "GET";
    const key = `${method} ${new URL(href).pathname}`;
    const override = overrides[key];
    if (override) return override();
    if (key === "GET /repos/acme/site/installation") {
      return json({ id: 42, account: { login: "acme", type: "Organization" }, repository_selection: "selected", permissions: { contents: "write" } });
    }
    if (key === "POST /app/installations/42/access_tokens") return json({ token: "ghs_fake", expires_at: "x" }, 201);
    if (key === "GET /repos/acme/site") return json({ permissions: { push: true } });
    if (key === "GET /repos/acme/site/git/ref/heads/main") return json({ object: { sha: "0123456789abcdef0123456789abcdef01234567" } });
    if (key === "GET /repos/acme/site/contents/content/schema.json") return json({ sha: "s", encoding: "base64", content: utf8ToBase64(JSON.stringify(schema)) });
    if (key === "GET /repos/acme/site/contents/content/pages.json") return json({ sha: "c", encoding: "base64", content: utf8ToBase64(JSON.stringify(content)) });
    return json({ message: `unexpected ${key}` }, 500);
  }) as unknown as typeof fetch;
}

const base = (overrides: Partial<RepoCheckInput> = {}): RepoCheckInput => ({
  env: ENV,
  fetch: fakeGithub(),
  repoOwner: "acme",
  repoName: "site",
  branch: "main",
  linkedInstallationIds: [42],
  ...overrides,
});

const find = (checks: ConnectionCheck[], id: string): ConnectionCheck => {
  const check = checks.find((entry) => entry.id === id);
  if (!check) throw new Error(`no check ${id}`);
  return check;
};

const IDS = ["app-config", "app-key", "installation", "installation-linked", "installation-token", "repo-access", "branch", "schema-file", "content-file"];

Deno.test("happy path: every check passes and the head, schema and content come back", async () => {
  const result = await runRepoChecks(base());
  assertEquals(result.checks.map((check) => check.id), IDS);
  assertEquals(result.allPassed, true, JSON.stringify(result.checks, null, 2));
  assertEquals(result.headSha, "0123456789abcdef0123456789abcdef01234567");
  assertEquals(result.installation?.id, 42);
  assertEquals(result.schema?.pages.length, 2);
  assertStringIncludes(find(result.checks, "content-file").detail, "17 fields");
  // The private key never appears anywhere in the report.
  assert(!JSON.stringify(result).includes(keys.pkcs1Pem.slice(40, 80)));
  assert(!JSON.stringify(result).includes("ghs_fake"));
});

Deno.test("missing secrets fail the first check and skip the rest", async () => {
  const result = await runRepoChecks(base({ env: { GITHUB_APP_ID: "1" } }));
  const first = find(result.checks, "app-config");
  assertEquals(first.status, "fail");
  assertStringIncludes(first.detail, "GITHUB_APP_PRIVATE_KEY");
  assertStringIncludes(first.fix ?? "", "Edge Functions → Secrets");
  for (const id of IDS.slice(1)) assertEquals(find(result.checks, id).status, "skipped");
  assertEquals(result.allPassed, false);
});

Deno.test("an unreadable private key is explained", async () => {
  const result = await runRepoChecks(base({ env: { ...ENV, GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----" } }));
  assertEquals(find(result.checks, "app-config").status, "ok");
  const key = find(result.checks, "app-key");
  assertEquals(key.status, "fail");
  assertStringIncludes(key.fix ?? "", "generate a new private key");
});

Deno.test("App not installed on the repository", async () => {
  const result = await runRepoChecks(base({ fetch: fakeGithub({ "GET /repos/acme/site/installation": () => json({ message: "Not Found" }, 404) }) }));
  const check = find(result.checks, "installation");
  assertEquals(check.status, "fail");
  assertStringIncludes(check.detail, "HTTP 404");
  assertStringIncludes(check.fix ?? "", "Install the App");
  assertEquals(find(result.checks, "installation-token").status, "skipped");
});

Deno.test("installation exists but is not linked to the agency", async () => {
  const result = await runRepoChecks(base({ linkedInstallationIds: [7] }));
  assertEquals(find(result.checks, "installation").status, "ok");
  const linked = find(result.checks, "installation-linked");
  assertEquals(linked.status, "fail");
  assertStringIncludes(linked.fix ?? "", "Add a site");
  assertEquals(result.allPassed, false);
});

Deno.test("GitHub refuses to scope a token", async () => {
  const result = await runRepoChecks(base({ fetch: fakeGithub({ "POST /app/installations/42/access_tokens": () => json({ message: "not on the list" }, 422) }) }));
  const check = find(result.checks, "installation-token");
  assertEquals(check.status, "fail");
  assertStringIncludes(check.detail, "422");
  assertEquals(find(result.checks, "repo-access").status, "skipped");
});

Deno.test("read-only access is flagged", async () => {
  const result = await runRepoChecks(base({ fetch: fakeGithub({ "GET /repos/acme/site": () => json({ permissions: { push: false } }) }) }));
  const check = find(result.checks, "repo-access");
  assertEquals(check.status, "fail");
  assertStringIncludes(check.fix ?? "", "Read and write");
});

Deno.test("missing branch names the branch", async () => {
  const result = await runRepoChecks(base({ branch: "prod", fetch: fakeGithub({ "GET /repos/acme/site/git/ref/heads/prod": () => json({ message: "Not Found" }, 404) }) }));
  const check = find(result.checks, "branch");
  assertEquals(check.status, "fail");
  assertStringIncludes(check.fix ?? "", '"prod"');
  assertEquals(find(result.checks, "schema-file").status, "skipped");
});

Deno.test("missing, malformed and contract-breaking schema files", async () => {
  const missing = await runRepoChecks(base({ fetch: fakeGithub({ "GET /repos/acme/site/contents/content/schema.json": () => json({ message: "Not Found" }, 404) }) }));
  assertEquals(find(missing.checks, "schema-file").status, "fail");
  assertStringIncludes(find(missing.checks, "schema-file").fix ?? "", "SITE_CONTRACT");

  const malformed = await runRepoChecks(base({ fetch: fakeGithub({ "GET /repos/acme/site/contents/content/schema.json": () => json({ sha: "s", encoding: "base64", content: utf8ToBase64("{ nope") }) }) }));
  assertStringIncludes(find(malformed.checks, "schema-file").detail, "not valid JSON");

  const broken = await runRepoChecks(base({ fetch: fakeGithub({}, { schema: { armatureContract: 1, pages: [{ slug: "Bad", label: "x", path: "x", sections: [] }] } }) }));
  const check = find(broken.checks, "schema-file");
  assertEquals(check.status, "fail");
  assertStringIncludes(check.detail, "slug");
  assertEquals(find(broken.checks, "content-file").status, "skipped");
});

Deno.test("content that does not match the schema fails the last check with the field named", async () => {
  const content = structuredClone(exampleContent) as Record<string, Record<string, Record<string, unknown>>>;
  delete content["home"]!["hero"]!["title"];
  const result = await runRepoChecks(base({ fetch: fakeGithub({}, { content }) }));
  const check = find(result.checks, "content-file");
  assertEquals(check.status, "fail");
  assertStringIncludes(check.detail, "home.hero.title: missing");
  assertEquals(result.allPassed, false);
  assertEquals(result.headSha, "0123456789abcdef0123456789abcdef01234567");
});

Deno.test("every failing check carries a fix and no passing check does", async () => {
  const result = await runRepoChecks(base({ linkedInstallationIds: [] }));
  for (const check of result.checks) {
    if (check.status === "fail") assert(check.fix, `${check.id} needs a fix`);
    if (check.status === "ok") assertEquals(check.fix, undefined);
    assert(check.detail.length > 0);
  }
});
