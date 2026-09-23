/**
 * Drag-and-drop hit testing against the rect map the kit reports. Pure geometry plus the
 * layout tree: given the pointer in the frame's own pixels, find where a drop would land
 * (a parent and an index) and where to draw the indicator. A drop can land between any
 * two siblings at any depth, before the first or after the last, and inside an empty or
 * nested container. The insertion edge follows the parent's flow — above or below in a
 * column, left or right in a row (reversed rows included), the nearest cell edge in a
 * grid — and the outer few pixels of a container mean "beside it", among its parent's
 * children. Used for dragging from the Elements panel and moving elements on the canvas.
 */
import { resolve, type Device, type Element } from "@shared/builder/index.ts";
import type { ElementRect, Rect } from "@shared/visualProtocol.ts";
import { canPlace, findElement, type BuilderState } from "./store.ts";
import { widgetLabel } from "./widgets/registry.ts";

export type DropTarget = {
  slug: string;
  parentId: string | null;
  index: number;
  /** How to draw it: a line before/after a sibling, or a filled container. */
  indicator: { kind: "line"; rect: Rect; axis: "x" | "y"; edge: "before" | "after" } | { kind: "inside"; rect: Rect };
  /** The element the pointer is over, for labels. */
  overId: string | null;
  /** The sibling the line sits against and which side, for the label ("before Heading"). */
  beside?: { id: string; edge: "before" | "after" };
};

/** How a parent lays its children out: a column, a row (maybe reversed) or a grid. */
export type Flow = { axis: "x" | "y"; reversed: boolean } | { axis: "grid" };

/** The outer band of a container, in frame pixels, that drops beside it rather than inside. */
export const EDGE_BAND = 8;

const contains = (rect: Rect, x: number, y: number): boolean => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;

/** The flow axis of a container's children, from their rectangles (row when siblings sit side by side). */
export function flowAxis(children: ElementRect[]): "x" | "y" {
  if (children.length < 2) return "y";
  const [a, b] = children as [ElementRect, ElementRect];
  const horizontal = Math.abs(a.rect.y - b.rect.y) < Math.max(a.rect.height, b.rect.height) * 0.5 && b.rect.x >= a.rect.x + a.rect.width * 0.5;
  return horizontal ? "x" : "y";
}

/** A parent's flow from the layout itself (its direction on this device), falling back to the rectangles. */
export function flowOf(parent: Element | undefined, siblings: ElementRect[], device: Device): Flow {
  if (parent?.type === "grid") return { axis: "grid" };
  if (parent?.type === "container") {
    const direction = resolve<string>((parent.props as { direction?: never }).direction, device) ?? "column";
    return { axis: direction.startsWith("row") ? "x" : "y", reversed: direction.endsWith("-reverse") };
  }
  return { axis: flowAxis(siblings), reversed: false };
}

function lineIndicator(child: ElementRect, axis: "x" | "y", side: "start" | "end", edge: "before" | "after"): DropTarget["indicator"] {
  const { rect } = child;
  if (axis === "y") return { kind: "line", axis, edge, rect: { x: rect.x, y: side === "start" ? rect.y : rect.y + rect.height, width: rect.width, height: 0 } };
  return { kind: "line", axis, edge, rect: { x: side === "start" ? rect.x : rect.x + rect.width, y: rect.y, width: 0, height: rect.height } };
}

/** The distance from a point to a rectangle (0 inside). */
const distance = (rect: Rect, x: number, y: number): number => Math.hypot(Math.max(rect.x - x, 0, x - (rect.x + rect.width)), Math.max(rect.y - y, 0, y - (rect.y + rect.height)));

/** The nearest of a rectangle's four edges to a point. */
function nearestEdge(rect: Rect, x: number, y: number): "left" | "right" | "top" | "bottom" {
  const edges: ["left" | "right" | "top" | "bottom", number][] = [
    ["left", Math.abs(x - rect.x)],
    ["right", Math.abs(rect.x + rect.width - x)],
    ["top", Math.abs(y - rect.y)],
    ["bottom", Math.abs(rect.y + rect.height - y)],
  ];
  edges.sort((a, b) => a[1] - b[1]);
  return (edges[0] as ["left", number])[0];
}

