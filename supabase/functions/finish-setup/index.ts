/**
 * finish-setup — for a needs_setup site, check whether the armature/setup
 * branch exists, offer the Netlify branch preview URL, and (on action="go_live")
 * merge armature/setup into the connected branch through the GitHub API as
 * ONE merge. Agency staff only. Never force-pushes.
 *
 * The site's status flips to "connected" as soon as Armature next sees the
 * kit files on the connected branch (kit-status handles that check); this
 * function only takes care of the merge.
 */
import { adminClient, loadAccessibleSite, requireAgencyMember, requireConnectedSite, resolveCaller } from "../_shared/auth.ts";
import { denoEnv } from "../_shared/env.ts";
import { ArmatureError } from "../_shared/errors.ts";
import { branchPreviewUrl, mergeBranchViaApi } from "../_shared/finishSetup.ts";
import { loadAppConfig, mintInstallationToken } from "../_shared/githubApp.ts";
import { GITHUB_API, GITHUB_API_VERSION, USER_AGENT } from "../_shared/githubApp.ts";
import { readJsonBody, requireUuid, serveJson } from "../_shared/http.ts";

const SETUP_BRANCH = "armature/setup";

type StatusResponse = {
  ok: true;
  action: "status";
  setupBranchExists: boolean;
  setupBranchSha: string | null;
  previewUrl: string | null;
  connectedBranch: string;
  setupBranch: string;
};
type GoLiveOk = { ok: true; action: "go_live"; kind: "merged" | "already_merged"; commit?: { sha: string; url: string } };
type GoLiveConflict = { ok: true; action: "go_live"; kind: "conflict"; message: string };
type Response = StatusResponse | GoLiveOk | GoLiveConflict;

Deno.serve(
  serveJson(async (req): Promise<Response> => {
    const env = denoEnv();
    const body = await readJsonBody(req);
    const siteId = requireUuid(body, "site_id");
    const action = (body["action"] === "go_live" ? "go_live" : "status") as "status" | "go_live";
    const explicitSlug = typeof body["netlify_slug"] === "string" ? body["netlify_slug"] : null;

    const caller = await resolveCaller(req, env);
    const site = await loadAccessibleSite(caller.supabase, siteId);
    await requireAgencyMember(caller.supabase, site.agency_id, caller.userId);
    const connected = requireConnectedSite(site);

    const token = await mintInstallationToken(loadAppConfig(env), connected.github_installation_id, connected.repo_name);
    const repo = `${connected.repo_owner}/${connected.repo_name}`;

    // Ping GitHub for armature/setup's ref sha (probe endpoint; 404 means "not there yet").
    const refUrl = `${GITHUB_API}/repos/${repo}/git/ref/heads/${SETUP_BRANCH}`;
    let setupSha: string | null = null;
    try {
      const response = await fetch(refUrl, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token.token}`,
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
          "User-Agent": USER_AGENT,
        },
      });
      if (response.ok) {
        const json = (await response.json()) as { object?: { sha?: string } };
        setupSha = json.object?.sha ?? null;
      } else if (response.status !== 404) {
        throw new Error(`GitHub returned ${response.status} for the branch check`);
      }
    } catch (cause) {
      throw new ArmatureError("github_error", `Could not check for the ${SETUP_BRANCH} branch on GitHub: ${cause instanceof Error ? cause.message : String(cause)}`);
    }

    if (action === "status") {
      return {
        ok: true,
        action: "status",
        setupBranchExists: setupSha !== null,
        setupBranchSha: setupSha,
        previewUrl: setupSha ? branchPreviewUrl({ liveUrl: site.live_url, explicitSlug, branch: SETUP_BRANCH }) : null,
        connectedBranch: connected.branch,
        setupBranch: SETUP_BRANCH,
      };
    }

    // action === "go_live"
    if (!setupSha) {
      throw new ArmatureError("invalid", `The ${SETUP_BRANCH} branch does not exist yet. Ask Claude Code to finish and push it, then come back.`);
    }
    const outcome = await mergeBranchViaApi({
      repo,
      base: connected.branch,
      head: SETUP_BRANCH,
      commitMessage: `Merge Armature setup from ${SETUP_BRANCH} into ${connected.branch}`,
      token: token.token,
    });
    if (outcome.kind === "conflict") {
      return { ok: true, action: "go_live", kind: "conflict", message: outcome.message };
    }
    if (outcome.kind === "missing_head_branch" || outcome.kind === "missing_base_branch") {
      const which = outcome.kind === "missing_head_branch" ? SETUP_BRANCH : connected.branch;
      throw new ArmatureError("github_error", `GitHub says the ${which} branch is missing. Check the branch name and try again.`);
    }

    // Success: flip the site's status to "connected" so the Dashboard reads normal from now on.
    try {
      const admin = adminClient(env);
      await admin.from("sites").update({ status: "connected" }).eq("id", site.id);
    } catch (err) {
      console.error("[finish-setup] could not update site status to connected:", err instanceof Error ? err.message : err);
    }

    if (outcome.kind === "already_merged") {
      return { ok: true, action: "go_live", kind: "already_merged" };
    }
    return { ok: true, action: "go_live", kind: "merged", commit: { sha: outcome.sha, url: outcome.url } };
  }),
);
