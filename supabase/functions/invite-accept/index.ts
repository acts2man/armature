/**
 * invite-accept — a signed-in person redeems an invite link.
 *
 * Service role: REQUIRED here, and documented. The person accepting is not yet a
 * member of anything, so under RLS they could neither read the invite nor insert
 * their own membership. The function therefore:
 *   1. verifies the caller's sign-in (their own token),
 *   2. looks up the invite by token hash with the service role,
 *   3. refuses unless the invite is unused, unexpired, and addressed to the
 *      caller's own email,
 *   4. inserts the membership and marks the invite accepted, with the service role.
 */
import type { InviteAcceptResponse, InviteRole } from "../../../shared/publishTypes.ts";
import { adminClient, resolveCaller } from "../_shared/auth.ts";
import { denoEnv } from "../_shared/env.ts";
import { ArmatureError } from "../_shared/errors.ts";
import { readJsonBody, requireString, serveJson } from "../_shared/http.ts";
import { hashToken } from "../_shared/tokens.ts";

type InviteRow = {
  id: string;
  agency_id: string;
  site_id: string | null;
  email: string;
  role: InviteRole;
  expires_at: string;
  accepted_at: string | null;
};

Deno.serve(
  serveJson(async (req): Promise<InviteAcceptResponse> => {
    const env = denoEnv();
    const body = await readJsonBody(req);
    const token = requireString(body, "token");

    const caller = await resolveCaller(req, env);
    const admin = adminClient(env);

    const { data, error } = await admin
      .from("invites")
      .select("id, agency_id, site_id, email, role, expires_at, accepted_at")
      .eq("token_hash", await hashToken(token))
      .maybeSingle();
    if (error) throw new ArmatureError("github_error", `Could not read the invite: ${error.message}`);
    const invite = data as InviteRow | null;
    if (!invite) {
      throw new ArmatureError("not_found", "This invite link is not valid. Ask the agency to send a new one.");
    }
    if (invite.accepted_at) {
      throw new ArmatureError("invalid", "This invite has already been used. If that was you, just sign in.");
    }
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      throw new ArmatureError("invalid", "This invite has expired. Ask the agency to send a new one.");
    }
    if (invite.email.toLowerCase() !== caller.email.toLowerCase()) {
      throw new ArmatureError(
        "forbidden",
        `This invite was sent to ${invite.email}, but you are signed in as ${caller.email || "a different account"}. Sign out and sign in with the invited email address.`,
      );
    }

    if (invite.site_id) {
      const { error: memberError } = await admin
        .from("site_members")
        .upsert({ site_id: invite.site_id, user_id: caller.userId, role: invite.role }, { onConflict: "site_id,user_id" });
      if (memberError) throw new ArmatureError("github_error", `Could not add you to the site: ${memberError.message}`);
    } else {
      const { error: memberError } = await admin
        .from("agency_members")
        .upsert({ agency_id: invite.agency_id, user_id: caller.userId, role: invite.role }, { onConflict: "agency_id,user_id" });
      if (memberError) throw new ArmatureError("github_error", `Could not add you to the agency: ${memberError.message}`);
    }

    // Keep the profile mirror current even if the auth trigger did not run.
    await admin.from("profiles").upsert({ id: caller.userId, email: caller.email }, { onConflict: "id" });

    const { error: acceptError } = await admin
      .from("invites")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", invite.id);
    if (acceptError) console.error("[invite-accept] could not mark accepted:", acceptError.message);

    return { ok: true, site_id: invite.site_id, agency_id: invite.agency_id, role: invite.role };
  }),
);
