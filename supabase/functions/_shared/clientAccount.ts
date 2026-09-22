/**
 * Client logins that the agency creates itself ("Create client login") and the
 * forced first-sign-in password change that follows.
 *
 * SERVER ONLY. The decisions live in `createClientLogin` and `setOwnPassword`,
 * which talk to small ports so the tests can stand in a fake Supabase; the real
 * ports at the bottom wrap supabase-js.
 *
 * Service role: REQUIRED for both, and documented here.
 *   - Creating an auth user, marking its email confirmed, setting user metadata
 *     and app_metadata all go through the GoTrue Admin API, which only the
 *     service-role key may call. There is no way to do it as the signed-in agency
 *     member: their token can only manage their own account.
 *   - The site membership for the new person is inserted with the service role
 *     too, because the caller's RLS policy allows it (agency staff insert) but the
 *     brand-new user has no session yet and the row must exist before they sign in.
 *     The caller's right to do this is checked first, with the caller's own token.
 *   - app_metadata (where `must_change_password` lives) cannot be changed by the
 *     user themselves, on purpose: that is what makes the flag trustworthy. So
 *     clearing it after the person has chosen their own password also needs the
 *     service role, after this code has verified the caller IS that person.
 *
 * The temporary password is never logged and never returned: it only exists in
 * the request body and in the call that creates the user.
 */
import { passwordProblem } from "../../../shared/passwordRules.ts";
import type { ClientCreateResponse, SiteRole } from "../../../shared/publishTypes.ts";
import type { Db } from "./auth.ts";
import { ArmatureError } from "./errors.ts";

export const CLIENT_ROLES: SiteRole[] = ["client_owner", "client_editor"];
export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// --- ports ------------------------------------------------------------------------

export type SiteLite = { id: string; agency_id: string; name: string };

/** Reads made with the CALLER's token, so RLS applies. */
export type CallerPort = {
  userId: string;
  email: string;
  /** The site as the caller can see it under RLS, or null. */
  loadSite(siteId: string): Promise<SiteLite | null>;
  /** The caller's role in the agency, or null when they are not a member. */
  agencyRole(agencyId: string): Promise<"owner" | "staff" | null>;
};

export type AuthUserLite = {
  id: string;
  email: string;
  app_metadata: Record<string, unknown>;
};

/** The GoTrue Admin API, service role. */
export type AdminAuthPort = {
  findUserByEmail(email: string): Promise<AuthUserLite | null>;
  createConfirmedUser(input: { email: string; password: string; fullName: string }): Promise<AuthUserLite>;
  getUserById(userId: string): Promise<AuthUserLite | null>;
  updateUser(userId: string, patch: { password?: string; app_metadata?: Record<string, unknown> }): Promise<void>;
};

/** Table writes with the service role. */
export type AdminDataPort = {
  /** "added" when a new row was inserted; "already_member" when one existed (its role is left alone). */
  addSiteMember(siteId: string, userId: string, role: SiteRole): Promise<"added" | "already_member">;
  upsertProfile(userId: string, email: string, fullName: string): Promise<void>;
};

// --- create a client login ---------------------------------------------------------

export type ClientCreateInput = {
  siteId: string;
  fullName: string;
  email: string;
  temporaryPassword: string;
  role: string;
};

export type ClientCreateDeps = {
  caller: CallerPort;
  auth: AdminAuthPort;
  data: AdminDataPort;
  /** APP_URL (or the request origin), no trailing slash. */
  appBaseUrl: string;
  /** Where one line about the outcome goes. Defaults to console.log. Never sees the password. */
  log?: (line: string) => void;
};

/** Validate and normalise the request. Throws a plain-English ArmatureError. */
export function normaliseClientCreateInput(input: ClientCreateInput): ClientCreateInput & { role: SiteRole } {
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  if (!EMAIL_PATTERN.test(email)) throw new ArmatureError("invalid", "That does not look like an email address.");
  if (fullName.length === 0) throw new ArmatureError("invalid", "Enter the person's name.");
  if (fullName.length > 120) throw new ArmatureError("invalid", "The name is too long (120 characters at most).");
  if (!CLIENT_ROLES.includes(input.role as SiteRole)) {
    throw new ArmatureError("invalid", `Unknown role "${input.role}". Choose Client owner or Client editor.`);
  }
  const problem = passwordProblem(input.temporaryPassword, email);
  if (problem) throw new ArmatureError("invalid", `That temporary password is not allowed. ${problem}`);
  return { ...input, email, fullName, role: input.role as SiteRole };
}

