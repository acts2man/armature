/**
 * Everything drawn above the preview iframe for the engine: a thin hover outline with the
 * element's label, the selected element's outline and handle tab (a pencil for widgets,
 * add / grip / delete for containers, with parent, duplicate and delete on hover), the
 * "Shared" chip for elements inside a component used on several pages, the drop line or
 * filled container while dragging, the padding and margin handles, and the small
 * rich-text toolbar while a text element is edited in place. Modelled on
 * src/builder/ElementOverlays.tsx, driven by the bridge's rect map and node map.
 */
import { clsx } from "clsx";
import { useState, type ReactNode } from "react";
import type { Device, Element } from "../../shared/builder/index.ts";
import type { ElementRect, Rect, RichTextCommand, RichTextState } from "../../shared/visualProtocol.ts";
import { IconBold, IconCheck, IconCopy, IconGrip, IconItalic, IconLayers, IconLink, IconPencil, IconPlus, IconTrash } from "../../src/components/icons.tsx";
import { Handles, type HandleActions } from "../../src/builder/Handles.tsx";
import { useGeometry, type GeometryStore } from "../../src/visual/geometry.ts";
import type { ResolvedNode } from "../shared/types.ts";
import { labelFor } from "./nodes.ts";
import type { EngineNodeInfo } from "./useEngineBridge.ts";
import type { EngineDragState } from "./useEngineDrag.ts";

export type EngineElementActions = {
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onAddInside: (id: string) => void;
  onBeginMove: (event: React.PointerEvent, id: string) => void;
  onSelectParent: (id: string) => void;
};

const TAB = 24;
const scaleRect = (rect: Rect, scale: number, pad = 0) => ({ left: rect.x * scale - pad, top: rect.y * scale - pad, width: rect.width * scale + pad * 2, height: rect.height * scale + pad * 2 });
export const isContainerRect = (rect: Pick<ElementRect, "type"> | undefined): boolean => rect?.type === "container";

function TabButton({ label, onClick, onPointerDown, children, danger, testId, className }: { label: string; onClick?: () => void; onPointerDown?: (event: React.PointerEvent) => void; children: ReactNode; danger?: boolean; testId?: string; className?: string }) {
  return (
    <button type="button" title={label} aria-label={label} data-testid={testId} onClick={onClick} onPointerDown={onPointerDown} className={clsx("inline-flex h-6 w-6 items-center justify-center text-accent-fg", danger ? "hover:bg-red" : "hover:bg-white/20", className)}>
      {children}
    </button>
  );
}

const px = (value: number) => ({ value: Math.round(value), unit: "px" as const });

/** The Handles component reads a builder Element; this one carries only the measured boxes. */
export function syntheticElement(rect: ElementRect): Element {
  return {
    id: rect.id,
    type: isContainerRect(rect) ? "container" : "text",
    props: {},
    style: {},
    advanced: {
      padding: { top: px(rect.padding.top), right: px(rect.padding.right), bottom: px(rect.padding.bottom), left: px(rect.padding.left) },
      margin: { top: px(rect.margin.top), right: px(rect.margin.right), bottom: px(rect.margin.bottom), left: px(rect.margin.left) },
    },
    meta: { createdBy: "engine", updatedAt: "" },
  };
}

/** Keeps the page's selection: a press in the toolbar never moves focus out of the frame. */
const keep = (event: React.MouseEvent | React.PointerEvent) => event.preventDefault();

