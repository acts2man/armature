/**
 * Page settings in the left panel (opened from the top bar's page-name chevron or the
 * Page settings button): the current page's SEO title, description, sharing picture,
 * hide-from-search, hide title, full canvas and background. A Save button applies the
 * change as one undo step. Builder pages also edit their title and address.
 *
 * The SEO section covers everything Google (and social networks) receive: the
 * search-result title (with a character counter and Google-style preview), the meta
 * description, canonical URL, noindex/nofollow, the Open Graph and X/Twitter share
 * fields, and structured data presets (LocalBusiness, Organization, Article, FAQ from
 * an accordion on the page, BreadcrumbList).
 */
import { useMemo, useState } from "react";
import { IconGrid } from "@/components/icons.tsx";
import { Button, Field, Input, Notice, Select, Textarea, Toggle } from "@/components/ui.tsx";
import { computePageHead, type SiteKit } from "@kit/index.ts";
import { isColorValue } from "@kit/values.ts";
import type { LayoutDoc, PageSeo, PageSettings, PageStructuredData } from "@shared/builder/index.ts";
import type { PageDefinition } from "@shared/schema.ts";
import { pathProblem, storedPath } from "./pageAddress.ts";

const TITLE_TARGET = 60;
const DESC_TARGET = 160;

/** A tiny character counter that turns amber past the target and red past the hard limit. */
function CharCount({ value, target, hardLimit }: { value: string; target: number; hardLimit?: number }) {
  const length = value.length;
  const over = length > target;
  const wayOver = hardLimit && length > hardLimit;
  const tone = wayOver ? "text-red-600" : over ? "text-amber-700" : "text-muted";
  return (
    <span className={`text-[11px] ${tone}`} aria-live="polite">
      {length}/{target}
      {over && !wayOver ? " — a bit long" : ""}
      {wayOver ? " — too long" : ""}
    </span>
  );
}

/** A quick, Google-style search preview so the person can see how the entry looks. */
function GooglePreview({ title, description, url }: { title: string; description: string; url: string }) {
  return (
    <div className="rounded-control border border-line bg-white p-3" data-testid="google-preview">
      <div className="truncate text-[12px] text-muted">{url || "https://your-site.example/page/"}</div>
      <div className="truncate text-[16px] font-medium text-[#1a0dab]">{title.slice(0, 66) || "Page title"}</div>
      <div className="text-[12px] text-[#4d5156] line-clamp-2">{description.slice(0, 180) || "A one- or two-sentence description shown under the title in search results."}</div>
    </div>
  );
}

