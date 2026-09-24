/**
 * /sites/:siteId/pages — every page of the site in one table, WordPress "All Pages"
 * style: title, address, type (Builder or Coded, see src/lib/pageRows.ts), when it last
 * went live and by whom; a search box and a count; row actions always in view (Edit
 * visually, Edit text for pages that still have form fields, Page settings, View, and
 * for pages that exist only as a layout Duplicate and Trash). On a phone the table
 * becomes stacked cards. The bin is its own view, with Restore and Delete permanently.
 * "Add New Page" asks for a title, an address and a starting point, then opens the editor
 * on the new page. Duplicate, Trash, Restore and Delete are each one small publish (one
 * commit). This is the one way into the editor.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { IconExternal, IconPage, IconPlus, IconSearch, IconTrash } from "@/components/icons.tsx";
import { useSite } from "@/components/SiteLayout.tsx";
import { Button, Cell, DataRow, DataTable, EmptyState, Input, Modal, Notice, PageHeader, Pill, Skeleton, SrOnly } from "@/components/ui.tsx";
import { NewPageDialog } from "@/builder/PagesPanel.tsx";
import { takenAddresses } from "@/builder/pageAddress.ts";
import { useTemplates } from "@/builder/templates.ts";
import { usePhone } from "@/hooks/useMediaQuery.ts";
import { usePageActions, type PageAction } from "@/hooks/usePageActions.ts";
import { useSiteContent } from "@/hooks/useSiteContent.ts";
import { formatDate, relativeTime, shortSha } from "@/lib/format.ts";
import { pageRows, publisherName, type PageRow } from "@/lib/pageRows.ts";
import { isHostingOnly } from "@/lib/services.ts";
import { supabase } from "@/lib/supabase.ts";
import type { Profile, Publish } from "@/lib/types.ts";
import { writeNewPageHandoff } from "@/visual/pages.ts";
import { describeProblem, type LayoutDoc } from "@shared/builder/index.ts";
import type { ContentGetResponse, FileProblem } from "@shared/publishTypes.ts";
import { SHARED_SLUG, type PageDefinition } from "@shared/schema.ts";

/** The page's address on the live site, or null when the site has no live URL yet. */
function liveHref(liveUrl: string | null, path: string): string | null {
  if (!liveUrl) return null;
  return `${liveUrl.replace(/\/+$/, "")}${path}`;
}

type LastPublish = { at: string; by: string | null };

/** The latest successful publish per page (a publish row may name several pages), with who made it (their name from profiles). */
function usePagePublishes(siteId: string) {
  return useQuery({
    queryKey: ["site-publishes", siteId, "by-page"],
    queryFn: async (): Promise<Record<string, LastPublish>> => {
      const { data, error } = await supabase.from("publishes").select("*").eq("site_id", siteId).eq("status", "committed").order("created_at", { ascending: false }).limit(200);
      if (error) throw new Error(error.message);
      const publishes = (data ?? []) as Publish[];
      const ids = [...new Set(publishes.map((publish) => publish.user_id).filter((id): id is string => !!id))];
      const people = new Map<string, Pick<Profile, "id" | "email" | "full_name">>();
      if (ids.length > 0) {
        const profiles = await supabase.from("profiles").select("id, email, full_name").in("id", ids);
        for (const row of (profiles.data ?? []) as Pick<Profile, "id" | "email" | "full_name">[]) people.set(row.id, row);
      }
      const out: Record<string, LastPublish> = {};
      for (const publish of publishes) {
        const by = publisherName(publish.user_id ? people.get(publish.user_id) : undefined);
        for (const slug of publish.page_slug.split(",").map((part) => part.trim()).filter(Boolean)) if (!out[slug]) out[slug] = { at: publish.created_at, by };
      }
      return out;
    },
  });
}

/**
 * Values in the site's files the editor could not read: one line each in plain English
 * (page, element, setting, the value found, what is allowed) and a "Show me" link that
 * opens the editor on that element. Nothing here blocks editing: the value is ignored on
 * the page and kept in the file until it is changed.
 */
