/**
 * stats-ingest — accepts one visitor beacon per page view. Public endpoint
 * (verify_jwt is off in supabase/config.toml) so anonymous browsers can post
 * without carrying a JWT; only origins that match the site's live_url are
 * accepted, and every visitor is rate-limited. Privacy: no cookies, no IPs
 * stored; a day-rotating salted hash is used to count a visitor once a day
 * and becomes unrecoverable at the next salt rotation.
 */
import { adminClient } from "../_shared/auth.ts";
import { denoEnv } from "../_shared/env.ts";
import { readJsonBody, serveJson } from "../_shared/http.ts";
import { handleStatsIngest } from "../_shared/statsIngest.ts";

Deno.serve(
  serveJson(async (req): Promise<{ ok: true }> => {
    const env = denoEnv();
    const rawBody = await readJsonBody(req);
    return await handleStatsIngest(env, req, rawBody, { db: adminClient(env) });
  }),
);
