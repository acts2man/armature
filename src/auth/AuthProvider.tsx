/**
 * Session, memberships and agency branding for the whole app.
 *
 * Loads once after sign-in: the agencies the person belongs to (staff), the sites
 * they belong to (clients), and the agency whose branding applies. Everything is
 * read through RLS, so a client only ever sees their own agency's branding.
 */
import type { Session, User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { setReadOnly, supabase, supabaseConfigured } from "@/lib/supabase.ts";
import { applyAccent, applyPortalTitle } from "@/lib/theme.ts";
import type { Agency, AgencyRole, Site, SiteRole } from "@/lib/types.ts";
import { applyViewAs, readOnlyReason, readStoredViewAs, storeViewAs, type StoredViewAs, type ViewAsClient } from "./viewAs.ts";

export type AgencyMembership = { agency: Agency; role: AgencyRole };
export type SiteMembership = { site: Site; role: SiteRole };
export type { ViewAsClient } from "./viewAs.ts";

export type AuthState = {
  /** True until the session and memberships have loaded the first time. */
  loading: boolean;
  session: Session | null;
  user: User | null;
  /** Agencies the person is staff of. */
  agencies: AgencyMembership[];
  /** Sites the person is a client member of. */
  sites: SiteMembership[];
  /** The agency whose branding applies: the staff's own, or the client's site's agency. */
  agency: Agency | null;
  /** The person's role in `agency`, or null for clients. */
  agencyRole: AgencyRole | null;
  /** True when the person is agency owner or staff anywhere. */
  isStaff: boolean;
  /** A readable problem loading memberships, or null. Never swallowed. */
  membershipsError: string | null;
  /**
   * "View as client" (src/auth/viewAs.ts): while set, everything above reads as that
   * client would see it (not staff, only their sites) and every write is refused. The
   * session and the person's real rights are untouched; `stopViewAs` brings them back.
   */
  viewingAs: ViewAsClient | null;
  startViewAs: (client: ViewAsClient) => void;
  stopViewAs: () => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

type Memberships = Pick<AuthState, "agencies" | "sites" | "agency" | "agencyRole" | "membershipsError">;

const EMPTY: Memberships = { agencies: [], sites: [], agency: null, agencyRole: null, membershipsError: null };

async function loadMemberships(): Promise<Memberships> {
  const [agencyMembers, siteMembers, agencies] = await Promise.all([
    supabase.from("agency_members").select("role, agency:agencies(*)"),
    supabase.from("site_members").select("role, site:sites(*)"),
    supabase.from("agencies").select("*").order("created_at", { ascending: true }),
  ]);

  const problems = [agencyMembers.error, siteMembers.error, agencies.error].filter(Boolean).map((error) => error!.message);
  if (problems.length > 0) {
    return {
      ...EMPTY,
      membershipsError: `Could not load your account's access: ${problems.join("; ")}. If this is a new project, check that the migrations were applied (docs/SETUP.md, part A).`,
    };
  }

  const staffOf: AgencyMembership[] = ((agencyMembers.data ?? []) as unknown as { role: AgencyRole; agency: Agency | null }[])
    .filter((row) => row.agency)
    .map((row) => ({ role: row.role, agency: row.agency as Agency }));
  const memberOf: SiteMembership[] = ((siteMembers.data ?? []) as unknown as { role: SiteRole; site: Site | null }[])
    .filter((row) => row.site)
    .map((row) => ({ role: row.role, site: row.site as Site }));

  const visibleAgencies = (agencies.data ?? []) as Agency[];
  const primary = staffOf[0]?.agency ?? visibleAgencies[0] ?? null;

  return {
    agencies: staffOf,
    sites: memberOf,
    agency: primary,
    agencyRole: staffOf.find((membership) => membership.agency.id === primary?.id)?.role ?? null,
    membershipsError: null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(!supabaseConfigured);
  const [memberships, setMemberships] = useState<Memberships>(EMPTY);
  const [membershipsReady, setMembershipsReady] = useState(!supabaseConfigured);
  const loadedForUser = useRef<string | null>(null);
  // "View as client" (src/auth/viewAs.ts). The write guard flips in the same tick as the
  // state (and before the first render when a reload restores the view), so no click can
  // slip a write through between "View as" and the client's view appearing.
  const [viewAs, setViewAs] = useState<StoredViewAs | null>(() => {
    const stored = readStoredViewAs();
    setReadOnly(stored ? readOnlyReason(stored.client) : null);
    return stored;
  });
  const startViewAs = useCallback(
    (client: ViewAsClient) => {
      const staffId = session?.user?.id;
      if (!staffId) return;
      const entry = { staffId, client };
      setReadOnly(readOnlyReason(client));
      storeViewAs(entry);
      setViewAs(entry);
    },
    [session?.user?.id],
  );
  const stopViewAs = useCallback(() => {
    setReadOnly(null);
    storeViewAs(null);
    setViewAs(null);
  }, []);

  // A view belongs to the account that started it: with another account in this tab, or
  // none, it does not apply and is forgotten. Until the session is known nothing renders
  // behind RequireAuth, and the guard set above still stands.
  const activeViewAs = viewAs && sessionReady && session?.user?.id === viewAs.staffId ? viewAs : null;
  useEffect(() => {
    if (!sessionReady) return;
    setReadOnly(activeViewAs ? readOnlyReason(activeViewAs.client) : null);
    if (viewAs && !activeViewAs) storeViewAs(null);
  }, [sessionReady, viewAs, activeViewAs]);

  useEffect(() => {
    if (!supabaseConfigured) return;
    let cancelled = false;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        setSession(data.session);
        setSessionReady(true);
      })
      .catch(() => {
        if (!cancelled) setSessionReady(true);
      });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setSessionReady(true);
    });
    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!session?.user) {
      setMemberships(EMPTY);
      setMembershipsReady(true);
      return;
    }
    const next = await loadMemberships();
    setMemberships(next);
    setMembershipsReady(true);
  }, [session?.user]);

  useEffect(() => {
    if (!sessionReady) return;
    const userId = session?.user?.id ?? null;
    if (loadedForUser.current === userId && membershipsReady) return;
    loadedForUser.current = userId;
    setMembershipsReady(false);
    void refresh();
  }, [sessionReady, session?.user?.id, refresh, membershipsReady]);

  useEffect(() => {
    applyAccent(memberships.agency?.accent_color);
    applyPortalTitle(memberships.agency?.portal_name);
  }, [memberships.agency?.accent_color, memberships.agency?.portal_name]);

  const signOut = useCallback(async () => {
    stopViewAs();
    await supabase.auth.signOut();
    setMemberships(EMPTY);
    loadedForUser.current = null;
  }, [stopViewAs]);

  const value = useMemo<AuthState>(
    () => ({
      loading: !sessionReady || (Boolean(session) && !membershipsReady),
      session,
      user: session?.user ?? null,
      ...applyViewAs({ ...memberships, isStaff: memberships.agencies.length > 0 }, activeViewAs?.client ?? null),
      viewingAs: activeViewAs?.client ?? null,
      startViewAs,
      stopViewAs,
      refresh,
      signOut,
    }),
    [sessionReady, membershipsReady, session, memberships, activeViewAs, startViewAs, stopViewAs, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
