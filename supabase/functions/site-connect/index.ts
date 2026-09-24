/**
 * site-connect — agency staff only. Given owner/repo/branch, verify the App can
 * reach the repository, that content/schema.json and content/pages.json exist and
 * validate, and create the site row. Every step is reported with a fix.
 *
 * With `site_id`, an existing hosting-only site of the agency is upgraded in
 * place instead: the same checks run and the repository is written onto that row.
 *
 * Authorisation: the caller must be a member of the agency (checked under RLS),
 * and the site row is written with the caller's own client, so RLS enforces the
 * agency boundary a second time. No service role.
 */
import type { SiteConnectResponse } from "../../../shared/publishTypes.ts";
import { linkedInstallationIds, requireAgencyMember, resolveCaller } from "../_shared/auth.ts";
import { denoEnv } from "../_shared/env.ts";
import { ArmatureError } from "../_shared/errors.ts";
import { optionalString, readJsonBody, requireString, requireUuid, serveJson } from "../_shared/http.ts";
import { runRepoChecks } from "../_shared/siteChecks.ts";

const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

Deno.serve(
  serveJson(async (req): Promise<SiteConnectResponse> => {
    const env = denoEnv();
    const body = await readJsonBody(req);
    const agencyId = requireUuid(body, "agency_id");
    const repoOwner = requireString(body, "repo_owner");
    const repoName = requireString(body, "repo_name").replace(/\.git$/, "");
    const branch = optionalString(body, "branch") ?? "main";
    const name = optionalString(body, "name") ?? repoName;
    const liveUrl = optionalString(body, "live_url");
    const upgradeSiteId = optionalString(body, "site_id");

    if (!NAME_PATTERN.test(repoOwner) || !NAME_PATTERN.test(repoName)) {
      throw new ArmatureError(
        "invalid",
        'The repository must be given as its GitHub owner and name, for example "acme" and "acme-site". Paste just those two parts, not the full URL.',
      );
    }
    if (liveUrl && !/^https?:\/\//.test(liveUrl)) {
      throw new ArmatureError("invalid", "The live URL must start with https://");
    }

    const caller = await resolveCaller(req, env);
    await requireAgencyMember(caller.supabase, agencyId, caller.userId);

    // Upgrading: the site must be the agency's own and still hosting-only.
    let existing: { id: string; name: string; live_url: string | null } | null = null;
    if (upgradeSiteId) {
      const { data, error } = await caller.supabase
        .from("sites")
        .select("id, name, agency_id, status, live_url")
        .eq("id", upgradeSiteId)
        .maybeSingle();
      if (error) throw new ArmatureError("github_error", `Could not read the site to upgrade: ${error.message}`);
      const row = data as { id: string; name: string; agency_id: string; status: string; live_url: string | null } | null;
      if (!row || row.agency_id !== agencyId) {
        throw new ArmatureError("forbidden", "That site does not exist, or it does not belong to your agency.");
      }
      if (row.status !== "hosting_only") {
        throw new ArmatureError("invalid", `${row.name} already has a repository connected.`);
      }
      existing = row;
    }

    const result = await runRepoChecks({
      env,
      repoOwner,
      repoName,
      branch,
      linkedInstallationIds: await linkedInstallationIds(caller.supabase, agencyId),
    });

    // We save the site as soon as the GitHub-side checks pass. If Armature files
    // are missing we save it with status="needs_setup" so the agency can open the
    // Dashboard and run Set up this site.
    if (!result.installation) {
      return { ok: true, allPassed: false, checks: result.checks };
    }
    const repoChecksOk = ["app-config", "app-key", "installation", "installation-linked", "installation-token", "repo-access", "branch"].every((id) =>
      result.checks.some((check) => check.id === id && check.status === "ok"),
    );
    if (!repoChecksOk) {
      return { ok: true, allPassed: false, checks: result.checks };
    }

    const status = result.allPassed ? "connected" : "needs_setup";
    // Snapshot the connected branch's current head SHA when we save the site as
    // needs_setup. Undo setup uses it later to restore the pre-setup tree as
    // one revert commit. On a fully-connected save (setup already done) we
    // leave the column null — there is no pre-setup snapshot to remember.
    const preSetupSha = status === "needs_setup" ? (result.headSha ?? null) : null;
    const repoFields: Record<string, unknown> = {
      repo_owner: repoOwner,
      repo_name: repoName,
      branch,
      github_installation_id: result.installation.id,
      status,
    };
    if (preSetupSha) repoFields.pre_setup_commit_sha = preSetupSha;
    const { data, error } = existing
      ? await caller.supabase
          .from("sites")
          .update({ ...repoFields, ...(liveUrl ? { live_url: liveUrl } : {}), ...(optionalString(body, "name") ? { name } : {}) })
          .eq("id", existing.id)
          .select("id, name, status")
          .single()
      : await caller.supabase
          .from("sites")
          .insert({ agency_id: agencyId, name, live_url: liveUrl ?? null, ...repoFields })
          .select("id, name, status")
          .single();

    if (error) {
      if (error.code === "23505") {
        throw new ArmatureError(
          "conflict",
          `${repoOwner}/${repoName} on branch "${branch}" is already connected as a site.`,
        );
      }
      throw new ArmatureError("github_error", `The checks passed but the site could not be saved: ${error.message}`);
    }

    const savedSite = data as { id: string; name: string; status: "connected" | "needs_setup" };
    return {
      ok: true,
      allPassed: result.allPassed,
      needsSetup: !result.allPassed,
      checks: result.checks,
      site: { id: savedSite.id, name: savedSite.name, status: savedSite.status },
    };
  }),
);
