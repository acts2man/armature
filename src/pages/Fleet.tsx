/**
 * Fleet — the agency staff home, as in docs/4-agency-fleet.html: a row of stat
 * cards, the client sites table, and on the right the newest open change request.
 * Every number comes from the database; nothing is invented.
 */
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { IconBranch, IconClock, IconExternal, IconPlus } from "@/components/icons.tsx";
import { RequestStatusPill } from "@/components/RequestStatus.tsx";
import {
  Card,
  Cell,
  DataRow,
  DataTable,
  EmptyState,
  LinkButton,
  Monogram,
  Notice,
  PageHeader,
  Panel,
  Pill,
  QuoteBlock,
  Skeleton,
  SkeletonRows,
  StatCard,
  Timeline,
} from "@/components/ui.tsx";
import { formatDateTime, plural, relativeTime } from "@/lib/format.ts";
import { requestSteps } from "@/lib/requests.ts";
import { supabase } from "@/lib/supabase.ts";
import { OPEN_CHANGE_REQUEST_STATUSES, type ChangeRequest, type PublishStatus, type Site, type SiteStatus } from "@/lib/types.ts";

type PublishLite = { site_id: string; status: PublishStatus; created_at: string };
type NewestRequest = ChangeRequest & { site: { id: string; name: string } | null; creator: { full_name: string | null; email: string | null } | null };

type FleetData = {
  sites: Site[];
  /** Open change requests per site id. */
  openCounts: Record<string, number>;
  /** Publishes in the last 30 days per site id. */
  recentPublishes: Record<string, number>;
  /** The newest publish row per site id, when there is one. */
  latestPublish: Record<string, PublishLite>;
  /** The most recently updated open request across the fleet, with who asked. */
  newest: NewestRequest | null;
};

type FleetRow = { site: Site; openCount: number; recent: number; latest: PublishLite | undefined };

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
const COLUMNS = "2.3fr 1.1fr 0.9fr 1.15fr";

