/**
 * Every change request across the agency's sites, newest activity first, with a
 * status filter. Rows open the site's own request page.
 */
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { IconBranch } from "@/components/icons.tsx";
import { RequestStatusPill } from "@/components/RequestStatus.tsx";
import { Cell, DataRow, DataTable, EmptyState, Monogram, Notice, PageHeader, Panel, Segmented, Select, SkeletonRows } from "@/components/ui.tsx";
import { relativeTime } from "@/lib/format.ts";
import { supabase } from "@/lib/supabase.ts";
import { CHANGE_REQUEST_STATUSES, CHANGE_REQUEST_STATUS_LABELS, OPEN_CHANGE_REQUEST_STATUSES, type ChangeRequest, type ChangeRequestStatus } from "@/lib/types.ts";

type Filter = "open" | "all" | ChangeRequestStatus;
type AgencyRequest = ChangeRequest & { site: { id: string; name: string } | null };

const COLUMNS = "1.4fr 2fr 1.1fr 0.9fr 0.9fr";

async function loadAgencyRequests(): Promise<AgencyRequest[]> {
  const { data, error } = await supabase.from("change_requests").select("*, site:sites(id, name)").order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as AgencyRequest[];
}

function isFilter(value: string): value is Filter {
  return value === "open" || value === "all" || (CHANGE_REQUEST_STATUSES as string[]).includes(value);
}

function matches(request: AgencyRequest, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "open") return OPEN_CHANGE_REQUEST_STATUSES.includes(request.status);
  return request.status === filter;
}

const siteName = (request: AgencyRequest): string => request.site?.name ?? "Unknown site";

function RequestsTable({ rows }: { rows: AgencyRequest[] }) {
  const navigate = useNavigate();
  return (
    <>
      <div className="hidden sm:block">
        <DataTable columns={COLUMNS} label="Change requests" head={["Site", "Request", "Status", "Opened", "Updated"]}>
          {rows.map((request) => (
            <DataRow key={request.id} columns={COLUMNS} onClick={() => navigate(`/sites/${request.site_id}/requests/${request.id}`)}>
              <Cell>
                <span className="flex min-w-0 items-center gap-2.5">
                  <Monogram name={siteName(request)} />
                  <span className="truncate text-[14px] font-semibold">{siteName(request)}</span>
                </span>
              </Cell>
              <Cell>
                <Link to={`/sites/${request.site_id}/requests/${request.id}`} className="block truncate text-[14px] font-semibold text-text hover:underline">
                  {request.title}
                </Link>
              </Cell>
              <Cell>
                <RequestStatusPill status={request.status} />
              </Cell>
              <Cell muted>{relativeTime(request.created_at)}</Cell>
              <Cell muted>{relativeTime(request.updated_at)}</Cell>
            </DataRow>
          ))}
        </DataTable>
      </div>
      <ul className="sm:hidden">
        {rows.map((request) => (
          <li key={request.id} className="border-b border-line last:border-b-0">
            <Link to={`/sites/${request.site_id}/requests/${request.id}`} className="flex flex-col gap-1 px-4 py-3">
              <span className="text-[12px] font-semibold text-muted">{siteName(request)}</span>
              <span className="flex items-start justify-between gap-2">
                <span className="text-[14px] font-semibold text-text">{request.title}</span>
                <RequestStatusPill status={request.status} />
              </span>
              <span className="text-[12px] text-muted">
                Opened {relativeTime(request.created_at)} · Updated {relativeTime(request.updated_at)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

export function AgencyRequests() {
  const [filter, setFilter] = useState<Filter>("open");
  const query = useQuery({ queryKey: ["agency-requests"], queryFn: loadAgencyRequests });

  let body: ReactNode;
  if (query.isPending) {
    body = <SkeletonRows rows={4} label="Loading change requests" />;
  } else if (query.isError) {
    body = (
      <div className="p-4">
        <Notice kind="danger" title="Change requests could not be loaded">
          {query.error.message}
        </Notice>
      </div>
    );
  } else {
    const rows = query.data.filter((request) => matches(request, filter));
    if (rows.length === 0) {
      body = (
        <div className="p-5">
          <EmptyState title={filter === "open" ? "No open requests" : "No requests match this filter"} icon={<IconBranch size={18} />}>
            {filter === "open" ? "Requests clients file from their site dashboards will appear here." : 'Try a different status, or "All".'}
          </EmptyState>
        </div>
      );
    } else {
      body = <RequestsTable rows={rows} />;
    }
  }

  const count = query.data ? query.data.filter((request) => matches(request, filter)).length : undefined;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Change requests" description="Across every site your agency looks after, newest activity first." />
      <Panel
        title={count === undefined ? "Requests" : `${count} ${count === 1 ? "request" : "requests"}`}
        aside={
          <>
            <Segmented
              label="Show"
              value={filter === "open" || filter === "all" ? filter : "status"}
              onChange={(next) => {
                if (next === "open" || next === "all") setFilter(next);
              }}
              options={[
                { value: "open", label: "Open" },
                { value: "all", label: "All" },
                { value: "status", label: "By status" },
              ]}
              className="hidden sm:inline-flex"
            />
            <label htmlFor="request-filter" className="sr-only">
              Status
            </label>
            <Select
              id="request-filter"
              value={filter}
              onChange={(event) => {
                const value = event.target.value;
                if (isFilter(value)) setFilter(value);
              }}
              className="h-9 w-44 text-[13px]"
            >
              <option value="open">Open</option>
              {CHANGE_REQUEST_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {CHANGE_REQUEST_STATUS_LABELS[status]}
                </option>
              ))}
              <option value="all">All</option>
            </Select>
          </>
        }
      >
        {body}
      </Panel>
    </div>
  );
}
