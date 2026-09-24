/**
 * check-kit-live — called every two minutes by pg_cron via pg_net, with the
 * random Vault-minted token in the `X-Armature-Token` header. The gateway's
 * JWT check is off (verify_jwt = false in supabase/config.toml) because the
 * caller carries no JWT; the function verifies the token against Vault
 * itself. Any request without the correct token answers
 * `{ ok: true, checked: [] }` and does nothing.
 *
 * For every kit_updates row still in `commit_pushed` or `undo_pushed`,
 * fetches the site's live URL, reads data-armature-kit and updates the row
 * (see `_shared/kitLive.ts` for the exact rules).
 */
import { denoEnv } from "../_shared/env.ts";
import { serveJson } from "../_shared/http.ts";
import { handleCheckKitLiveRequest, type KitLiveOutcome } from "../_shared/kitLive.ts";

Deno.serve(
  serveJson(async (req): Promise<{ ok: true; checked: KitLiveOutcome[] }> => {
    return await handleCheckKitLiveRequest(denoEnv(), req);
  }),
);
