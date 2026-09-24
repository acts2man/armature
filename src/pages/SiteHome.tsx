/**
 * A site's Dashboard, WordPress-style: a welcome line, "Edit your site" shortcuts, the
 * new messages from the site's forms, recent publishes and open change requests, plus
 * what needs the person's attention. Clients and agency staff share the layout; the
 * agency-only things (connection check, hosting, editing level) live under Site
 * settings. Only real data is shown: a section with nothing to show says so briefly.
 */
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { IconAlert, IconBranch, IconCheck, IconEye, IconExternal, IconGithub, IconHistory, IconImage, IconInbox, IconPage, IconPalette, IconPencil, IconPlus, IconSend, IconSettings } from "@/components/icons.tsx";
import { useSite } from "@/components/SiteLayout.tsx";
import { SidebarTour } from "@/components/SidebarTour.tsx";
import { RequestStatusPill } from "@/components/RequestStatus.tsx";
import { useRecentMessages } from "@/hooks/useMessages.ts";
import { BUILT, siteNavItems } from "@/components/siteNav.ts";
import { EmptyState, LinkButton, Notice, PageHeader, Panel, PanelRow, Pill, SkeletonRows, SrOnly } from "@/components/ui.tsx";
import { formatDateTime, plural, relativeTime, shortSha } from "@/lib/format.ts";
import { formLabel, isUnread, messagePreview, senderLabel } from "@/lib/messages.ts";
import { displayName, firstName, greeting } from "@/lib/people.ts";
import { SITE_STATUS_TONES, isHostingOnly, siteStatusLabel } from "@/lib/services.ts";
import { supabase } from "@/lib/supabase.ts";
import { OPEN_CHANGE_REQUEST_STATUSES, PUBLISH_STATUS_LABELS, type ChangeRequest, type Publish, type PublishStatus, type Site } from "@/lib/types.ts";

const PUBLISH_TONES: Record<PublishStatus, "green" | "amber" | "danger"> = { committed: "green", conflict: "amber", failed: "danger" };

const displayUrl = (url: string): string => url.replace(/^https?:\/\//i, "").replace(/\/+$/, "");

function StatusPill({ site }: { site: Pick<Site, "status" | "last_published_at"> }) {
  const label = siteStatusLabel(site);
  return <Pill tone={SITE_STATUS_TONES[label]}>{label}</Pill>;
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
      const { data, error } = await supabase.from("change_requests").select("*").eq("site_id", siteId).order("updated_at", { ascending: false }).limit(10);
      if (error) throw new Error(error.message);
      return (data ?? []) as ChangeRequest[];
    },
  });
}

function Shortcut({ to, icon, title, detail, external, testId }: { to: string; icon: ReactNode; title: string; detail: string; external?: boolean; testId?: string }) {
  const className = "flex min-h-[72px] items-center gap-3.5 rounded-card border border-line bg-panel px-4 py-3 text-left hover:border-ink-line hover:bg-ground";
  const body = (
    <>
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-ground text-text">{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-[14px] font-semibold text-text">{title}</span>
        <span className="block text-[12px] leading-snug text-muted">{detail}</span>
      </span>
    </>
  );
  if (external) {
    return (
      <a href={to} target="_blank" rel="noreferrer" className={className} data-testid={testId}>
        {body}
        <SrOnly>(opens in a new tab)</SrOnly>
      </a>
    );
  }
  return (
    <Link to={to} className={className} data-testid={testId}>
      {body}
    </Link>
  );
}

function PanelLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex h-9 items-center rounded-control px-3 text-[14px] font-semibold text-text hover:bg-ground">
      {children}
    </Link>
  );
}

