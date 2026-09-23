/**
 * The Elements mode of the left panel (Elementor-style): a header, a Widgets / Globals
 * tab pair, a search box and the widget tiles in a two-column grid. Drag a tile onto the
 * page, or click it to insert after the selection. The Globals tab holds the site's
 * global colours, fonts and typography presets.
 */
import { clsx } from "clsx";
import { useMemo, useState, type ReactNode } from "react";
import * as icons from "@/components/icons.tsx";
import { SrOnly } from "@/components/ui.tsx";
import type { Element } from "@shared/builder/index.ts";
import type { SiteSectionInfo } from "@shared/visualProtocol.ts";
import { createElement } from "./store.ts";
import type { DragSource } from "./useDrag.ts";
import { GROUP_LABELS, STRUCTURES, createStructure, widgetDefinitions, type WidgetDefinition, type WidgetGroup } from "./widgets/registry.ts";
import "./widgets/library.ts";

export type PanelItem = { key: string; label: string; icon: ReactNode; keywords: string[]; create: () => Element; hint?: string };

function iconFor(name: string, size = 18): ReactNode {
  const Component = (icons as unknown as Record<string, React.ComponentType<{ size?: number }> | undefined>)[`Icon${name}`];
  return Component ? <Component size={size} /> : <icons.IconWidget size={size} />;
}

