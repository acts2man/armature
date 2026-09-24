/**
 * client-password-reset — agency staff get a password reset link for one of their
 * clients, to pass on when the client is locked out.
 *
 * Who may call it: an owner or staff member of an agency that looks after a site the
 * client belongs to, checked with the caller's own token under RLS (see
 * _shared/clientAccess.ts). Nobody else gets a link.
 *
 * Service role: REQUIRED, see _shared/clientAccess.ts for why (minting a recovery link
 * is an Admin API call). The caller's rights are checked first with their own token;
 * the service role is only used after that.
 *
 * Email delivery is a STUB, as for invites: the link is returned to the agency member
 * and `emailed` is false. The link is never logged.
 */
import type { ClientPasswordResetResponse } from "../../../shared/publishTypes.ts";
import { adminClient, resolveCaller } from "../_shared/auth.ts";
import { issuePasswordReset, resetAuthPort, resetCallerPort } from "../_shared/clientAccess.ts";
import { sendAgencyEmail } from "../_shared/email.ts";
import { denoEnv } from "../_shared/env.ts";
import { readJsonBody, requireUuid, serveJson } from "../_shared/http.ts";
import { appBaseUrl } from "../_shared/tokens.ts";

Deno.serve(
  serveJson(async (req): Promise<ClientPasswordResetResponse> => {
    const env = denoEnv();
    const body = await readJsonBody(req);
    const userId = requireUuid(body, "user_id");

    const caller = await resolveCaller(req, env);
    const admin = adminClient(env);

    return await issuePasswordReset(
      { userId },
      {
        caller: resetCallerPort(caller.supabase, caller.userId),
        auth: resetAuthPort(admin),
        appBaseUrl: appBaseUrl(env, req),
        email: {
          send: async (agencyId, to, resetUrl) => {
            const result = await sendAgencyEmail(env, agencyId, {
              to: [to],
              subject: "Reset your password",
              text: [
                "Hello,",
                "",
                "You (or your website's agency) asked to reset your password. Open the link below to choose a new one:",
                "",
                resetUrl,
                "",
                "The link works for about an hour. If you didn't ask for a reset, ignore this message.",
              ].join("\n"),
            });
            return { sent: result.sent, hint: result.sent ? null : result.hint };
          },
        },
      },
    );
  }),
);
