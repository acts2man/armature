/**
 * Drag-and-drop hit testing against the rect map the kit reports. Pure geometry: given
 * the pointer in the frame's own pixels, find where a drop would land (a parent and an
 * index) and where to draw the indicator. Used for dragging from the Elements panel,
 * moving elements on the canvas, and the Navigator.
 */
import type { ElementRect, Rect } from "@shared/visualProtocol.ts";
import { canPlace, findElement, type BuilderState } from "./store.ts";

export type DropTarget = {
  slug: string;
  parentId: string | null;
  index: number;
  /** How to draw it: a line before/after a sibling, or a filled container. */
  indicator: { kind: "line"; rect: Rect; axis: "x" | "y"; edge: "before" | "after" } | { kind: "inside"; rect: Rect };
  /** The element the pointer is over, for labels. */
  overId: string | null;
};

const contains = (rect: Rect, x: number, y: number): boolean => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;

/** The flow axis of a container's children, from their rectangles (row when siblings sit side by side). */
export function flowAxis(children: ElementRect[]): "x" | "y" {
  if (children.length < 2) return "y";
  const [a, b] = children as [ElementRect, ElementRect];
  const horizontal = Math.abs(a.rect.y - b.rect.y) < Math.max(a.rect.height, b.rect.height) * 0.5 && b.rect.x >= a.rect.x + a.rect.width * 0.5;
  return horizontal ? "x" : "y";
}

function lineIndicator(child: ElementRect, axis: "x" | "y", edge: "before" | "after"): DropTarget["indicator"] {
  const { rect } = child;
  if (axis === "y") return { kind: "line", axis, edge, rect: { x: rect.x, y: edge === "before" ? rect.y : rect.y + rect.height, width: rect.width, height: 0 } };
  return { kind: "line", axis, edge, rect: { x: edge === "before" ? rect.x : rect.x + rect.width, y: rect.y, width: 0, height: rect.height } };
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
}): DropTarget | null {
  const { state, slug, x, y, movingId } = opts;
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
  // Deepest element under the pointer that is not the moving subtree.
  const movingAncestors = movingId ? new Set([movingId, ...(findElement(state, movingId, slug)?.element.children ?? []).map((child) => child.id)]) : new Set<string>();
  const isInsideMoving = (id: string): boolean => {
    let current: string | null = id;
    while (current) {
      if (current === movingId) return true;
      current = findElement(state, current, slug)?.parentId ?? null;
    }
    return false;
  };
  const under = opts.elements
    .filter((element) => element.page === slug && contains(element.rect, x, y) && !movingAncestors.has(element.id) && !isInsideMoving(element.id))
    .map((element) => ({ element, depth: findElement(state, element.id, slug)?.depth ?? 0 }))
    .sort((a, b) => b.depth - a.depth);

  const placeAmong = (parentId: string | null, over: ElementRect | null): DropTarget | null => {
    if (!canPlace(state, { slug, parentId }, movingId, opts.allowLocked)) return null;
    const siblings = childrenRects(parentId);
    const axis = flowAxis(siblings);
    if (siblings.length === 0) {
      const parent = parentId ? byId.get(parentId) : null;
      const rect = parent ? (parent.inner ?? parent.rect) : (opts.pageRect ?? { x, y, width: 0, height: 0 });
      return { slug, parentId, index: 0, indicator: { kind: "inside", rect }, overId: parentId };
    }
    let index = siblings.length;
    let target: ElementRect | null = null;
    let edge: "before" | "after" = "after";
    if (over) {
      const position = siblings.findIndex((sibling) => sibling.id === over.id);
      const midpoint = axis === "y" ? over.rect.y + over.rect.height / 2 : over.rect.x + over.rect.width / 2;
      const before = (axis === "y" ? y : x) < midpoint;
      index = before ? position : position + 1;
      target = over;
      edge = before ? "before" : "after";
    } else {
      for (let i = 0; i < siblings.length; i++) {
        const sibling = siblings[i] as ElementRect;
        const midpoint = axis === "y" ? sibling.rect.y + sibling.rect.height / 2 : sibling.rect.x + sibling.rect.width / 2;
        if ((axis === "y" ? y : x) < midpoint) {
          index = i;
          target = sibling;
          edge = "before";
          break;
        }
      }
      if (!target) {
        target = siblings[siblings.length - 1] as ElementRect;
        edge = "after";
      }
    }
    // The index counts positions in the full sibling list (the moving element included), the
    // way moveElement expects it; the rects above left the moving element out.
    if (movingId) {
      const moving = findElement(state, movingId, slug);
      if (moving && moving.parentId === parentId && moving.slug === slug && index >= moving.index) index += 1;
    }
    return { slug, parentId, index, indicator: lineIndicator(target, axis, edge), overId: over?.id ?? parentId };
  };

  const deepest = under[0]?.element ?? null;
  if (!deepest) return placeAmong(null, null);

  const entry = findElement(state, deepest.id, slug);
  if (!entry) return null;
  const isContainer = entry.element.type === "container" || entry.element.type === "grid";
  if (isContainer && canPlace(state, { slug, parentId: deepest.id }, movingId, opts.allowLocked)) {
    // Inside the container: over one of its children, in a gap, or in its padding.
    const child = under.find((candidate) => findElement(state, candidate.element.id, slug)?.parentId === deepest.id)?.element ?? null;
    // Near the container's own top or bottom edge (outside the inner box): before/after the container itself.
    const inner = deepest.inner ?? deepest.rect;
    const edgeBand = 12;
    if (!child && (y < inner.y - 0 && y < deepest.rect.y + edgeBand) && entry.parentId !== undefined) return placeAmong(entry.parentId, deepest);
    if (!child && (y > inner.y + inner.height && y > deepest.rect.y + deepest.rect.height - edgeBand)) return placeAmong(entry.parentId, deepest);
    return placeAmong(deepest.id, child);
  }
  // A widget (or a locked container): before or after it among its siblings.
  return placeAmong(entry.parentId, deepest);
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
