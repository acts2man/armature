/**
 * Wraps every /sites/:siteId/* screen: loads the site (under RLS), exposes it
 * through `useSite()`, and for agency staff draws the site strip (breadcrumb and
 * tabs) above the screen. Clients navigate with the sidebar instead, so they get
 * no strip. Not found and no access are both spelled out rather than left blank.
 */
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { NavLink, Outlet, useParams } from "react-router";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { supabase } from "@/lib/supabase.ts";
import type { Site } from "@/lib/types.ts";
import { IconChevronRight } from "./icons.tsx";
import { LinkButton, Monogram, Notice, Skeleton, TabBar, tabClass } from "./ui.tsx";

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
    return (
      <div className="space-y-5" role="status" aria-label="Loading site">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-40 rounded-card" />
      </div>
    );
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
        action={
          <LinkButton to="/" variant="secondary">
            Go home
          </LinkButton>
        }
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
      <div className="flex flex-col gap-5">
        {isStaff && (
          <div className="-mb-1 flex flex-col gap-2 border-b border-line">
            <div className="flex min-w-0 items-center gap-2 text-[13px] text-muted">
              <NavLink to="/fleet" className="font-medium hover:text-text">
                Fleet
              </NavLink>
              <IconChevronRight size={14} />
              <span className="flex min-w-0 items-center gap-2">
                <Monogram name={site.name} size="sm" />
                <span className="truncate font-semibold text-text">{site.name}</span>
              </span>
            </div>
            <TabBar label="Site">
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
              <NavLink to={`${root}/team`} className={tabClass}>
                Team
              </NavLink>
            </TabBar>
          </div>
        )}
        <Outlet />
      </div>
    </SiteContext.Provider>
  );
}
