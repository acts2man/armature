/**
 * site-diagnose — the "Check connection" checklist for one site. Never throws a
 * bare error; every step is reported with a fix. Secrets are shown by presence and
 * length only, and the GitHub steps run only for a caller who can access the site.
 *
 * Service role: used ONLY to store the derived sites.status (connected /
 * needs_attention) after the run, because clients may run the check but may not
 * update site rows.
 */
import type { ConnectionCheck, DiagnoseResponse } from "../../../shared/publishTypes.ts";
import { adminClient, linkedInstallationIds, loadAccessibleSite, requireConnectedSite, resolveCaller, type SiteRow } from "../_shared/auth.ts";
import { denoEnv, type Env } from "../_shared/env.ts";
import { readJsonBody, requireUuid, serveJson } from "../_shared/http.ts";
import { runRepoChecks } from "../_shared/siteChecks.ts";

async function storeStatus(env: Env, site: SiteRow, allPassed: boolean, installationId?: number) {
  try {
    const patch: Record<string, unknown> = { status: allPassed ? "connected" : "needs_attention" };
    if (allPassed && installationId && installationId !== site.github_installation_id) {
      // The App was reinstalled and re-linked; keep the record current.
      patch["github_installation_id"] = installationId;
    }
    const { error } = await adminClient(env).from("sites").update(patch).eq("id", site.id);
    if (error) console.error("[site-diagnose] could not store status:", error.message);
  } catch (error) {
    console.error("[site-diagnose] could not store status:", error instanceof Error ? error.message : error);
  }
}

Deno.serve(
  serveJson(async (req): Promise<DiagnoseResponse> => {
    const env = denoEnv();
    const body = await readJsonBody(req);
    const siteId = requireUuid(body, "site_id");
    const checks: ConnectionCheck[] = [];

    // 1. signed in
    let caller;
    try {
      caller = await resolveCaller(req, env);
      checks.push({ id: "signed-in", label: "You are signed in", status: "ok", detail: `Signed in as ${caller.email}` });
    } catch (error) {
      checks.push({
        id: "signed-in",
        label: "You are signed in",
        status: "fail",
        detail: error instanceof Error ? error.message : "Could not verify your sign-in.",
        fix: "Sign out and sign in again. If this keeps failing, the dashboard's Supabase settings in Netlify are wrong.",
      });
      checks.push({ id: "site-access", label: "Your account can edit this site", status: "skipped", detail: "Not checked, because the sign-in check did not pass." });
      return { ok: true, allPassed: false, checks };
    }

    // 2. site access
    let site;
    try {
      site = requireConnectedSite(await loadAccessibleSite(caller.supabase, siteId));
      checks.push({ id: "site-access", label: "Your account can edit this site", status: "ok", detail: `${site.name} — ${site.repo_owner}/${site.repo_name} on ${site.branch}` });
    } catch (error) {
      checks.push({
        id: "site-access",
        label: "Your account can edit this site",
        status: "fail",
        detail: error instanceof Error ? error.message : "No access.",
        fix: "If this is a hosting-only site, the agency connects its repository from Fleet. Otherwise ask the agency to add your account to this site (Team).",
      });
      return { ok: true, allPassed: false, checks };
    }

    // 3. the repository checklist
    const linked = await linkedInstallationIds(caller.supabase, site.agency_id).catch(() => [site.github_installation_id]);
    if (!linked.includes(site.github_installation_id)) linked.push(site.github_installation_id);
    const result = await runRepoChecks({
      env,
      repoOwner: site.repo_owner,
      repoName: site.repo_name,
      branch: site.branch,
      linkedInstallationIds: linked,
    });
    checks.push(...result.checks);

    const allPassed = checks.every((check) => check.status === "ok");
    await storeStatus(env, site, allPassed, result.installation?.id);
    return { ok: true, allPassed, checks };
  }),
);