async function loadFleet(): Promise<FleetData> {
  const since = new Date(Date.now() - THIRTY_DAYS).toISOString();
  const [sitesResult, requestsResult, publishesResult, newestResult] = await Promise.all([
    supabase.from("sites").select("*").order("name"),
    supabase.from("change_requests").select("site_id, status").in("status", OPEN_CHANGE_REQUEST_STATUSES),
    supabase.from("publishes").select("site_id, status, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(1000),
    supabase
      .from("change_requests")
      .select("*, site:sites(id, name)")
      .in("status", OPEN_CHANGE_REQUEST_STATUSES)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (sitesResult.error) throw new Error(`Could not load sites: ${sitesResult.error.message}`);
  if (requestsResult.error) throw new Error(`Could not load change requests: ${requestsResult.error.message}`);
  if (publishesResult.error) throw new Error(`Could not load publishes: ${publishesResult.error.message}`);
  if (newestResult.error) throw new Error(`Could not load the newest request: ${newestResult.error.message}`);

  const openCounts: Record<string, number> = {};
  for (const row of (requestsResult.data ?? []) as { site_id: string }[]) {
    openCounts[row.site_id] = (openCounts[row.site_id] ?? 0) + 1;
  }
  const recentPublishes: Record<string, number> = {};
  const latestPublish: Record<string, PublishLite> = {};
  for (const row of (publishesResult.data ?? []) as PublishLite[]) {
    recentPublishes[row.site_id] = (recentPublishes[row.site_id] ?? 0) + 1;
    if (latestPublish[row.site_id] === undefined) latestPublish[row.site_id] = row;
  }

  let newest: NewestRequest | null = null;
  const raw = newestResult.data as (ChangeRequest & { site: { id: string; name: string } | null }) | null;
  if (raw) {
    let creator: NewestRequest["creator"] = null;
    if (raw.created_by) {
      const profile = await supabase.from("profiles").select("full_name, email").eq("id", raw.created_by).maybeSingle();
      creator = (profile.data as NewestRequest["creator"]) ?? null;
    }
    newest = { ...raw, creator };
  }

  return { sites: (sitesResult.data ?? []) as Site[], openCounts, recentPublishes, latestPublish, newest };
}

function StatusPill({ status }: { status: SiteStatus }) {
  return status === "connected" ? <Pill tone="green">Connected</Pill> : <Pill tone="amber">Needs attention</Pill>;
}

function publishedLine(row: FleetRow): string {
  const repo = `${row.site.repo_owner}/${row.site.repo_name}`;
  if (row.latest && row.latest.status !== "committed") return `${repo}. Last publish failed ${relativeTime(row.latest.created_at)}`;
  if (row.site.last_published_at) return `${repo}. Published ${relativeTime(row.site.last_published_at)}`;
  return `${repo}. Not published yet`;
}

function OpenRequestsCell({ row }: { row: FleetRow }) {
  if (row.openCount === 0) return <span className="text-[13px] text-muted">None</span>;
  return (
    <Link to={`/sites/${row.site.id}/requests`} onClick={(event) => event.stopPropagation()} className="inline-flex">
      <Pill tone="blue">{plural(row.openCount, "open request")}</Pill>
    </Link>
  );
}

function SitesTable({ rows }: { rows: FleetRow[] }) {
  const navigate = useNavigate();
  return (
    <>
      <div className="hidden sm:block">
        <DataTable columns={COLUMNS} label="Client sites" head={["Site", "Status", "Publishes, 30 days", "Open requests"]}>
          {rows.map((row) => (
            <DataRow key={row.site.id} columns={COLUMNS} onClick={() => navigate(`/sites/${row.site.id}`)}>
              <Cell>
                <Link to={`/sites/${row.site.id}`} className="flex min-h-11 items-center gap-3 text-text">
                  <Monogram name={row.site.name} />
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-semibold">{row.site.name}</span>
                    <span className="block truncate text-[12px] text-muted">{publishedLine(row)}</span>
                  </span>
                </Link>
              </Cell>
              <Cell>
                <StatusPill status={row.site.status} />
              </Cell>
              <Cell className="text-[14px] font-semibold">{row.recent}</Cell>
              <Cell>
                <OpenRequestsCell row={row} />
              </Cell>
            </DataRow>
          ))}
        </DataTable>
      </div>
      <ul className="sm:hidden">
        {rows.map((row) => (
          <li key={row.site.id} className="border-b border-line last:border-b-0">
            <Link to={`/sites/${row.site.id}`} className="flex items-start gap-3 px-4 py-3">
              <Monogram name={row.site.name} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[14px] font-semibold text-text">{row.site.name}</span>
                  <StatusPill status={row.site.status} />
                </span>
                <span className="mt-0.5 block text-[12px] text-muted">{publishedLine(row)}</span>
                <span className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-muted">
                  <span>{plural(row.recent, "publish", "publishes")} in 30 days</span>
                  <span>·</span>
                  {row.openCount > 0 ? <Pill tone="blue">{plural(row.openCount, "open request")}</Pill> : <span>No open requests</span>}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function RequestPanel({ newest }: { newest: NewestRequest | null }) {
  if (!newest) {
    return (
      <Panel as="aside" title="Change requests" className="h-full">
        <div className="p-5">
          <EmptyState title="No open requests" icon={<IconBranch size={18} />}>
            When a client asks for something the editor cannot do, the newest request appears here.
          </EmptyState>
        </div>
      </Panel>
    );
  }
  const who = newest.creator?.full_name?.trim() || newest.creator?.email?.trim() || "The client";
  const siteName = newest.site?.name ?? "A site";
  const detail = newest.details.trim();
  return (
    <Panel as="aside" title="Newest change request" aside={<RequestStatusPill status={newest.status} />} className="h-full">
      <div className="flex h-full flex-col justify-between gap-4 p-5">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Monogram name={siteName} size="lg" />
            <div className="min-w-0">
              <div className="truncate font-semibold text-text">{siteName}</div>
              <div className="text-[13px] text-muted">
                {who} asked on {formatDateTime(newest.created_at)}
              </div>
            </div>
          </div>
          <QuoteBlock title={newest.title}>{detail ? (detail.length > 240 ? `${detail.slice(0, 240)}…` : detail) : "No details were given."}</QuoteBlock>
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-muted">
              <IconClock size={14} />
              <span>Progress</span>
            </div>
            <Timeline steps={requestSteps(newest)} />
          </div>
        </div>
        <div className="flex flex-col gap-2.5">
          {newest.agency_note.trim() && <p className="text-[13px] leading-relaxed text-muted">Your last note: {newest.agency_note.trim().slice(0, 120)}</p>}
          <LinkButton to={`/sites/${newest.site_id}/requests/${newest.id}`} className="w-full">
            Open the request
          </LinkButton>
          <div className="grid grid-cols-2 gap-2.5">
            <LinkButton variant="secondary" to={`/sites/${newest.site_id}`}>
              Open site
            </LinkButton>
            <LinkButton variant="secondary" to="/agency/requests">
              All requests
            </LinkButton>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function StatsRow({ rows }: { rows: FleetRow[] }) {
  const connected = rows.filter((row) => row.site.status === "connected").length;
  const attention = rows.length - connected;
  const openRequests = rows.reduce((total, row) => total + row.openCount, 0);
  const sitesWithRequests = rows.filter((row) => row.openCount > 0).length;
  const publishes = rows.reduce((total, row) => total + row.recent, 0);
  const publishedSites = rows.filter((row) => row.recent > 0).length;
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <StatCard label="Sites" value={rows.length} note={rows.length === 0 ? "none connected yet" : `${connected} connected${attention > 0 ? `, ${attention} need attention` : ""}`} />
      <StatCard label="Needs attention" value={attention} note={attention === 0 ? "every site is connected" : "run Check connection"} />
      <StatCard label="Open requests" value={openRequests} note={openRequests === 0 ? "nothing waiting" : `across ${plural(sitesWithRequests, "site")}`} />
      <StatCard label="Publishes, 30 days" value={publishes} note={publishes === 0 ? "nothing published yet" : `from ${plural(publishedSites, "site")}`} />
    </div>
  );
}

function FleetSkeleton() {
  return (
    <div className="flex flex-col gap-5" role="status" aria-label="Loading the fleet">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Card key={index} className="space-y-3">
            <Skeleton className="w-16" />
            <Skeleton className="h-7 w-10" />
          </Card>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_392px]">
        <Card padded={false}>
          <SkeletonRows rows={4} label="Loading sites" />
        </Card>
        <Card className="space-y-3">
          <Skeleton className="w-40" />
          <Skeleton lines={3} />
        </Card>
      </div>
    </div>
  );
}

export function Fleet() {
  const { agencies } = useAuth();
  const agencyIds = [...agencies.map((membership) => membership.agency.id)].sort();

  const query = useQuery({ queryKey: ["fleet", agencyIds], queryFn: loadFleet });

  const addAction = (
    <LinkButton to="/sites/new">
      <IconPlus size={16} /> Add a site
    </LinkButton>
  );

  let body: ReactNode;
  if (query.isPending) {
    body = <FleetSkeleton />;
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
      .map((site) => ({
        site,
        openCount: data.openCounts[site.id] ?? 0,
        recent: data.recentPublishes[site.id] ?? 0,
        latest: data.latestPublish[site.id],
      }));

    const groups =
      agencies.length > 1
        ? [...agencies]
            .sort((a, b) => a.agency.name.localeCompare(b.agency.name))
            .map((membership) => ({ title: membership.agency.name, rows: rows.filter((row) => row.site.agency_id === membership.agency.id) }))
        : [{ title: "Client sites", rows }];

    body = (
      <div className="flex flex-col gap-5">
        <StatsRow rows={rows} />
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_392px]">
          <div className="flex min-w-0 flex-col gap-4">
            {rows.length === 0 ? (
              <EmptyState title="No sites yet" action={addAction} icon={<IconExternal size={18} />}>
                Connect a site's GitHub repository and it will appear here with its status and requests.
              </EmptyState>
            ) : (
              groups.map((group) => (
                <Panel key={group.title} title={group.title} aside={<span className="text-[12px] text-muted">Publishes are for the last 30 days</span>}>
                  {group.rows.length === 0 ? <p className="px-5 py-4 text-[13px] text-muted">No sites yet for this agency.</p> : <SitesTable rows={group.rows} />}
                </Panel>
              ))
            )}
          </div>
          <RequestPanel newest={data.newest} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Fleet" description="Every client site you manage, with what needs you first." action={addAction} />
      {body}
    </div>
  );
}
