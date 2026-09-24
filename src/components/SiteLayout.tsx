/**
 * Wraps every /sites/:siteId/* screen: loads the site (under RLS) and exposes it
 * through `useSite()`. Navigation is the sidebar's job (src/components/AppShell.tsx),
 * so there is no strip of tabs here. Not found and no access are both spelled out
 * rather than left blank.
 */
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { Outlet, useParams } from "react-router";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { supabase } from "@/lib/supabase.ts";
import type { Site } from "@/lib/types.ts";
import { LinkButton, Notice, Skeleton } from "./ui.tsx";

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

/** The site row under RLS: null when it does not exist or the account has no access. */
// eslint-disable-next-line react-refresh/only-export-components
export function useSiteQuery(siteId: string) {
  return useQuery({
    queryKey: siteQueryKey(siteId),
    enabled: siteId.length > 0,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.from("sites").select("*").eq("id", siteId).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as Site | null) ?? null;
    },
  });
}

/** True when the signed-in person is agency staff for this site's agency. */
// eslint-disable-next-line react-refresh/only-export-components
export function useIsStaffFor(site: Site | null | undefined): boolean {
  const { agencies, isStaff: staffAnywhere } = useAuth();
  return Boolean(site) && staffAnywhere && agencies.some((membership) => membership.agency.id === site?.agency_id);
}

export function SiteLayout() {
  const { siteId = "" } = useParams();
  const { isStaff: staffAnywhere } = useAuth();
  const query = useSiteQuery(siteId);
  const isStaff = useIsStaffFor(query.data);

  if (query.isPending) {
    return (
      <div className="space-y-5" role="status" aria-label="Loading site">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-5 w-48" />
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
          <LinkButton to={staffAnywhere ? "/projects" : "/"} variant="secondary">
            {staffAnywhere ? "Back to Projects" : "Go home"}
          </LinkButton>
        }
      >
        Either it does not exist, or your account has not been given access to it. Ask the agency to invite you.
      </Notice>
    );
  }

  return (
    <SiteContext.Provider value={{ site: query.data, isStaff, refetch: query.refetch }}>
      <Outlet />
    </SiteContext.Provider>
  );
}