function RichToolbar({ rect, scale, viewportWidth, state, onCommand, onDone }: { rect: Rect; scale: number; viewportWidth: number; state: RichTextState | null; onCommand: (command: RichTextCommand, value?: string) => void; onDone: () => void }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");
  const top = rect.y * scale - 48;
  const left = Math.max(4, Math.min(rect.x * scale, viewportWidth * scale - 240));
  const tool = (label: string, active: boolean, onClick: () => void, icon: ReactNode, testId: string) => (
    <button type="button" title={label} aria-label={label} aria-pressed={active} data-testid={testId} onMouseDown={keep} onPointerDown={keep} onClick={onClick} className={clsx("inline-flex h-8 min-w-8 items-center justify-center rounded-sm px-1.5", active ? "bg-accent text-accent-fg" : "hover:bg-ink-2")}>
      {icon}
    </button>
  );
  return (
    <div className="pointer-events-auto absolute z-10 flex flex-col gap-1" style={{ left, top: top < 4 ? (rect.y + rect.height) * scale + 8 : top }} data-testid="engine-richtext-toolbar">
      <div role="toolbar" aria-label="Text formatting" className="toast-in flex h-10 items-center gap-0.5 rounded-[8px] bg-ink px-1 text-white shadow-dark">
        {tool("Bold", !!state?.bold, () => onCommand("bold"), <IconBold size={15} />, "rt-bold")}
        {tool("Italic", !!state?.italic, () => onCommand("italic"), <IconItalic size={15} />, "rt-italic")}
        {tool(state?.link ? `Link: ${state.link}` : "Add a link", !!state?.link || linkOpen, () => {
          setHref(state?.link ?? "");
          setLinkOpen((open) => !open);
        }, <IconLink size={15} />, "rt-link")}
        <span className="mx-0.5 h-5 w-px bg-ink-line" aria-hidden="true" />
        <button type="button" onMouseDown={keep} onPointerDown={keep} onClick={onDone} className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-white/10 px-2.5 text-[12px] font-semibold hover:bg-white/20" data-testid="rt-done">
          <IconCheck size={14} /> Done
        </button>
      </div>
      {linkOpen && (
        <form
          className="toast-in flex items-center gap-1.5 rounded-[8px] bg-ink p-1.5 shadow-dark"
          onSubmit={(event) => {
            event.preventDefault();
            onCommand("link", href.trim() || undefined);
            setLinkOpen(false);
          }}
        >
          <input value={href} onChange={(event) => setHref(event.target.value)} placeholder="https://… or /page" className="h-8 w-56 rounded-sm border-0 bg-ink-2 px-2 text-[12px] text-white placeholder:text-white/50" data-testid="rt-link-input" />
          <button type="submit" className="h-8 rounded-sm bg-accent px-2.5 text-[12px] font-semibold text-accent-fg">
            {href.trim() ? "Apply" : "Remove"}
          </button>
        </form>
      )}
    </div>
  );
}

