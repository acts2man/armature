/**
 * "/" — the landing screen inside the shell. Staff go to the fleet, a client
 * with one site goes straight to it, a client with several picks one here, and a
 * client with none is told exactly what to do next.
 */
import { ExternalLink } from "lucide-react";
import { Navigate } from "react-router";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { Card, LinkButton, Notice, PageHeader, Spinner, SrOnly } from "@/components/ui.tsx";

/** "https://www.example.com/" → "www.example.com" for display. */
const displayUrl = (url: string): string => url.replace(/^https?:\/\//i, "").replace(/\/+$/, "");

export function Home() {
  const { loading, isStaff, sites, agency, membershipsError } = useAuth();

  if (loading) return <Spinner label="Loading your account" />;
  if (membershipsError) {
    // The shell already shows the error itself, with a retry; this keeps the screen honest.
    return <Notice kind="info">Your sites will be listed here once your account's access has loaded.</Notice>;
  }
  if (isStaff) return <Navigate to="/fleet" replace />;

  const only = sites[0];
  if (sites.length === 1 && only) return <Navigate to={`/sites/${only.site.id}`} replace />;

  if (sites.length === 0) {
    const portal = agency?.portal_name?.trim();
    return (
      <Notice kind="warning" title="Your account does not have access to any site yet">
        {portal ? `Ask ${portal} to send you an invite.` : "Ask the agency that looks after your website to send you an invite."}{" "}
        When it arrives, sign in with the email address the invite was sent to. An invite only works for that exact address.
      </Notice>
    );
  }

  const sorted = [...sites].sort((a, b) => a.site.name.localeCompare(b.site.name));
  return (
    <div className="space-y-6">
      <PageHeader title="Your sites" description="Choose a site to edit its pages or send a change request." />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map(({ site }) => (
          <li key={site.id}>
            <Card as="article" className="flex h-full flex-col gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold text-ink">{site.name}</h2>
                {site.live_url ? (
                  <a
                    href={site.live_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 max-w-full items-center gap-1 text-sm text-accent underline-offset-2 hover:underline"
                  >
                    <span className="truncate">{displayUrl(site.live_url)}</span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <SrOnly>(opens in a new tab)</SrOnly>
                  </a>
                ) : (
                  <p className="text-sm text-muted">No live address recorded yet</p>
                )}
              </div>
              <div className="mt-auto">
                <LinkButton to={`/sites/${site.id}`}>
                  Open
                  <SrOnly> {site.name}</SrOnly>
                </LinkButton>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
