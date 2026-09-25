/**
 * Site settings, agency staff only: the things a client never needs to see, under one
 * sidebar item with tabs. Connection (the repository, its status and the check),
 * Hosting & services, Client editing (what clients may do in the editor) and
 * Publish history.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { NavLink, Outlet } from "react-router";
import { CheckList } from "@/components/CheckList.tsx";
import { EditingLevelPanel } from "@/components/EditingLevelPanel.tsx";
import { IconAlert, IconCheck, IconExternal, IconGithub, IconHistory, IconPencil, IconStethoscope } from "@/components/icons.tsx";
import { KitStatusPanel } from "@/components/KitStatusPanel.tsx";
import { siteQueryKey, useSite } from "@/components/SiteLayout.tsx";
import { SiteServicesPanel } from "@/components/SiteServicesPanel.tsx";
import { UndoSetupCard } from "@/components/UndoSetupCard.tsx";
import { Button, LinkButton, Notice, PageHeader, Panel, Pill, SrOnly, TabBar, tabClass } from "@/components/ui.tsx";
import { formatDateTime, relativeTime } from "@/lib/format.ts";
import { callFunction } from "@/lib/functions.ts";
import { SITE_STATUS_TONES, isHostingOnly, siteStatusLabel } from "@/lib/services.ts";
import { supabase } from "@/lib/supabase.ts";
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
          <dt className="text-muted" id="live-address">Live address</dt>
          <dd className="min-w-0">
            <LiveAddressEditor site={site} />
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
      {!hostingOnly && <UndoSetupCard site={site} />}
    </div>
  );
}

/**
 * Inline editor for a site's live_url on the Connection tab. Shows the
 * current address as a link with a small "Edit" pencil; the pencil expands
 * an input + Save/Cancel. Save writes directly through the RLS-guarded
 * sites table and re-fetches the site.
 *
 * A #live-address anchor sits above this field so the Kit card can link
 * straight here when it can't see the kit on the recorded address.
 */
function LiveAddressEditor({ site }: { site: import("@/lib/types.ts").Site }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editing = draft !== null;

  const save = useMutation({
    mutationFn: async () => {
      const trimmed = (draft ?? "").trim();
      if (trimmed.length > 0) {
        try {
          const parsed = new URL(trimmed);
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("must be http or https");
        } catch {
          throw new Error("That address doesn't look like a URL. Include https:// (for example https://example.com).");
        }
      }
      const next = trimmed.length > 0 ? trimmed : null;
      const { error: dbError } = await supabase.from("sites").update({ live_url: next }).eq("id", site.id);
      if (dbError) throw new Error(dbError.message);
      return next;
    },
    onSuccess: () => {
      setError(null);
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: siteQueryKey(site.id) });
      void queryClient.invalidateQueries({ queryKey: ["kit-status", site.id] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : "Could not save the address.");
    },
  });

  if (editing) {
    return (
      <form
        onSubmit={(event) => { event.preventDefault(); save.mutate(); }}
        className="flex flex-col gap-2"
        data-testid="live-address-editor"
      >
        <input
          type="url"
          className="h-8 rounded-control border border-line px-2 font-mono text-[12px]"
          value={draft ?? ""}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="https://your-site.netlify.app"
          aria-label="Live address"
          data-testid="live-address-input"
          autoFocus
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" loading={save.isPending} data-testid="live-address-save">Save</Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => { setDraft(null); setError(null); }} data-testid="live-address-cancel">Cancel</Button>
        </div>
        {error && <span className="text-[12px] text-danger" data-testid="live-address-error">{error}</span>}
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {site.live_url ? (
        <a href={site.live_url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 text-text underline-offset-2 hover:underline">
          <span className="truncate">{site.live_url}</span>
          <IconExternal size={12} />
          <SrOnly>(opens in a new tab)</SrOnly>
        </a>
      ) : (
        <span className="text-muted">Not recorded</span>
      )}
      <Button type="button" size="sm" variant="secondary" onClick={() => setDraft(site.live_url ?? "")} data-testid="edit-live-address">
        <IconPencil size={12} /> Edit
      </Button>
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