export function EngineOverlays({
  store,
  scale,
  nodes,
  resolved,
  selectedId,
  device,
  editing,
  drag,
  actions,
  handleActions,
  richText,
}: {
  store: GeometryStore;
  scale: number;
  nodes: Record<string, EngineNodeInfo>;
  resolved: (id: string) => ResolvedNode | undefined;
  selectedId: string | null;
  device: Device;
  editing: boolean;
  drag: EngineDragState | null;
  actions: EngineElementActions;
  handleActions: HandleActions;
  richText: { state: RichTextState | null; onCommand: (command: RichTextCommand, value?: string) => void; onDone: () => void };
}) {
  const geometry = useGeometry(store);
  const rects = new Map(geometry.elements.map((element) => [element.id, element]));
  const hover = !drag && geometry.hoverElement && geometry.hoverElement !== selectedId ? rects.get(geometry.hoverElement) : undefined;
  const selected = selectedId ? rects.get(selectedId) : undefined;
  const selectedNode = selectedId ? resolved(selectedId) : undefined;
  const label = (rect: ElementRect) => labelFor(resolved(rect.id), rect, nodes[rect.id]);
  const depthOf = (rect: ElementRect) => {
    let depth = 0;
    let current = rect.parentId;
    while (current && depth < 12) {
      depth += 1;
      current = rects.get(current)?.parentId ?? null;
    }
    return depth;
  };
  const canMove = selectedNode ? selectedNode.structure.editable : true;
  const viewportWidth = geometry.viewport.width || 0;

  const widgetTabPosition = (rect: ElementRect) => {
    const top = rect.rect.y * scale - TAB - 1;
    return { right: Math.max(0, viewportWidth * scale - (rect.rect.x + rect.rect.width) * scale - 1), top: top < 2 ? rect.rect.y * scale + 2 : top };
  };
  const containerTabPosition = (rect: ElementRect, buttons: number) => {
    const width = buttons * TAB;
    const top = rect.rect.y * scale - TAB / 2;
    return { left: Math.max(2, (rect.rect.x + rect.rect.width / 2) * scale - width / 2 + depthOf(rect) * (TAB + 8)), top: top < 2 ? rect.rect.y * scale + 2 : top };
  };

  const dropParent = drag?.target ? rects.get(drag.target.parentId) : undefined;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" data-testid="engine-overlays">
      {hover && (
        <div className={clsx("absolute outline-1 outline-accent/70", isContainerRect(hover) ? "outline-dashed" : "outline")} style={scaleRect(hover.rect, scale, 1)} data-testid={`hover-${hover.id}`} data-kind={isContainerRect(hover) ? "container" : "widget"}>
          <span className={clsx("absolute left-0 flex h-5 max-w-64 items-center gap-1 truncate bg-accent/85 px-1.5 text-[11px] font-semibold text-accent-fg", hover.rect.y * scale < 22 ? "top-0" : "-top-[20px]")}>{label(hover)}</span>
        </div>
      )}

      {selected && (
        <div data-testid="element-selection" data-element-id={selected.id} data-kind={isContainerRect(selected) ? "container" : "widget"} className={clsx("absolute outline outline-[1.5px] outline-accent", editing && "outline-dashed")} style={scaleRect(selected.rect, scale, 1)}>
          {selected.empty && isContainerRect(selected) && !editing && (
            <div className="pointer-events-auto absolute inset-0 flex items-center justify-center">
              <button type="button" onClick={() => actions.onAddInside(selected.id)} className="inline-flex h-9 items-center gap-2 rounded-control border border-dashed border-accent bg-white/90 px-3 text-[12px] font-semibold text-accent hover:bg-white" data-testid="empty-container-add">
                <IconPlus size={14} /> Drag an element here
              </button>
            </div>
          )}
        </div>
      )}

      {selected && selectedNode?.shared && !editing && !drag && (
        <span className="absolute flex h-5 items-center gap-1 rounded-sm bg-ink px-1.5 text-[10px] font-semibold text-white" style={{ left: selected.rect.x * scale + 2, top: selected.rect.y * scale + selected.rect.height * scale + 4 }} data-testid="engine-shared-chip" title={`${selectedNode.shared.component} appears on: ${selectedNode.shared.usedIn.join(", ")}`}>
          <IconLayers size={11} /> Shared: used on {selectedNode.shared.usedIn.length === 1 ? "1 page" : `${selectedNode.shared.usedIn.length} pages`}
        </span>
      )}

      {selected && !editing && !drag && isContainerRect(selected) && (
        <div role="toolbar" aria-label={`${label(selected)} tools`} data-testid="element-toolbar" data-kind="container" className="group pointer-events-auto absolute flex items-center overflow-hidden rounded-[4px] bg-accent shadow-pop" style={containerTabPosition(selected, 3)}>
          <TabButton label="Add an element inside" onClick={() => actions.onAddInside(selected.id)} testId="element-add">
            <IconPlus size={14} />
          </TabButton>
          <TabButton label={canMove ? `${label(selected)}: drag to move` : `${label(selected)} cannot be moved`} onPointerDown={(event) => canMove && actions.onBeginMove(event, selected.id)} testId="element-move" className={canMove ? "cursor-grab active:cursor-grabbing" : "cursor-not-allowed opacity-60"}>
            <IconGrip size={14} />
          </TabButton>
          <TabButton label="Delete" onClick={() => actions.onDelete(selected.id)} danger testId="element-delete">
            <IconTrash size={13} />
          </TabButton>
          <span className="hidden items-center border-l border-white/30 group-hover:flex">
            {selected.parentId && (
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

      {selected && !editing && !drag && !isContainerRect(selected) && (
        <div role="toolbar" aria-label={`${label(selected)} tools`} data-testid="element-toolbar" data-kind="widget" className="group pointer-events-auto absolute flex items-center overflow-hidden rounded-[4px] bg-accent shadow-pop" style={widgetTabPosition(selected)}>
          <span className="hidden items-center border-r border-white/30 group-hover:flex">
            {selected.parentId && (
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
          <TabButton label={`${label(selected)}: edit, or drag to move`} onPointerDown={(event) => canMove && actions.onBeginMove(event, selected.id)} onClick={() => (selected.type === "image" ? actions.onSelect(selected.id) : actions.onEdit(selected.id))} testId="element-move" className={canMove ? "cursor-grab active:cursor-grabbing" : undefined}>
            <IconPencil size={13} />
          </TabButton>
        </div>
      )}

      {selected && editing && <RichToolbar rect={selected.rect} scale={scale} viewportWidth={viewportWidth} state={richText.state} onCommand={richText.onCommand} onDone={richText.onDone} />}

      {selected && !editing && !drag && <Handles selected={selected} element={syntheticElement(selected)} parent={selected.parentId ? rects.get(selected.parentId) : undefined} scale={scale} device={device} actions={handleActions} />}

      {/* Drag indicator: the container that would receive the drop, and the line or the filled inside */}
      {drag?.target && dropParent && drag.target.indicator.kind === "line" && <div className="absolute rounded-[3px] outline-dashed outline-1 outline-accent/60" data-testid="drop-parent" data-element-id={drag.target.parentId} style={scaleRect(dropParent.rect, scale, 1)} />}
      {drag?.target && drag.target.indicator.kind === "line" && (
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
      {drag?.target && drag.target.indicator.kind === "inside" && <div className="absolute rounded-[4px] bg-accent/15 outline outline-2 outline-dashed outline-accent" data-testid="drop-inside" style={scaleRect(drag.target.indicator.rect, scale)} />}
      {drag && drag.overCanvas && !drag.target && <div className="absolute inset-0 cursor-not-allowed bg-red/5" data-testid="drop-refused" />}
    </div>
  );
}
