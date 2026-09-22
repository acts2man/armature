/**
 * Change requests for one site: everything the client has asked the agency to
 * do that the editor cannot, with a filter for open vs all.
 */
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { IconBranch, IconSend } from "@/components/icons.tsx";
import { RequestStatusPill } from "@/components/RequestStatus.tsx";
import { useSite } from "@/components/SiteLayout.tsx";
import { EmptyState, LinkButton, Notice, PageHeader, Panel, Segmented, SkeletonRows } from "@/components/ui.tsx";
import { relativeTime } from "@/lib/format.ts";
import { supabase } from "@/lib/supabase.ts";
import { OPEN_CHANGE_REQUEST_STATUSES, type ChangeRequest } from "@/lib/types.ts";

type Filter = "open" | "all";

async function loadRequests(siteId: string): Promise<ChangeRequest[]> {
  const { data, error } = await supabase.from("change_requests").select("*").eq("site_id", siteId).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ChangeRequest[];
}

/** The first non-empty line of the details, for the one-line preview. */
function preview(details: string): string {
  return details.split("\n").map((part) => part.trim()).find((part) => part.length > 0) ?? "";
}

function RequestRow({ request, siteId }: { request: ChangeRequest; siteId: string }) {
  const summary = preview(request.details);
  const updated = request.updated_at !== request.created_at;
  return (
    <li className="border-b border-line last:border-b-0">
      <Link to={`/sites/${siteId}/requests/${request.id}`} className="flex min-h-16 items-center justify-between gap-4 px-4 py-3 hover:bg-ground sm:px-5">
        <span className="flex min-w-0 items-center gap-3.5">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-ground text-text">
            <IconBranch size={18} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-semibold text-text">{request.title}</span>
            <span className="block truncate text-[13px] text-muted">
              {summary || "No details given"}
              <span className="hidden sm:inline">
                {" · "}Opened {relativeTime(request.created_at)}
                {updated && <>, updated {relativeTime(request.updated_at)}</>}
              </span>
            </span>
          </span>
        </span>
        <RequestStatusPill status={request.status} />
      </Link>
    </li>
  );
}

export function ChangeRequests() {
  const { site, isStaff } = useSite();
  const [filter, setFilter] = useState<Filter>("open");
  const query = useQuery({ queryKey: ["change-requests", site.id], queryFn: () => loadRequests(site.id) });

  let body: ReactNode;
  if (query.isPending) {
    body = <SkeletonRows rows={3} label="Loading change requests" />;
  } else if (query.isError) {
    body = (
      <div className="p-4">
        <Notice kind="danger" title="Change requests could not be loaded">
          {query.error.message}
        </Notice>
      </div>
    );
  } else {
    const rows = filter === "open" ? query.data.filter((request) => OPEN_CHANGE_REQUEST_STATUSES.includes(request.status)) : query.data;
    if (rows.length === 0) {
      body = (
        <div className="p-5">
          <EmptyState
            title={filter === "open" ? "No open requests" : "No requests yet"}
            icon={<IconSend size={18} />}
            action={
              <LinkButton to={`/sites/${site.id}/requests/new`} variant="secondary" size="sm">
                Request a change
              </LinkButton>
            }
          >
            {filter === "open" && query.data.length > 0
              ? 'Everything has been handled. Switch to "All" to see finished requests.'
              : isStaff
                ? "Requests the client files for this site will appear here."
                : "When the editor can't make a change you need, ask the agency here."}
          </EmptyState>
        </div>
      );
    } else {
      body = <ul>{rows.map((request) => <RequestRow key={request.id} request={request} siteId={site.id} />)}</ul>;
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Change requests"
        description={isStaff ? "What this client has asked for, and where each request stands." : "Ask the agency for changes the editor can't make, and track their progress."}
        action={
          <LinkButton to={`/sites/${site.id}/requests/new`}>
            <IconSend size={16} /> Request a change
          </LinkButton>
        }
      />
      <Panel
        title="Requests"
        aside={
          <Segmented
            label="Filter requests"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "open", label: "Open" },
              { value: "all", label: "All" },
            ]}
          />
        }
      >
        {body}
      </Panel>
    </div>
  );
}
