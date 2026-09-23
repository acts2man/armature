/**
 * /sites/:siteId/pages — every page the site's content/schema.json declares as
 * editable, read live from the repository so the list can never drift from what
 * the editor will actually load. Cards follow docs/3-modules.html.
 */
import type { ReactNode } from "react";
import { Link } from "react-router";
import { IconExternal, IconPage, IconPencil } from "@/components/icons.tsx";
import { useSite } from "@/components/SiteLayout.tsx";
import { Button, Card, EmptyState, LinkButton, Notice, PageHeader, Pill, Skeleton, SrOnly } from "@/components/ui.tsx";
import { useSiteContent } from "@/hooks/useSiteContent.ts";
import { plural, shortSha } from "@/lib/format.ts";
import { isHostingOnly } from "@/lib/services.ts";
import { describeProblem } from "@shared/builder/index.ts";
import type { FileProblem } from "@shared/publishTypes.ts";
import type { PageDefinition } from "@shared/schema.ts";

/** The page's address on the live site, or null when the site has no live URL yet. */
function liveHref(liveUrl: string | null, path: string): string | null {
  if (!liveUrl) return null;
  return `${liveUrl.replace(/\/+$/, "")}${path}`;
}

function PageCard({ siteId, liveUrl, page }: { siteId: string; liveUrl: string | null; page: PageDefinition }) {
  const fieldCount = page.sections.reduce((total, section) => total + section.fields.length, 0);
  const href = liveHref(liveUrl, page.path);
  const editTo = `/sites/${siteId}/pages/${page.slug}`;

  return (
    <Card as="article" className="flex flex-col justify-between gap-3">
      <div className="flex gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-ground text-text">
          <IconPage size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-sans text-[15px] font-semibold tracking-normal text-text">
            <Link to={editTo} className="hover:underline">
              {page.label}
            </Link>
          </h2>
          {page.description && <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{page.description}</p>}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
            {href ? (
              <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all font-mono text-text underline-offset-2 hover:underline">
                {page.path}
                <IconExternal size={12} />
                <SrOnly>(opens the live page in a new tab)</SrOnly>
              </a>
            ) : (
              <span className="break-all font-mono">{page.path}</span>
            )}
            <span>·</span>
            <span>
              {plural(page.sections.length, "section")}, {plural(fieldCount, "field")}
            </span>
          </p>
        </div>
      </div>
      <div className="flex justify-end">
        <Link to={editTo} className="inline-flex h-9 items-center gap-2 rounded-control border border-line bg-panel px-4 text-[14px] font-semibold text-text hover:bg-ground">
          <IconPencil size={16} /> Edit
          <SrOnly> {page.label}</SrOnly>
        </Link>
      </div>
    </Card>
  );
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
    return `/sites/${siteId}/visual/${problem.slug}${problem.elementId ? `?element=${problem.elementId}` : ""}`;
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
    <div className="grid gap-4 sm:grid-cols-2" role="status" aria-label="Reading the site's content">
      {[0, 1, 2, 3].map((index) => (
        <Card key={index} className="space-y-3">
          <Skeleton className="w-1/3" />
          <Skeleton lines={2} />
        </Card>
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
        action={isStaff ? <LinkButton to={`/sites/new?upgrade=${site.id}`} size="sm">Connect repository</LinkButton> : undefined}
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

function ConnectedPages() {
  const { site } = useSite();
  const content = useSiteContent(site.id);

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

  let body: ReactNode;
  let meta: ReactNode;
  if (content.isPending) {
    body = <PagesSkeleton />;
  } else if (content.isError) {
    body = failed(content.error.message);
  } else if (!content.data.ok) {
    body = failed(content.data.message);
  } else {
    const loaded = content.data;
    meta = (
      <>
        <Pill tone="green">Connected</Pill>
        <span className="font-mono text-[13px]">
          {loaded.repo} on {loaded.branch} @ {shortSha(loaded.commitSha)}
        </span>
      </>
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
        {loaded.schema.pages.length === 0 ? (
          <EmptyState title="No editable pages" icon={<IconPage size={18} />}>
            The site's content map (content/schema.json) does not declare any pages yet. The site's developer adds them.
          </EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {loaded.schema.pages.map((page) => (
              <PageCard key={page.slug} siteId={site.id} liveUrl={site.live_url} page={page} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Pages" description="Choose a page to edit. Changes go live when you press Publish." meta={meta} />
      {body}
    </div>
  );
}
