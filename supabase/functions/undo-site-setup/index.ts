/**
 * undo-site-setup — restore a site's repository to its pre-setup snapshot as
 * ONE new commit on top of the current head. Agency staff only.
 *
 * The site's `pre_setup_commit_sha` is written when site-connect first saves
 * the site as needs_setup (see 20260924001100_pre_setup_snapshot.sql). Undo
 * setup reads that SHA, computes the file diff against the current head, and
 * commits every add/change/delete needed to make the current tree byte-
 * identical to the pre-setup one. The update commits stay in git history, so
 * a re-do is a fresh setup and the Undo can be Undone with a regular git
 * revert if the agency changes their mind about their mind.
 *
 * Never a force-push. The commit message says exactly what happened.
 */
import { adminClient, loadAccessibleSite, requireAgencyMember, requireConnectedSite, resolveCaller } from "../_shared/auth.ts";
import { denoEnv } from "../_shared/env.ts";
import { ArmatureError } from "../_shared/errors.ts";
import { loadAppConfig, mintInstallationToken } from "../_shared/githubApp.ts";
import { createGithubContentRepo } from "../_shared/githubRepo.ts";
import { readJsonBody, requireUuid, serveJson } from "../_shared/http.ts";
import { buildRestoreFiles } from "../_shared/undoSiteSetup.ts";

Deno.serve(
  serveJson(async (req): Promise<{ ok: true; commit: { sha: string; url: string }; changed: { restored: number; deleted: number } }> => {
    const env = denoEnv();
    const body = await readJsonBody(req);
    const siteId = requireUuid(body, "site_id");
    const caller = await resolveCaller(req, env);
    const site = await loadAccessibleSite(caller.supabase, siteId);
    await requireAgencyMember(caller.supabase, site.agency_id, caller.userId);
    const connected = requireConnectedSite(site);

    const admin = adminClient(env);
    const { data: row } = await admin.from("sites").select("pre_setup_commit_sha").eq("id", site.id).maybeSingle();
    const preSetupSha = (row as { pre_setup_commit_sha?: string | null } | null)?.pre_setup_commit_sha ?? null;
    if (!preSetupSha) {
      throw new ArmatureError(
        "invalid",
        "Armature does not have a pre-setup snapshot for this site, so Undo setup can't run. This usually means the site was set up before Armature started saving the snapshot; you can undo the setup by hand in GitHub (revert the setup commits on the connected branch), or reset the site by removing the Armature files and re-connecting it.",
      );
    }

    const token = await mintInstallationToken(loadAppConfig(env), connected.github_installation_id, connected.repo_name);
    const repo = createGithubContentRepo({ token: token.token, repo: `${connected.repo_owner}/${connected.repo_name}`, branch: connected.branch });
    const head = await repo.getBranchHead();
    if (head === preSetupSha) {
      throw new ArmatureError("invalid", "The connected branch is already at the pre-setup snapshot; there's nothing to undo.");
    }

    const files = await buildRestoreFiles(repo, preSetupSha, head);
    if (files.length === 0) {
      throw new ArmatureError("invalid", "Nothing has changed since the pre-setup snapshot — Undo setup would be a no-op.");
    }

    const commit = await repo.commit({
      message: `Undo Armature setup (restore to ${preSetupSha.slice(0, 7)})`,
      files,
      parentCommitSha: head,
    });

    // Flip the site back to needs_setup and reset the kit snapshot so the Kit column
    // reflects reality without waiting for the next probe. Clear pre_setup_commit_sha
    // so a future setup snapshots the new starting state (the undo commit itself).
    try {
      await admin
        .from("sites")
        .update({
          status: "needs_setup",
          kit_version_in_repo: null,
          kit_version_live: null,
          kit_verdict: "not_installed",
          kit_probed_at: new Date().toISOString(),
          pre_setup_commit_sha: null,
        })
        .eq("id", site.id);
    } catch (err) {
      console.error("[undo-site-setup] could not update site row after revert:", err instanceof Error ? err.message : err);
    }

    const restored = files.filter((f) => f.delete !== true).length;
    const deleted = files.filter((f) => f.delete === true).length;
    return {
      ok: true,
      commit: { sha: commit.commitSha, url: commit.commitUrl },
      changed: { restored, deleted },
    };
  }),
);
