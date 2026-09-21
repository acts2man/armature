/**
 * invite-create — agency staff invite a person by email, either to one site (as a
 * client owner/editor) or to the agency itself (as staff/owner).
 *
 * Email delivery is a STUB in v0.1: the link is logged to the function's logs and
 * returned to the agency member, who can copy it to the client. `emailed` is false
 * so the dashboard says so plainly.
 *
 * Authorisation: agency membership under RLS; the invite row is inserted with the
 * caller's client. Only the SHA-256 hash of the token is stored. No service role.
 */
import type { InviteCreateResponse, InviteRole } from "../../../shared/publishTypes.ts";
import { requireAgencyMember, resolveCaller } from "../_shared/auth.ts";
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

    // Email stub. Replace this log line with a real send when an email provider is chosen.
    console.log(`[invite-create] Invite for ${email} (${role}${siteId ? `, site ${siteId}` : ""}): ${inviteUrl}`);

    return {
      ok: true,
      invite_id: (data as { id: string }).id,
      invite_url: inviteUrl,
      expires_at: expiresAt,
      emailed: false,
    };
  }),
);
