/**
 * Fleet — the agency staff home. Every site the agency looks after, with its
 * connection status, its last publish and how many change requests are open.
 */
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { Card, EmptyState, LinkButton, Notice, PageHeader, Pill, Spinner, SrOnly } from "@/components/ui.tsx";
import { plural, relativeTime } from "@/lib/format.ts";
import { supabase } from "@/lib/supabase.ts";
import { OPEN_CHANGE_REQUEST_STATUSES, type PublishStatus, type Site, type SiteStatus } from "@/lib/types.ts";

type LatestPublish = { site_id: string; status: PublishStatus; created_at: string; commit_url: string | null };

type FleetData = {
  sites: Site[];
  /** Open change requests per site id. */
  openCounts: Record<string, number>;
  /** The newest publish row per site id, when there is one. */
  latestPublish: Record<string, LatestPublish>;
};

type FleetRow = { site: Site; openCount: number; latest: LatestPublish | undefined };

async function loadFleet(): Promise<FleetData> {
  const [sitesResult, requestsResult, publishesResult] = await Promise.all([
    supabase.from("sites").select("*").order("name"),
    supabase.from("change_requests").select("site_id, status").in("status", OPEN_CHANGE_REQUEST_STATUSES),
    supabase
      .from("publishes")
      .select("site_id, status, created_at, commit_url")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  if (sitesResult.error) throw new Error(`Could not load sites: ${sitesResult.error.message}`);
  if (requestsResult.error) throw new Error(`Could not load change requests: ${requestsResult.error.message}`);
  if (publishesResult.error) throw new Error(`Could not load publishes: ${publishesResult.error.message}`);

  const openCounts: Record<string, number> = {};
  for (const row of (requestsResult.data ?? []) as { site_id: string }[]) {
    openCounts[row.site_id] = (openCounts[row.site_id] ?? 0) + 1;
  }
  const latestPublish: Record<string, LatestPublish> = {};
  for (const row of (publishesResult.data ?? []) as LatestPublish[]) {
    if (latestPublish[row.site_id] === undefined) latestPublish[row.site_id] = row;
  }
  return { sites: (sitesResult.data ?? []) as Site[], openCounts, latestPublish };
}

function StatusPill({ status }: { status: SiteStatus }) {
  return status === "connected" ? <Pill tone="success">Connected</Pill> : <Pill tone="warning">Needs attention</Pill>;
}

function SiteCell({ site }: { site: Site }) {
  return (
    <div className="min-w-0">
      <p className="font-medium text-text">{site.name}</p>
      <p className="break-all font-mono text-xs text-muted">
        {site.repo_owner}/{site.repo_name}@{site.branch}
      </p>
      {site.live_url && (
        <a
          href={site.live_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center gap-1 break-all text-sm text-accent underline-offset-2 hover:underline"
        >
          {site.live_url}
          <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <SrOnly>(opens in a new tab)</SrOnly>
        </a>
      )}
    </div>
  );
}

function LastPublishCell({ row }: { row: FleetRow }) {
  const lastAttemptFailed = row.latest !== undefined && row.latest.status !== "committed";
  return (
    <div>
      <p className="text-text">{relativeTime(row.site.last_published_at)}</p>
      {lastAttemptFailed && <p className="text-xs font-medium text-warning">last attempt failed</p>}
    </div>
  );
}

function OpenRequestsLink({ row, labelled }: { row: FleetRow; labelled: boolean }) {
  return (
    <Link
      to={`/sites/${row.site.id}/requests`}
      className="inline-flex min-h-11 items-center text-accent underline-offset-2 hover:underline"
    >
      {labelled ? plural(row.openCount, "open request") : row.openCount}
      {!labelled && <SrOnly> open {row.openCount === 1 ? "request" : "requests"}</SrOnly>}
    </Link>
  );
}

function FleetTable({ rows }: { rows: FleetRow[] }) {
  return (
    <div className="hidden overflow-x-auto rounded-card border border-line bg-panel sm:block">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
            <th scope="col" className="px-4 py-3 font-medium">
              Site
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Status
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Last publish
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Open requests
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              <SrOnly>Open</SrOnly>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.site.id} className="border-b border-line align-middle last:border-b-0">
              <td className="px-4 py-3">
                <SiteCell site={row.site} />
              </td>
              <td className="px-4 py-3">
                <StatusPill status={row.site.status} />
              </td>
              <td className="px-4 py-3">
                <LastPublishCell row={row} />
              </td>
              <td className="px-4 py-3">
                <OpenRequestsLink row={row} labelled={false} />
              </td>
              <td className="px-4 py-3 text-right">
                <LinkButton variant="secondary" to={`/sites/${row.site.id}`}>
                  Open
                  <SrOnly> {row.site.name}</SrOnly>
                </LinkButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FleetCards({ rows }: { rows: FleetRow[] }) {
  return (
    <ul className="space-y-3 sm:hidden">
      {rows.map((row) => (
        <li key={row.site.id}>
          <Card as="article">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <SiteCell site={row.site} />
              <StatusPill status={row.site.status} />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">Last publish</dt>
                <dd>
                  <LastPublishCell row={row} />
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">Requests</dt>
                <dd>
                  <OpenRequestsLink row={row} labelled />
                </dd>
              </div>
            </dl>
            <div className="mt-3">
              <LinkButton variant="secondary" to={`/sites/${row.site.id}`} className="w-full">
                Open
                <SrOnly> {row.site.name}</SrOnly>
              </LinkButton>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function FleetGroup({ title, rows }: { title?: string; rows: FleetRow[] }) {
  return (
    <section className="space-y-3">
      {title && <h2 className="text-lg font-semibold text-ink">{title}</h2>}
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No sites yet for this agency.</p>
      ) : (
        <>
          <FleetTable rows={rows} />
          <FleetCards rows={rows} />
        </>
      )}
    </section>
  );
}

export function Fleet() {
  const { agencies } = useAuth();
  const agencyIds = [...agencies.map((membership) => membership.agency.id)].sort();

  const query = useQuery({ queryKey: ["fleet", agencyIds], queryFn: loadFleet });

  const addAction = <LinkButton to="/sites/new">Add a site</LinkButton>;

  let body: ReactNode;
  if (query.isPending) {
    body = <Spinner label="Loading sites" />;
  } else if (query.isError) {
    body = (
      <Notice kind="danger" title="The fleet could not be loaded">
        {query.error.message}
      </Notice>
    );
  } else {
    const data = query.data;
    const rows: FleetRow[] = data.sites
      .filter((site) => agencyIds.includes(site.agency_id))
      .map((site) => ({ site, openCount: data.openCounts[site.id] ?? 0, latest: data.latestPublish[site.id] }));

    if (rows.length === 0) {
      body = (
        <EmptyState title="No sites yet" action={addAction}>
          Connect a site's GitHub repository and it will appear here.
        </EmptyState>
      );
    } else if (agencies.length > 1) {
      const sorted = [...agencies].sort((a, b) => a.agency.name.localeCompare(b.agency.name));
      body = (
        <div className="space-y-8">
          {sorted.map((membership) => (
            <FleetGroup
              key={membership.agency.id}
              title={membership.agency.name}
              rows={rows.filter((row) => row.site.agency_id === membership.agency.id)}
            />
          ))}
        </div>
      );
    } else {
      body = <FleetGroup rows={rows} />;
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Fleet" description="Every site your agency looks after" action={addAction} />
      {body}
    </div>
  );
}
