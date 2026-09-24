/**
 * Everything drawn above the iframe for builder elements, from the rect map the kit
 * reports, at 60fps from the geometry store, in Elementor's language: a thin hover
 * outline (solid on a widget, dashed on a container) with the type label, a solid accent
 * outline on the selected element with its handle tab — a square pencil at the top-right
 * of a widget (drag it to move; hover it for the parent, duplicate and delete), or a tab
 * centred on a container's top edge with add / grip / delete (offset when nested) — the
 * empty-container hint, the hover "+" between sections, the drag indicator, the resize and
 * spacing handles, and the hidden/locked badges.
 */
import { clsx } from "clsx";
import { useEffect, useState, type ReactNode } from "react";
import { IconCopy, IconEyeOff, IconGrip, IconLock, IconPencil, IconPlus, IconTrash } from "@/components/icons.tsx";
import { setAt, type Device, type Element, type Size, type SiteKit } from "@shared/builder/index.ts";
import type { ElementRect, Rect, RichTextCommand, RichTextState } from "@shared/visualProtocol.ts";
import { useGeometry, type GeometryStore } from "@/visual/geometry.ts";
import type { DragState } from "./useDrag.ts";
import { styleKindOf } from "./controls/specs.ts";
import { sectionGapAt } from "./dnd.ts";
import { Handles, type HandleActions } from "./Handles.tsx";
import { fontSizeOf } from "./fontSize.ts";
import { FontSizeStrip, RichTextToolbar, type FontSizeStepperProps } from "./RichTextToolbar.tsx";
import { findElement, isContainerType, type BuilderState } from "./store.ts";
import { widgetLabel } from "./widgets/registry.ts";

export type ElementActions = {
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onAddInside: (id: string) => void;
  onAddSection: (index: number) => void;
  onBeginMove: (event: React.PointerEvent, id: string) => void;
  onSelectParent: (id: string) => void;
  /** A setting written from the canvas (the font-size stepper); `group` keeps one hold one undo step. */
  onSetPath?: (id: string, path: string[], value: unknown, label: string, group?: string) => void;
};

/** Widgets whose Style tab has typography get the font-size stepper: headings, text, buttons, boxes with text. */
const hasTypography = (type: string): boolean => {
  const kind = styleKindOf(type);
  return kind === "text" || kind === "box";
};

const scaleRect = (rect: Rect, scale: number, pad = 0) => ({ left: rect.x * scale - pad, top: rect.y * scale - pad, width: rect.width * scale + pad * 2, height: rect.height * scale + pad * 2 });

/** One square of a handle tab. */
function TabButton({ label, onClick, onPointerDown, children, danger, testId, className }: { label: string; onClick?: () => void; onPointerDown?: (event: React.PointerEvent) => void; children: ReactNode; danger?: boolean; testId?: string; className?: string }) {
  return (
    <button type="button" title={label} aria-label={label} data-testid={testId} onClick={onClick} onPointerDown={onPointerDown} className={clsx("inline-flex h-6 w-6 items-center justify-center text-accent-fg", danger ? "hover:bg-red" : "hover:bg-white/20", className)}>
      {children}
    </button>
  );
}

const TAB = 24;

