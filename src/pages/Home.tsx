/**
 * "/" — the landing screen inside the shell. Staff go to the fleet, a client
 * with one site goes straight to it, a client with several picks one here, and a
 * client with none is told exactly what to do next.
 */
import { Navigate } from "react-router";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { IconExternal, IconGlobe } from "@/components/icons.tsx";
import { Card, EmptyState, LinkButton, Monogram, Notice, PageHeader, Pill, Skeleton, SrOnly } from "@/components/ui.tsx";
import { SITE_ROLE_LABELS } from "@/lib/types.ts";

/** "https://www.example.com/" → "www.example.com" for display. */
const displayUrl = (url: string): string => url.replace(/^https?:\/\//i, "").replace(/\/+$/, "");

export function Home() {
  const { loading, isStaff, sites, agency, membershipsError } = useAuth();

  if (loading) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading your account">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 rounded-card" />
      </div>
    );
  }
  if (membershipsError) {
    // The shell already shows the error itself, with a retry; this keeps the screen honest.
    return <Notice kind="info">Your sites will be listed here once your account's access has loaded.</Notice>;
  }
  if (isStaff) return <Navigate to="/fleet" replace />;

  const only = sites[0];
  if (sites.length === 1 && only) return <Navigate to={`/sites/${only.site.id}`} replace />;

  const portal = agency?.portal_name?.trim();
  if (sites.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Your sites" />
        <EmptyState title="Your account does not have access to any site yet" icon={<IconGlobe size={18} />}>
          {portal ? `Ask ${portal} to send you an invite or create your login.` : "Ask the agency that looks after your website to send you an invite."} When an invite arrives, sign in with the
          email address it was sent to; it only works for that exact address.
        </EmptyState>
      </div>
    );
  }

  const sorted = [...sites].sort((a, b) => a.site.name.localeCompare(b.site.name));
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Your sites" description="Choose a site to edit its pages or send a change request." />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map(({ site, role }) => (
          <li key={site.id}>
            <Card as="article" className="flex h-full flex-col justify-between gap-4">
              <div className="flex min-w-0 gap-3">
                <Monogram name={site.name} size="lg" />
                <div className="min-w-0">
                  <h2 className="truncate font-sans text-[15px] font-semibold tracking-normal text-text">{site.name}</h2>
                  {site.live_url ? (
                    <a href={site.live_url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 text-[13px] text-muted underline-offset-2 hover:underline">
                      <span className="truncate">{displayUrl(site.live_url)}</span>
                      <IconExternal size={12} />
                      <SrOnly>(opens in a new tab)</SrOnly>
                    </a>
                  ) : (
                    <p className="text-[13px] text-muted">No live address recorded yet</p>
                  )}
                  <div className="mt-1.5">
                    <Pill tone="grey">{SITE_ROLE_LABELS[role]}</Pill>
                  </div>
                </div>
              </div>
              <LinkButton to={`/sites/${site.id}`} variant="secondary" size="sm" className="self-start">
                Open
                <SrOnly> {site.name}</SrOnly>
              </LinkButton>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
