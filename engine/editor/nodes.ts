/**
 * Small pure helpers around the bridge's element map and the server's resolved nodes:
 * friendly names, ancestor chains, location equality, and the computed-style parsing the
 * Style tab reads (pixels, colours as hex).
 */
import type { ElementRect } from "../../shared/visualProtocol.ts";
import type { Loc, NodeRef, ResolvedNode } from "../shared/types.ts";
import type { EngineNodeInfo } from "./useEngineBridge.ts";

export const locEquals = (a: Loc | null | undefined, b: Loc | null | undefined): boolean => !!a && !!b && a.file === b.file && a.line === b.line && a.col === b.col;

/** The NodeRef the server wants, without the DOM extras the bridge adds. */
export const refOf = (node: EngineNodeInfo): NodeRef => ({ loc: node.loc, usage: node.usage, indices: node.indices, ancestors: node.ancestors, component: node.component, tag: node.tag });

const TAG_NAMES: Record<string, string> = { h1: "Heading", h2: "Heading", h3: "Heading", h4: "Heading", h5: "Heading", h6: "Heading", p: "Text", span: "Text", li: "List item", ul: "List", ol: "List", img: "Picture", picture: "Picture", video: "Video", svg: "Icon", a: "Link", button: "Button", section: "Section", header: "Header", footer: "Footer", nav: "Navigation", main: "Main", article: "Article", aside: "Aside", form: "Form", input: "Field", textarea: "Field", label: "Label", blockquote: "Quote", table: "Table", div: "Box" };
const TYPE_NAMES: Record<string, string> = { heading: "Heading", text: "Text", image: "Picture", button: "Button", link: "Link", container: "Box", list: "List", item: "List item" };

/** A friendly name for an element before (or without) the server's own label. */
export function friendlyName(rect: Pick<ElementRect, "tag" | "type"> | undefined, node?: EngineNodeInfo | null): string {
  if (node?.component && rect?.type === "container" && node.usage && !node.loc) return node.component;
  const tag = rect?.tag ?? node?.tag ?? "";
  return TAG_NAMES[tag] ?? TYPE_NAMES[rect?.type ?? ""] ?? (tag ? tag.toUpperCase() : "Element");
}

/** The label shown for an element: the resolved label when known, else a friendly name. */
export const labelFor = (resolved: ResolvedNode | undefined | null, rect: ElementRect | undefined, node: EngineNodeInfo | undefined | null): string => resolved?.label || friendlyName(rect, node);

/** Ancestor ids from the outermost down to the element's parent, from the rect map's parentId links. */
export function ancestorChain(rects: Map<string, ElementRect>, id: string): string[] {
  const out: string[] = [];
  let current = rects.get(id)?.parentId ?? null;
  const seen = new Set<string>([id]);
  while (current && !seen.has(current) && out.length < 40) {
    seen.add(current);
    out.unshift(current);
    current = rects.get(current)?.parentId ?? null;
  }
  return out;
}

/** True when `id` is `ancestorId` or sits somewhere inside it. */
export const isWithin = (rects: Map<string, ElementRect>, id: string, ancestorId: string): boolean => id === ancestorId || ancestorChain(rects, id).includes(ancestorId);

/** The element whose source location (its own or its usage) is `loc`, after a hot reload moved things around. */
export function idForLoc(nodes: Record<string, EngineNodeInfo>, loc: Loc): string | null {
  for (const [id, node] of Object.entries(nodes)) if (locEquals(node.loc, loc)) return id;
  for (const [id, node] of Object.entries(nodes)) if (locEquals(node.usage, loc)) return id;
  return null;
}

// --- computed style ---------------------------------------------------------------------------

/** "12.5px" → 12.5; anything else → undefined. */
export function pxOf(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^(-?\d*\.?\d+)px$/.exec(value.trim());
  return match ? Math.round(Number(match[1]) * 100) / 100 : undefined;
}

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

/** "rgb(12, 34, 56)" or "rgba(12, 34, 56, 0.5)" → "#0c2238" (or with alpha, "#0c223880"). Transparent → undefined. */
export function colorToHex(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const text = value.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(text)) return text.toLowerCase();
  const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(text);
  if (!match) return text === "transparent" ? undefined : text;
  const alphaText = match[4];
  const alpha = alphaText === undefined ? 1 : alphaText.endsWith("%") ? Number(alphaText.slice(0, -1)) / 100 : Number(alphaText);
  if (alpha === 0) return undefined;
  const base = `#${hex2(Number(match[1]))}${hex2(Number(match[2]))}${hex2(Number(match[3]))}`;
  return alpha >= 1 ? base : `${base}${hex2(alpha * 255)}`;
}

/** Ids of the elements the server said changed, from a list of changed files. */
export const stylesheetsIn = (paths: string[]): string[] => paths.filter((path) => /\.(css|scss|sass|less)$/i.test(path));
