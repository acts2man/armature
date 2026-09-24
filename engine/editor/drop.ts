/**
 * Where a drag would land, from the bridge's rect map: the deepest container under the
 * pointer that the server says can receive children, and the index among that
 * container's tagged children from their midpoints (vertical in a column, horizontal
 * when the children sit side by side). Pure; the workspace supplies the resolved nodes.
 */
import type { ElementRect, Rect } from "../../shared/visualProtocol.ts";
import type { ResolvedNode } from "../shared/types.ts";
import { ancestorChain } from "./nodes.ts";

export type DropIndicator = { kind: "line"; rect: Rect; axis: "x" | "y"; edge: "before" | "after" } | { kind: "inside"; rect: Rect };

export type EngineDropTarget = {
  parentId: string;
  /** Position among the parent's tagged children (the moved element itself not counted). */
  index: number;
  indicator: DropIndicator;
  /** The sibling the line sits against, for the ghost label. */
  beside: { id: string; edge: "before" | "after" } | null;
};

export type DropInput = {
  elements: ElementRect[];
  x: number;
  y: number;
  /** The element being moved, if any: it and its descendants never receive the drop. */
  movingId?: string;
  /** The server's answer for an id, or undefined when it has not been asked yet. */
  resolved: (id: string) => ResolvedNode | undefined;
  /** Called for containers the pointer is over that have not been resolved yet. */
  requestResolve?: (id: string) => void;
};

const contains = (rect: Rect, x: number, y: number) => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;

/** Children lie in a row when the second starts to the right of the first and overlaps it vertically. */
function axisOf(children: ElementRect[]): "x" | "y" {
  const [first, second] = children;
  if (!first || !second) return "y";
  const beside = second.rect.x >= first.rect.x + first.rect.width - 2 && second.rect.y < first.rect.y + first.rect.height && second.rect.y + second.rect.height > first.rect.y;
  return beside ? "x" : "y";
}

export function findDropTarget(input: DropInput): EngineDropTarget | null {
  const rects = new Map(input.elements.map((element) => [element.id, element]));
  const moving = input.movingId;
  const excluded = (id: string) => !!moving && (id === moving || ancestorChain(rects, id).includes(moving));
  // Deepest first: the longest ancestor chain, then the smallest area.
  const under = input.elements
    .filter((element) => contains(element.rect, input.x, input.y) && !excluded(element.id))
    .map((element) => ({ element, depth: ancestorChain(rects, element.id).length, area: element.rect.width * element.rect.height }))
    .sort((a, b) => b.depth - a.depth || a.area - b.area);

  for (const { element } of under) {
    // Words, pictures and buttons never take a drop; only boxes (or empty elements) can hold something.
    if (element.type !== "container" && !element.empty) continue;
    const node = input.resolved(element.id);
    if (!node) {
      input.requestResolve?.(element.id);
      continue;
    }
    if (!node.structure.canReceiveChildren) continue;
    const children = input.elements.filter((child) => child.parentId === element.id && !excluded(child.id));
    if (children.length === 0) return { parentId: element.id, index: 0, indicator: { kind: "inside", rect: element.inner ?? element.rect }, beside: null };
    const axis = axisOf(children);
    const sorted = [...children].sort((a, b) => (axis === "y" ? a.rect.y - b.rect.y : a.rect.x - b.rect.x));
    let index = 0;
    for (const child of sorted) {
      const mid = axis === "y" ? child.rect.y + child.rect.height / 2 : child.rect.x + child.rect.width / 2;
      if ((axis === "y" ? input.y : input.x) > mid) index += 1;
      else break;
    }
    const before = sorted[index];
    const after = sorted[index - 1];
    const anchor = before ?? after;
    if (!anchor) return null;
    const edge: "before" | "after" = before ? "before" : "after";
    const r = anchor.rect;
    const rect: Rect = axis === "y" ? { x: r.x, y: edge === "before" ? r.y : r.y + r.height, width: r.width, height: 0 } : { x: edge === "before" ? r.x : r.x + r.width, y: r.y, width: 0, height: r.height };
    return { parentId: element.id, index, indicator: { kind: "line", rect, axis, edge }, beside: { id: anchor.id, edge } };
  }
  return null;
}
