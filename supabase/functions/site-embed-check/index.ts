/**
 * site-embed-check — when the visual editor cannot load a site, this says why:
 * it fetches the site's live URL (public, no credentials, no secrets involved) and
 * reports the X-Frame-Options and Content-Security-Policy frame-ancestors headers,
 * so the editor can name the exact header to change.
 *
 * Authorisation: RLS on the site row (agency staff or site member).
 * Service role: not used.
 */
import { loadAccessibleSite, resolveCaller } from "../_shared/auth.ts";
import { checkEmbed } from "../_shared/embedCheck.ts";
import { denoEnv } from "../_shared/env.ts";
import { ArmatureError } from "../_shared/errors.ts";
import { readJsonBody, requireUuid, serveJson } from "../_shared/http.ts";

Deno.serve(
  serveJson(async (req) => {
    const env = denoEnv();
    const body = await readJsonBody(req);
    const siteId = requireUuid(body, "site_id");
    const caller = await resolveCaller(req, env);
    const site = await loadAccessibleSite(caller.supabase, siteId);
    if (!site.live_url) {
      throw new ArmatureError("invalid", `${site.name} has no live URL yet, so there is nothing to show in the visual editor. The agency can add one under Projects.`);
    }
    return await checkEmbed(site.live_url);
  }),
);
