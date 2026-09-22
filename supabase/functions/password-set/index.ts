/**
 * password-set — a signed-in person chooses their own password, which also clears
 * the must_change_password flag an agency-created login starts with.
 *
 * Service role: REQUIRED, and only for the flag. `must_change_password` lives in
 * app_metadata, which a user cannot edit themselves (that is what makes the flag
 * trustworthy), so clearing it is an Admin API call. The caller is verified from
 * their own token first, and the only account this function ever touches is that
 * caller's own: the user id comes from the token, never from the request.
 */
import type { PasswordSetResponse } from "../../../shared/publishTypes.ts";
import { adminClient, resolveCaller } from "../_shared/auth.ts";
import { adminAuthPort, setOwnPassword } from "../_shared/clientAccount.ts";
import { denoEnv } from "../_shared/env.ts";
import { readJsonBody, requireString, serveJson } from "../_shared/http.ts";

Deno.serve(
  serveJson(async (req): Promise<PasswordSetResponse> => {
    const env = denoEnv();
    const body = await readJsonBody(req);
    const password = requireString(body, "password");

    const caller = await resolveCaller(req, env);
    await setOwnPassword({ userId: caller.userId, email: caller.email, password }, adminAuthPort(adminClient(env)));
    return { ok: true };
  }),
);
