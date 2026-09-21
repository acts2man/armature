/**
 * Wraps every /sites/:siteId/* screen: loads the site (under RLS), exposes it
 * through `useSite()`, and draws the site-level navigation. Not found and no
 * access are both spelled out rather than left blank.
 */
import { clsx } from "clsx";
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { NavLink, Outlet, useParams } from "react-router";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { supabase } from "@/lib/supabase.ts";
import type { Site } from "@/lib/types.ts";
import { LinkButton, Notice, Spinner } from "./ui.tsx";

export type SiteContextValue = {
  site: Site;
  /** True when the signed-in person is agency staff for this site's agency. */
  isStaff: boolean;
  refetch: () => Promise<unknown>;
};

const SiteContext = createContext<SiteContextValue | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useSite(): SiteContextValue {
  const value = useContext(SiteContext);
  if (!value) throw new Error("useSite must be used inside SiteLayout");
  return value;
}

// eslint-disable-next-line react-refresh/only-export-components
export const siteQueryKey = (siteId: string) => ["site", siteId] as const;

function tabClass({ isActive }: { isActive: boolean }): string {
  return clsx(
    "inline-flex min-h-11 items-center border-b-2 px-3 text-[15px] font-medium",
    isActive ? "border-accent text-ink" : "border-transparent text-muted hover:text-text",
  );
}

export function SiteLayout() {
  const { siteId = "" } = useParams();
  const { agencies, isStaff: staffAnywhere } = useAuth();

  const query = useQuery({
    queryKey: siteQueryKey(siteId),
    enabled: siteId.length > 0,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.from("sites").select("*").eq("id", siteId).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as Site | null) ?? null;
    },
  });

  if (query.isPending) {
    return <Spinner label="Loading site" />;
  }
  if (query.isError) {
    return (
      <Notice kind="danger" title="The site could not be loaded">
        {query.error.message}
      </Notice>
    );
  }
  if (!query.data) {
    return (
      <Notice
        kind="warning"
        title="This site is not available to your account"
        action={<LinkButton to="/" variant="secondary">Go home</LinkButton>}
      >
        Either it does not exist, or your account has not been given access to it. Ask the agency to invite you.
      </Notice>
    );
  }

  const site = query.data;
  const isStaff = staffAnywhere && agencies.some((membership) => membership.agency.id === site.agency_id);
  const root = `/sites/${site.id}`;

  return (
    <SiteContext.Provider value={{ site, isStaff, refetch: query.refetch }}>
      <div className="space-y-6">
        <div className="-mb-2 border-b border-line">
          <p className="mb-2 truncate text-sm text-muted">
            {isStaff ? (
              <>
                <NavLink to="/fleet" className="underline-offset-2 hover:underline">
                  Fleet
                </NavLink>
                {" / "}
              </>
            ) : null}
            <span className="font-medium text-text">{site.name}</span>
          </p>
          <nav aria-label="Site" className="-mb-px flex flex-wrap gap-1 overflow-x-auto">
            <NavLink to={root} end className={tabClass}>
              Overview
            </NavLink>
            <NavLink to={`${root}/pages`} className={tabClass}>
              Pages
            </NavLink>
            <NavLink to={`${root}/requests`} className={tabClass}>
              Change requests
            </NavLink>
            <NavLink to={`${root}/history`} className={tabClass}>
              Publish history
            </NavLink>
            {isStaff && (
              <NavLink to={`${root}/team`} className={tabClass}>
                Team
              </NavLink>
            )}
          </nav>
        </div>
        <Outlet />
      </div>
    </SiteContext.Provider>
  );
}