export function SiteHome() {
  const { site, isStaff } = useSite();
  const { user, agency } = useAuth();
  const root = `/sites/${site.id}`;
  const hostingOnly = isHostingOnly(site);
  const publishes = useRecentPublishes(site.id);
  const requests = useRecentRequests(site.id);
  const messages = useRecentMessages(site.id);
  const navItems = siteNavItems({ root, isStaff, hostingOnly });

  // --- what needs attention, from real data only ---
  const attention: { key: string; icon: ReactNode; title: string; detail: string; action: ReactNode }[] = [];
  if (site.status === "needs_attention") {
    attention.push({
      key: "connection",
      icon: <IconAlert size={18} />,
      title: "The site's connection needs attention",
      detail: isStaff ? "Run a check under Site settings to see which step is failing and how to fix it." : "Publishing may not work until the agency fixes this.",
      action: isStaff ? (
        <LinkButton variant="secondary" size="sm" to={`${root}/settings`}>
          Check connection
        </LinkButton>
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
        <LinkButton variant="secondary" size="sm" to={isStaff ? `${root}/settings/history` : `${root}/history`}>
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

  const open = (requests.data ?? []).filter((request) => OPEN_CHANGE_REQUEST_STATUSES.includes(request.status));
  const name = firstName(displayName(user));
  const unread = messages.data?.unread ?? 0;
  const portal = agency?.portal_name?.trim() || "your agency";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={isStaff ? site.name : `${greeting()}, ${name}`}
        description={isStaff ? undefined : hostingOnly ? `${site.name} is looked after by ${portal}. Anything you need changed, ask for it here.` : `Here is how ${site.name} is doing. Pick something below to start editing.`}
        meta={
          <>
            {site.live_url ? (
              <a href={site.live_url} target="_blank" rel="noreferrer" className="inline-flex min-h-6 items-center gap-1 text-text underline-offset-2 hover:underline">
                {displayUrl(site.live_url)}
                <IconExternal size={13} />
                <SrOnly>(opens in a new tab)</SrOnly>
              </a>
            ) : isStaff && !hostingOnly ? (
              <span className="font-mono text-[13px]">
                {site.repo_owner}/{site.repo_name}@{site.branch}
              </span>
            ) : (
              <span>{site.name}</span>
            )}
            <StatusPill site={site} />
            {!hostingOnly && <span>{site.last_published_at ? `Last published ${formatDateTime(site.last_published_at)}` : "Nothing published yet"}</span>}
          </>
        }
        action={
          <>
            {site.live_url && (
              <LinkButton variant="secondary" to={site.live_url} external>
                <IconEye size={16} /> View site
              </LinkButton>
            )}
            {hostingOnly && isStaff && (
              <LinkButton to={`/sites/new?upgrade=${site.id}`}>
                <IconGithub size={16} /> Connect repository
              </LinkButton>
            )}
          </>
        }
      />

      <SidebarTour siteName={site.name} isStaff={isStaff} items={navItems} />

      {hostingOnly && (
        <Notice kind="info" title={isStaff ? "Hosting-only site" : "This site is looked after by the agency"}>
          {isStaff
            ? "No repository is connected, so there are no pages to edit or publish yet. Hosting, domain and email are recorded under Site settings; connect the repository whenever the site is ready to be edited here."
            : "Its pages are not edited here yet. Change requests still reach the agency."}
        </Notice>
      )}

      {!hostingOnly && (
        <section aria-labelledby="edit-your-site" className="flex flex-col gap-3">
          <h2 id="edit-your-site" className="font-sans text-[15px] font-bold tracking-normal text-text">
            Edit your site
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="shortcuts">
            <Shortcut to={`${root}/pages`} icon={<IconPencil size={18} />} title="Edit a page" detail="Pick a page under Pages, then click anything on it and change it." testId="shortcut-edit" />
            <Shortcut to={`${root}/pages`} icon={<IconPage size={18} />} title="All pages" detail="Every page, its address and when it last went live." testId="shortcut-pages" />
            {BUILT.appearance && <Shortcut to={`${root}/appearance`} icon={<IconPalette size={18} />} title="Colours and fonts" detail="The site's look, changed everywhere at once." testId="shortcut-appearance" />}
            {BUILT.media && <Shortcut to={`${root}/media`} icon={<IconImage size={18} />} title="Pictures" detail="Upload, replace and describe the site's images." testId="shortcut-media" />}
          </div>
        </section>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[1.65fr_1fr]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="Needs your attention" aside={attention.length > 0 ? <Pill tone="amber">{attention.length}</Pill> : <Pill tone="green">All clear</Pill>}>
            {publishes.isPending || requests.isPending ? (
              <SkeletonRows rows={1} label="Checking what needs attention" />
            ) : attention.length === 0 ? (
              <PanelRow
                icon={<IconCheck size={18} />}
                title="Nothing needs your attention"
                detail={open.length > 0 ? `${plural(open.length, "open request")} with the agency. You will see anything that needs you here.` : "Everything is connected and up to date."}
              />
            ) : (
              attention.map((item) => <PanelRow key={item.key} icon={item.icon} title={item.title} detail={item.detail} action={item.action} />)
            )}
          </Panel>

          <Panel
            title={
              <span className="inline-flex items-center gap-2">
                New messages {unread > 0 && <Pill tone="blue">{unread} unread</Pill>}
              </span>
            }
            aside={BUILT.contact ? <PanelLink to={`${root}/contact`}>All messages</PanelLink> : undefined}
          >
            <div data-testid="dashboard-messages">
              {messages.isPending ? (
                <SkeletonRows rows={3} label="Loading messages" />
              ) : messages.isError ? (
                <div className="p-4">
                  <Notice kind="danger" title="Messages could not be loaded">
                    {messages.error.message}
                  </Notice>
                </div>
              ) : messages.data.latest.length === 0 ? (
                <div className="p-5">
                  <EmptyState title="No messages yet" icon={<IconInbox size={18} />}>
                    {hostingOnly ? "Entries from the site's forms will be listed here once the site is connected." : "When someone fills in a form on the site, their message lands here and is emailed to the addresses the agency set."}
                  </EmptyState>
                </div>
              ) : (
                messages.data.latest.map((submission) => {
                  const unreadRow = isUnread(submission);
                  const inner = (
                    <>
                      <span className="mt-2 flex h-2.5 w-2.5 shrink-0 items-center justify-center" aria-hidden="true">
                        {unreadRow && <span className="h-2 w-2 rounded-full bg-accent" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <span className={unreadRow ? "text-[14px] font-bold text-text" : "text-[14px] font-semibold text-text"}>
                            {senderLabel(submission.data)}
                            {unreadRow && <SrOnly> (unread)</SrOnly>}
                          </span>
                          <span className="text-[12px] text-muted">{relativeTime(submission.created_at)}</span>
                        </span>
                        <span className="block truncate text-[13px] text-muted">{messagePreview(submission.data) || formLabel(submission)}</span>
                      </span>
                    </>
                  );
                  const className = "flex items-start gap-3 border-b border-line px-5 py-3 last:border-b-0 hover:bg-ground";
                  return BUILT.contact ? (
                    <Link key={submission.id} to={`${root}/contact?entry=${submission.id}`} className={className} data-testid={`message-${submission.id}`}>
                      {inner}
                    </Link>
                  ) : (
                    <div key={submission.id} className={className} data-testid={`message-${submission.id}`}>
                      {inner}
                    </div>
                  );
                })
              )}
            </div>
          </Panel>

          <Panel title="Recent publishes" aside={<PanelLink to={isStaff ? `${root}/settings/history` : `${root}/history`}>All history</PanelLink>}>
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
                  title={hostingOnly ? "No pages to publish" : "Nothing published yet"}
                  icon={<IconPage size={18} />}
                  action={
                    hostingOnly ? (
                      isStaff ? (
                        <LinkButton to={`/sites/new?upgrade=${site.id}`} variant="secondary" size="sm">
                          Connect repository
                        </LinkButton>
                      ) : undefined
                    ) : (
                      <LinkButton to={`${root}/pages`} variant="secondary" size="sm">
                        Edit a page
                      </LinkButton>
                    )
                  }
                >
                  {hostingOnly ? "This site's repository is not connected, so nothing is published from here. Publishes appear once it is." : "Changes you publish from the editor will be listed here with a link to the commit."}
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
          <Panel title="Change requests" aside={<PanelLink to={`${root}/requests`}>All requests</PanelLink>}>
            {/* The one place to ask the agency for something bigger: new layouts, features, anything the editor cannot do. */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-ground/60 px-4 py-3.5 sm:px-5" data-testid="request-card">
              <div className="flex min-w-0 items-center gap-3.5">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-panel text-text">
                  <IconSend size={18} />
                </span>
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold text-text">Need something bigger?</div>
                  <div className="text-[13px] leading-snug text-muted">{isStaff ? "New layouts, features and anything the editor cannot do reach you here as a request." : `New layouts, features and anything the editor cannot do go to ${portal} as a request.`}</div>
                </div>
              </div>
              <LinkButton size="sm" to={`${root}/requests/new`} data-testid="request-new">
                <IconPlus size={15} /> Request a change
              </LinkButton>
            </div>
            <div data-testid="dashboard-requests">
              {requests.isPending ? (
                <SkeletonRows rows={2} label="Loading change requests" />
              ) : requests.isError ? (
                <div className="p-4">
                  <Notice kind="danger" title="Change requests could not be loaded">
                    {requests.error.message}
                  </Notice>
                </div>
              ) : open.length === 0 ? (
                <div className="p-5">
                  <EmptyState title="No open requests" icon={<IconBranch size={18} />}>
                    {isStaff ? "Requests the client files for this site will appear here." : "Ask for anything you cannot change yourself and the agency will pick it up."}
                  </EmptyState>
                </div>
              ) : (
                open.slice(0, 5).map((request) => (
                  <Link key={request.id} to={`${root}/requests/${request.id}`} className="flex min-h-[52px] items-center justify-between gap-3 border-b border-line px-5 py-2 text-[13px] last:border-b-0 hover:bg-ground">
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-semibold text-text">{request.title}</span>
                      <span className="block text-muted">{relativeTime(request.updated_at)}</span>
                    </span>
                    <RequestStatusPill status={request.status} />
                  </Link>
                ))
              )}
            </div>
          </Panel>

          <Panel title="Site health" aside={<StatusPill site={site} />}>
            <div className="flex flex-col gap-2.5 p-5 text-[13px] text-text">
              <div className="flex items-center gap-2.5">
                <span className={site.status === "connected" ? "text-green" : hostingOnly ? "text-muted" : "text-amber"}>{site.status === "connected" ? <IconCheck size={16} /> : hostingOnly ? <IconGithub size={16} /> : <IconAlert size={16} />}</span>
                <span>{site.status === "connected" ? "Connected and publishing" : hostingOnly ? "No repository connected" : "The connection check found a problem"}</span>
              </div>
              {!hostingOnly && (
                <div className="flex items-center gap-2.5">
                  <span className={site.last_published_at ? "text-green" : "text-muted"}>{site.last_published_at ? <IconCheck size={16} /> : <IconHistory size={16} />}</span>
                  <span>{site.last_published_at ? `Last published ${relativeTime(site.last_published_at)}` : "No publish yet"}</span>
                </div>
              )}
              <div className="flex items-center gap-2.5">
                <span className={unread === 0 ? "text-green" : "text-blue"}>
                  <IconInbox size={16} />
                </span>
                <span>{unread === 0 ? "No unread messages" : plural(unread, "unread message")}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className={open.length === 0 ? "text-green" : "text-blue"}>
                  <IconBranch size={16} />
                </span>
                <span>{open.length === 0 ? "No open change requests" : plural(open.length, "open change request")}</span>
              </div>
              {isStaff && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <LinkButton variant="secondary" size="sm" to={`${root}/settings`}>
                    <IconSettings size={16} /> Site settings
                  </LinkButton>
                </div>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