export function ElementsPanel({
  isStaff,
  sections,
  sectionsInUse,
  onBeginDrag,
  onInsert,
  onStructure,
  templates = [],
  onOpenLibrary,
  globals,
  showGlobals = false,
  canAdd = true,
}: {
  isStaff: boolean;
  sections: SiteSectionInfo[];
  /** Keys of site sections already on the current page (non-repeatable ones cannot be added twice). */
  sectionsInUse: Set<string>;
  onBeginDrag: (event: React.PointerEvent, source: DragSource) => void;
  onInsert: (element: Element, label: string) => void;
  onStructure: () => void;
  /** Saved section templates (this site's and the agency's). */
  templates?: { id: string; name: string; create: () => Element; count: number }[];
  onOpenLibrary?: () => void;
  /** The Globals tab body: global colours, fonts and typography (the site kit). */
  globals?: ReactNode;
  showGlobals?: boolean;
  /** The style level cannot add widgets: hide the widget tiles, keep Globals. */
  canAdd?: boolean;
}) {
  const [tab, setTab] = useState<"widgets" | "globals">(canAdd ? "widgets" : "globals");
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const definitions = widgetDefinitions().filter((definition) => isStaff || !definition.agencyOnly);
    const byGroup = new Map<WidgetGroup, WidgetDefinition[]>();
    for (const definition of definitions) byGroup.set(definition.group, [...(byGroup.get(definition.group) ?? []), definition]);
    const out: { key: string; label: string; items: PanelItem[] }[] = [];
    for (const group of ["layout", "basic", "general", "agency"] as WidgetGroup[]) {
      const items = (byGroup.get(group) ?? []).map((definition): PanelItem => ({ key: definition.type, label: definition.label, icon: iconFor(definition.icon), keywords: [definition.label, ...(definition.keywords ?? [])], create: definition.create }));
      if (items.length) out.push({ key: group, label: GROUP_LABELS[group], items });
    }
    if (sections.length) {
      out.push({
        key: "sections",
        label: "Site sections",
        items: sections.map((section) => ({
          key: `section:${section.key}`,
          label: section.label,
          icon: <icons.IconSection size={18} />,
          keywords: [section.label, section.key, "section"],
          create: () => createElement("site-section", { key: section.key }),
          hint: !section.repeatable && sectionsInUse.has(section.key) ? "Already on this page" : undefined,
        })),
      });
    }
    if (templates.length) {
      out.push({
        key: "templates",
        label: "Saved templates",
        items: templates.map((template) => ({ key: `template:${template.id}`, label: template.name, icon: <icons.IconTemplate size={18} />, keywords: [template.name, "template", "saved"], create: template.create })),
      });
    }
    return out;
  }, [isStaff, sections, sectionsInUse, templates]);

  const needle = query.trim().toLowerCase();
  const visible = groups
    .map((group) => ({ ...group, items: needle ? group.items.filter((item) => item.keywords.some((keyword) => keyword.toLowerCase().includes(needle))) : group.items }))
    .filter((group) => group.items.length > 0);

  const showWidgets = tab === "widgets" && canAdd;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="elements-panel">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 pb-2.5 pt-3.5">
        <h2 className="font-display text-[16px] font-semibold text-text">Elements</h2>
      </div>
      {showGlobals && (
        <div className="px-3 pb-2 pt-2">
          <div role="tablist" aria-label="Elements or globals" className="flex gap-0.5 rounded-control bg-ground p-0.5">
            {(canAdd ? (["widgets", "globals"] as const) : (["globals"] as const)).map((item) => (
              <button key={item} type="button" role="tab" aria-selected={tab === item} data-testid={`tab-${item}`} onClick={() => setTab(item)} className={clsx("h-8 flex-1 rounded-sm text-[12px] font-semibold capitalize", tab === item ? "bg-panel text-text shadow-segment" : "text-muted hover:text-text")}>
                {item}
              </button>
            ))}
          </div>
        </div>
      )}
      {tab === "globals" && showGlobals ? (
        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="globals-panel">
          {globals}
        </div>
      ) : !showWidgets ? (
        <p className="px-4 py-6 text-[13px] leading-relaxed text-muted">Your account can restyle this page and its global colours and fonts, but not add elements. Use the Globals tab.</p>
      ) : (
      <>
      <div className="px-3 pb-2 pt-2">
        <label htmlFor="elements-search" className="sr-only">
          Search elements
        </label>
        <div className="relative">
          <icons.IconSearch size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            id="elements-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search elements"
            className="h-9 w-full rounded-control border border-line bg-panel pl-8 pr-3 text-[13px] text-text placeholder:text-muted/70 focus:border-accent"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {!needle && (
          <button type="button" onClick={onStructure} className="mb-3 flex h-10 w-full items-center justify-center gap-2 rounded-control border border-dashed border-line text-[13px] font-semibold text-text hover:border-accent hover:text-accent" data-testid="add-section">
            <icons.IconPlus size={16} /> Add a section
          </button>
        )}
        {!needle && onOpenLibrary && (
          <button type="button" onClick={onOpenLibrary} className="mb-3 flex h-9 w-full items-center justify-center gap-2 rounded-control border border-line text-[13px] font-semibold text-text hover:border-accent hover:text-accent" data-testid="open-template-library">
            <icons.IconTemplate size={15} /> Template library
          </button>
        )}
        {visible.length === 0 && <p className="px-1 py-6 text-center text-[13px] text-muted">Nothing matches "{query}".</p>}
        {visible.map((group) => (
          <section key={group.key} className="mb-3" aria-label={group.label}>
            <h3 className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{group.label}</h3>
            <div className="grid grid-cols-2 gap-1.5">
              {group.items.map((item) => {
                const disabled = !!item.hint;
                return (
                  <button
                    key={item.key}
                    type="button"
                    disabled={disabled}
                    title={item.hint ?? `Drag onto the page, or click to insert ${item.label}`}
                    data-testid={`element-${item.key}`}
                    onPointerDown={(event) => !disabled && onBeginDrag(event, { kind: "new", label: item.label, create: item.create })}
                    onClick={() => !disabled && onInsert(item.create(), item.label)}
                    className={clsx(
                      "flex h-[68px] select-none flex-col items-center justify-center gap-1.5 rounded-control border border-line bg-panel text-[12px] font-medium text-text transition-[border-color,box-shadow,transform] duration-150",
                      disabled ? "cursor-not-allowed opacity-50" : "cursor-grab hover:border-accent hover:shadow-segment active:cursor-grabbing",
                    )}
                  >
                    <span className="text-muted">{item.icon}</span>
                    <span className="truncate px-1">{item.label}</span>
                    {item.hint && <SrOnly>{item.hint}</SrOnly>}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
        {!needle && (
          <section className="mb-3" aria-label="Structures">
            <h3 className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Structures</h3>
            <div className="grid grid-cols-3 gap-1.5">
              {STRUCTURES.slice(0, 6).map((structure) => (
                <button
                  key={structure.id}
                  type="button"
                  title={`${structure.label}: drag onto the page or click to add a section`}
                  data-testid={`structure-${structure.id}`}
                  onPointerDown={(event) => onBeginDrag(event, { kind: "new", label: `${structure.label} section`, create: () => createStructure(structure) })}
                  onClick={() => onInsert(createStructure(structure), `${structure.label} section`)}
                  className="flex h-12 cursor-grab items-center justify-center gap-0.5 rounded-control border border-line bg-panel px-1.5 hover:border-accent active:cursor-grabbing"
                >
                  {structure.columns.map((column, index) => (
                    <span key={index} className="h-6 rounded-[2px] bg-grey-soft" style={{ width: `${column}%` }} aria-hidden="true" />
                  ))}
                  <SrOnly>{structure.label}</SrOnly>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
      </>
      )}
    </div>
  );
}