export function PageSettingsPanel({
  page,
  layout,
  isBuilderPage,
  siteKit,
  taken,
  onClose,
  onSave,
  onDuplicate,
  onDelete,
}: {
  page: PageDefinition;
  layout: LayoutDoc | undefined;
  isBuilderPage: boolean;
  /** The site kit, used to pull site-wide SEO defaults so the preview shows the real page URL and title pattern. */
  siteKit?: SiteKit | null;
  /** Every other page's address, so a builder page's new address can be checked. */
  taken: Map<string, string>;
  onClose: () => void;
  onSave: (patch: Partial<LayoutDoc>) => void;
  /** Builder pages can be duplicated and deleted (agency staff and the builder level). */
  onDuplicate?: () => void;
  onDelete?: () => void;
}) {
  const [label, setLabel] = useState(layout?.label ?? page.label);
  const [path, setPath] = useState(layout?.path ?? page.path);
  const [seo, setSeo] = useState<PageSeo>(layout?.seo ?? {});
  const [settings, setSettings] = useState<PageSettings>(layout?.pageSettings ?? {});
  const problem = isBuilderPage ? pathProblem(path, taken, page.label) : null;
  const backgroundProblem = settings.bodyBackground && !isColorValue(settings.bodyBackground) ? "Use a colour such as #f3efe6." : null;
  const clean = <T extends object>(value: T): T | undefined => {
    const entries = Object.entries(value).filter(([, inner]) => inner !== undefined && inner !== "" && inner !== false && inner !== null);
    return entries.length ? (Object.fromEntries(entries) as T) : undefined;
  };
  const disabled = !!problem || !!backgroundProblem || (isBuilderPage && !label.trim());

  // The preview reflects site-wide title pattern, defaults and URL so what shows on the
  // panel is exactly what Google would see.
  const preview = useMemo(() => {
    const draftLayout: LayoutDoc = { ...(layout ?? { version: 1, pageSlug: page.slug, path: page.path, root: [] as never[] }), path, label, seo, pageSettings: settings } as LayoutDoc;
    const tags = computePageHead(draftLayout, siteKit ?? null, { pageLabel: label });
    const titleTag = tags.find((tag) => tag.tag === "title");
    const descTag = tags.find((tag) => tag.tag === "meta" && (tag as { attrs: Record<string, string> }).attrs.name === "description");
    const canonicalTag = tags.find((tag) => tag.tag === "link" && (tag as { attrs: Record<string, string> }).attrs.rel === "canonical");
    return {
      title: titleTag && titleTag.tag === "title" ? titleTag.content : "",
      description: descTag && descTag.tag === "meta" ? (descTag.attrs as Record<string, string>).content ?? "" : "",
      url: canonicalTag && canonicalTag.tag === "link" ? (canonicalTag.attrs as Record<string, string>).href ?? "" : "",
    };
  }, [layout, page.slug, page.path, path, label, seo, settings, siteKit]);

  const kind = seo.structuredData?.kind ?? "none";
  const setStructured = (next: PageStructuredData) => setSeo({ ...seo, structuredData: next.kind === "none" ? undefined : next });

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="page-settings-panel">
      <div className="flex items-center gap-2 border-b border-line px-4 pb-3 pt-3">
        <button type="button" onClick={onClose} aria-label="Back to Elements" title="Back to Elements" data-testid="page-settings-back" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-muted hover:bg-ground hover:text-text">
          <IconGrid size={18} />
        </button>
        <h2 className="min-w-0 flex-1 truncate font-display text-[16px] font-semibold text-text">Page settings</h2>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        {isBuilderPage ? (
          <>
            <Field label="Title" htmlFor="page-title">
              <Input id="page-title" value={label} maxLength={120} onChange={(event) => setLabel(event.target.value)} />
            </Field>
            <Field label="Address" htmlFor="page-path" error={problem}>
              <Input id="page-path" value={path} onChange={(event) => setPath(event.target.value)} className="font-mono" />
            </Field>
          </>
        ) : (
          <Notice kind="info" title="A page coded into the site">
            Its title and address come from the site's code. The settings below apply to it.
          </Notice>
        )}

        <p className="text-[12px] font-bold uppercase tracking-wide text-muted">Search results</p>
        <Field label="Title in search results" htmlFor="page-seo-title" hint="Empty uses the page title. About 60 characters shows in full.">
          <Input id="page-seo-title" value={seo.title ?? ""} maxLength={200} onChange={(event) => setSeo({ ...seo, title: event.target.value || undefined })} />
          <div className="mt-1 text-right">
            <CharCount value={seo.title ?? ""} target={TITLE_TARGET} hardLimit={100} />
          </div>
        </Field>
        <Field label="Description" htmlFor="page-seo-description" hint="One or two sentences. About 160 characters shows in full.">
          <Textarea id="page-seo-description" value={seo.description ?? ""} maxLength={500} onChange={(event) => setSeo({ ...seo, description: event.target.value || undefined })} className="min-h-20" />
          <div className="mt-1 text-right">
            <CharCount value={seo.description ?? ""} target={DESC_TARGET} hardLimit={300} />
          </div>
        </Field>
        <div>
          <p className="mb-2 text-[12px] text-muted">Preview:</p>
          <GooglePreview title={preview.title} description={preview.description} url={preview.url} />
        </div>
        <Field label="Canonical URL" htmlFor="page-seo-canonical" hint="Empty uses the site URL + the page's address. Set only for a mirror or when a page has moved.">
          <Input id="page-seo-canonical" value={seo.canonical ?? ""} onChange={(event) => setSeo({ ...seo, canonical: event.target.value || undefined })} className="font-mono" />
        </Field>
        <label className="flex items-center justify-between gap-3 text-[14px] text-text">
          Hide from search engines
          <Toggle checked={!!seo.noindex} onChange={(next) => setSeo({ ...seo, noindex: next || undefined })} label="Hide from search engines" />
        </label>
        <label className="flex items-center justify-between gap-3 text-[14px] text-text">
          Ask crawlers not to follow links on this page
          <Toggle checked={!!seo.nofollow} onChange={(next) => setSeo({ ...seo, nofollow: next || undefined })} label="Don't follow links" />
        </label>

        <p className="text-[12px] font-bold uppercase tracking-wide text-muted">Sharing (Facebook, LinkedIn, iMessage, …)</p>
        <Field label="Share title" htmlFor="page-og-title" hint="Empty uses the search-result title.">
          <Input id="page-og-title" value={seo.ogTitle ?? ""} maxLength={200} onChange={(event) => setSeo({ ...seo, ogTitle: event.target.value || undefined })} />
        </Field>
        <Field label="Share description" htmlFor="page-og-description" hint="Empty uses the description.">
          <Textarea id="page-og-description" value={seo.ogDescription ?? ""} maxLength={500} onChange={(event) => setSeo({ ...seo, ogDescription: event.target.value || undefined })} className="min-h-16" />
        </Field>
        <Field label="Share picture" htmlFor="page-og-image" hint="A picture on this site (/assets/...) or an https:// address. 1200×630 px works well.">
          <Input id="page-og-image" value={seo.ogImage ?? ""} onChange={(event) => setSeo({ ...seo, ogImage: event.target.value || undefined })} className="font-mono" />
        </Field>

        <p className="text-[12px] font-bold uppercase tracking-wide text-muted">Sharing on X (Twitter)</p>
        <Field label="X title" htmlFor="page-tw-title" hint="Empty uses the Open Graph share title.">
          <Input id="page-tw-title" value={seo.twitterTitle ?? ""} maxLength={200} onChange={(event) => setSeo({ ...seo, twitterTitle: event.target.value || undefined })} />
        </Field>
        <Field label="X description" htmlFor="page-tw-description" hint="Empty uses the Open Graph share description.">
          <Textarea id="page-tw-description" value={seo.twitterDescription ?? ""} maxLength={500} onChange={(event) => setSeo({ ...seo, twitterDescription: event.target.value || undefined })} className="min-h-16" />
        </Field>
        <Field label="X picture" htmlFor="page-tw-image" hint="Empty uses the Open Graph share picture.">
          <Input id="page-tw-image" value={seo.twitterImage ?? ""} onChange={(event) => setSeo({ ...seo, twitterImage: event.target.value || undefined })} className="font-mono" />
        </Field>

        <p className="text-[12px] font-bold uppercase tracking-wide text-muted">Structured data (schema.org)</p>
        <Field label="Kind" htmlFor="page-structured-kind" hint="Adds a small JSON block search engines read to know what the page is about.">
          <Select id="page-structured-kind" value={kind} onChange={(event) => {
            const next = event.target.value as PageStructuredData["kind"];
            if (next === "none") setStructured({ kind: "none" });
            else if (next === "LocalBusiness") setStructured({ kind: "LocalBusiness" });
            else if (next === "Organization") setStructured({ kind: "Organization" });
            else if (next === "Article") setStructured({ kind: "Article", article: {} });
            else if (next === "FAQ") setStructured({ kind: "FAQ" });
            else if (next === "BreadcrumbList") setStructured({ kind: "BreadcrumbList", items: [{ name: "", url: "" }] });
          }}>
            <option value="none">None</option>
            <option value="LocalBusiness">LocalBusiness (a shop, restaurant, service)</option>
            <option value="Organization">Organization (a company, charity, group)</option>
            <option value="Article">Article (a blog post or news story)</option>
            <option value="FAQ">FAQ (from an accordion on this page)</option>
            <option value="BreadcrumbList">Breadcrumbs (the path to this page)</option>
          </Select>
        </Field>
        {(kind === "LocalBusiness" || kind === "Organization") && (
          <Notice kind="info" title={`${kind} uses your site business details`}>
            The business details live under Site settings › SEO so they cover every page. This page can override any field there.
          </Notice>
        )}
        {kind === "Article" && seo.structuredData?.kind === "Article" && (
          <div className="flex flex-col gap-3">
            <Field label="Headline" htmlFor="article-headline">
              <Input id="article-headline" value={seo.structuredData.article.headline ?? ""} maxLength={300} onChange={(event) => setStructured({ kind: "Article", article: { ...(seo.structuredData?.kind === "Article" ? seo.structuredData.article : {}), headline: event.target.value } })} />
            </Field>
            <Field label="Author" htmlFor="article-author">
              <Input id="article-author" value={seo.structuredData.article.author ?? ""} onChange={(event) => setStructured({ kind: "Article", article: { ...(seo.structuredData?.kind === "Article" ? seo.structuredData.article : {}), author: event.target.value } })} />
            </Field>
            <Field label="Published (ISO date)" htmlFor="article-date">
              <Input id="article-date" placeholder="2026-05-01" value={seo.structuredData.article.datePublished ?? ""} onChange={(event) => setStructured({ kind: "Article", article: { ...(seo.structuredData?.kind === "Article" ? seo.structuredData.article : {}), datePublished: event.target.value } })} />
            </Field>
          </div>
        )}
        {kind === "FAQ" && seo.structuredData?.kind === "FAQ" && (
          <Field label="Accordion element id" htmlFor="faq-id" hint="Eight characters. Copy from the accordion's data-ae-id, or use the first accordion on the page if empty.">
            <Input id="faq-id" value={seo.structuredData.fromAccordionId ?? ""} maxLength={8} onChange={(event) => setStructured({ kind: "FAQ", fromAccordionId: event.target.value || undefined })} className="font-mono" />
          </Field>
        )}
        {kind === "BreadcrumbList" && seo.structuredData?.kind === "BreadcrumbList" && (
          <div className="flex flex-col gap-2">
            {seo.structuredData.items.map((item, index) => (
              <div key={index} className="flex flex-col gap-2 rounded-control border border-line p-2">
                <Input placeholder="Name" value={item.name} onChange={(event) => {
                  const items = [...(seo.structuredData?.kind === "BreadcrumbList" ? seo.structuredData.items : [])];
                  items[index] = { ...items[index]!, name: event.target.value };
                  setStructured({ kind: "BreadcrumbList", items });
                }} />
                <Input placeholder="Address (/about/ or https://…)" value={item.url} className="font-mono" onChange={(event) => {
                  const items = [...(seo.structuredData?.kind === "BreadcrumbList" ? seo.structuredData.items : [])];
                  items[index] = { ...items[index]!, url: event.target.value };
                  setStructured({ kind: "BreadcrumbList", items });
                }} />
              </div>
            ))}
            <Button size="sm" variant="secondary" onClick={() => {
              const items = seo.structuredData?.kind === "BreadcrumbList" ? [...seo.structuredData.items, { name: "", url: "" }] : [{ name: "", url: "" }];
              setStructured({ kind: "BreadcrumbList", items });
            }}>Add item</Button>
          </div>
        )}

        <p className="text-[12px] font-bold uppercase tracking-wide text-muted">Layout</p>
        <label className="flex items-center justify-between gap-3 text-[14px] text-text">
          Full canvas (hide the site's header and footer)
          <Toggle checked={!!settings.fullCanvas} onChange={(next) => setSettings({ ...settings, fullCanvas: next || undefined })} label="Full canvas" />
        </label>
        <label className="flex items-center justify-between gap-3 text-[14px] text-text">
          Hide the page title
          <Toggle checked={!!settings.hideTitle} onChange={(next) => setSettings({ ...settings, hideTitle: next || undefined })} label="Hide the page title" />
        </label>
        <Field label="Page background" htmlFor="page-background" error={backgroundProblem} hint="A colour such as #f3efe6. Empty uses the site's page background.">
          <Input id="page-background" value={settings.bodyBackground ?? ""} onChange={(event) => setSettings({ ...settings, bodyBackground: event.target.value || undefined })} className="font-mono" />
        </Field>
        {isBuilderPage && (onDuplicate || onDelete) && (
          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <p className="text-[12px] font-bold uppercase tracking-wide text-muted">This page</p>
            {onDuplicate && (
              <Button variant="secondary" size="sm" onClick={onDuplicate} data-testid="page-duplicate">
                Duplicate this page
              </Button>
            )}
            {onDelete && (
              <Button variant="danger" size="sm" onClick={onDelete} data-testid="page-delete">
                Delete this page
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="border-t border-line p-3">
        <Button
          size="sm"
          className="w-full"
          disabled={disabled}
          data-testid="page-settings-save"
          onClick={() => onSave({ ...(isBuilderPage ? { label: label.trim(), path: storedPath(path) } : {}), seo: clean(seo), pageSettings: clean(settings) })}
        >
          Save settings
        </Button>
      </div>
    </div>
  );
}