export function ElementOverlays({
  store,
  scale,
  state,
  slug,
  selectedId,
  device,
  isStaff,
  canEdit,
  editing,
  drag,
  changedIds,
  actions,
  handleActions,
  richText,
}: {
  store: GeometryStore;
  scale: number;
  state: BuilderState;
  slug: string;
  selectedId: string | null;
  device: Device;
  isStaff: boolean;
  /** False for clients whose editing level allows content only: no toolbar, no handles. */
  canEdit: boolean;
  editing: boolean;
  drag: DragState | null;
  changedIds: Set<string>;
  actions: ElementActions;
  handleActions?: HandleActions;
  /** While a Text Editor is edited on the page: its toolbar's state and commands. */
  richText?: { state: RichTextState | null; kit: SiteKit; onCommand: (command: RichTextCommand, value?: string) => void; onDone: () => void };
}) {
  const geometry = useGeometry(store);
  const layout = state.layouts[slug];
  const rects = new Map(geometry.elements.filter((element) => element.page === slug).map((element) => [element.id, element]));
  const hover = !drag && geometry.hoverElement && geometry.hoverElement !== selectedId ? rects.get(geometry.hoverElement) : null;
  const selected = selectedId ? rects.get(selectedId) : null;
  const selectedEntry = selectedId && layout ? findElement(state, selectedId, slug) : undefined;
  const hoverEntry = hover && layout ? findElement(state, hover.id, slug) : undefined;

  // The "+" between sections follows the pointer inside the frame; tracked here from the last hover message.
  const [gapAt, setGap] = useState<ReturnType<typeof sectionGapAt>>(null);
  const gap = layout && !drag ? gapAt : null;
  useEffect(() => {
    if (!layout || drag) return;
    const rootIds = layout.root.map((element) => element.id);
    const onMove = (event: PointerEvent) => {
      const sheet = (event.target as HTMLElement | null)?.closest?.("[data-testid='sheet']") ?? document.querySelector("[data-testid='sheet']");
      if (!sheet) return;
      const box = sheet.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) return setGap(null);
      const y = (event.clientY - box.top) / scale;
      setGap(sectionGapAt(store.get().elements, slug, rootIds, y, 18));
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [layout, slug, scale, store, drag]);

  // A column boundary: the selected element and its next sibling sit side by side in a flex row.
  const parentRect = selectedEntry?.parentId ? rects.get(selectedEntry.parentId) : undefined;
  const parentElement = selectedEntry?.parentId ? findElement(state, selectedEntry.parentId, slug)?.element : undefined;
  const nextElement = parentElement?.type === "container" && selectedEntry ? parentElement.children?.[selectedEntry.index + 1] : undefined;
  const nextRect = nextElement ? rects.get(nextElement.id) : undefined;
  const besideNext =
    selected && nextElement && nextRect && nextRect.rect.x >= selected.rect.x + selected.rect.width - 2 && nextRect.rect.y < selected.rect.y + selected.rect.height && nextRect.rect.y + nextRect.rect.height > selected.rect.y && !(nextElement.locked && !isStaff)
      ? { rect: nextRect, element: nextElement }
      : undefined;

  const label = (element: Element | undefined, rect: ElementRect): string => (element?.label ? element.label : element?.type === "site-section" ? `${rect.section ?? "Section"} (site section)` : widgetLabel(rect.type));
  const isLocked = (entry: { element: Element; ancestors: string[] } | undefined): boolean => !!entry && !isStaff && (entry.element.locked === true || entry.ancestors.some((id) => findElement(state, id, slug)?.element.locked));
  const hiddenHere = (element: Element | undefined): boolean => element?.advanced.hidden?.[device] === true;

  // The font-size stepper for the selected element, for the device being edited.
  const fontSize: FontSizeStepperProps | null =
    selected && selectedEntry && canEdit && !drag && actions.onSetPath && !isLocked(selectedEntry) && hasTypography(selectedEntry.element.type)
      ? {
          info: fontSizeOf(selectedEntry.element, state.kit, device, selected.fontSize),
          device,
          onChange: (next: Size, run: string) => {
            const current = findElement(state, selectedEntry.element.id, slug)?.element ?? selectedEntry.element;
            const raw = current.style.typography?.fontSize;
            // A first size on a phone or tablet keeps desktop at what it shows now (the site style's
            // size, or the page's), since the file format needs a desktop base.
            const base = raw === undefined && device !== "desktop" ? { desktop: fontSizeOf(current, state.kit, "desktop", selected.fontSize).size } : raw;
            actions.onSetPath?.(current.id, ["style", "typography", "fontSize"], setAt<Size>(base, device, next), "Changed font size", `drag:font-size:${current.id}:${run}`);
          },
        }
      : null;
  /** The strip sits above the element at its left; under it when the element is too narrow to share its top edge with the tab. */
  const stripPosition = (rect: ElementRect) => {
    const narrow = rect.rect.width * scale < 170;
    const top = narrow ? (rect.rect.y + rect.rect.height) * scale + 2 : rect.rect.y * scale - 34;
    return { left: Math.max(2, rect.rect.x * scale), top: top < 2 ? rect.rect.y * scale + 2 : top };
  };

  /** The widget tab sits outside the top-right corner (inside it when the element touches the top). */
  const widgetTabPosition = (rect: ElementRect) => {
    const top = rect.rect.y * scale - TAB - 1;
    return { right: Math.max(0, (store.get().viewport.width || 0) * scale - (rect.rect.x + rect.rect.width) * scale - 1), top: top < 2 ? rect.rect.y * scale + 2 : top };
  };
  /** A container's tab straddles its top edge, centred; nested containers shift right so tabs never stack. */
  const containerTabPosition = (rect: ElementRect, depth: number, buttons: number) => {
    const width = buttons * TAB;
    const top = rect.rect.y * scale - TAB / 2;
    return { left: Math.max(2, (rect.rect.x + rect.rect.width / 2) * scale - width / 2 + depth * (TAB + 8)), top: top < 2 ? rect.rect.y * scale + 2 : top };
  };

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" data-testid="element-overlays">
      {/* Hidden-on-this-device badges */}
      {layout &&
        Array.from(rects.values())
          .filter((rect) => hiddenHere(findElement(state, rect.id, slug)?.element))
          .map((rect) => (
            <span key={`hidden-${rect.id}`} className="absolute flex h-5 items-center gap-1 rounded-sm bg-ink/80 px-1.5 text-[10px] font-semibold text-white" style={{ left: rect.rect.x * scale + 4, top: rect.rect.y * scale + 4 }}>
              <IconEyeOff size={11} /> Hidden on {device}
            </span>
          ))}

      {hover && (
        <div
          className={clsx("absolute outline-1 outline-accent/70", isContainerType(hover.type) || hover.type === "site-section" ? "outline-dashed" : "outline")}
          style={scaleRect(hover.rect, scale, 1)}
          data-testid={`hover-${hover.id}`}
          data-kind={isContainerType(hover.type) || hover.type === "site-section" ? "container" : "widget"}
        >
          <span className={clsx("absolute left-0 flex h-5 max-w-64 items-center gap-1 truncate bg-accent/85 px-1.5 text-[11px] font-semibold text-accent-fg", hover.rect.y * scale < 22 ? "top-0" : "-top-[20px]")}>
            {label(hoverEntry?.element, hover)}
            {isLocked(hoverEntry) && <IconLock size={11} />}
          </span>
        </div>
      )}

      {selected && (
        <div data-testid="element-selection" data-element-id={selected.id} data-kind={isContainerType(selected.type) || selected.type === "site-section" ? "container" : "widget"} className={clsx("absolute outline outline-[1.5px] outline-accent", editing && "outline-dashed")} style={scaleRect(selected.rect, scale, 1)}>
          {selected.empty && isContainerType(selected.type) && canEdit && !editing && (
            <div className="pointer-events-auto absolute inset-0 flex items-center justify-center">
              <button type="button" onClick={() => actions.onAddInside(selected.id)} className="inline-flex h-9 items-center gap-2 rounded-control border border-dashed border-accent bg-white/90 px-3 text-[12px] font-semibold text-accent hover:bg-white" data-testid="empty-container-add">
                <IconPlus size={14} /> Drag a widget here
              </button>
            </div>
          )}
        </div>
      )}

      {selected && canEdit && !editing && !drag && !isLocked(selectedEntry) && (isContainerType(selected.type) || selected.type === "site-section") && (
        <div
          role="toolbar"
          aria-label={`${label(selectedEntry?.element, selected)} tools`}
          data-testid="element-toolbar"
          data-kind="container"
          className="group pointer-events-auto absolute flex items-center overflow-hidden rounded-[4px] bg-accent shadow-pop"
          style={containerTabPosition(selected, selectedEntry?.ancestors.length ?? 0, isContainerType(selected.type) ? 3 : 2)}
        >
          {isContainerType(selected.type) && (
            <TabButton label="Add an element inside" onClick={() => actions.onAddInside(selected.id)} testId="element-add">
              <IconPlus size={14} />
            </TabButton>
          )}
          <TabButton label={`${label(selectedEntry?.element, selected)}: drag to move`} onPointerDown={(event) => actions.onBeginMove(event, selected.id)} testId="element-move" className="cursor-grab active:cursor-grabbing">
            <IconGrip size={14} />
          </TabButton>
          <TabButton label="Delete" onClick={() => actions.onDelete(selected.id)} danger testId="element-delete">
            <IconTrash size={13} />
          </TabButton>
          <span className="hidden items-center border-l border-white/30 group-hover:flex">
            {selectedEntry && selectedEntry.parentId && (
              <TabButton label="Select the parent" onClick={() => actions.onSelectParent(selected.id)} testId="element-parent">
                <span className="text-[11px] font-bold">↑</span>
              </TabButton>
            )}
            <TabButton label="Duplicate" onClick={() => actions.onDuplicate(selected.id)} testId="element-duplicate">
              <IconCopy size={13} />
            </TabButton>
          </span>
        </div>
      )}

      {selected && canEdit && !editing && !drag && !isLocked(selectedEntry) && !(isContainerType(selected.type) || selected.type === "site-section") && (
        <div
          role="toolbar"
          aria-label={`${label(selectedEntry?.element, selected)} tools`}
          data-testid="element-toolbar"
          data-kind="widget"
          className="group pointer-events-auto absolute flex items-center overflow-hidden rounded-[4px] bg-accent shadow-pop"
          style={widgetTabPosition(selected)}
        >
          <span className="hidden items-center border-r border-white/30 group-hover:flex">
            {selectedEntry && selectedEntry.parentId && (
              <TabButton label="Select the parent" onClick={() => actions.onSelectParent(selected.id)} testId="element-parent">
                <span className="text-[11px] font-bold">↑</span>
              </TabButton>
            )}
            <TabButton label="Duplicate" onClick={() => actions.onDuplicate(selected.id)} testId="element-duplicate">
              <IconCopy size={13} />
            </TabButton>
            <TabButton label="Delete" onClick={() => actions.onDelete(selected.id)} danger testId="element-delete">
              <IconTrash size={13} />
            </TabButton>
          </span>
          <TabButton
            label={`${label(selectedEntry?.element, selected)}: edit, or drag to move`}
            onPointerDown={(event) => actions.onBeginMove(event, selected.id)}
            onClick={() => (selected.type === "heading" || selected.type === "text" || selected.type === "button" ? actions.onEdit(selected.id) : actions.onSelect(selected.id))}
            testId="element-move"
            className="cursor-grab active:cursor-grabbing"
          >
            <IconPencil size={13} />
          </TabButton>
        </div>
      )}

      {selected && editing && richText && selected.type === "text" && (
        <RichTextToolbar rect={selected.rect} scale={scale} viewportWidth={store.get().viewport.width} state={richText.state} kit={richText.kit} onCommand={richText.onCommand} onDone={richText.onDone} fontSize={fontSize ?? undefined} />
      )}

      {selected && fontSize && !(editing && selected.type === "text") && <FontSizeStrip {...fontSize} {...stripPosition(selected)} />}

      {selected && selectedEntry && handleActions && canEdit && !editing && !drag && !isLocked(selectedEntry) && (
        <Handles
          selected={selected}
          element={selectedEntry.element}
          parent={parentRect}
          next={besideNext}
          scale={scale}
          device={device}
          actions={handleActions}
        />
      )}

      {selected && isLocked(selectedEntry) && !drag && (
        <span className="absolute flex h-6 items-center gap-1 rounded-sm bg-ink px-2 text-[11px] font-semibold text-white" style={{ left: selected.rect.x * scale, top: selected.rect.y * scale - 30 }}>
          <IconLock size={12} /> Locked by the agency
        </span>
      )}

      {/* Empty containers not selected: a quiet hint */}
      {canEdit &&
        !drag &&
        Array.from(rects.values())
          .filter((rect) => rect.empty && isContainerType(rect.type) && rect.id !== selectedId)
          .map((rect) => (
            <span key={`empty-${rect.id}`} className="absolute flex items-center justify-center text-[12px] font-medium text-muted" style={scaleRect(rect.inner ?? rect.rect, scale)}>
              <span className="pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-control border border-dashed border-line bg-white/80 px-2.5 hover:border-accent hover:text-accent" role="button" tabIndex={-1} onClick={() => actions.onAddInside(rect.id)}>
                <IconPlus size={13} /> Drag a widget here
              </span>
            </span>
          ))}

      {/* Between sections: the hover "+" */}
      {gap && canEdit && !editing && (
        <div className="pointer-events-none absolute flex items-center" style={{ left: gap.x * scale, top: gap.y * scale - 14, width: gap.width * scale, height: 28 }} data-testid="section-gap">
          <span className="h-px flex-1 border-t border-dashed border-accent" />
          <button type="button" onClick={() => actions.onAddSection(gap.index)} className="pointer-events-auto inline-flex h-7 items-center gap-1 rounded-full border border-accent bg-white px-2.5 text-[11px] font-semibold text-accent hover:bg-accent hover:text-accent-fg" data-testid="section-gap-add">
            <IconPlus size={12} /> Add section
          </button>
          <span className="h-px flex-1 border-t border-dashed border-accent" />
        </div>
      )}

      {/* Drag indicator: the container that would receive the drop, and the line or the filled inside */}
      {drag && drag.target && drag.target.indicator.kind === "line" && drag.target.parentId && rects.get(drag.target.parentId) && (
        <div className="absolute rounded-[3px] outline-dashed outline-1 outline-accent/60" data-testid="drop-parent" data-element-id={drag.target.parentId} style={scaleRect(rects.get(drag.target.parentId)!.rect, scale, 1)} />
      )}
      {drag && drag.target && drag.target.indicator.kind === "line" && (
        <div
          className="absolute rounded-full bg-accent shadow-[0_0_0_2px_rgba(255,255,255,0.9)]"
          data-testid="drop-line"
          style={
            drag.target.indicator.axis === "y"
              ? { left: drag.target.indicator.rect.x * scale, top: drag.target.indicator.rect.y * scale - 2, width: drag.target.indicator.rect.width * scale, height: 4 }
              : { left: drag.target.indicator.rect.x * scale - 2, top: drag.target.indicator.rect.y * scale, width: 4, height: drag.target.indicator.rect.height * scale }
          }
        />
      )}
      {drag && drag.target && drag.target.indicator.kind === "inside" && <div className="absolute rounded-[4px] bg-accent/15 outline outline-2 outline-dashed outline-accent" data-testid="drop-inside" style={scaleRect(drag.target.indicator.rect, scale)} />}
      {drag && drag.overCanvas && !drag.target && <div className="absolute inset-0 cursor-not-allowed bg-red/5" data-testid="drop-refused" />}

      {/* Changed dots on the canvas are drawn by the Navigator; here only the count for tests */}
      <span className="sr-only" data-testid="changed-count">
        {changedIds.size}
      </span>
    </div>
  );
}
