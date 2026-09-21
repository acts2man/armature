/**
 * Change requests for one site: everything the client has asked the agency to
 * do that the editor cannot, with a filter for open vs all.
 */
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useSite } from "@/components/SiteLayout.tsx";
import { Button, Card, EmptyState, LinkButton, Notice, PageHeader, Pill, Spinner } from "@/components/ui.tsx";
import { relativeTime } from "@/lib/format.ts";
import { supabase } from "@/lib/supabase.ts";
import {
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

type Filter = "open" | "all";

async function loadRequests(siteId: string): Promise<ChangeRequest[]> {
  const { data, error } = await supabase
    .from("change_requests")
    .select("*")
    .eq("site_id", siteId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ChangeRequest[];
}

/** The first non-empty line of the details, for the one-line preview. */
function preview(details: string): string {
  const line = details
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  return line ?? "";
}

function RequestRow({ request, siteId }: { request: ChangeRequest; siteId: string }) {
  const summary = preview(request.details);
  const updated = request.updated_at !== request.created_at;
  return (
    <li>
      <Card as="article">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="min-w-0 text-lg font-semibold text-ink">
            <Link
              to={`/sites/${siteId}/requests/${request.id}`}
              className="inline-flex min-h-11 items-center underline-offset-2 hover:underline"
            >
              {request.title}
            </Link>
          </h2>
          <RequestStatusPill status={request.status} />
        </div>
        <p className="mt-1 text-sm text-muted">
          Opened {relativeTime(request.created_at)}
          {updated && <> · Updated {relativeTime(request.updated_at)}</>}
        </p>
        {summary && <p className="mt-2 truncate text-sm text-muted">{summary}</p>}
      </Card>
    </li>
  );
}

export function ChangeRequests() {
  const { site } = useSite();
  const [filter, setFilter] = useState<Filter>("open");

  const query = useQuery({
    queryKey: ["change-requests", site.id],
    queryFn: () => loadRequests(site.id),
  });

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
    const rows =
      filter === "open"
        ? query.data.filter((request) => OPEN_CHANGE_REQUEST_STATUSES.includes(request.status))
        : query.data;
    if (rows.length === 0) {
      body = (
        <EmptyState
          title={filter === "open" ? "No open requests" : "No requests yet"}
          action={<LinkButton to={`/sites/${site.id}/requests/new`}>Request a change</LinkButton>}
        >
          {filter === "open" && query.data.length > 0
            ? "Everything has been handled. Switch to “All” to see finished requests."
            : "When the editor can’t make a change you need, ask the agency here."}
        </EmptyState>
      );
    } else {
      body = (
        <ul className="space-y-3">
          {rows.map((request) => (
            <RequestRow key={request.id} request={request} siteId={site.id} />
          ))}
        </ul>
      );
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Change requests"
        description="Ask the agency for changes the editor can't make, and track their progress."
        action={<LinkButton to={`/sites/${site.id}/requests/new`}>Request a change</LinkButton>}
      />
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter requests">
        <Button
          variant={filter === "open" ? "primary" : "secondary"}
          aria-pressed={filter === "open"}
          onClick={() => setFilter("open")}
        >
          Open
        </Button>
        <Button
          variant={filter === "all" ? "primary" : "secondary"}
          aria-pressed={filter === "all"}
          onClick={() => setFilter("all")}
        >
          All
        </Button>
      </div>
      {body}
    </div>
  );
}
