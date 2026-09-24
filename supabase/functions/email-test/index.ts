/**
 * email-test — Settings › Email sending's "Send test email" button.
 *
 * Sends a plain "This is a test" message from the agency's configured from address to
 * the caller's own email. Only agency staff of the given agency may call it. The
 * caller's rights are checked with their own token first. Records the outcome on the
 * agency row (agencies.email_last_test_at / email_last_test_error) so the dashboard can
 * show when the last test succeeded and, if not, what went wrong.
 */
import { adminClient, requireAgencyMember, resolveCaller } from "../_shared/auth.ts";
import { sendAgencyEmail } from "../_shared/email.ts";
import { denoEnv } from "../_shared/env.ts";
import { ArmatureError } from "../_shared/errors.ts";
import { readJsonBody, requireUuid, serveJson } from "../_shared/http.ts";

type EmailTestResponse = {
  ok: true;
  sent: boolean;
  from: string | null;
  hint?: string | null;
};

Deno.serve(
  serveJson(async (req): Promise<EmailTestResponse> => {
    const env = denoEnv();
    const body = await readJsonBody(req);
    const agencyId = requireUuid(body, "agency_id");
    const caller = await resolveCaller(req, env);
    await requireAgencyMember(caller.supabase, agencyId, caller.userId);
    if (!caller.email) throw new ArmatureError("invalid", "Your account has no email address to send the test to.");

    const result = await sendAgencyEmail(env, agencyId, {
      to: [caller.email],
      subject: "Test email from Armature",
      text: [
        "This is a test email from Armature.",
        "",
        "If you're reading this, email sending is set up correctly for your agency — invites and password resets will now go out under your own name.",
      ].join("\n"),
    });

    const admin = adminClient(env);
    await admin
      .from("agencies")
      .update({
        email_last_test_at: result.sent ? new Date().toISOString() : null,
        email_last_test_error: result.sent ? null : ("reason" in result ? `${result.reason}: ${result.hint}` : null),
      })
      .eq("id", agencyId);

    return { ok: true, sent: result.sent, from: result.sent ? result.from : null, hint: result.sent ? null : result.hint };
  }),
);
