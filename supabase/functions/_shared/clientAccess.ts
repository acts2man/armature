/**
 * Password reset links that agency staff issue for a client ("Reset password" on the
 * Clients screen), so a client who is locked out does not have to find "Forgot your
 * password?" themselves.
 *
 * SERVER ONLY. The decision lives in `issuePasswordReset`, which talks to small ports so
 * the tests can stand in a fake Supabase; the real ports at the bottom wrap supabase-js.
 *
 * Service role: REQUIRED, and only for the link. A recovery link is minted by the GoTrue
 * Admin API (`generateLink`), which only the service-role key may call. The caller's right
 * to ask is checked first with the caller's own token, under RLS: the person must be a
 * client member of a site whose agency the caller is staff of. Staff of another agency,
 * a fellow client, or the caller themselves get a refusal and no link.
 *
 * The link is returned to the caller to pass on (email delivery is a stub, exactly as for
 * invites) and is never logged.
 */
import type { ClientPasswordResetResponse } from "../../../shared/publishTypes.ts";
import type { Db } from "./auth.ts";
import { adminAuthPort, type AuthUserLite } from "./clientAccount.ts";
import { ArmatureError } from "./errors.ts";

// --- ports ------------------------------------------------------------------------

/** Reads made with the CALLER's token, so RLS applies. */
export type ResetCallerPort = {
  userId: string;
  /** The sites the person is a client member of, as the caller can see them, with each site's agency. */
  clientSites(userId: string): Promise<{ siteId: string; agencyId: string }[]>;
  /** The caller's role in the agency, or null when they are not a member. */
  agencyRole(agencyId: string): Promise<"owner" | "staff" | null>;
};

/** The GoTrue Admin API, service role. */
export type ResetAuthPort = {
  getUserById(userId: string): Promise<AuthUserLite | null>;
  /** `generateLink({ type: "recovery" })`: the full link the person opens. */
  recoveryLink(email: string, redirectTo: string): Promise<string>;
};

export type PasswordResetDeps = {
  caller: ResetCallerPort;
  auth: ResetAuthPort;
  /** APP_URL (or the request origin), no trailing slash. */
  appBaseUrl: string;
  /** Where one line about the outcome goes. Defaults to console.log. Never sees the link. */
  log?: (line: string) => void;
};

// --- the decision -------------------------------------------------------------------

export async function issuePasswordReset(input: { userId: string }, deps: PasswordResetDeps): Promise<ClientPasswordResetResponse> {
  const log = deps.log ?? ((line: string) => console.log(line));

  if (input.userId === deps.caller.userId) {
    throw new ArmatureError("invalid", 'To change your own password, sign out and use "Forgot your password?" on the sign-in page.');
  }

  // 1. Is this person a client of a site the caller's agency looks after? Under RLS the
  //    caller only sees memberships of their own agency's sites (and of sites they are a
  //    client of themselves, which the agency check below rules out).
  const sites = await deps.caller.clientSites(input.userId);
  const agencyIds = [...new Set(sites.map((site) => site.agencyId))];
  let allowed = false;
  for (const agencyId of agencyIds) {
    if (await deps.caller.agencyRole(agencyId)) {
      allowed = true;
      break;
    }
  }
  if (!allowed) {
    throw new ArmatureError(
      "forbidden",
      "Only agency staff can reset a client's password, and this person is not a client of a site your agency looks after.",
    );
  }

  // 2. Their account, and the link.
  const user = await deps.auth.getUserById(input.userId);
  if (!user || !user.email) {
    throw new ArmatureError("not_found", "That person's account could not be found. It may have been deleted; invite them again instead.");
  }
  const resetUrl = await deps.auth.recoveryLink(user.email, `${deps.appBaseUrl}/signin`);

  // Email stub, as for invites: the link goes back to the agency member to pass on.
  log(`[client-password-reset] reset link issued for ${user.email} by ${deps.caller.userId}`);

  return { ok: true, email: user.email, reset_url: resetUrl, emailed: false };
}

// --- real ports on supabase-js -----------------------------------------------------

export function resetCallerPort(db: Db, userId: string): ResetCallerPort {
  return {
    userId,
    async clientSites(targetId) {
      const { data: members, error } = await db.from("site_members").select("site_id").eq("user_id", targetId);
      if (error) throw new ArmatureError("github_error", `Could not read the person's sites: ${error.message}`);
      const siteIds = ((members ?? []) as { site_id: string }[]).map((row) => row.site_id);
      if (siteIds.length === 0) return [];
      const { data: sites, error: sitesError } = await db.from("sites").select("id, agency_id").in("id", siteIds);
      if (sitesError) throw new ArmatureError("github_error", `Could not read the sites: ${sitesError.message}`);
      return ((sites ?? []) as { id: string; agency_id: string }[]).map((site) => ({ siteId: site.id, agencyId: site.agency_id }));
    },
    async agencyRole(agencyId) {
      const { data, error } = await db.from("agency_members").select("role").eq("agency_id", agencyId).eq("user_id", userId).maybeSingle();
      if (error) throw new ArmatureError("github_error", `Could not check your agency role: ${error.message}`);
      return (data as { role: "owner" | "staff" } | null)?.role ?? null;
    },
  };
}

export function resetAuthPort(admin: Db): ResetAuthPort {
  return {
    getUserById: adminAuthPort(admin).getUserById,
    async recoveryLink(email, redirectTo) {
      const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } });
      if (error) throw new ArmatureError("github_error", `Supabase would not create the reset link: ${error.message}`);
      const link = data?.properties?.action_link;
      if (!link) throw new ArmatureError("github_error", "Supabase did not return the reset link.");
      return link;
    },
  };
}
