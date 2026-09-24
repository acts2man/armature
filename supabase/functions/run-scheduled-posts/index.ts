/**
 * run-scheduled-posts — called every 5 minutes by pg_cron. For each row in
 * public.scheduled_posts whose fire_at has arrived, re-commit the post's file
 * (identical bytes, just a fresh commit) so Netlify rebuilds and the site starts
 * showing it. The row is then deleted.
 *
 * The post file must already be in the site's repository; the editor wrote it when
 * the person clicked "Schedule". This function only nudges Netlify — it never
 * changes the post's content.
 */
import { adminClient } from "../_shared/auth.ts";
import { denoEnv } from "../_shared/env.ts";
import { serveJson } from "../_shared/http.ts";
import { loadAppConfig, mintInstallationToken } from "../_shared/githubApp.ts";
import { createGithubContentRepo } from "../_shared/githubRepo.ts";

type ScheduledRow = { id: string; site_id: string; post_slug: string; fire_at: string };
type SiteRow = { id: string; agency_id: string; repo_owner: string | null; repo_name: string | null; branch: string | null; github_installation_id: number | null };

Deno.serve(
  serveJson(async (): Promise<{ ok: true; fired: string[] }> => {
    const env = denoEnv();
    const db = adminClient(env);
    const fired: string[] = [];
    const now = new Date().toISOString();

    const { data, error } = await db.from("scheduled_posts").select("id, site_id, post_slug, fire_at").lte("fire_at", now).order("fire_at", { ascending: true }).limit(50);
    if (error) throw new Error(`could not read scheduled posts: ${error.message}`);

    const rows = (data ?? []) as ScheduledRow[];
    for (const row of rows) {
      const { data: site } = await db.from("sites").select("id, agency_id, repo_owner, repo_name, branch, github_installation_id").eq("id", row.site_id).maybeSingle();
      const s = site as SiteRow | null;
      if (!s || !s.repo_owner || !s.repo_name || !s.branch || s.github_installation_id === null) {
        console.log(`[run-scheduled-posts] site ${row.site_id} not connected; skipping post ${row.post_slug}`);
        await db.from("scheduled_posts").delete().eq("id", row.id);
        continue;
      }
      try {
        const token = await mintInstallationToken(loadAppConfig(env), s.github_installation_id, s.repo_name);
        const repo = createGithubContentRepo({ token: token.token, repo: `${s.repo_owner}/${s.repo_name}`, branch: s.branch });
        const head = await repo.getBranchHead();
        const path = `content/posts/${row.post_slug}.json`;
        const file = await repo.readTextFile(path, head).catch(() => null);
        if (!file) {
          console.log(`[run-scheduled-posts] post file missing for ${row.post_slug}; skipping`);
        } else {
          await repo.commit({
            message: `Post "${row.post_slug}" scheduled publish`,
            files: [{ path, content: file.text, encoding: "utf-8" }],
            parentCommitSha: head,
          });
          fired.push(row.post_slug);
        }
      } catch (cause) {
        console.error(`[run-scheduled-posts] failed for ${row.post_slug}:`, cause instanceof Error ? cause.message : cause);
        // Leave the row so the next run tries again.
        continue;
      }
      await db.from("scheduled_posts").delete().eq("id", row.id);
    }
    return { ok: true, fired };
  }),
);
