/**
 * Fleet — the agency's single view of every client site and what the agency
 * charges for it: status, open requests, the yearly total for hosting, domain
 * and email, and the next renewal. Every number comes from the database.
 */
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { IconArrowDown, IconArrowUp, IconBranch, IconClock, IconGlobe, IconPlus, IconSearch } from "@/components/icons.tsx";
import { RequestStatusPill } from "@/components/RequestStatus.tsx";
import {
  Card,
  Cell,
  DataRow,
  DataTable,
  EmptyState,
  Input,
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
import { formatDate, formatDateTime, plural, relativeTime } from "@/lib/format.ts";
import { formatCents } from "@/lib/money.ts";
import { requestSteps } from "@/lib/requests.ts";
import { SITE_STATUS_TONES, isHostingOnly, renewalState, siteStatusLabel, type RenewalState } from "@/lib/services.ts";
import { supabase } from "@/lib/supabase.ts";
import { OPEN_CHANGE_REQUEST_STATUSES, type ChangeRequest, type Site, type SiteBilling } from "@/lib/types.ts";

type NewestRequest = ChangeRequest & { site: { id: string; name: string } | null; creator: { full_name: string | null; email: string | null } | null };

type FleetData = {
  sites: Site[];
  /** Open change requests per site id. */
  openCounts: Record<string, number>;
  /** The site_billing view, per site id. Sites without a services record have no row. */
  billing: Record<string, SiteBilling>;
  /** The most recently updated open request across the fleet, with who asked. */
  newest: NewestRequest | null;
};

export type FleetRow = { site: Site; openCount: number; billing: SiteBilling | undefined; renewal: RenewalState | null };

type SortKey = "name" | "total" | "renewal";
type SortDir = "asc" | "desc";

const COLUMNS = "2.2fr 1.1fr 1.1fr 0.9fr 1.2fr";

async function loadFleet(): Promise<FleetData> {
  const [sitesResult, requestsResult, billingResult, newestResult] = await Promise.all([
    supabase.from("sites").select("*").order("name"),
    supabase.from("change_requests").select("site_id, status").in("status", OPEN_CHANGE_REQUEST_STATUSES),
    supabase.from("site_billing").select("*"),
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
  if (billingResult.error) throw new Error(`Could not load billing: ${billingResult.error.message}`);
  if (newestResult.error) throw new Error(`Could not load the newest request: ${newestResult.error.message}`);

  const openCounts: Record<string, number> = {};
  for (const row of (requestsResult.data ?? []) as { site_id: string }[]) {
    openCounts[row.site_id] = (openCounts[row.site_id] ?? 0) + 1;
  }
  const billing: Record<string, SiteBilling> = {};
  for (const row of (billingResult.data ?? []) as SiteBilling[]) billing[row.site_id] = row;

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

  return { sites: (sitesResult.data ?? []) as Site[], openCounts, billing, newest };
}

export function SiteStatusPill({ site }: { site: Pick<Site, "status" | "last_published_at"> }) {
  const label = siteStatusLabel(site);
  return <Pill tone={SITE_STATUS_TONES[label]}>{label}</Pill>;
}

export function RenewalCell({ renewal }: { renewal: RenewalState | null }) {
  if (!renewal) return <span className="text-[13px] text-muted">None set</span>;
  if (renewal.state === "later") return <span className="text-[13px] text-text">{formatDate(renewal.date)}</span>;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="text-[13px] text-text">{formatDate(renewal.date)}</span>
      <Pill tone={renewal.state === "past" ? "danger" : "amber"}>
        {renewal.state === "past" ? `${plural(-renewal.days, "day")} ago` : renewal.days === 0 ? "Today" : `in ${plural(renewal.days, "day")}`}
      </Pill>
    </span>
  );
}

function siteLine(row: FleetRow): string {
  const site = row.site;
  if (isHostingOnly(site)) return site.live_url ? `${site.live_url.replace(/^https?:\/\//, "")}. No repository yet` : "No repository yet";
  const repo = `${site.repo_owner}/${site.repo_name}`;
  return site.last_published_at ? `${repo}. Published ${relativeTime(site.last_published_at)}` : `${repo}. Not published yet`;
}

function OpenRequestsCell({ row }: { row: FleetRow }) {
  if (row.openCount === 0) return <span className="text-[13px] text-muted">None</span>;
  return (
    <Link to={`/sites/${row.site.id}/requests`} onClick={(event) => event.stopPropagation()} className="inline-flex">
      <Pill tone="blue">{plural(row.openCount, "open request")}</Pill>
    </Link>
  );
}

function SortHeader({ label, active, dir, onClick }: { label: string; active: boolean; dir: SortDir; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={clsx("inline-flex h-8 items-center gap-1 rounded-sm text-[12px] font-semibold hover:text-text", active ? "text-text" : "text-muted")}
    >
      {label}
      {active && (dir === "asc" ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />)}
    </button>
  );
}

function SitesTable({ rows, sort, onSort }: { rows: FleetRow[]; sort: { key: SortKey; dir: SortDir }; onSort: (key: SortKey) => void }) {
  const navigate = useNavigate();
  const head = [
    <SortHeader key="name" label="Site" active={sort.key === "name"} dir={sort.dir} onClick={() => onSort("name")} />,
    "Status",
    "Open requests",
    <SortHeader key="total" label="Yearly total" active={sort.key === "total"} dir={sort.dir} onClick={() => onSort("total")} />,
    <SortHeader key="renewal" label="Next renewal" active={sort.key === "renewal"} dir={sort.dir} onClick={() => onSort("renewal")} />,
  ];
  return (
    <>
      <div className="hidden sm:block">
        <DataTable columns={COLUMNS} label="Client sites" head={head}>
          {rows.map((row) => (
            <DataRow key={row.site.id} columns={COLUMNS} onClick={() => navigate(`/sites/${row.site.id}`)}>
              <Cell>
                <Link to={`/sites/${row.site.id}`} className="flex min-h-11 items-center gap-3 text-text">
                  <Monogram name={row.site.name} />
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-semibold">{row.site.name}</span>
                    <span className="block truncate text-[12px] text-muted">{siteLine(row)}</span>
                  </span>
                </Link>
              </Cell>
              <Cell>
                <SiteStatusPill site={row.site} />
              </Cell>
              <Cell>
                <OpenRequestsCell row={row} />
              </Cell>
              <Cell className="text-[14px] font-semibold">{row.billing ? formatCents(row.billing.yearly_total_cents) : <span className="font-normal text-muted">Not set</span>}</Cell>
              <Cell>
                <RenewalCell renewal={row.renewal} />
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
                  <SiteStatusPill site={row.site} />
                </span>
                <span className="mt-0.5 block text-[12px] text-muted">{siteLine(row)}</span>
                <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                  <span className="font-semibold text-text">{row.billing ? `${formatCents(row.billing.yearly_total_cents)} / year` : "No services set"}</span>
                  <span>·</span>
                  <RenewalCell renewal={row.renewal} />
                </span>
                {row.openCount > 0 && (
                  <span className="mt-1.5 block">
                    <Pill tone="blue">{plural(row.openCount, "open request")}</Pill>
                  </span>
                )}
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
  const hostingOnly = rows.filter((row) => isHostingOnly(row.site)).length;
  const connected = rows.length - hostingOnly;
  const yearly = rows.reduce((total, row) => total + (row.billing?.yearly_total_cents ?? 0), 0);
  const priced = rows.filter((row) => row.billing).length;
  const soon = rows.filter((row) => row.renewal?.state === "soon").length;
  const past = rows.filter((row) => row.renewal?.state === "past").length;
  const openRequests = rows.reduce((total, row) => total + row.openCount, 0);
  const sitesWithRequests = rows.filter((row) => row.openCount > 0).length;
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <StatCard label="Sites" value={rows.length} note={rows.length === 0 ? "none yet" : `${connected} with a site, ${hostingOnly} hosting-only`} />
      <StatCard label="Yearly billing" value={formatCents(yearly)} note={priced === 0 ? "no services recorded yet" : `across ${plural(priced, "site")}`} />
      <StatCard label="Renewals, next 30 days" value={soon} note={past > 0 ? `${plural(past, "renewal")} already past` : soon === 0 ? "nothing due soon" : "check the dates below"} />
      <StatCard label="Open requests" value={openRequests} note={openRequests === 0 ? "nothing waiting" : `across ${plural(sitesWithRequests, "site")}`} />
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

function compare(a: FleetRow, b: FleetRow, key: SortKey): number {
  if (key === "name") return a.site.name.localeCompare(b.site.name);
  if (key === "total") return (a.billing?.yearly_total_cents ?? -1) - (b.billing?.yearly_total_cents ?? -1);
  // Renewal: dated rows first (earliest first), undated last.
  const da = a.renewal?.date ?? "9999-12-31";
  const db = b.renewal?.date ?? "9999-12-31";
  return da.localeCompare(db) || a.site.name.localeCompare(b.site.name);
}

function matchesSearch(row: FleetRow, needle: string): boolean {
  if (!needle) return true;
  const hay = [row.site.name, row.site.repo_owner, row.site.repo_name, row.site.live_url, siteStatusLabel(row.site)].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(needle);
}

export function Fleet() {
  const { agencies } = useAuth();
  const agencyIds = [...agencies.map((membership) => membership.agency.id)].sort();
  const query = useQuery({ queryKey: ["fleet", agencyIds], queryFn: loadFleet });
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "name", dir: "asc" });

  const onSort = (key: SortKey) => setSort((current) => (current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "total" ? "desc" : "asc" }));

  const rows: FleetRow[] = useMemo(() => {
    const data = query.data;
    if (!data) return [];
    return data.sites
      .filter((site) => agencyIds.includes(site.agency_id))
      .map((site) => {
        const billing = data.billing[site.id];
        return { site, openCount: data.openCounts[site.id] ?? 0, billing, renewal: billing ? renewalState(billing.next_renewal_date, billing.overdue_renewal_date) : null };
      });
    // agencyIds is derived from `agencies`, which is stable per session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, agencies]);

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
    const needle = search.trim().toLowerCase();
    const visible = rows.filter((row) => matchesSearch(row, needle)).sort((a, b) => (sort.dir === "asc" ? 1 : -1) * compare(a, b, sort.key));
    const groups =
      agencies.length > 1
        ? [...agencies]
            .sort((a, b) => a.agency.name.localeCompare(b.agency.name))
            .map((membership) => ({ title: membership.agency.name, rows: visible.filter((row) => row.site.agency_id === membership.agency.id) }))
        : [{ title: "Client sites", rows: visible }];

    const searchBox = (
      <div className="relative">
        <label htmlFor="fleet-search" className="sr-only">
          Search sites
        </label>
        <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <Input id="fleet-search" type="search" placeholder="Search sites" value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 w-44 pl-9 text-[13px] sm:w-56" />
      </div>
    );

    body = (
      <div className="flex flex-col gap-5">
        <StatsRow rows={rows} />
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_392px]">
          <div className="flex min-w-0 flex-col gap-4">
            {rows.length === 0 ? (
              <EmptyState title="No sites yet" action={addAction} icon={<IconGlobe size={18} />}>
                Connect a site's GitHub repository, or add a hosting-only client, and it will appear here with its status, billing and renewals.
              </EmptyState>
            ) : (
              groups.map((group) => (
                <Panel key={group.title} title={group.title} aside={searchBox}>
                  {group.rows.length === 0 ? (
                    <p className="px-5 py-4 text-[13px] text-muted">{needle ? `No sites match "${search.trim()}".` : "No sites yet for this agency."}</p>
                  ) : (
                    <SitesTable rows={group.rows} sort={sort} onSort={onSort} />
                  )}
                </Panel>
              ))
            )}
          </div>
          <RequestPanel newest={query.data.newest} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Fleet" description="Every client site you manage, what you charge for it, and what needs you first." action={addAction} />
      {body}
    </div>
  );
}
