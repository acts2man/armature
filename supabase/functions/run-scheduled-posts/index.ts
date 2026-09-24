/**
 * run-scheduled-posts — called every 5 minutes by pg_cron via pg_net, with the
 * random Vault-minted token in the `X-Armature-Token` header. The gateway's JWT
 * check is off (verify_jwt = false in supabase/config.toml) because the caller
 * carries no JWT; the function verifies the token against Vault itself. Any
 * request without the correct token answers `{ ok: true, fired: [] }` and does
 * nothing, so a probe learns nothing about the schedule.
 *
 * For each row in `public.scheduled_posts` whose `fire_at` has arrived the
 * post's file is re-committed (identical bytes, just a fresh commit) so Netlify
 * rebuilds and the site starts showing it. The row is deleted after. All the
 * logic lives in `_shared/scheduledPosts.ts` so it is testable.
 */
import { denoEnv } from "../_shared/env.ts";
import { serveJson } from "../_shared/http.ts";
import { handleScheduledPostsRequest } from "../_shared/scheduledPosts.ts";

Deno.serve(
  serveJson(async (req): Promise<{ ok: true; fired: string[] }> => {
    return await handleScheduledPostsRequest(denoEnv(), req);
  }),
);
