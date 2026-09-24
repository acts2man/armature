/**
 * "View as client": agency staff see a site exactly as one of its clients does.
 *
 * It is client-side state only. The signed-in session, token and rights stay the staff
 * member's own; what changes is what `useAuth()` reports (no agency, not staff, the client's
 * site memberships), so the shell draws the client menu and every screen takes its client
 * branch, and the Supabase client refuses every write (src/lib/readOnly.ts) so nothing is
 * saved while the view is on. The view lives in this tab's sessionStorage, tied to the
 * staff member who started it, so a reload keeps it (and its banner) rather than quietly
 * handing full rights back on the client's screen; Exit, sign-out or another account ends it.
 */
import type { AgencyRole, Site, SiteRole } from "@/lib/types.ts";

export type ViewAsClient = {
  userId: string;
  name: string;
  email: string | null;
  /** The sites the client belongs to, with their role on each (the first is where the view opens). */
  sites: { site: Site; role: SiteRole }[];
};

type Viewable = {
  agencies: unknown[];
  sites: { site: Site; role: SiteRole }[];
  agencyRole: AgencyRole | null;
  isStaff: boolean;
};

/** The auth state as the client would see it: no agency standing, only their sites. */
export function applyViewAs<T extends Viewable>(state: T, viewAs: ViewAsClient | null): T {
  if (!viewAs) return state;
  return { ...state, agencies: [], agencyRole: null, isStaff: false, sites: viewAs.sites };
}

/** What a refused write says while the view is on. */
export function readOnlyReason(viewAs: ViewAsClient): string {
  return `You are viewing this as ${viewAs.name} would, so nothing can be saved here. Press Exit at the top of the page to go back to Clients.`;
}

/** A view in progress: who started it, and whom they see as. */
export type StoredViewAs = { staffId: string; client: ViewAsClient };

const STORAGE_KEY = "armature:view-as";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function tabStorage(): StorageLike | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** The view stored in this tab, or null when there is none or it does not read back as one. */
export function readStoredViewAs(storage: StorageLike | null = tabStorage()): StoredViewAs | null {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredViewAs> | null;
    const client = parsed?.client;
    if (!parsed || typeof parsed.staffId !== "string" || !client || typeof client.userId !== "string" || typeof client.name !== "string" || !Array.isArray(client.sites) || client.sites.length === 0) {
      return null;
    }
    return { staffId: parsed.staffId, client: { userId: client.userId, name: client.name, email: typeof client.email === "string" ? client.email : null, sites: client.sites } };
  } catch {
    return null;
  }
}

/** Remember the view in this tab (null forgets it). Storage that is blocked just means the view ends on reload. */
export function storeViewAs(entry: StoredViewAs | null, storage: StorageLike | null = tabStorage()): void {
  try {
    if (entry) storage?.setItem(STORAGE_KEY, JSON.stringify(entry));
    else storage?.removeItem(STORAGE_KEY);
  } catch {
    // A private window or blocked storage: the view lasts until the next reload.
  }
}