export function FileProblems({ siteId, problems, pages }: { siteId: string; problems: FileProblem[]; pages: PageDefinition[] }) {
  if (problems.length === 0) return null;
  const pageLabel = (problem: FileProblem) => (problem.slug ? (pages.find((page) => page.slug === problem.slug)?.label ?? problem.slug) : "Site settings");
  const showMe = (problem: FileProblem): string | null => {
    if (problem.effect === "file") return null;
    if (!problem.slug) return `/sites/${siteId}/visual`;
    return `/sites/${siteId}/visual?page=${encodeURIComponent(problem.slug)}${problem.elementId ? `&element=${problem.elementId}` : ""}`;
  };
  return (
    <Notice kind="warning" title={problems.length === 1 ? "One value in this site's files could not be read" : `${problems.length} values in this site's files could not be read`} className="[&_ul]:mt-1">
      <p className="mb-2">Each one is ignored on the page and kept exactly as it is in the file until someone changes that setting. Everything else on the page works as usual.</p>
      <ul className="list-disc space-y-1.5 pl-5" data-testid="file-problems">
        {problems.map((problem, index) => {
          const href = showMe(problem);
          return (
            <li key={`${index}-${problem.file}-${problem.setting}`}>
              <span className="font-semibold">{pageLabel(problem)}</span>
              {": "}
              {describeProblem(problem)}
              {href && (
                <>
                  {" "}
                  <Link to={href} className="font-semibold text-accent underline-offset-2 hover:underline" data-testid="show-me">
                    Show me
                  </Link>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </Notice>
  );
}

function PagesSkeleton() {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Loading pages">
      <Skeleton className="h-10 w-72" />
      {[0, 1, 2, 3].map((index) => (
        <Skeleton key={index} className="h-14 rounded-card" />
      ))}
    </div>
  );
}

function HostingOnlyPages() {
  const { site, isStaff } = useSite();
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Pages" meta={<Pill tone="grey">Hosting only</Pill>} />
      <EmptyState
        title="No pages to edit yet"
        icon={<IconPage size={18} />}
        action={
          isStaff ? (
            <Link to={`/sites/new?upgrade=${site.id}`} className="inline-flex h-9 items-center rounded-control bg-accent px-4 text-[14px] font-semibold text-accent-fg hover:opacity-90">
              Connect repository
            </Link>
          ) : undefined
        }
      >
        {isStaff
          ? `${site.name} is a hosting-only site: no repository is connected. Connect one and its pages appear here, ready to edit and publish.`
          : `${site.name} is looked after by the agency but is not edited here yet. Ask them if you would like to make changes yourself.`}
      </EmptyState>
    </div>
  );
}

export function SitePages() {
  const { site } = useSite();
  if (isHostingOnly(site)) return <HostingOnlyPages />;
  return <ConnectedPages />;
}

const actionClass = "inline-flex min-h-8 items-center rounded-sm px-1 text-[12px] font-semibold text-accent underline-offset-2 hover:underline focus-visible:underline";
const dangerClass = "inline-flex min-h-8 items-center rounded-sm px-1 text-[12px] font-semibold text-red underline-offset-2 hover:underline focus-visible:underline";

/** The actions under a row's title, always in view (never only on hover). */
function RowActions({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <div className="-ml-1 mt-0.5 flex flex-wrap items-center gap-x-1" data-testid={testId}>
      {children}
    </div>
  );
}

const Sep = () => (
  <span aria-hidden="true" className="text-line">
    |
  </span>
);

const TypePill = ({ builder }: { builder: boolean }) => <Pill tone={builder ? "blue" : "grey"}>{builder ? "Builder" : "Coded"}</Pill>;

/** When and by whom a page last went live, or a dash. */
function LastPublished({ last, pending, withBy }: { last: LastPublish | undefined; pending: boolean; withBy?: boolean }) {
  if (last) {
    return (
      <span title={formatDate(last.at)}>
        {relativeTime(last.at)}
        {withBy && last.by ? ` by ${last.by}` : ""}
      </span>
    );
  }
  if (pending) return <Skeleton className="h-4 w-20" />;
  return <>—</>;
}

/** The address, linked to the live page when there is one. Long addresses wrap rather than clip. */
function Address({ path, href }: { path: string; href: string | null }) {
  if (!href) return <span className="break-all font-mono text-[12px] text-muted">{path}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-start gap-1 break-all font-mono text-[12px] text-text underline-offset-2 hover:underline">
      <span className="min-w-0">{path}</span>
      <IconExternal size={12} className="mt-0.5 shrink-0" />
      <SrOnly>(opens the live page in a new tab)</SrOnly>
    </a>
  );
}

const COLUMNS = "minmax(220px,2fr) minmax(170px,1.4fr) 90px 150px minmax(130px,1fr)";
const BIN_COLUMNS = "minmax(220px,2fr) minmax(170px,1.4fr) 90px 150px 140px";

function ConnectedPages() {
  const { site, isStaff } = useSite();
  const navigate = useNavigate();
  const phone = usePhone();
  const [search] = useSearchParams();
  const view = search.get("view") === "trash" ? "trash" : "all";
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<PageAction | null>(null);
  const content = useSiteContent(site.id);
  const publishes = usePagePublishes(site.id);
  const templates = useTemplates(site.id, site.agency_id);
  const loaded: ContentGetResponse | null = content.data && content.data.ok ? content.data : null;
  const actions = usePageActions(site.id, loaded?.commitSha);

  const rows = useMemo(() => (loaded ? pageRows(loaded.schema.pages, loaded.layouts ?? {}) : []), [loaded]);
  const trash = useMemo(() => Object.values(loaded?.trash ?? {}).sort((a, b) => (a.label ?? a.pageSlug).localeCompare(b.label ?? b.pageSlug)), [loaded]);
  const needle = query.trim().toLowerCase();
  const shown = rows.filter((row) => !needle || row.label.toLowerCase().includes(needle) || row.path.toLowerCase().includes(needle));
  const shownTrash = trash.filter((layout) => !needle || (layout.label ?? layout.pageSlug).toLowerCase().includes(needle) || layout.path.toLowerCase().includes(needle));
  const canStructure = isStaff || loaded?.editingLevel === "builder";
  const chrome = loaded?.schema.pages.find((page) => page.slug === SHARED_SLUG);
  const allSlugs = useMemo(() => new Set([...rows.map((row) => row.slug), ...trash.map((layout) => layout.pageSlug), SHARED_SLUG]), [rows, trash]);

  const duplicate = (row: PageRow) => {
    let copySlug = `${row.slug}-copy`;
    let n = 2;
    while (allSlugs.has(copySlug)) copySlug = `${row.slug}-copy-${n++}`;
    actions.mutate({ kind: "duplicate", slug: row.slug, label: row.label, copySlug, copyLabel: `${row.label} (copy)`, copyPath: `/${copySlug}/` });
  };

  const failed = (message: string) => (
    <Notice
      kind="danger"
      title="The site's content could not be loaded"
      action={
        <Button variant="secondary" size="sm" loading={content.isFetching} onClick={() => void content.refetch()}>
          Retry
        </Button>
      }
    >
      {message}
    </Notice>
  );

  /** The actions of one live page: the same in the table and on a card. */
  const pageActions = (row: PageRow, editTo: string, href: string | null) => (
    <RowActions testId={`page-actions-${row.slug}`}>
      <Link to={editTo} className={actionClass} data-testid={`edit-visually-${row.slug}`}>
        Edit visually
        <SrOnly> {row.label}</SrOnly>
      </Link>
      {row.hasFields && (
        <>
          <Sep />
          <Link to={`/sites/${site.id}/pages/${row.slug}`} className={actionClass} data-testid={`edit-text-${row.slug}`}>
            Edit text
            <SrOnly> of {row.label}</SrOnly>
          </Link>
        </>
      )}
      <Sep />
      <Link to={`${editTo}&panel=settings`} className={actionClass} data-testid={`page-settings-${row.slug}`}>
        Page settings
        <SrOnly> for {row.label}</SrOnly>
      </Link>
      {href && (
        <>
          <Sep />
          <a href={href} target="_blank" rel="noreferrer" className={actionClass} data-testid={`view-${row.slug}`}>
            View
            <SrOnly> {row.label} (opens in a new tab)</SrOnly>
          </a>
        </>
      )}
      {row.layoutOnly && canStructure && (
        <>
          <Sep />
          <button type="button" className={actionClass} disabled={actions.isPending} onClick={() => duplicate(row)} data-testid={`duplicate-${row.slug}`}>
            Duplicate
            <SrOnly> {row.label}</SrOnly>
          </button>
          <Sep />
          <button type="button" className={dangerClass} disabled={actions.isPending} onClick={() => setConfirm({ kind: "trash", slug: row.slug, label: row.label })} data-testid={`trash-${row.slug}`}>
            Trash
            <SrOnly> {row.label}</SrOnly>
          </button>
        </>
      )}
    </RowActions>
  );

  /** The actions of one page in the bin. */
  const binActions = (layout: LayoutDoc) => (
    <RowActions testId={`page-actions-${layout.pageSlug}`}>
      <button type="button" className={actionClass} disabled={actions.isPending} onClick={() => actions.mutate({ kind: "restore", slug: layout.pageSlug, label: layout.label ?? layout.pageSlug })} data-testid={`restore-${layout.pageSlug}`}>
        Restore
      </button>
      <Sep />
      <button type="button" className={dangerClass} disabled={actions.isPending} onClick={() => setConfirm({ kind: "delete", slug: layout.pageSlug, label: layout.label ?? layout.pageSlug })} data-testid={`delete-${layout.pageSlug}`}>
        Delete permanently
      </button>
    </RowActions>
  );

  let body: ReactNode;
  let meta: ReactNode;
  if (content.isPending) body = <PagesSkeleton />;
  else if (content.isError) body = failed(content.error.message);
  else if (!loaded) body = failed(content.data && !content.data.ok ? content.data.message : "The site's content could not be read.");
  else {
    meta = (
      <>
        <Pill tone="green">Connected</Pill>
        <span className="break-all font-mono text-[13px]">
          {loaded.repo} on {loaded.branch} @ {shortSha(loaded.commitSha)}
        </span>
      </>
    );
    const viewLink = (key: "all" | "trash", label: string, count: number) => (
      <Link
        to={key === "all" ? "?" : "?view=trash"}
        aria-current={view === key ? "page" : undefined}
        data-testid={`pages-view-${key}`}
        className={view === key ? "font-semibold text-text" : "text-accent underline-offset-2 hover:underline"}
      >
        {label} <span className="text-muted">({count})</span>
      </Link>
    );

    let list: ReactNode;
    if (view === "trash") {
      if (shownTrash.length === 0) {
        list = (
          <EmptyState title={trash.length === 0 ? "The bin is empty" : "No page in the bin matches"} icon={<IconTrash size={18} />}>
            {trash.length === 0 ? "Pages you move to the bin wait here until you restore them or delete them for good." : "Try another word."}
          </EmptyState>
        );
      } else if (phone) {
        list = (
          <ul className="flex flex-col gap-3" aria-label="Pages in the bin" data-testid="pages-cards">
            {shownTrash.map((layout) => (
              <li key={layout.pageSlug} className="flex flex-col gap-2 rounded-card border border-line bg-panel p-4" data-testid={`trash-row-${layout.pageSlug}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="break-words text-[15px] font-semibold text-text">{layout.label ?? layout.pageSlug}</span>
                  <Pill tone="grey">Builder</Pill>
                </div>
                <Address path={layout.path} href={null} />
                <span className="text-[13px] text-muted">In the bin</span>
                {binActions(layout)}
              </li>
            ))}
          </ul>
        );
      } else {
        list = (
          <div className="rounded-card border border-line bg-panel">
            <DataTable columns={BIN_COLUMNS} head={["Title", "Address", "Type", "Trashed", ""]} label="Pages in the bin" minWidth={760}>
              {shownTrash.map((layout) => (
                <DataRow key={layout.pageSlug} columns={BIN_COLUMNS} data-testid={`trash-row-${layout.pageSlug}`}>
                  <Cell>
                    <span className="block break-words text-[14px] font-semibold text-text">{layout.label ?? layout.pageSlug}</span>
                    {binActions(layout)}
                  </Cell>
                  <Cell>
                    <Address path={layout.path} href={null} />
                  </Cell>
                  <Cell>
                    <Pill tone="grey">Builder</Pill>
                  </Cell>
                  <Cell muted>In the bin</Cell>
                  <Cell />
                </DataRow>
              ))}
            </DataTable>
          </div>
        );
      }
    } else if (rows.length === 0) {
      list = (
        <EmptyState title="No editable pages" icon={<IconPage size={18} />} action={canStructure ? <Button size="sm" onClick={() => setAdding(true)}>Add New Page</Button> : undefined}>
          The site's content map (content/schema.json) does not declare any pages yet, and none has been built in the editor.
        </EmptyState>
      );
    } else if (shown.length === 0) {
      list = (
        <EmptyState title="No page matches" icon={<IconSearch size={18} />}>
          Try another word, or clear the search.
        </EmptyState>
      );
    } else if (phone) {
      list = (
        <ul className="flex flex-col gap-3" aria-label="Pages" data-testid="pages-cards">
          {shown.map((row) => {
            const href = liveHref(site.live_url, row.path);
            const last = publishes.data?.[row.slug];
            const editTo = `/sites/${site.id}/visual?page=${encodeURIComponent(row.slug)}`;
            return (
              <li key={row.slug} className="flex flex-col gap-2 rounded-card border border-line bg-panel p-4" data-testid={`page-row-${row.slug}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Link to={editTo} className="break-words text-[15px] font-semibold text-text hover:underline" data-testid={`page-title-${row.slug}`}>
                    {row.label}
                  </Link>
                  <TypePill builder={row.builder} />
                </div>
                {row.description && <span className="break-words text-[12px] text-muted">{row.description}</span>}
                <Address path={row.path} href={href} />
                <span className="text-[13px] text-muted">
                  {last ? "Last published " : "Published: "}
                  <LastPublished last={last} pending={publishes.isPending} withBy />
                </span>
                {pageActions(row, editTo, href)}
              </li>
            );
          })}
        </ul>
      );
    } else {
      list = (
        <div className="rounded-card border border-line bg-panel">
          <DataTable columns={COLUMNS} head={["Title", "Address", "Type", "Last published", "By"]} label="Pages" minWidth={760}>
            {shown.map((row) => {
              const href = liveHref(site.live_url, row.path);
              const last = publishes.data?.[row.slug];
              const editTo = `/sites/${site.id}/visual?page=${encodeURIComponent(row.slug)}`;
              return (
                <DataRow key={row.slug} columns={COLUMNS} data-testid={`page-row-${row.slug}`}>
                  <Cell>
                    <Link to={editTo} className="block break-words text-[14px] font-semibold text-text hover:underline" data-testid={`page-title-${row.slug}`}>
                      {row.label}
                    </Link>
                    {row.description && <span className="block break-words text-[12px] text-muted">{row.description}</span>}
                    {pageActions(row, editTo, href)}
                  </Cell>
                  <Cell>
                    <Address path={row.path} href={href} />
                  </Cell>
                  <Cell>
                    <TypePill builder={row.builder} />
                  </Cell>
                  <Cell muted>
                    <LastPublished last={last} pending={publishes.isPending} />
                  </Cell>
                  <Cell muted>
                    <span className="break-words">{last?.by ?? "—"}</span>
                  </Cell>
                </DataRow>
              );
            })}
          </DataTable>
        </div>
      );
    }

    body = (
      <div className="flex flex-col gap-4">
        <FileProblems siteId={site.id} problems={loaded.problems ?? []} pages={loaded.schema.pages} />
        {loaded.warnings.length > 0 && (
          <Notice kind="warning" title="Notes about this site's content">
            <ul className="list-disc space-y-1 pl-5">
              {loaded.warnings.map((warning, index) => (
                <li key={`${index}-${warning}`}>{warning}</li>
              ))}
            </ul>
          </Notice>
        )}
        {actions.isError && (
          <Notice kind="danger" title="That could not be done">
            {actions.error.message}
          </Notice>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[13px]" data-testid="pages-views">
            {viewLink("all", "All", rows.length)}
            {(trash.length > 0 || view === "trash") && (
              <>
                <Sep />
                {viewLink("trash", "Trash", trash.length)}
              </>
            )}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <span className="text-[13px] text-muted" data-testid="pages-count">
              {view === "trash" ? `${shownTrash.length} in the bin` : `${shown.length} ${shown.length === 1 ? "page" : "pages"}`}
            </span>
            <label className="relative min-w-0">
              <span className="sr-only">Search pages</span>
              <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pages" className="h-10 w-48 max-w-full pl-9 sm:w-56" data-testid="pages-search" />
            </label>
          </div>
        </div>

        {list}

        {view === "all" && chrome && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-panel px-5 py-3 text-[13px]" data-testid="chrome-row">
            <span className="text-muted">
              <span className="font-semibold text-text">{chrome.label}</span>: shown on every page. Its words and pictures also edit by clicking them on any page in the visual editor.
            </span>
            {chrome.sections.some((section) => section.fields.length > 0) && (
              <Link to={`/sites/${site.id}/pages/${chrome.slug}`} className={actionClass} data-testid="edit-text-shared">
                Edit text
              </Link>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Pages"
        description="Every page of the site. Click a title to edit it; changes go live when you press Publish."
        meta={meta}
        action={
          loaded && canStructure ? (
            <Button onClick={() => setAdding(true)} data-testid="add-new-page">
              <IconPlus size={16} /> Add New Page
            </Button>
          ) : undefined
        }
      />
      {body}

      {loaded && (
        <NewPageDialog
          open={adding}
          taken={takenAddresses([...loaded.schema.pages, ...rows.filter((row) => row.layoutOnly).map((row) => ({ slug: row.slug, label: row.label, path: row.path, sections: [] }))])}
          existingSlugs={allSlugs}
          pageTemplates={(templates.data ?? []).filter((row) => row.kind === "page")}
          onClose={() => setAdding(false)}
          onCreate={(layout) => {
            setAdding(false);
            if (!writeNewPageHandoff(site.id, layout)) {
              actions.reset();
              navigate(`/sites/${site.id}/visual`);
              return;
            }
            navigate(`/sites/${site.id}/visual?page=${encodeURIComponent(layout.pageSlug)}&new=1`);
          }}
        />
      )}

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === "delete" ? "Delete this page for good?" : "Move this page to the bin?"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={actions.isPending}
              data-testid="confirm-page-action"
              onClick={() => {
                if (!confirm) return;
                actions.mutate(confirm, { onSettled: () => setConfirm(null) });
              }}
            >
              {confirm?.kind === "delete" ? "Delete permanently" : "Move to the bin"}
            </Button>
          </>
        }
      >
        {confirm?.kind === "delete" ? (
          <p className="text-[14px] leading-relaxed text-text">
            "{confirm.label}" will be removed from the bin and cannot be brought back. This is published as one commit.
          </p>
        ) : (
          <p className="text-[14px] leading-relaxed text-text">
            "{confirm?.label}" comes off the live site with the next commit and waits in the bin, where you can restore it at any time.
          </p>
        )}
      </Modal>
    </div>
  );
}
