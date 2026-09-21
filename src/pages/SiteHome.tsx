/**
 * Site overview — the client's home and the staff overview for one site: its
 * connection status, a "Check connection" run, the latest publishes and the
 * latest change requests.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Link } from "react-router";
import { CheckList } from "@/components/CheckList.tsx";
import { siteQueryKey, useSite } from "@/components/SiteLayout.tsx";
import { Button, Card, EmptyState, LinkButton, Notice, PageHeader, Pill, Spinner, SrOnly } from "@/components/ui.tsx";
import { relativeTime, shortSha } from "@/lib/format.ts";
import { callFunction } from "@/lib/functions.ts";
import { supabase } from "@/lib/supabase.ts";
import {
  CHANGE_REQUEST_STATUS_LABELS,
  PUBLISH_STATUS_LABELS,
  type ChangeRequest,
  type ChangeRequestStatus,
  type Publish,
  type PublishStatus,
  type SiteStatus,
} from "@/lib/types.ts";
import type { DiagnoseResponse } from "@shared/publishTypes.ts";

type Tone = NonNullable<ComponentProps<typeof Pill>["tone"]>;

const PUBLISH_TONES: Record<PublishStatus, Tone> = { committed: "success", conflict: "warning", failed: "danger" };

const REQUEST_TONES: Record<ChangeRequestStatus, Tone> = {
  new: "accent",
  in_progress: "warning",
  ready_for_review: "accent",
  done: "success",
  declined: "neutral",
};

function StatusPill({ status }: { status: SiteStatus }) {
  return status === "connected" ? <Pill tone="success">Connected</Pill> : <Pill tone="warning">Needs attention</Pill>;
}

function SectionCard({ id, title, seeAll, children }: { id: string; title: string; seeAll: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <Card className="h-full">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={id} className="text-lg font-semibold text-ink">
            {title}
          </h2>
          <Link to={seeAll} className="inline-flex min-h-11 items-center text-sm font-medium text-accent underline-offset-2 hover:underline">
            See all
          </Link>
        </div>
        <div className="mt-3">{children}</div>
      </Card>
    </section>
  );
}

function CommitLink({ publish }: { publish: Publish }) {
  if (!publish.commit_url) return null;
  return (
    <a
      href={publish.commit_url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-11 items-center gap-1 font-mono text-sm text-accent underline-offset-2 hover:underline"
    >
      {shortSha(publish.commit_sha) || "commit"}
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      <SrOnly>(opens the commit in a new tab)</SrOnly>
    </a>
  );
}

function RecentPublishes({ siteId }: { siteId: string }) {
  const query = useQuery({
    queryKey: ["site-publishes", siteId, "recent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("publishes")
        .select("*")
        .eq("site_id", siteId)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw new Error(error.message);
      return (data ?? []) as Publish[];
    },
  });

  let body: ReactNode;
  if (query.isPending) {
    body = <Spinner label="Loading publishes" />;
  } else if (query.isError) {
    body = (
      <Notice kind="danger" title="Publishes could not be loaded">
        {query.error.message}
      </Notice>
    );
  } else if (query.data.length === 0) {
    body = <EmptyState title="Nothing published yet">Changes published from the page editor will appear here.</EmptyState>;
  } else {
    body = (
      <ul className="divide-y divide-line">
        {query.data.map((publish) => (
          <li key={publish.id} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
            <span className="font-medium text-text">{publish.page_slug}</span>
            <span className="text-sm text-muted">{relativeTime(publish.created_at)}</span>
            <Pill tone={PUBLISH_TONES[publish.status]}>{PUBLISH_STATUS_LABELS[publish.status]}</Pill>
            <span className="ml-auto">
              <CommitLink publish={publish} />
            </span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <SectionCard id="recent-publishes" title="Recent publishes" seeAll={`/sites/${siteId}/history`}>
      {body}
    </SectionCard>
  );
}

function RecentRequests({ siteId, isStaff }: { siteId: string; isStaff: boolean }) {
  const query = useQuery({
    queryKey: ["site-change-requests", siteId, "recent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("change_requests")
        .select("*")
        .eq("site_id", siteId)
        .order("updated_at", { ascending: false })
        .limit(5);
      if (error) throw new Error(error.message);
      return (data ?? []) as ChangeRequest[];
    },
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
  } else if (query.data.length === 0) {
    body = (
      <EmptyState
        title="No change requests yet"
        action={
          <LinkButton variant="secondary" to={`/sites/${siteId}/requests/new`}>
            Request a change
          </LinkButton>
        }
      >
        {isStaff
          ? "Requests the client files for this site will appear here."
          : "Ask for anything you cannot change yourself and the agency will pick it up."}
      </EmptyState>
    );
  } else {
    body = (
      <ul className="divide-y divide-line">
        {query.data.map((request) => (
          <li key={request.id}>
            <Link
              to={`/sites/${siteId}/requests/${request.id}`}
              className="-mx-2 flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-1.5 hover:bg-ground"
            >
              <span className="font-medium text-text">{request.title}</span>
              <Pill tone={REQUEST_TONES[request.status]}>{CHANGE_REQUEST_STATUS_LABELS[request.status]}</Pill>
              <span className="ml-auto text-sm text-muted">{relativeTime(request.updated_at)}</span>
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <SectionCard
      id="recent-requests"
      title="Your change requests"
      seeAll={`/sites/${siteId}/requests`}
    >
      {body}
    </SectionCard>
  );
}

export function SiteHome() {
  const { site, isStaff } = useSite();
  const queryClient = useQueryClient();
  const root = `/sites/${site.id}`;

  const diagnose = useMutation({
    mutationFn: async () => {
      const result = await callFunction<DiagnoseResponse>("site-diagnose", { site_id: site.id });
      if (!result.ok) throw new Error(result.message);
      return result;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: siteQueryKey(site.id) });
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={site.name}
        description={
          site.live_url ? (
            <a
              href={site.live_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-1 break-all text-accent underline-offset-2 hover:underline"
            >
              {site.live_url}
              <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
              <SrOnly>(opens in a new tab)</SrOnly>
            </a>
          ) : (
            "No live URL recorded"
          )
        }
        action={
          <>
            <LinkButton to={`${root}/pages`}>Edit pages</LinkButton>
            <LinkButton variant="secondary" to={`${root}/requests/new`}>
              Request a change
            </LinkButton>
          </>
        }
      />

      <section aria-labelledby="site-status">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h2 id="site-status" className="text-lg font-semibold text-ink">
                Status
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={site.status} />
                <span className="text-sm text-muted">Last published {relativeTime(site.last_published_at)}</span>
              </div>
              {isStaff && (
                <p className="break-all font-mono text-sm text-muted">
                  {site.repo_owner}/{site.repo_name}@{site.branch}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => diagnose.mutate()} loading={diagnose.isPending}>
                Check connection
              </Button>
              {isStaff && (
                <LinkButton variant="secondary" to={`${root}/team`}>
                  Team
                </LinkButton>
              )}
            </div>
          </div>
          {diagnose.isPending && (
            <div className="mt-4">
              <Spinner label="Running the connection check" />
            </div>
          )}
          {diagnose.isError && (
            <Notice kind="danger" title="The connection check could not run" className="mt-4">
              {diagnose.error.message}
            </Notice>
          )}
        </Card>
      </section>

      {diagnose.data && <CheckList report={diagnose.data} onHide={() => diagnose.reset()} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <RecentPublishes siteId={site.id} />
        <RecentRequests siteId={site.id} isStaff={isStaff} />
      </div>
    </div>
  );
}
