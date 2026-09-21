/**
 * site-connect — agency staff only. Given owner/repo/branch, verify the App can
 * reach the repository, that content/schema.json and content/pages.json exist and
 * validate, and create the site row. Every step is reported with a fix.
 *
 * Authorisation: the caller must be a member of the agency (checked under RLS),
 * and the site row is inserted with the caller's own client, so RLS enforces the
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

    const result = await runRepoChecks({
      env,
      repoOwner,
      repoName,
      branch,
      linkedInstallationIds: await linkedInstallationIds(caller.supabase, agencyId),
    });

    if (!result.allPassed || !result.installation) {
      return { ok: true, allPassed: false, checks: result.checks };
    }

    const { data, error } = await caller.supabase
      .from("sites")
      .insert({
        agency_id: agencyId,
        name,
        repo_owner: repoOwner,
        repo_name: repoName,
        branch,
        live_url: liveUrl ?? null,
        github_installation_id: result.installation.id,
        status: "connected",
      })
      .select("id, name")
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

    return {
      ok: true,
      allPassed: true,
      checks: result.checks,
      site: { id: (data as { id: string }).id, name: (data as { name: string }).name },
    };
  }),
);
