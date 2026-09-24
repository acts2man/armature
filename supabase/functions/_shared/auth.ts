/**
 * Caller authentication and database access for the edge functions.
 *
 * SERVER ONLY.
 *
 * `resolveCaller` verifies the bearer token that supabase-js sends from the browser
 * and returns a Supabase client scoped to that user, so every query it makes runs
 * under row-level security as them. `adminClient` uses the service-role key and
 * bypasses RLS; it is used only where documented: writing publish history, setting
 * a site's derived status, and accepting invites.
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { ArmatureError } from "./errors.ts";
import { envValue, type Env } from "./env.ts";

// deno-lint-ignore no-explicit-any
export type Db = SupabaseClient<any, "public", any>;

export type Caller = {
  userId: string;
  email: string;
  /** Scoped to the caller's token, so every query runs as them under RLS. */
  supabase: Db;
};

function supabaseUrl(env: Env): string {
  const url = envValue(env, "SUPABASE_URL");
  if (!url) throw new ArmatureError("not_configured", "SUPABASE_URL is missing from the function environment.");
  return url;
}

function publishableKey(env: Env): string {
  const key = envValue(env, "SUPABASE_PUBLISHABLE_KEY") || envValue(env, "SUPABASE_ANON_KEY");
  if (!key) {
    throw new ArmatureError(
      "not_configured",
      "SUPABASE_ANON_KEY is missing from the function environment.",
    );
  }
  return key;
}

/** Pull the bearer token off the incoming request, or explain what is missing. */
export function readBearerToken(req: Request): string {
  const header = req.headers.get("authorization");
  if (!header) {
    throw new ArmatureError(
      "forbidden",
      "Your browser did not send a sign-in token with this request. Reload the page, and sign in again if that does not help.",
    );
  }
  if (!header.startsWith("Bearer ")) {
    throw new ArmatureError("forbidden", "Your sign-in token was not sent in the expected format.");
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token || token.split(".").length !== 3) {
    throw new ArmatureError(
      "forbidden",
      "Your sign-in token is not readable. Sign out and sign in again.",
    );
  }
  return token;
}

/** Verify the caller and return a client scoped to them. Never throws a bare Error. */
export async function resolveCaller(req: Request, env: Env): Promise<Caller> {
  const token = readBearerToken(req);
  const supabase: Db = createClient(supabaseUrl(env), publishableKey(env), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    throw new ArmatureError(
      "forbidden",
      `Your sign-in could not be verified (${error?.message ?? "no user"}). Sign out and sign in again.`,
    );
  }
  return {
    userId: data.user.id,
    email: data.user.email ?? "",
    supabase,
  };
}

/** A service-role client. Bypasses RLS: use only where the function documents it. */
export function adminClient(env: Env): Db {
  const key = envValue(env, "SUPABASE_SERVICE_ROLE_KEY");
  if (!key) {
    throw new ArmatureError(
      "not_configured",
      "SUPABASE_SERVICE_ROLE_KEY is missing from the function environment.",
    );
  }
  return createClient(supabaseUrl(env), key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export type SiteRow = {
  id: string;
  agency_id: string;
  name: string;
  /** Null until a repository is connected (a hosting-only site). */
  repo_owner: string | null;
  repo_name: string | null;
  branch: string | null;
  live_url: string | null;
  github_installation_id: number | null;
  status: "connected" | "needs_attention" | "hosting_only";
  last_published_at: string | null;
  created_at: string;
  /** What clients may do in the visual editor (page builder migration). Absent before it is applied. */
  editing_level?: "content" | "style" | "builder" | null;
};

/** A site whose repository is connected: every repository field is present. */
export type ConnectedSiteRow = SiteRow & {
  repo_owner: string;
  repo_name: string;
  branch: string;
  github_installation_id: number;
};

/**
 * Pages, publishing and the connection check need a repository. A hosting-only
 * site has none, and this says so instead of failing deeper down.
 */
export function requireConnectedSite(site: SiteRow): ConnectedSiteRow {
  if (site.status === "hosting_only" || !site.repo_owner || !site.repo_name || !site.branch || site.github_installation_id === null) {
    throw new ArmatureError(
      "invalid",
      `${site.name} is a hosting-only site: no repository is connected yet, so there are no pages to edit or publish. The agency can connect one under Projects.`,
    );
  }
  return site as ConnectedSiteRow;
}

/**
 * The site, if the caller may edit it. RLS decides: agency staff of the owning
 * agency and client members of the site see the row; nobody else does.
 */
export async function loadAccessibleSite(db: Db, siteId: string): Promise<SiteRow> {
  const { data, error } = await db.from("sites").select("*").eq("id", siteId).maybeSingle();
  if (error) throw new ArmatureError("github_error", `Could not read the site: ${error.message}`);
  if (!data) {
    throw new ArmatureError(
      "forbidden",
      "This site does not exist, or your account does not have access to it.",
    );
  }
  return data as SiteRow;
}

/** The caller's role in an agency, or a forbidden error. */
export async function requireAgencyMember(
  db: Db,
  agencyId: string,
  userId: string,
): Promise<"owner" | "staff"> {
  const { data, error } = await db
    .from("agency_members")
    .select("role")
    .eq("agency_id", agencyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new ArmatureError("github_error", `Could not check your agency role: ${error.message}`);
  if (!data) {
    throw new ArmatureError(
      "forbidden",
      "Only agency staff can do this, and your account is not a member of that agency.",
    );
  }
  return (data as { role: "owner" | "staff" }).role;
}

export async function linkedInstallationIds(db: Db, agencyId: string): Promise<number[]> {
  const { data, error } = await db
    .from("github_installations")
    .select("installation_id")
    .eq("agency_id", agencyId);
  if (error) throw new ArmatureError("github_error", `Could not read GitHub installations: ${error.message}`);
  return ((data ?? []) as { installation_id: number }[]).map((row) => Number(row.installation_id));
}
