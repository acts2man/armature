/**
 * /sites/:siteId/pages — every page of the site in one table, WordPress "All Pages"
 * style: title, address, type (Builder or Coded), when it last went live and by whom;
 * a search box and a count; row actions on hover or focus (Edit visually, Edit text for
 * pages that still have form fields, Page settings, View, and for builder pages Duplicate
 * and Trash). The bin is its own view, with Restore and Delete permanently. "Add New
 * Page" asks for a title, an address and a starting point, then opens the editor on the
 * new page. Duplicate, Trash, Restore and Delete are each one small publish (one commit).
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
import { usePageActions, type PageAction } from "@/hooks/usePageActions.ts";
import { useSiteContent } from "@/hooks/useSiteContent.ts";
import { formatDate, relativeTime, shortSha } from "@/lib/format.ts";
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

type PageRow = {
  slug: string;
  label: string;
  path: string;
  /** Built in the visual editor (a layout file only); a coded page is rendered by the site's own code. */
  builder: boolean;
  /** Still has the older form fields (Stage 1), so "Edit text" applies. */
  hasFields: boolean;
  description?: string;
};

/** Every page as a row: the coded pages in the site's order, then builder pages by title. */
function pageRows(pages: PageDefinition[], layouts: Record<string, LayoutDoc>): PageRow[] {
  const coded = pages.filter((page) => page.slug !== SHARED_SLUG).map((page) => ({ slug: page.slug, label: page.label, path: page.path, builder: false, hasFields: page.sections.some((section) => section.fields.length > 0), description: page.description }));
  const builder = Object.values(layouts)
    .filter((layout) => !pages.some((page) => page.slug === layout.pageSlug))
    .map((layout) => ({ slug: layout.pageSlug, label: layout.label ?? layout.pageSlug, path: layout.path, builder: true, hasFields: false }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [...coded, ...builder];
}

type LastPublish = { at: string; by: string };

/** The latest successful publish per page (a publish row may name several pages), with who made it. */
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
        const person = publish.user_id ? people.get(publish.user_id) : undefined;
        const by = person?.full_name?.trim() || person?.email?.trim() || "—";
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

function RowActions({ children }: { children: ReactNode }) {
  return <div className="-ml-1 mt-0.5 flex flex-wrap items-center gap-x-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">{children}</div>;
}

const Sep = () => (
  <span aria-hidden="true" className="text-line">
    |
  </span>
);

function ConnectedPages() {
  const { site, isStaff } = useSite();
  const navigate = useNavigate();
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

  const columns = "minmax(180px,2fr) minmax(140px,1.4fr) 88px 150px 140px";

  let body: ReactNode;
  let meta: ReactNode;
  if (content.isPending) body = <PagesSkeleton />;
  else if (content.isError) body = failed(content.error.message);
  else if (!loaded) body = failed(content.data && !content.data.ok ? content.data.message : "The site's content could not be read.");
  else {
    meta = (
      <>
        <Pill tone="green">Connected</Pill>
        <span className="font-mono text-[13px]">
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
          <div className="flex items-center gap-3">
            <span className="text-[13px] text-muted" data-testid="pages-count">
              {view === "trash" ? `${shownTrash.length} in the bin` : `${shown.length} ${shown.length === 1 ? "page" : "pages"}`}
            </span>
            <label className="relative">
              <span className="sr-only">Search pages</span>
              <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pages" className="h-10 w-56 pl-9" data-testid="pages-search" />
            </label>
          </div>
        </div>

        {view === "trash" ? (
          shownTrash.length === 0 ? (
            <EmptyState title={trash.length === 0 ? "The bin is empty" : "No page in the bin matches"} icon={<IconTrash size={18} />}>
              {trash.length === 0 ? "Pages you move to the bin wait here until you restore them or delete them for good." : "Try another word."}
            </EmptyState>
          ) : (
            <div className="rounded-card border border-line bg-panel">
              <DataTable columns="minmax(180px,2fr) minmax(140px,1.4fr) 88px 150px 140px" head={["Title", "Address", "Type", "Trashed", ""]} label="Pages in the bin" minWidth={720}>
                {shownTrash.map((layout) => (
                  <DataRow key={layout.pageSlug} columns="minmax(180px,2fr) minmax(140px,1.4fr) 88px 150px 140px" className="group" data-testid={`trash-row-${layout.pageSlug}`}>
                    <Cell>
                      <span className="block truncate text-[14px] font-semibold text-text">{layout.label ?? layout.pageSlug}</span>
                      <RowActions>
                        <button type="button" className={actionClass} disabled={actions.isPending} onClick={() => actions.mutate({ kind: "restore", slug: layout.pageSlug, label: layout.label ?? layout.pageSlug })} data-testid={`restore-${layout.pageSlug}`}>
                          Restore
                        </button>
                        <Sep />
                        <button type="button" className={dangerClass} disabled={actions.isPending} onClick={() => setConfirm({ kind: "delete", slug: layout.pageSlug, label: layout.label ?? layout.pageSlug })} data-testid={`delete-${layout.pageSlug}`}>
                          Delete permanently
                        </button>
                      </RowActions>
                    </Cell>
                    <Cell>
                      <span className="break-all font-mono text-[12px] text-muted">{layout.path}</span>
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
          )
        ) : rows.length === 0 ? (
          <EmptyState title="No editable pages" icon={<IconPage size={18} />} action={canStructure ? <Button size="sm" onClick={() => setAdding(true)}>Add New Page</Button> : undefined}>
            The site's content map (content/schema.json) does not declare any pages yet, and none has been built in the editor.
          </EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState title="No page matches" icon={<IconSearch size={18} />}>
            Try another word, or clear the search.
          </EmptyState>
        ) : (
          <div className="rounded-card border border-line bg-panel">
            <DataTable columns={columns} head={["Title", "Address", "Type", "Last published", "By"]} label="Pages" minWidth={720}>
              {shown.map((row) => {
                const href = liveHref(site.live_url, row.path);
                const last = publishes.data?.[row.slug];
                const editTo = `/sites/${site.id}/visual?page=${encodeURIComponent(row.slug)}`;
                return (
                  <DataRow key={row.slug} columns={columns} className="group" data-testid={`page-row-${row.slug}`}>
                    <Cell>
                      <Link to={editTo} className="block truncate text-[14px] font-semibold text-text hover:underline" data-testid={`page-title-${row.slug}`}>
                        {row.label}
                      </Link>
                      {row.description && <span className="block truncate text-[12px] text-muted">{row.description}</span>}
                      <RowActions>
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
                        {row.builder && canStructure && (
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
                    </Cell>
                    <Cell>
                      {href ? (
                        <a href={href} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 break-all font-mono text-[12px] text-text underline-offset-2 hover:underline">
                          <span className="truncate">{row.path}</span>
                          <IconExternal size={12} />
                          <SrOnly>(opens the live page in a new tab)</SrOnly>
                        </a>
                      ) : (
                        <span className="break-all font-mono text-[12px] text-muted">{row.path}</span>
                      )}
                    </Cell>
                    <Cell>
                      <Pill tone={row.builder ? "blue" : "grey"}>{row.builder ? "Builder" : "Coded"}</Pill>
                    </Cell>
                    <Cell muted>
                      {last ? (
                        <span title={formatDate(last.at)}>{relativeTime(last.at)}</span>
                      ) : publishes.isPending ? (
                        <Skeleton className="h-4 w-20" />
                      ) : (
                        "—"
                      )}
                    </Cell>
                    <Cell muted>
                      <span className="truncate">{last?.by ?? "—"}</span>
                    </Cell>
                  </DataRow>
                );
              })}
            </DataTable>
          </div>
        )}

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
          taken={takenAddresses([...loaded.schema.pages, ...rows.filter((row) => row.builder).map((row) => ({ slug: row.slug, label: row.label, path: row.path, sections: [] }))])}
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
