/**
 * undo-kit-update — one-click Undo for a previously-committed Update kit.
 *
 * Given a kit_updates row id, restores the site's kit folder to the exact
 * contents at the update's `previous_commit_sha` (recorded when the original
 * update commit landed) as a NEW commit on top of the branch's current head.
 * Nothing is force-pushed; the old update commit stays in git history.
 *
 * A new kit_updates row records the undo with `status = 'undo_pushed'` and
 * `previous_commit_sha` set to the branch head at undo time, so the row can
 * itself be undone if the agency changes their mind.
 *
 * Agency staff only. The undone row must:
 *   - belong to the site the caller can access;
 *   - have been in status `commit_pushed`, `live_confirmed` or
 *     `needs_attention` (not already undone);
 *   - carry `previous_commit_sha` (rows from before the snapshot migration
 *     would have this empty; those are refused with a helpful message).
 */
import { adminClient, loadAccessibleSite, requireAgencyMember, requireConnectedSite, resolveCaller } from "../_shared/auth.ts";
import { denoEnv } from "../_shared/env.ts";
import { ArmatureError } from "../_shared/errors.ts";
import { loadAppConfig, mintInstallationToken } from "../_shared/githubApp.ts";
import { createGithubContentRepo } from "../_shared/githubRepo.ts";
import { readJsonBody, requireUuid, serveJson } from "../_shared/http.ts";
import { buildUndoFiles, readKitFilesAtRef } from "../_shared/undoKit.ts";

Deno.serve(
  serveJson(async (req): Promise<{ ok: true; commit: { sha: string; url: string }; restored_version: string | null; update_id: string | null }> => {
    const env = denoEnv();
    const body = await readJsonBody(req);
    const updateId = requireUuid(body, "update_id");
    const caller = await resolveCaller(req, env);

    const admin = adminClient(env);
    const { data: row, error: rowError } = await admin
      .from("kit_updates")
      .select("id, site_id, from_version, to_version, previous_commit_sha, status")
      .eq("id", updateId)
      .maybeSingle();
    if (rowError) throw new ArmatureError("github_error", `Could not read the kit update row: ${rowError.message}`);
    if (!row) throw new ArmatureError("invalid", "That kit update no longer exists.");

    const site = await loadAccessibleSite(caller.supabase, (row as { site_id: string }).site_id);
    await requireAgencyMember(caller.supabase, site.agency_id, caller.userId);
    const connected = requireConnectedSite(site);

    const previousSha = (row as { previous_commit_sha: string | null }).previous_commit_sha;
    if (!previousSha) {
      throw new ArmatureError(
        "invalid",
        "This update was recorded before Armature started saving the previous commit, so Undo can't run against it. Push a new commit yourself, or update the kit to the current version first (that lets Armature keep a snapshot for future Undos).",
      );
    }

    const status = (row as { status: string }).status;
    if (["undo", "undo_pushed", "undo_confirmed"].includes(status)) {
      throw new ArmatureError("invalid", "This update has already been undone.");
    }

    const { data: siteRow } = await admin.from("sites").select("kit_path").eq("id", site.id).maybeSingle();
    const kitPath = (siteRow as { kit_path?: string } | null)?.kit_path?.trim() || "src/lib/armature-kit";

    const token = await mintInstallationToken(loadAppConfig(env), connected.github_installation_id, connected.repo_name);
    const repo = createGithubContentRepo({ token: token.token, repo: `${connected.repo_owner}/${connected.repo_name}`, branch: connected.branch });

    const restoredFiles = await readKitFilesAtRef(repo, kitPath, previousSha);
    const headBefore = await repo.getBranchHead();
    const currentFiles = await readKitFilesAtRef(repo, kitPath, headBefore);
    const files = buildUndoFiles({ kitPath, restoredFiles, currentFiles });
    if (files.length === 0) {
      throw new ArmatureError("invalid", "The kit folder is already identical to the previous version — nothing to undo.");
    }

    const restoredVersion = restoredFiles["version.ts"]?.match(/KIT_VERSION\s*=\s*["']([^"']+)["']/)?.[1]
      ?? restoredFiles["index.ts"]?.match(/KIT_VERSION\s*=\s*["']([^"']+)["']/)?.[1]
      ?? null;

    const fromVersion = (row as { to_version: string }).to_version;
    const toLabel = restoredVersion ?? ((row as { from_version: string }).from_version || "the previous version");
    const commit = await repo.commit({
      message: `Undo Armature kit ${fromVersion} → ${toLabel}`,
      files,
      parentCommitSha: headBefore,
    });

    // Snapshot on public.sites: repo now carries the restored version; the live watcher will
    // update kit_version_live once Netlify rebuilds.
    try {
      await admin
        .from("sites")
        .update({
          kit_version_in_repo: restoredVersion,
          kit_verdict: null, // computed on next kit-status probe (may be update_available now)
          kit_probed_at: new Date().toISOString(),
        })
        .eq("id", site.id);
    } catch (err) {
      console.error("[undo-kit-update] could not update site snapshot columns:", err instanceof Error ? err.message : err);
    }

    // Mark the original row as `undo` and record a new kit_updates row for the undo commit so
    // the live watcher picks it up and Undo of Undo is possible.
    let newRowId: string | null = null;
    try {
      await admin.from("kit_updates").update({ status: "undo" }).eq("id", updateId);
      const insert = await admin
        .from("kit_updates")
        .insert({
          site_id: site.id,
          from_version: fromVersion,
          to_version: restoredVersion ?? toLabel,
          commit_sha: commit.commitSha,
          commit_url: commit.commitUrl,
          previous_commit_sha: headBefore,
          requested_by: caller.userId,
          status: "undo_pushed",
          status_detail: `Undo of ${updateId}`,
        })
        .select("id")
        .maybeSingle();
      newRowId = ((insert.data as { id?: string } | null)?.id) ?? null;
    } catch (err) {
      console.error("[undo-kit-update] could not record kit_updates row:", err instanceof Error ? err.message : err);
    }

    return {
      ok: true,
      commit: { sha: commit.commitSha, url: commit.commitUrl },
      restored_version: restoredVersion,
      update_id: newRowId,
    };
  }),
);