/**
 * Where a drop at (x, y) lands. `movingId` is the element being moved (never dropped into
 * itself). `page` bounds the root level. Returns null when nothing valid is under the pointer.
 */
export function hitTest(opts: {
  state: BuilderState;
  elements: ElementRect[];
  slug: string;
  x: number;
  y: number;
  movingId?: string;
  pageRect?: Rect;
  allowLocked?: boolean;
  /** The device being edited: a container's direction may differ per device. */
  device?: Device;
}): DropTarget | null {
  const { state, slug, x, y, movingId } = opts;
  const device = opts.device ?? "desktop";
  const layout = state.layouts[slug];
  if (!layout) return null;
  const byId = new Map(opts.elements.filter((element) => element.page === slug).map((element) => [element.id, element]));
  const childrenRects = (parentId: string | null): ElementRect[] => {
    const ids = parentId === null ? layout.root.map((element) => element.id) : (findElement(state, parentId, slug)?.element.children ?? []).map((element) => element.id);
    return ids.map((id) => byId.get(id)).filter((rect): rect is ElementRect => !!rect && rect.id !== movingId);
  };

  // Dropping an element onto itself means nothing: no target while the pointer is inside it.
  if (movingId) {
    const own = byId.get(movingId);
    if (own && contains(own.rect, x, y)) return null;
  }
  // Every element under the pointer that is not the moving subtree, deepest first.
  const isInsideMoving = (id: string): boolean => {
    let current: string | null = id;
    while (current) {
      if (current === movingId) return true;
      current = findElement(state, current, slug)?.parentId ?? null;
    }
    return false;
  };
  const under = opts.elements
    .filter((element) => element.page === slug && contains(element.rect, x, y) && !isInsideMoving(element.id))
    .map((element) => ({ element, depth: findElement(state, element.id, slug)?.depth ?? 0 }))
    .sort((a, b) => b.depth - a.depth);

  /** Among a parent's children: a line against the sibling the pointer is over (or nearest), or the empty inside. */
  const placeAmong = (parentId: string | null, over: ElementRect | null): DropTarget | null => {
    if (!canPlace(state, { slug, parentId }, movingId, opts.allowLocked)) return null;
    const siblings = childrenRects(parentId);
    const parent = parentId ? findElement(state, parentId, slug)?.element : undefined;
    if (siblings.length === 0) {
      const parentRect = parentId ? byId.get(parentId) : null;
      const rect = parentRect ? (parentRect.inner ?? parentRect.rect) : (opts.pageRect ?? { x, y, width: 0, height: 0 });
      return { slug, parentId, index: 0, indicator: { kind: "inside", rect }, overId: parentId };
    }
    const flow = flowOf(parent, siblings, device);
    // The sibling to measure against: the one under the pointer, else the nearest one.
    const target = over && siblings.some((sibling) => sibling.id === over.id) ? over : siblings.reduce((best, sibling) => (distance(sibling.rect, x, y) < distance(best.rect, x, y) ? sibling : best));
    const position = siblings.findIndex((sibling) => sibling.id === target.id);
    let axis: "x" | "y";
    let side: "start" | "end";
    let before: boolean;
    if (flow.axis === "grid") {
      // A grid: the nearest cell edge decides both the side and the axis of the line.
      const edge = nearestEdge(target.rect, x, y);
      axis = edge === "left" || edge === "right" ? "x" : "y";
      side = edge === "left" || edge === "top" ? "start" : "end";
      before = side === "start";
    } else {
      axis = flow.axis;
      const midpoint = axis === "y" ? target.rect.y + target.rect.height / 2 : target.rect.x + target.rect.width / 2;
      side = (axis === "y" ? y : x) < midpoint ? "start" : "end";
      // In a reversed row the first child sits at the end, so the visual side and the index flip.
      before = flow.reversed ? side === "end" : side === "start";
    }
    let index = before ? position : position + 1;
    // The index counts positions in the full sibling list (the moving element included), the
    // way moveElement expects it; the rects above left the moving element out.
    if (movingId) {
      const moving = findElement(state, movingId, slug);
      if (moving && moving.parentId === parentId && moving.slug === slug && index >= moving.index) index += 1;
    }
    return { slug, parentId, index, indicator: lineIndicator(target, axis, side, before ? "before" : "after"), overId: over?.id ?? parentId, beside: { id: target.id, edge: before ? "before" : "after" } };
  };

  const deepest = under[0]?.element ?? null;
  if (!deepest) return placeAmong(null, null);

  // The outer few pixels of a container mean "beside it": the nearest such container, deepest
  // first, on the edges its parent's flow uses (top/bottom in a column, left/right in a row, any
  // in a grid). Over one of its children the child's own before/after wins, unless the parent
  // flows the other way (a column in a row: its left and right edges are the only way between
  // the columns).
  for (const { element } of under) {
    const entry = findElement(state, element.id, slug);
    if (!entry || !(entry.element.type === "container" || entry.element.type === "grid")) continue;
    if (entry.parentId === undefined) continue;
    const parent = entry.parentId ? findElement(state, entry.parentId, slug)?.element : undefined;
    const flow = flowOf(parent, childrenRects(entry.parentId), device);
    const childUnder = under.some((candidate) => findElement(state, candidate.element.id, slug)?.parentId === element.id);
    if (childUnder && flowOf(entry.element, childrenRects(element.id), device).axis === flow.axis) continue;
    const { rect } = element;
    const nearTop = y - rect.y < EDGE_BAND;
    const nearBottom = rect.y + rect.height - y < EDGE_BAND;
    const nearLeft = x - rect.x < EDGE_BAND;
    const nearRight = rect.x + rect.width - x < EDGE_BAND;
    const beside = flow.axis === "grid" ? nearTop || nearBottom || nearLeft || nearRight : flow.axis === "y" ? nearTop || nearBottom : nearLeft || nearRight;
    if (beside) {
      const placed = placeAmong(entry.parentId, element);
      if (placed) return placed;
    }
  }

  const entry = findElement(state, deepest.id, slug);
  if (!entry) return null;
  const isContainer = entry.element.type === "container" || entry.element.type === "grid";
  if (isContainer && canPlace(state, { slug, parentId: deepest.id }, movingId, opts.allowLocked)) {
    // Inside the container: against one of its children, or in a gap (the nearest child decides).
    const child = under.find((candidate) => findElement(state, candidate.element.id, slug)?.parentId === deepest.id)?.element ?? null;
    return placeAmong(deepest.id, child);
  }
  // A widget (or a locked container): before or after it among its siblings.
  return placeAmong(entry.parentId, deepest);
}

