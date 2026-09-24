/**
 * Site settings, agency staff only: the things a client never needs to see, under one
 * sidebar item with tabs. Connection (the repository, its status and the check),
 * Hosting & services, Client editing (what clients may do in the editor) and
 * Publish history.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { NavLink, Outlet } from "react-router";
import { CheckList } from "@/components/CheckList.tsx";
import { EditingLevelPanel } from "@/components/EditingLevelPanel.tsx";
import { IconAlert, IconCheck, IconExternal, IconGithub, IconHistory, IconStethoscope } from "@/components/icons.tsx";
import { KitStatusPanel } from "@/components/KitStatusPanel.tsx";
import { siteQueryKey, useSite } from "@/components/SiteLayout.tsx";
import { SiteServicesPanel } from "@/components/SiteServicesPanel.tsx";
import { Button, LinkButton, Notice, PageHeader, Panel, Pill, SrOnly, TabBar, tabClass } from "@/components/ui.tsx";
import { formatDateTime, relativeTime } from "@/lib/format.ts";
import { callFunction } from "@/lib/functions.ts";
import { SITE_STATUS_TONES, isHostingOnly, siteStatusLabel } from "@/lib/services.ts";
import type { DiagnoseResponse } from "@shared/publishTypes.ts";
import { PublishHistory } from "./PublishHistory.tsx";

export function SiteSettings() {
  const { site, isStaff } = useSite();
  const root = `/sites/${site.id}/settings`;

  if (!isStaff) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Site settings" />
        <Notice
          kind="info"
          title="Your agency looks after these settings"
          action={
            <LinkButton to={`/sites/${site.id}`} variant="secondary" size="sm">
              Back to your dashboard
            </LinkButton>
          }
        >
          The site's connection, hosting and publishing are managed by the agency. Ask them if something needs changing.
        </Notice>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Site settings" description={`How ${site.name} is connected, hosted and published. Clients never see this screen.`} />
      <div className="border-b border-line">
        <TabBar label="Site settings">
          <NavLink to={root} end className={tabClass} data-testid="settings-tab-connection">
            Connection
          </NavLink>
          <NavLink to={`${root}/services`} className={tabClass} data-testid="settings-tab-services">
            Hosting &amp; services
          </NavLink>
          {!isHostingOnly(site) && (
            <NavLink to={`${root}/editing`} className={tabClass} data-testid="settings-tab-editing">
              Client editing
            </NavLink>
          )}
          <NavLink to={`${root}/history`} className={tabClass} data-testid="settings-tab-history">
            Publish history
          </NavLink>
        </TabBar>
      </div>
      <Outlet />
    </div>
  );
}

/** The Connection tab: the repository line, the status, the check and its report. */
export function SiteConnection() {
  const { site } = useSite();
  const queryClient = useQueryClient();
  const hostingOnly = isHostingOnly(site);
  const label = siteStatusLabel(site);

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
    <div className="flex flex-col gap-5">
      {hostingOnly && (
        <Notice
          kind="info"
          title="Hosting-only site"
          action={
            <LinkButton to={`/sites/new?upgrade=${site.id}`} size="sm">
              <IconGithub size={16} /> Connect repository
            </LinkButton>
          }
        >
          No repository is connected, so there are no pages to edit or publish yet. Hosting, domain and email are recorded under Hosting &amp; services; connect the repository whenever the site is ready to be edited here.
        </Notice>
      )}
      {diagnose.isError && (
        <Notice kind="danger" title="The connection check could not run">
          {diagnose.error.message}
        </Notice>
      )}
      {diagnose.data && <CheckList report={diagnose.data} onHide={() => diagnose.reset()} />}

      <Panel title="Connection" aside={<Pill tone={SITE_STATUS_TONES[label]}>{label}</Pill>}>
        <dl className="grid gap-x-6 gap-y-3 p-5 text-[13px] sm:grid-cols-[160px_minmax(0,1fr)]">
          <dt className="text-muted">Repository</dt>
          <dd className="min-w-0">
            {hostingOnly ? (
              <span className="text-muted">None connected</span>
            ) : (
              <a href={`https://github.com/${site.repo_owner}/${site.repo_name}`} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 font-mono text-[13px] text-text underline-offset-2 hover:underline">
                <span className="truncate">
                  {site.repo_owner}/{site.repo_name}
                </span>
                <IconExternal size={12} />
                <SrOnly>(opens GitHub in a new tab)</SrOnly>
              </a>
            )}
          </dd>
          <dt className="text-muted">Branch</dt>
          <dd className="font-mono text-[13px]">{site.branch ?? "—"}</dd>
          <dt className="text-muted">Live address</dt>
          <dd className="min-w-0">
            {site.live_url ? (
              <a href={site.live_url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 text-text underline-offset-2 hover:underline">
                <span className="truncate">{site.live_url}</span>
                <IconExternal size={12} />
                <SrOnly>(opens in a new tab)</SrOnly>
              </a>
            ) : (
              <span className="text-muted">Not recorded</span>
            )}
          </dd>
          <dt className="text-muted">GitHub App</dt>
          <dd>{site.github_installation_id ? `Installed (installation ${site.github_installation_id})` : "Not installed"}</dd>
          <dt className="text-muted">Last published</dt>
          <dd>{site.last_published_at ? `${formatDateTime(site.last_published_at)} (${relativeTime(site.last_published_at)})` : "Nothing published yet"}</dd>
        </dl>
        <div className="flex flex-col gap-2.5 border-t border-line p-5 text-[13px] text-text">
          <div className="flex items-center gap-2.5">
            <span className={site.status === "connected" ? "text-green" : hostingOnly ? "text-muted" : "text-amber"}>{site.status === "connected" ? <IconCheck size={16} /> : hostingOnly ? <IconGithub size={16} /> : <IconAlert size={16} />}</span>
            <span>{site.status === "connected" ? "Connected to the site's repository" : hostingOnly ? "No repository connected" : "The last connection check found a problem"}</span>
          </div>
          {!hostingOnly && (
            <div className="flex items-center gap-2.5">
              <span className={site.last_published_at ? "text-green" : "text-muted"}>{site.last_published_at ? <IconCheck size={16} /> : <IconHistory size={16} />}</span>
              <span>{site.last_published_at ? `Last published ${relativeTime(site.last_published_at)}` : "No publish yet"}</span>
            </div>
          )}
          {!hostingOnly && (
            <div className="mt-2">
              <Button variant="secondary" size="sm" onClick={() => diagnose.mutate()} loading={diagnose.isPending} data-testid="check-connection">
                <IconStethoscope size={16} /> Check connection
              </Button>
            </div>
          )}
        </div>
      </Panel>
      {!hostingOnly && <KitStatusPanel site={site} />}
    </div>
  );
}

export function SiteServicesSettings() {
  const { site } = useSite();
  return <SiteServicesPanel siteId={site.id} siteName={site.name} />;
}

export function SiteEditingSettings() {
  const { site } = useSite();
  if (isHostingOnly(site)) {
    return <Notice kind="info">Connect the site's repository first; then you can choose what clients may edit.</Notice>;
  }
  return <EditingLevelPanel site={site} />;
}

export function SiteHistorySettings() {
  return <PublishHistory embedded />;
}
