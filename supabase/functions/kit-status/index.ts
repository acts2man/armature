/**
 * kit-status — for a site, returns what kit version is in the repo, what's live,
 * and the verdict the UI uses to draw the Kit panel. Agency staff only (a client
 * has no reason to know or care what version their site's kit is on).
 */
import { adminClient, loadAccessibleSite, requireAgencyMember, resolveCaller } from "../_shared/auth.ts";
import { denoEnv } from "../_shared/env.ts";
import { ArmatureError } from "../_shared/errors.ts";
import { loadAppConfig, mintInstallationToken } from "../_shared/githubApp.ts";
import { createGithubContentRepo } from "../_shared/githubRepo.ts";
import { readJsonBody, requireUuid, serveJson } from "../_shared/http.ts";
import { resolveKitStatus, type KitStatus } from "../_shared/kitStatus.ts";

Deno.serve(
  serveJson(async (req): Promise<{ ok: true; status: KitStatus }> => {
    const env = denoEnv();
    const body = await readJsonBody(req);
    const siteId = requireUuid(body, "site_id");
    const caller = await resolveCaller(req, env);
    const site = await loadAccessibleSite(caller.supabase, siteId);
    await requireAgencyMember(caller.supabase, site.agency_id, caller.userId);

    if (site.status === "hosting_only" || !site.repo_owner || !site.repo_name || !site.branch || site.github_installation_id === null) {
      throw new ArmatureError("invalid", "This site has no repository yet, so there is no kit to check.");
    }

    // Read kit_path directly (RLS allows the caller to see this row). Fallback default
    // covers a fresh project not yet on migration 20260924000500.
    const admin = adminClient(env);
    const { data: siteRow } = await admin.from("sites").select("kit_path").eq("id", site.id).maybeSingle();
    const kitPath = (siteRow as { kit_path?: string } | null)?.kit_path?.trim() || "src/lib/armature-kit";

    const token = await mintInstallationToken(loadAppConfig(env), site.github_installation_id, site.repo_name);
    const repo = createGithubContentRepo({ token: token.token, repo: `${site.repo_owner}/${site.repo_name}`, branch: site.branch });
    const head = await repo.getBranchHead();
    const read = async (path: string): Promise<string | null> => {
      try {
        const file = await repo.readTextFile(path, head);
        return file.text;
      } catch {
        return null;
      }
    };
    const status = await resolveKitStatus({ kitPath, liveUrl: site.live_url, read });
    return { ok: true, status };
  }),
);
