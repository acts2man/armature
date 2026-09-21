/**
 * Every change request across the agency's sites, newest activity first, with a
 * status filter. Rows link into the site's own request page.
 */
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Card, EmptyState, Field, Notice, PageHeader, Pill, Select, Spinner } from "@/components/ui.tsx";
import { relativeTime } from "@/lib/format.ts";
import { supabase } from "@/lib/supabase.ts";
import {
  CHANGE_REQUEST_STATUSES,
  CHANGE_REQUEST_STATUS_LABELS,
  OPEN_CHANGE_REQUEST_STATUSES,
  type ChangeRequest,
  type ChangeRequestStatus,
} from "@/lib/types.ts";

const STATUS_TONES: Record<ChangeRequestStatus, "accent" | "warning" | "success" | "neutral"> = {
  new: "accent",
  in_progress: "warning",
  ready_for_review: "accent",
  done: "success",
  declined: "neutral",
};

function RequestStatusPill({ status }: { status: ChangeRequestStatus }) {
  return <Pill tone={STATUS_TONES[status]}>{CHANGE_REQUEST_STATUS_LABELS[status]}</Pill>;
}

type Filter = "open" | "all" | ChangeRequestStatus;

type AgencyRequest = ChangeRequest & { site: { id: string; name: string } | null };

async function loadAgencyRequests(): Promise<AgencyRequest[]> {
  const { data, error } = await supabase
    .from("change_requests")
    .select("*, site:sites(id, name)")
    .order("updated_at", { ascending: false });
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

function TitleLink({ request }: { request: AgencyRequest }) {
  return (
    <Link
      to={`/sites/${request.site_id}/requests/${request.id}`}
      className="inline-flex min-h-11 items-center font-medium text-text underline-offset-2 hover:underline"
    >
      {request.title}
    </Link>
  );
}

function siteName(request: AgencyRequest): string {
  return request.site?.name ?? "—";
}

function RequestsTable({ rows }: { rows: AgencyRequest[] }) {
  return (
    <div className="hidden overflow-x-auto rounded-card border border-line bg-panel sm:block">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
            <th scope="col" className="px-4 py-3 font-medium">
              Site
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Title
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Status
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Opened
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Updated
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((request) => (
            <tr key={request.id} className="border-b border-line align-middle last:border-b-0">
              <td className="px-4 py-3 text-text">{siteName(request)}</td>
              <td className="px-4 py-3">
                <TitleLink request={request} />
              </td>
              <td className="px-4 py-3">
                <RequestStatusPill status={request.status} />
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-muted">{relativeTime(request.created_at)}</td>
              <td className="px-4 py-3 whitespace-nowrap text-muted">{relativeTime(request.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RequestsCards({ rows }: { rows: AgencyRequest[] }) {
  return (
    <ul className="space-y-3 sm:hidden">
      {rows.map((request) => (
        <li key={request.id}>
          <Card as="article">
            <p className="text-xs uppercase tracking-wide text-muted">{siteName(request)}</p>
            <div className="mt-1 flex flex-wrap items-start justify-between gap-2">
              <TitleLink request={request} />
              <RequestStatusPill status={request.status} />
            </div>
            <p className="mt-2 text-sm text-muted">
              Opened {relativeTime(request.created_at)} · Updated {relativeTime(request.updated_at)}
            </p>
          </Card>
        </li>
      ))}
    </ul>
  );
}

export function AgencyRequests() {
  const [filter, setFilter] = useState<Filter>("open");

  const query = useQuery({ queryKey: ["agency-requests"], queryFn: loadAgencyRequests });

  let body: ReactNode;
  if (query.isPending) {
    body = <Spinner label="Loading change requests" />;
  } else if (query.isError) {
    body = (
      <Notice kind="danger" title="Change requests could not be loaded">
        {query.error.message}
      </Notice>
    );
  } else {
    const rows = query.data.filter((request) => matches(request, filter));
    if (rows.length === 0) {
      body = (
        <EmptyState title={filter === "open" ? "No open requests" : "No requests match this filter"}>
          {filter === "open"
            ? "Requests clients file from their site dashboards will appear here."
            : "Try a different status, or “All”."}
        </EmptyState>
      );
    } else {
      body = (
        <>
          <RequestsTable rows={rows} />
          <RequestsCards rows={rows} />
        </>
      );
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Change requests" description="Across every site your agency looks after." />
      <Field label="Status" htmlFor="request-filter" className="max-w-xs">
        <Select
          id="request-filter"
          value={filter}
          onChange={(event) => {
            const value = event.target.value;
            if (isFilter(value)) setFilter(value);
          }}
        >
          <option value="open">Open</option>
          {CHANGE_REQUEST_STATUSES.map((status) => (
            <option key={status} value={status}>
              {CHANGE_REQUEST_STATUS_LABELS[status]}
            </option>
          ))}
          <option value="all">All</option>
        </Select>
      </Field>
      {body}
    </div>
  );
}
