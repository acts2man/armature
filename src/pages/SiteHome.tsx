/**
 * Site overview, as in docs/2-client-dashboard.html: a greeting, what needs the
 * person's attention, recent publishes and change requests, site health, and
 * quick actions. Clients and agency staff share the layout; staff also get the
 * repository line, "Check connection" and Team. Only real data is shown: a
 * section with nothing to show says so briefly instead of inventing numbers.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { CheckList } from "@/components/CheckList.tsx";
import { IconAlert, IconBranch, IconCheck, IconEye, IconExternal, IconHistory, IconPage, IconPencil, IconSend, IconStethoscope, IconTeam } from "@/components/icons.tsx";
import { siteQueryKey, useSite } from "@/components/SiteLayout.tsx";
import { RequestStatusPill } from "@/components/RequestStatus.tsx";
import { Button, EmptyState, LinkButton, Notice, PageHeader, Panel, PanelRow, Pill, SkeletonRows, SrOnly } from "@/components/ui.tsx";
import { formatDateTime, plural, relativeTime, shortSha } from "@/lib/format.ts";
import { callFunction } from "@/lib/functions.ts";
import { displayName, firstName, greeting } from "@/lib/people.ts";
import { supabase } from "@/lib/supabase.ts";
import {
  OPEN_CHANGE_REQUEST_STATUSES,
  PUBLISH_STATUS_LABELS,
  type ChangeRequest,
  type Publish,
  type PublishStatus,
  type SiteStatus,
} from "@/lib/types.ts";
import type { DiagnoseResponse } from "@shared/publishTypes.ts";

const PUBLISH_TONES: Record<PublishStatus, "green" | "amber" | "danger"> = { committed: "green", conflict: "amber", failed: "danger" };

const displayUrl = (url: string): string => url.replace(/^https?:\/\//i, "").replace(/\/+$/, "");

function StatusPill({ status }: { status: SiteStatus }) {
  return status === "connected" ? <Pill tone="green">Connected</Pill> : <Pill tone="amber">Needs attention</Pill>;
}

function useRecentPublishes(siteId: string) {
  return useQuery({
    queryKey: ["site-publishes", siteId, "recent"],
    queryFn: async () => {
      const { data, error } = await supabase.from("publishes").select("*").eq("site_id", siteId).order("created_at", { ascending: false }).limit(5);
      if (error) throw new Error(error.message);
      return (data ?? []) as Publish[];
    },
  });
}

function useRecentRequests(siteId: string) {
  return useQuery({
    queryKey: ["site-change-requests", siteId, "recent"],
    queryFn: async () => {
      const { data, error } = await supabase.from("change_requests").select("*").eq("site_id", siteId).order("updated_at", { ascending: false }).limit(6);
      if (error) throw new Error(error.message);
      return (data ?? []) as ChangeRequest[];
    },
  });
}

function QuickAction({ to, icon, children, external }: { to: string; icon: ReactNode; children: ReactNode; external?: boolean }) {
  const className = "inline-flex h-12 items-center gap-2.5 rounded-[10px] border border-line bg-panel px-4 text-[14px] font-semibold text-text hover:bg-ground";
  if (external) {
    return (
      <a href={to} target="_blank" rel="noreferrer" className={className}>
        {icon}
        {children}
        <SrOnly>(opens in a new tab)</SrOnly>
      </a>
    );
  }
  return (
    <Link to={to} className={className}>
      {icon}
      {children}
    </Link>
  );
}

export function SiteHome() {
  const { site, isStaff } = useSite();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const root = `/sites/${site.id}`;
  const publishes = useRecentPublishes(site.id);
  const requests = useRecentRequests(site.id);

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

  // --- what needs attention, from real data only ---
  const attention: { key: string; icon: ReactNode; title: string; detail: string; action: ReactNode }[] = [];
  if (site.status !== "connected") {
    attention.push({
      key: "connection",
      icon: <IconAlert size={18} />,
      title: "The site's connection needs attention",
      detail: isStaff ? "Run a check to see which step is failing and how to fix it." : "Publishing may not work until the agency fixes this.",
      action: isStaff ? (
        <Button variant="secondary" size="sm" onClick={() => diagnose.mutate()} loading={diagnose.isPending}>
          Check connection
        </Button>
      ) : (
        <LinkButton variant="secondary" size="sm" to={`${root}/requests/new`}>
          Tell the agency
        </LinkButton>
      ),
    });
  }
  const latest = publishes.data?.[0];
  if (latest && latest.status !== "committed") {
    attention.push({
      key: "publish",
      icon: <IconHistory size={18} />,
      title: latest.status === "conflict" ? "Your last publish hit a conflict" : "Your last publish did not go through",
      detail: `${latest.page_slug}, ${relativeTime(latest.created_at)}. Open the history for the reason.`,
      action: (
        <LinkButton variant="secondary" size="sm" to={`${root}/history`}>
          See history
        </LinkButton>
      ),
    });
  }
  for (const request of requests.data ?? []) {
    if (!isStaff && request.status === "ready_for_review") {
      attention.push({
        key: request.id,
        icon: <IconBranch size={18} />,
        title: `${request.title} is ready for your review`,
        detail: request.agency_note.trim() ? request.agency_note.trim().slice(0, 100) : "The agency has finished this request. Take a look.",
        action: (
          <LinkButton variant="secondary" size="sm" to={`${root}/requests/${request.id}`}>
            Review
          </LinkButton>
        ),
      });
    }
    if (isStaff && request.status === "new") {
      attention.push({
        key: request.id,
        icon: <IconBranch size={18} />,
        title: `New request: ${request.title}`,
        detail: `Asked ${relativeTime(request.created_at)}. Nobody has picked it up yet.`,
        action: (
          <LinkButton variant="secondary" size="sm" to={`${root}/requests/${request.id}`}>
            Open
          </LinkButton>
        ),
      });
    }
  }

  const openCount = (requests.data ?? []).filter((request) => OPEN_CHANGE_REQUEST_STATUSES.includes(request.status)).length;
  const name = firstName(displayName(user));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={isStaff ? site.name : `${greeting()}, ${name}`}
        meta={
          <>
            {site.live_url ? (
              <a href={site.live_url} target="_blank" rel="noreferrer" className="inline-flex min-h-6 items-center gap-1 text-text underline-offset-2 hover:underline">
                {displayUrl(site.live_url)}
                <IconExternal size={13} />
                <SrOnly>(opens in a new tab)</SrOnly>
              </a>
            ) : isStaff ? (
              <span className="font-mono text-[13px]">
                {site.repo_owner}/{site.repo_name}@{site.branch}
              </span>
            ) : (
              <span>{site.name}</span>
            )}
            <StatusPill status={site.status} />
            <span>{site.last_published_at ? `Last published ${formatDateTime(site.last_published_at)}` : "Nothing published yet"}</span>
          </>
        }
        action={
          <>
            {site.live_url && (
              <LinkButton variant="secondary" to={site.live_url} external>
                <IconEye size={16} /> View site
              </LinkButton>
            )}
            <LinkButton to={`${root}/pages`}>
              <IconPencil size={16} /> Edit pages
            </LinkButton>
          </>
        }
      />

      {diagnose.isError && (
        <Notice kind="danger" title="The connection check could not run">
          {diagnose.error.message}
        </Notice>
      )}
      {diagnose.data && <CheckList report={diagnose.data} onHide={() => diagnose.reset()} />}

      <div className="grid items-start gap-5 xl:grid-cols-[1.65fr_1fr]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="Needs your attention" aside={attention.length > 0 ? <Pill tone="amber">{attention.length}</Pill> : <Pill tone="green">All clear</Pill>}>
            {publishes.isPending || requests.isPending ? (
              <SkeletonRows rows={1} label="Checking what needs attention" />
            ) : attention.length === 0 ? (
              <PanelRow
                icon={<IconCheck size={18} />}
                title="Nothing needs your attention"
                detail={openCount > 0 ? `${plural(openCount, "open request")} with the agency. You will see anything that needs you here.` : "Everything is connected and up to date."}
              />
            ) : (
              attention.map((item) => <PanelRow key={item.key} icon={item.icon} title={item.title} detail={item.detail} action={item.action} />)
            )}
          </Panel>

          <Panel
            title="Recent publishes"
            aside={
              <Link to={`${root}/history`} className="inline-flex h-9 items-center rounded-control px-3 text-[14px] font-semibold text-text hover:bg-ground">
                All history
              </Link>
            }
          >
            {publishes.isPending ? (
              <SkeletonRows rows={3} label="Loading publishes" />
            ) : publishes.isError ? (
              <div className="p-4">
                <Notice kind="danger" title="Publishes could not be loaded">
                  {publishes.error.message}
                </Notice>
              </div>
            ) : publishes.data.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  title="Nothing published yet"
                  icon={<IconPage size={18} />}
                  action={
                    <LinkButton to={`${root}/pages`} variant="secondary" size="sm">
                      Edit a page
                    </LinkButton>
                  }
                >
                  Changes you publish from the page editor will be listed here with a link to the commit.
                </EmptyState>
              </div>
            ) : (
              <>
                <div className="hidden h-10 items-center gap-3 border-b border-line px-5 text-[12px] font-semibold text-muted sm:grid sm:grid-cols-[1.4fr_1fr_1fr_90px]">
                  <div>Page</div>
                  <div>When</div>
                  <div>Commit</div>
                  <div>Status</div>
                </div>
                {publishes.data.map((publish) => (
                  <div key={publish.id} className="grid min-h-[52px] grid-cols-[1fr_auto] items-center gap-3 border-b border-line px-4 py-2 text-[13px] last:border-b-0 sm:grid-cols-[1.4fr_1fr_1fr_90px] sm:px-5">
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-semibold text-text">{publish.page_slug}</div>
                      <div className="text-muted sm:hidden">{relativeTime(publish.created_at)}</div>
                    </div>
                    <div className="hidden text-muted sm:block">{relativeTime(publish.created_at)}</div>
                    <div className="hidden sm:block">
                      {publish.commit_url ? (
                        <a href={publish.commit_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[12px] text-text underline-offset-2 hover:underline">
                          {shortSha(publish.commit_sha) || "commit"}
                          <IconExternal size={12} />
                          <SrOnly>(opens the commit in a new tab)</SrOnly>
                        </a>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </div>
                    <div>
                      <Pill tone={PUBLISH_TONES[publish.status]}>{PUBLISH_STATUS_LABELS[publish.status]}</Pill>
                    </div>
                  </div>
                ))}
              </>
            )}
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="Site health" aside={<StatusPill status={site.status} />}>
            <div className="flex flex-col gap-2.5 p-5 text-[13px] text-text">
              <div className="flex items-center gap-2.5">
                <span className={site.status === "connected" ? "text-green" : "text-amber"}>{site.status === "connected" ? <IconCheck size={16} /> : <IconAlert size={16} />}</span>
                <span>{site.status === "connected" ? "Connected to the site's repository" : "The connection check found a problem"}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className={site.last_published_at ? "text-green" : "text-muted"}>{site.last_published_at ? <IconCheck size={16} /> : <IconHistory size={16} />}</span>
                <span>{site.last_published_at ? `Last published ${relativeTime(site.last_published_at)}` : "No publish yet"}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className={openCount === 0 ? "text-green" : "text-blue"}>
                  <IconBranch size={16} />
                </span>
                <span>{openCount === 0 ? "No open change requests" : `${plural(openCount, "open change request")}`}</span>
              </div>
              {isStaff && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => diagnose.mutate()} loading={diagnose.isPending}>
                    <IconStethoscope size={16} /> Check connection
                  </Button>
                  <LinkButton variant="secondary" size="sm" to={`${root}/team`}>
                    <IconTeam size={16} /> Team
                  </LinkButton>
                </div>
              )}
            </div>
          </Panel>

          <Panel
            title="Change requests"
            aside={
              <Link to={`${root}/requests`} className="inline-flex h-9 items-center rounded-control px-3 text-[14px] font-semibold text-text hover:bg-ground">
                All requests
              </Link>
            }
          >
            {requests.isPending ? (
              <SkeletonRows rows={2} label="Loading change requests" />
            ) : requests.isError ? (
              <div className="p-4">
                <Notice kind="danger" title="Change requests could not be loaded">
                  {requests.error.message}
                </Notice>
              </div>
            ) : requests.data.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  title="No change requests yet"
                  icon={<IconSend size={18} />}
                  action={
                    <LinkButton variant="secondary" size="sm" to={`${root}/requests/new`}>
                      Request a change
                    </LinkButton>
                  }
                >
                  {isStaff ? "Requests the client files for this site will appear here." : "Ask for anything you cannot change yourself and the agency will pick it up."}
                </EmptyState>
              </div>
            ) : (
              requests.data.slice(0, 5).map((request) => (
                <Link key={request.id} to={`${root}/requests/${request.id}`} className="flex min-h-[52px] items-center justify-between gap-3 border-b border-line px-5 py-2 text-[13px] last:border-b-0 hover:bg-ground">
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-semibold text-text">{request.title}</span>
                    <span className="block text-muted">{relativeTime(request.updated_at)}</span>
                  </span>
                  <RequestStatusPill status={request.status} />
                </Link>
              ))
            )}
          </Panel>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <QuickAction to={`${root}/pages`} icon={<IconPencil size={18} />}>
          Edit a page
        </QuickAction>
        <QuickAction to={`${root}/requests/new`} icon={<IconSend size={18} />}>
          Request a change
        </QuickAction>
        {site.live_url && (
          <QuickAction to={site.live_url} icon={<IconEye size={18} />} external>
            View the live site
          </QuickAction>
        )}
        <QuickAction to={`${root}/history`} icon={<IconHistory size={18} />}>
          Publish history
        </QuickAction>
      </div>
    </div>
  );
}
