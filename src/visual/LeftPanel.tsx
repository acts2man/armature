/**
 * The 264px panel on the left: Pages (every page in the schema) and Layers (the
 * current page's sections and fields, plus the shared header and footer). A dot marks
 * a changed field; clicking a field selects it and scrolls the canvas to it.
 */
import { clsx } from "clsx";
import { useState } from "react";
import { IconChevronDown, IconChevronRight, IconHeading, IconImage, IconLayers, IconLayout, IconLink, IconPage, IconParagraph, IconSection, IconVideo } from "@/components/icons.tsx";
import { SrOnly } from "@/components/ui.tsx";
import { SHARED_SLUG, type PageDefinition, type PageField, type SiteSchema } from "@shared/schema.ts";
import { fieldPath, fieldRoot, type FieldPath } from "@shared/visualProtocol.ts";

export type LeftTab = "pages" | "layers";

function fieldIcon(type: PageField["type"]) {
  switch (type) {
    case "textarea":
      return <IconParagraph size={15} />;
    case "image":
      return <IconImage size={15} />;
    case "video":
      return <IconVideo size={15} />;
    case "link":
    case "url":
      return <IconLink size={15} />;
    case "list":
      return <IconLayers size={15} />;
    default:
      return <IconHeading size={15} />;
  }
}

function SectionGroup({
  slug,
  section,
  shared,
  selectedRoot,
  changed,
  onCanvas,
  connected,
  onSelect,
}: {
  slug: string;
  section: PageDefinition["sections"][number];
  shared?: boolean;
  selectedRoot: FieldPath | null;
  changed: Set<FieldPath>;
  onCanvas: Set<FieldPath>;
  connected: boolean;
  onSelect: (path: FieldPath) => void;
}) {
  const [open, setOpen] = useState(true);
  const sectionChanged = section.fields.some((field) => changed.has(fieldPath(slug, section.key, field.key)));
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-sm px-2 text-left text-[13px] font-medium text-text hover:bg-ground"
      >
        <span className="flex min-w-0 items-center gap-2">
          {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          {shared ? <IconLayout size={15} /> : <IconSection size={15} />}
          <span className="truncate">{section.label}</span>
        </span>
        {sectionChanged && !open && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Has unpublished changes" />}
      </button>
      {open && (
        <div className="flex flex-col gap-px">
          {section.fields.map((field) => {
            const path = fieldPath(slug, section.key, field.key);
            const active = selectedRoot === path;
            const isChanged = changed.has(path);
            const visible = !connected || onCanvas.has(path);
            return (
              <button
                key={field.key}
                type="button"
                aria-pressed={active}
                onClick={() => onSelect(path)}
                data-testid={`layer-${path}`}
                className={clsx(
                  "flex h-9 w-full items-center justify-between gap-2 rounded-sm py-0 pl-[26px] pr-2 text-left text-[13px]",
                  active ? "bg-blue-soft font-semibold text-blue" : "font-medium text-text hover:bg-ground",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="w-3.5 shrink-0" />
                  <span className={active ? "text-blue" : "text-muted"}>{fieldIcon(field.type)}</span>
                  <span className="truncate">{field.label}</span>
                  {!visible && <SrOnly>(edited in the inspector, not on this page)</SrOnly>}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {!visible && <span className="text-[11px] text-muted" title="Not shown on this page; edit it in the inspector">off page</span>}
                  {isChanged && <span className="h-2 w-2 rounded-full bg-accent" aria-label="Unpublished change" />}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function LeftPanel({
  tab,
  onTab,
  schema,
  page,
  pages,
  changed,
  changedByPage,
  onCanvas,
  connected,
  selectedPath,
  onSelectField,
  onPage,
}: {
  tab: LeftTab;
  onTab: (tab: LeftTab) => void;
  schema: SiteSchema;
  page: PageDefinition | undefined;
  pages: PageDefinition[];
  changed: Set<FieldPath>;
  changedByPage: Record<string, number>;
  onCanvas: Set<FieldPath>;
  /** False while the frame is still connecting: then nothing is known to be off the page. */
  connected: boolean;
  selectedPath: FieldPath | null;
  onSelectField: (path: FieldPath) => void;
  onPage: (slug: string) => void;
}) {
  const selectedRoot = selectedPath ? fieldRoot(selectedPath) : null;
  const shared = schema.pages.find((item) => item.slug === SHARED_SLUG && item.slug !== page?.slug);

  return (
    <aside aria-label="Page structure" className="flex w-[264px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="px-3.5 pb-2.5 pt-3.5">
        <div role="tablist" aria-label="Panel" className="flex gap-0.5 rounded-control bg-ground p-0.5">
          {(["layers", "pages"] as LeftTab[]).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={tab === item}
              onClick={() => onTab(item)}
              className={clsx("h-8 flex-1 rounded-sm text-[12px] font-semibold", tab === item ? "bg-panel text-text shadow-segment" : "text-muted hover:text-text")}
            >
              {item === "layers" ? "Layers" : "Pages"}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" role="tabpanel">
        {tab === "pages" ? (
          <PagesList pages={pages} page={page} changedByPage={changedByPage} onPage={onPage} shared={shared} />
        ) : page ? (
          <div className="flex flex-col gap-0.5">
            {page.sections.map((section) => (
              <SectionGroup key={section.key} slug={page.slug} section={section} selectedRoot={selectedRoot} changed={changed} onCanvas={onCanvas} connected={connected} onSelect={onSelectField} />
            ))}
            {shared && (
              <>
                <div className="mt-2 px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{shared.label}</div>
                {shared.sections.map((section) => (
                  <SectionGroup key={section.key} slug={shared.slug} section={section} shared selectedRoot={selectedRoot} changed={changed} onCanvas={onCanvas} connected={connected} onSelect={onSelectField} />
                ))}
              </>
            )}
            {page.sections.length === 0 && <p className="px-2 py-3 text-[13px] text-muted">This page has no editable sections.</p>}
          </div>
        ) : (
          <p className="px-2 py-3 text-[13px] text-muted">Pick a page to see its layers.</p>
        )}
      </div>
    </aside>
  );
}

/** The Pages tab: every page with its path and a count of unpublished changes. Shared with the builder panel. */
export function PagesList({ pages, page, changedByPage, onPage, shared, children }: { pages: PageDefinition[]; page: PageDefinition | undefined; changedByPage: Record<string, number>; onPage: (slug: string) => void; shared?: PageDefinition | undefined; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-px">
      {pages.map((item) => {
        const active = item.slug === page?.slug;
        const count = changedByPage[item.slug] ?? 0;
        return (
          <button
            key={item.slug}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => onPage(item.slug)}
            data-testid={`page-${item.slug}`}
            className={clsx("flex min-h-11 w-full items-center justify-between gap-2 rounded-sm px-2 text-left", active ? "bg-blue-soft text-blue" : "text-text hover:bg-ground")}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <IconPage size={16} className={active ? "text-blue" : "text-muted"} />
              <span className="min-w-0">
                <span className={clsx("block truncate text-[13px]", active ? "font-semibold" : "font-medium")}>{item.label}</span>
                <span className="block truncate font-mono text-[11px] text-muted">{item.path}</span>
              </span>
            </span>
            {count > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-accent-fg">
                {count}
                <SrOnly> unpublished changes</SrOnly>
              </span>
            )}
          </button>
        );
      })}
      {children}
      {shared && <p className="mt-3 px-2 text-[12px] leading-relaxed text-muted">The header and footer ({shared.label}) appear on every page; find their fields under Layers.</p>}
    </div>
  );
}