/** What a drop would do, for the drag ghost: "into Container", "before Heading", "after Text Editor". */
export function dropLabel(state: BuilderState, target: DropTarget): string {
  const name = (id: string | null): string => {
    if (id === null) return "the page";
    const element = findElement(state, id, target.slug)?.element;
    return element?.label || widgetLabel(element?.type ?? "");
  };
  if (target.indicator.kind === "inside") return `into ${name(target.parentId)}`;
  if (target.beside) return `${target.beside.edge} ${name(target.beside.id)}`;
  return `into ${name(target.parentId)}`;
}

/** The gap between two root-level sections nearest the pointer, for the hover "+" (null when not near one). */
export function sectionGapAt(elements: ElementRect[], slug: string, rootIds: string[], y: number, band = 14): { index: number; y: number; x: number; width: number } | null {
  const rects = rootIds.map((id) => elements.find((element) => element.id === id && element.page === slug)).filter((rect): rect is ElementRect => !!rect);
  for (let i = 0; i <= rects.length; i++) {
    const above = rects[i - 1];
    const below = rects[i];
    const line = below ? below.rect.y : above ? above.rect.y + above.rect.height : null;
    if (line === null) continue;
    if (Math.abs(y - line) <= band) {
      const reference = below ?? above;
      if (!reference) continue;
      return { index: i, y: line, x: reference.rect.x, width: reference.rect.width };
    }
  }
  return null;
}
