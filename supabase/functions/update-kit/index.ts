/**
 * update-kit — one-click kit update. Agency staff only.
 *
 * Reads the site's current kit_path, plans the diff against the bundled
 * kit-package.json, and commits every add/change/delete under kit_path in ONE
 * commit. On success the site's next build (Netlify) picks up the new version;
 * data-armature-kit on <html> then reports the new number to Armature.
 *
 * Refuses when the site's current kit files differ from the previous version's
 * package (local edits), unless the caller passes overwrite=true. Records the
 * outcome in public.kit_updates for the history tab.
 */
import { adminClient, loadAccessibleSite, requireAgencyMember, requireConnectedSite, resolveCaller } from "../_shared/auth.ts";
import { denoEnv } from "../_shared/env.ts";
import { ArmatureError } from "../_shared/errors.ts";
import { loadAppConfig, mintInstallationToken } from "../_shared/githubApp.ts";
import { createGithubContentRepo } from "../_shared/githubRepo.ts";
import { readJsonBody, requireUuid, serveJson } from "../_shared/http.ts";
import { commitFilesFor, planKitUpdate, readCurrentKitFiles, type KitPackage } from "../_shared/updateKit.ts";
import kitPackage from "./kit-package.json" with { type: "json" };

Deno.serve(
  serveJson(async (req): Promise<{ ok: true; from: string | null; to: string; commit: { sha: string; url: string }; changed: { added: number; changed: number; removed: number } }> => {
    const env = denoEnv();
    const body = await readJsonBody(req);
    const siteId = requireUuid(body, "site_id");
    const overwrite = body["overwrite"] === true;
    const caller = await resolveCaller(req, env);
    const site = await loadAccessibleSite(caller.supabase, siteId);
    await requireAgencyMember(caller.supabase, site.agency_id, caller.userId);
    const connected = requireConnectedSite(site);

    const admin = adminClient(env);
    const { data: siteRow } = await admin.from("sites").select("kit_path").eq("id", site.id).maybeSingle();
    const kitPath = (siteRow as { kit_path?: string } | null)?.kit_path?.trim() || "src/lib/armature-kit";

    const token = await mintInstallationToken(loadAppConfig(env), connected.github_installation_id, connected.repo_name);
    const repo = createGithubContentRepo({ token: token.token, repo: `${connected.repo_owner}/${connected.repo_name}`, branch: connected.branch });
    const head = await repo.getBranchHead();
    const currentFiles = await readCurrentKitFiles(repo, kitPath, head);

    const currentPackage = kitPackage as KitPackage;
    const plan = planKitUpdate({ kitPath, currentPackage, currentFiles, overwrite });
    if (!overwrite && plan.localEdits.length > 0) {
      throw new ArmatureError(
        "invalid",
        `The site's kit folder has local edits in ${plan.localEdits.length} file${plan.localEdits.length === 1 ? "" : "s"}: ${plan.localEdits.slice(0, 5).join(", ")}${plan.localEdits.length > 5 ? ", …" : ""}. Choose Overwrite to replace them.`,
        plan.localEdits,
      );
    }

    // Detect the site's current version (best-effort) so the audit row + commit message can name it.
    let fromVersion: string | null = null;
    for (const rel of ["version.ts", "index.ts"] as const) {
      const source = currentFiles[rel];
      if (!source) continue;
      const match = source.match(/KIT_VERSION\s*=\s*["']([^"']+)["']/);
      if (match) {
        fromVersion = match[1] ?? null;
        break;
      }
    }

    const toVersion = currentPackage.kitVersion;
    if (plan.toAdd.length + plan.toChange.length + plan.toRemove.length === 0) {
      throw new ArmatureError("invalid", `The site is already on kit ${toVersion}.`);
    }

    const files = commitFilesFor({ kitPath, currentPackage, currentFiles, overwrite }, plan);
    const commit = await repo.commit({
      message: fromVersion ? `Update Armature kit ${fromVersion} → ${toVersion}` : `Install Armature kit ${toVersion}`,
      files,
      parentCommitSha: head,
    });

    try {
      await admin.from("kit_updates").insert({
        site_id: site.id,
        from_version: fromVersion ?? "",
        to_version: toVersion,
        commit_sha: commit.commitSha,
        commit_url: commit.commitUrl,
        requested_by: caller.userId,
        status: "commit_pushed",
        status_detail: `${plan.toAdd.length} added, ${plan.toChange.length} changed, ${plan.toRemove.length} removed`,
      });
    } catch (err) {
      console.error("[update-kit] could not record kit_updates row:", err instanceof Error ? err.message : err);
    }

    return {
      ok: true,
      from: fromVersion,
      to: toVersion,
      commit: { sha: commit.commitSha, url: commit.commitUrl },
      changed: { added: plan.toAdd.length, changed: plan.toChange.length, removed: plan.toRemove.length },
    };
  }),
);
