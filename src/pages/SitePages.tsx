/**
 * /sites/:siteId/pages — every page the site's content/schema.json declares as
 * editable, read live from the repository so the list can never drift from what
 * the editor will actually load.
 */
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { useSite } from "@/components/SiteLayout.tsx";
import { Button, Card, EmptyState, LinkButton, Notice, PageHeader, Spinner, SrOnly } from "@/components/ui.tsx";
import { useSiteContent } from "@/hooks/useSiteContent.ts";
import { plural, shortSha } from "@/lib/format.ts";
import type { PageDefinition } from "@shared/schema.ts";

/** The page's address on the live site, or null when the site has no live URL yet. */
function liveHref(liveUrl: string | null, path: string): string | null {
  if (!liveUrl) return null;
  return `${liveUrl.replace(/\/+$/, "")}${path}`;
}

function PageCard({ siteId, liveUrl, page }: { siteId: string; liveUrl: string | null; page: PageDefinition }) {
  const fieldCount = page.sections.reduce((total, section) => total + section.fields.length, 0);
  const href = liveHref(liveUrl, page.path);

  return (
    <Card as="article" className="flex flex-col gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-semibold text-ink">{page.label}</h2>
        {page.description && <p className="mt-1 text-sm text-muted">{page.description}</p>}
        <p className="mt-2 text-sm text-muted">
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-1 break-all text-accent underline-offset-2 hover:underline"
            >
              {page.path}
              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <SrOnly>(opens the live page in a new tab)</SrOnly>
            </a>
          ) : (
            <span className="break-all">{page.path}</span>
          )}
        </p>
        <p className="mt-1 text-sm text-muted">
          {plural(page.sections.length, "section")} · {plural(fieldCount, "field")}
        </p>
      </div>
      <div>
        <LinkButton to={`/sites/${siteId}/pages/${page.slug}`} variant="secondary">
          Edit
          <SrOnly> {page.label}</SrOnly>
        </LinkButton>
      </div>
    </Card>
  );
}

export function SitePages() {
  const { site } = useSite();
  const content = useSiteContent(site.id);

  const failed = (message: string) => (
    <Notice
      kind="danger"
      title="The site's content could not be loaded"
      action={
        <Button variant="secondary" loading={content.isFetching} onClick={() => void content.refetch()}>
          Retry
        </Button>
      }
    >
      {message}
    </Notice>
  );

  let body: ReactNode;
  if (content.isPending) {
    body = <Spinner label="Reading the site's content from GitHub" />;
  } else if (content.isError) {
    body = failed(content.error.message);
  } else if (!content.data.ok) {
    body = failed(content.data.message);
  } else {
    const loaded = content.data;
    body = (
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Connected to {loaded.repo} on {loaded.branch} @ {shortSha(loaded.commitSha)}
        </p>
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
          <EmptyState title="No editable pages">
            The site's content map (content/schema.json) does not declare any pages yet.
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
    <div className="space-y-6">
      <PageHeader title="Pages" description="Choose a page to edit. Changes go live when you press Publish." />
      {body}
    </div>
  );
}
