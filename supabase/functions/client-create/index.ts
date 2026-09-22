/**
 * client-create — agency staff create a client's account themselves and hand
 * over the login, instead of (or as well as) sending an invite link.
 *
 * Who may call it: an owner or staff member of the agency that owns the site,
 * checked with the caller's own token exactly like invite-create.
 *
 * Service role: REQUIRED, see _shared/clientAccount.ts for why (creating and
 * confirming an auth user, and setting the must_change_password flag in
 * app_metadata, are Admin API calls). The caller's rights are checked first with
 * their own token; the service role is only used after that.
 *
 * The temporary password is never logged and never returned.
 */
import type { ClientCreateResponse } from "../../../shared/publishTypes.ts";
import { adminClient, resolveCaller } from "../_shared/auth.ts";
import { adminAuthPort, adminDataPort, callerPort, createClientLogin } from "../_shared/clientAccount.ts";
import { denoEnv } from "../_shared/env.ts";
import { readJsonBody, requireString, requireUuid, serveJson } from "../_shared/http.ts";
import { appBaseUrl } from "../_shared/tokens.ts";

Deno.serve(
  serveJson(async (req): Promise<ClientCreateResponse> => {
    const env = denoEnv();
    const body = await readJsonBody(req);
    const input = {
      siteId: requireUuid(body, "site_id"),
      fullName: requireString(body, "full_name"),
      email: requireString(body, "email"),
      temporaryPassword: requireString(body, "temporary_password"),
      role: requireString(body, "role"),
    };

    const caller = await resolveCaller(req, env);
    const admin = adminClient(env);

    return await createClientLogin(input, {
      caller: callerPort(caller.supabase, caller.userId, caller.email),
      auth: adminAuthPort(admin),
      data: adminDataPort(admin),
      appBaseUrl: appBaseUrl(env, req),
    });
  }),
);
