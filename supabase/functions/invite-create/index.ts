/**
 * invite-create — agency staff invite a person by email, either to one site (as a
 * client owner/editor) or to the agency itself (as staff/owner).
 *
 * Email delivery is optional. When the Supabase secret RESEND_API_KEY is present AND
 * the agency has set an email_from_address under Settings › Email sending, the invite
 * goes out as a branded email in the agency's name (`emailed: true`). Otherwise the
 * link comes back for the agency to copy (`emailed: false`, `email_hint` explains why).
 *
 * Authorisation: agency membership under RLS; the invite row is inserted with the
 * caller's client. Only the SHA-256 hash of the token is stored. No service role.
 */
import type { InviteCreateResponse, InviteRole } from "../../../shared/publishTypes.ts";
import { requireAgencyMember, resolveCaller } from "../_shared/auth.ts";
import { sendAgencyEmail } from "../_shared/email.ts";
import { denoEnv } from "../_shared/env.ts";
import { ArmatureError } from "../_shared/errors.ts";
import { optionalString, readJsonBody, requireString, requireUuid, serveJson } from "../_shared/http.ts";
import { appBaseUrl, generateInviteToken, hashToken } from "../_shared/tokens.ts";

const ROLES: InviteRole[] = ["owner", "staff", "client_owner", "client_editor"];
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const INVITE_DAYS = 7;

Deno.serve(
  serveJson(async (req): Promise<InviteCreateResponse> => {
    const env = denoEnv();
    const body = await readJsonBody(req);
    const agencyId = requireUuid(body, "agency_id");
    const siteId = optionalString(body, "site_id") ?? null;
    const email = requireString(body, "email").toLowerCase();
    const role = requireString(body, "role") as InviteRole;

    if (!EMAIL_PATTERN.test(email)) throw new ArmatureError("invalid", "That does not look like an email address.");
    if (!ROLES.includes(role)) throw new ArmatureError("invalid", `Unknown role "${role}".`);
    if (siteId && !role.startsWith("client_")) {
      throw new ArmatureError("invalid", "A site invite must use the client_owner or client_editor role.");
    }
    if (!siteId && role.startsWith("client_")) {
      throw new ArmatureError("invalid", "A client invite needs a site.");
    }

    const caller = await resolveCaller(req, env);
    const callerRole = await requireAgencyMember(caller.supabase, agencyId, caller.userId);
    if (!siteId && callerRole !== "owner") {
      throw new ArmatureError("forbidden", "Only an agency owner can invite agency staff.");
    }

    if (siteId) {
      const { data: site } = await caller.supabase
        .from("sites")
        .select("id, agency_id")
        .eq("id", siteId)
        .maybeSingle();
      if (!site || (site as { agency_id: string }).agency_id !== agencyId) {
        throw new ArmatureError("forbidden", "That site does not belong to your agency.");
      }
    }

    const token = generateInviteToken();
    const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await caller.supabase
      .from("invites")
      .insert({
        agency_id: agencyId,
        site_id: siteId,
        email,
        role,
        token_hash: await hashToken(token),
        expires_at: expiresAt,
        created_by: caller.userId,
      })
      .select("id")
      .single();
    if (error) throw new ArmatureError("github_error", `Could not save the invite: ${error.message}`);

    const base = appBaseUrl(env, req);
    const inviteUrl = `${base}/invite/${token}`;

    const subject = role === "owner" || role === "staff" ? "You've been invited to Armature" : "You've been given access to your website";
    const kindLabel = siteId ? "your website" : "the agency";
    const text = [
      `Hello,`,
      ``,
      `You've been invited to ${kindLabel}. Open the link below to set your password and sign in:`,
      ``,
      inviteUrl,
      ``,
      `This link works for ${INVITE_DAYS} days.`,
    ].join("\n");

    const delivery = await sendAgencyEmail(env, agencyId, { to: [email], subject, text });
    if (!delivery.sent) {
      console.log(`[invite-create] Not emailed (${delivery.reason}). Link for ${email}: ${inviteUrl}`);
    }

    return {
      ok: true,
      invite_id: (data as { id: string }).id,
      invite_url: inviteUrl,
      expires_at: expiresAt,
      emailed: delivery.sent,
      email_hint: delivery.sent ? null : delivery.hint,
    };
  }),
);