export async function createClientLogin(raw: ClientCreateInput, deps: ClientCreateDeps): Promise<ClientCreateResponse> {
  const input = normaliseClientCreateInput(raw);
  const log = deps.log ?? ((line: string) => console.log(line));

  // 1. The site, as the caller sees it, and the caller's standing in its agency.
  const site = await deps.caller.loadSite(input.siteId);
  if (!site) {
    throw new ArmatureError("forbidden", "That site does not exist, or it does not belong to your agency.");
  }
  const role = await deps.caller.agencyRole(site.agency_id);
  if (!role) {
    throw new ArmatureError(
      "forbidden",
      "Only agency staff can create client logins, and your account is not a member of the agency that owns this site.",
    );
  }

  // 2. Does an account already exist for this email?
  const existing = await deps.auth.findUserByEmail(input.email);
  const signInUrl = `${deps.appBaseUrl}/signin`;

  if (existing) {
    // Their password is theirs; we only grant access.
    const membership = await deps.data.addSiteMember(site.id, existing.id, input.role);
    log(`[client-create] existing account ${input.email} given access to site ${site.id} (${membership})`);
    return {
      ok: true,
      outcome: "already_existed",
      email: input.email,
      site_name: site.name,
      sign_in_url: signInUrl,
      message:
        membership === "already_member"
          ? `This person already has an account and already had access to ${site.name}. Their existing password still applies.`
          : `This person already has an account; they were given access to ${site.name}. Their existing password still applies.`,
    };
  }

  // 3. A new account: email confirmed, name in user metadata, and the flag that
  //    forces them to choose their own password on first sign-in.
  let user: AuthUserLite;
  try {
    user = await deps.auth.createConfirmedUser({
      email: input.email,
      password: input.temporaryPassword,
      fullName: input.fullName,
    });
  } catch (error) {
    if (error instanceof ArmatureError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new ArmatureError("github_error", `The account could not be created: ${detail}`);
  }

  await deps.data.upsertProfile(user.id, input.email, input.fullName);
  await deps.data.addSiteMember(site.id, user.id, input.role);
  log(`[client-create] created account ${input.email} with access to site ${site.id} as ${input.role}`);

  return {
    ok: true,
    outcome: "created",
    email: input.email,
    site_name: site.name,
    sign_in_url: signInUrl,
    message: `An account was created for ${input.email} with access to ${site.name}. They will be asked to choose their own password the first time they sign in.`,
  };
}

// --- the person chooses their own password --------------------------------------

export type SetOwnPasswordInput = {
  /** From the verified sign-in token, never from the request body. */
  userId: string;
  email: string;
  password: string;
};

/**
 * Set the caller's own password and clear `must_change_password`. The caller was
 * verified from their token; the service role is needed only because app_metadata
 * is not user-editable.
 */
export async function setOwnPassword(input: SetOwnPasswordInput, auth: AdminAuthPort): Promise<void> {
  const problem = passwordProblem(input.password, input.email);
  if (problem) throw new ArmatureError("invalid", problem);

  const user = await auth.getUserById(input.userId);
  if (!user) throw new ArmatureError("forbidden", "Your account could not be found. Sign out and sign in again.");

  await auth.updateUser(user.id, {
    password: input.password,
    app_metadata: { ...user.app_metadata, must_change_password: false },
  });
}

// --- real ports on supabase-js -----------------------------------------------------

export function callerPort(db: Db, userId: string, email: string): CallerPort {
  return {
    userId,
    email,
    async loadSite(siteId) {
      const { data, error } = await db.from("sites").select("id, agency_id, name").eq("id", siteId).maybeSingle();
      if (error) throw new ArmatureError("github_error", `Could not read the site: ${error.message}`);
      return (data as SiteLite | null) ?? null;
    },
    async agencyRole(agencyId) {
      const { data, error } = await db
        .from("agency_members")
        .select("role")
        .eq("agency_id", agencyId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new ArmatureError("github_error", `Could not check your agency role: ${error.message}`);
      return (data as { role: "owner" | "staff" } | null)?.role ?? null;
    },
  };
}

type RawUser = { id: string; email?: string | null; app_metadata?: Record<string, unknown> | null };

function liteUser(user: RawUser): AuthUserLite {
  return { id: user.id, email: (user.email ?? "").toLowerCase(), app_metadata: user.app_metadata ?? {} };
}

const LIST_PAGE = 1000;
const LIST_PAGES_MAX = 20;

export function adminAuthPort(admin: Db): AdminAuthPort {
  const getUserById = async (userId: string): Promise<AuthUserLite | null> => {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error) {
      if (error.status === 404) return null;
      throw new ArmatureError("github_error", `Could not read the account: ${error.message}`);
    }
    return data.user ? liteUser(data.user as RawUser) : null;
  };

  return {
    getUserById,

    async findUserByEmail(email) {
      const wanted = email.toLowerCase();
      // Fast path: the profiles mirror (kept in step with auth.users by a trigger).
      // `_` and `%` are wildcards to ilike, and `_` is common in addresses.
      const pattern = wanted.replace(/[\\%_]/g, (char) => `\\${char}`);
      const { data: profile, error } = await admin
        .from("profiles")
        .select("id")
        .ilike("email", pattern)
        .limit(1)
        .maybeSingle();
      if (error) throw new ArmatureError("github_error", `Could not look up the email address: ${error.message}`);
      if (profile) {
        const user = await getUserById((profile as { id: string }).id);
        if (user && user.email === wanted) return user;
      }
      // Slow path: the mirror can lag, so scan the auth users before creating a duplicate.
      for (let page = 1; page <= LIST_PAGES_MAX; page += 1) {
        const { data, error: listError } = await admin.auth.admin.listUsers({ page, perPage: LIST_PAGE });
        if (listError) throw new ArmatureError("github_error", `Could not list accounts: ${listError.message}`);
        const users = (data?.users ?? []) as RawUser[];
        const hit = users.find((user) => (user.email ?? "").toLowerCase() === wanted);
        if (hit) return liteUser(hit);
        if (users.length < LIST_PAGE) break;
      }
      return null;
    },

    async createConfirmedUser({ email, password, fullName }) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
        app_metadata: { must_change_password: true },
      });
      if (error) {
        const exists = error.code === "email_exists" || /already (been )?registered/i.test(error.message);
        if (exists) {
          throw new ArmatureError(
            "conflict",
            "An account with this email address was created a moment ago by someone else. Try again to give it access.",
          );
        }
        throw new ArmatureError("github_error", `Supabase would not create the account: ${error.message}`);
      }
      if (!data.user) throw new ArmatureError("github_error", "Supabase did not return the new account.");
      return liteUser(data.user as RawUser);
    },

    async updateUser(userId, patch) {
      const { error } = await admin.auth.admin.updateUserById(userId, patch);
      if (error) throw new ArmatureError("github_error", `The password could not be saved: ${error.message}`);
    },
  };
}

export function adminDataPort(admin: Db): AdminDataPort {
  return {
    async addSiteMember(siteId, userId, role) {
      const { data: current, error: readError } = await admin
        .from("site_members")
        .select("user_id")
        .eq("site_id", siteId)
        .eq("user_id", userId)
        .maybeSingle();
      if (readError) throw new ArmatureError("github_error", `Could not check the site's members: ${readError.message}`);
      if (current) return "already_member";
      const { error } = await admin.from("site_members").insert({ site_id: siteId, user_id: userId, role });
      if (error) {
        // A concurrent insert of the same row is fine: the person is a member either way.
        if (error.code === "23505") return "already_member";
        throw new ArmatureError("github_error", `Could not add the person to the site: ${error.message}`);
      }
      return "added";
    },
    async upsertProfile(userId, email, fullName) {
      const { error } = await admin
        .from("profiles")
        .upsert({ id: userId, email, full_name: fullName }, { onConflict: "id" });
      if (error) console.error("[client-create] could not update the profile:", error.message);
    },
  };
}
