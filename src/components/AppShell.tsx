/**
 * The frame around every signed-in screen: the agency's portal name and logo,
 * the top-level navigation for the person's role, and sign out. Clients never
 * see the word "Armature" anywhere in here.
 */
import { clsx } from "clsx";
import { LogOut } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { Notice } from "./ui.tsx";

function navClass({ isActive }: { isActive: boolean }): string {
  return clsx(
    "inline-flex min-h-11 items-center rounded-lg px-3 text-[15px] font-medium",
    isActive ? "bg-ground text-ink" : "text-muted hover:bg-ground hover:text-text",
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  const { agency } = useAuth();
  const name = agency?.portal_name ?? "Editing dashboard";
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      {agency?.logo_url ? (
        <img src={agency.logo_url} alt="" className="h-8 w-8 shrink-0 rounded-md object-contain" />
      ) : (
        <span aria-hidden="true" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-ink font-display text-sm font-bold text-white">
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      {!compact && <span className="truncate font-display text-lg font-semibold text-ink">{name}</span>}
    </span>
  );
}

export function AppShell() {
  const { user, isStaff, sites, agencyRole, membershipsError, signOut, refresh } = useAuth();
  const navigate = useNavigate();
  const singleSite = !isStaff && sites.length === 1 ? sites[0]?.site : undefined;

  return (
    <div className="min-h-dvh bg-ground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-panel focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <NavLink to="/" className="min-w-0 shrink" aria-label="Home">
            <Brand />
          </NavLink>
          <nav aria-label="Main" className="order-3 flex w-full flex-wrap gap-1 sm:order-none sm:w-auto sm:flex-1">
            {isStaff ? (
              <>
                <NavLink to="/fleet" className={navClass}>
                  Fleet
                </NavLink>
                <NavLink to="/agency/requests" className={navClass}>
                  Change requests
                </NavLink>
                <NavLink to="/agency/settings" className={navClass}>
                  {agencyRole === "owner" ? "Agency settings" : "Agency"}
                </NavLink>
              </>
            ) : singleSite ? (
              <>
                <NavLink to={`/sites/${singleSite.id}`} end className={navClass}>
                  Home
                </NavLink>
                <NavLink to={`/sites/${singleSite.id}/pages`} className={navClass}>
                  Edit pages
                </NavLink>
                <NavLink to={`/sites/${singleSite.id}/requests`} className={navClass}>
                  Change requests
                </NavLink>
              </>
            ) : (
              <NavLink to="/" end className={navClass}>
                My sites
              </NavLink>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden max-w-[16rem] truncate text-sm text-muted sm:inline" title={user?.email ?? ""}>
              {user?.email}
            </span>
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-muted hover:bg-ground hover:text-text"
              onClick={() => {
                void signOut().then(() => navigate("/signin", { replace: true }));
              }}
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl px-4 py-6 sm:py-8">
        {membershipsError && (
          <Notice
            kind="danger"
            title="Your account's access could not be loaded"
            className="mb-6"
            action={
              <button type="button" className="underline" onClick={() => void refresh()}>
                Try again
              </button>
            }
          >
            {membershipsError}
          </Notice>
        )}
        <Outlet />
      </main>
    </div>
  );
}
