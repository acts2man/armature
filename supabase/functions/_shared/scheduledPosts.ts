/**
 * run-scheduled-posts helpers.
 *
 * pg_cron calls this function every 5 minutes without a JWT (verify_jwt is off
 * in supabase/config.toml). Instead of a JWT the cron job carries a random
 * `X-Armature-Token` value that was minted once and stored in Supabase Vault by
 * migration 20260924000400_scheduled_posts_dispatch.sql. This module verifies
 * that token via a security-definer RPC and, on a match, fires each row in
 * `public.scheduled_posts` whose `fire_at` has arrived by re-committing the
 * post file so Netlify rebuilds. Nothing else may call the function: an empty
 * header, the wrong value or a missing verifier all short-circuit into a
 * `{ ok: true, fired: [] }` reply.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { adminClient } from "./auth.ts";
import { type Env } from "./env.ts";
import { loadAppConfig, mintInstallationToken } from "./githubApp.ts";
import { createGithubContentRepo, type ContentRepo } from "./githubRepo.ts";

export const TOKEN_HEADER = "x-armature-token";

// deno-lint-ignore no-explicit-any
export type ScheduledPostsDb = SupabaseClient<any, "public", any>;

export type ScheduledRow = { id: string; site_id: string; post_slug: string; fire_at: string };
export type ScheduledSiteRow = { id: string; agency_id: string; repo_owner: string | null; repo_name: string | null; branch: string | null; github_installation_id: number | null };

/** Read the token out of the incoming request. Empty when the header is missing. */
export function tokenFromRequest(req: Request): string {
  return (req.headers.get(TOKEN_HEADER) ?? req.headers.get("X-Armature-Token") ?? "").trim();
}

/**
 * Ask the database whether the given token matches the Vault secret. The
 * security-definer function public.armature_check_scheduled_posts_token(text)
 * does the compare so the raw value never leaves the database. A missing
 * verifier or Vault secret is treated as a failed check, never as an accept.
 */
export async function verifyToken(db: ScheduledPostsDb, candidate: string): Promise<boolean> {
  if (!candidate) return false;
  const { data, error } = await db.rpc("armature_check_scheduled_posts_token", { candidate });
  if (error) {
    console.error("[run-scheduled-posts] token check failed:", error.message);
    return false;
  }
  return data === true;
}

export type RunHooks = {
  now?: () => string;
  /** Overrides the GitHub App installation token step, for tests. */
  mintToken?: (env: Env, installationId: number, repoName: string) => Promise<{ token: string }>;
  makeRepo?: (options: { token: string; repo: string; branch: string }) => ContentRepo;
};

/**
 * Fire every row whose fire_at has arrived. Rows for a site that has no
 * repository (hosting-only) or whose file has disappeared are quietly dropped
 * so they don't retry forever; a real GitHub failure is left in place so the
 * next cron run tries again.
 */
export async function fireDuePosts(env: Env, db: ScheduledPostsDb, hooks: RunHooks = {}): Promise<{ ok: true; fired: string[] }> {
  const now = hooks.now?.() ?? new Date().toISOString();
  const makeRepo = hooks.makeRepo ?? ((options) => createGithubContentRepo(options));
  const mintToken = hooks.mintToken ?? (async (env: Env, installationId: number, repoName: string) => await mintInstallationToken(loadAppConfig(env), installationId, repoName));
  const fired: string[] = [];

  const { data, error } = await db.from("scheduled_posts").select("id, site_id, post_slug, fire_at").lte("fire_at", now).order("fire_at", { ascending: true }).limit(50);
  if (error) throw new Error(`could not read scheduled posts: ${error.message}`);
  const rows = (data ?? []) as ScheduledRow[];

  for (const row of rows) {
    const { data: siteRow } = await db.from("sites").select("id, agency_id, repo_owner, repo_name, branch, github_installation_id").eq("id", row.site_id).maybeSingle();
    const s = siteRow as ScheduledSiteRow | null;
    if (!s || !s.repo_owner || !s.repo_name || !s.branch || s.github_installation_id === null) {
      console.log(`[run-scheduled-posts] site ${row.site_id} not connected; dropping post ${row.post_slug}`);
      await db.from("scheduled_posts").delete().eq("id", row.id);
      continue;
    }
    try {
      const token = await mintToken(env, s.github_installation_id, s.repo_name);
      const repo = makeRepo({ token: token.token, repo: `${s.repo_owner}/${s.repo_name}`, branch: s.branch });
      const head = await repo.getBranchHead();
      const path = `content/posts/${row.post_slug}.json`;
      const file = await repo.readTextFile(path, head).catch(() => null);
      if (!file) {
        console.log(`[run-scheduled-posts] post file missing for ${row.post_slug}; dropping`);
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
      continue;
    }
    await db.from("scheduled_posts").delete().eq("id", row.id);
  }
  return { ok: true, fired };
}

export type HandlerHooks = RunHooks & {
  /** Overrides the service-role Supabase client, for tests. */
  db?: ScheduledPostsDb;
};

/**
 * The full request handler. Returns an empty fired list without touching the
 * scheduled_posts table when the caller did not send the correct token, so an
 * attacker probing the endpoint learns nothing about the schedule.
 */
export async function handleScheduledPostsRequest(env: Env, req: Request, hooks: HandlerHooks = {}): Promise<{ ok: true; fired: string[] }> {
  const db = hooks.db ?? adminClient(env);
  const candidate = tokenFromRequest(req);
  const allowed = await verifyToken(db, candidate);
  if (!allowed) {
    console.warn("[run-scheduled-posts] rejected caller without a valid X-Armature-Token");
    return { ok: true, fired: [] };
  }
  return fireDuePosts(env, db, hooks);
}
