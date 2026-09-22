/**
 * Three-way merges for the builder publish: when the branch moved while someone was
 * editing, their changes (base -> mine) are replayed onto what is committed now
 * (theirs). Layouts merge per element: an element either side changed alone takes that
 * side's version; when both sides changed the same element, it is a conflict the person
 * resolves ("mine" or "theirs"). The site kit and media metadata merge per value.
 *
 * Pure and dependency-free: the editor, the publish function and the tests share it.
 */
import type { Element, LayoutDoc } from "../../kit/types.ts";

export type Resolution = "mine" | "theirs";
export type MergeConflict = {
  /** `layout:<slug>:<elementId>`, `layout:<slug>` (the page itself), or `kit:<path>` / `media:<path>`. */
  key: string;
  page?: string;
  elementId?: string;
  /** Plain words for the person choosing. */
  label: string;
};

type Node = { element: Omit<Element, "children">; parent: string | null };
type Tree = { nodes: Map<string, Node>; children: Map<string | null, string[]> };

const ROOT = null;

function flatten(root: Element[]): Tree {
  const nodes = new Map<string, Node>();
  const children = new Map<string | null, string[]>();
  const walk = (elements: Element[], parent: string | null) => {
    children.set(parent, elements.map((element) => element.id));
    for (const element of elements) {
      const { children: kids, ...rest } = element;
      nodes.set(element.id, { element: rest, parent });
      if (kids) walk(kids, element.id);
    }
  };
  walk(root, ROOT);
  return { nodes, children };
}

function rebuild(tree: Tree, parent: string | null = ROOT, seen = new Set<string>()): Element[] {
  const out: Element[] = [];
  for (const id of tree.children.get(parent) ?? []) {
    const node = tree.nodes.get(id);
    if (!node || seen.has(id)) continue;
    seen.add(id);
    const kids = tree.children.get(id);
    out.push(kids !== undefined ? { ...node.element, children: rebuild(tree, id, seen) } : { ...node.element });
  }
  return out;
}

/** What an element is, apart from its place and its bookkeeping. */
const body = (node: Node | undefined): string => {
  if (!node) return "";
  const { meta: _meta, ...rest } = node.element;
  return stableJson(rest);
};

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as object)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** An element's place: its parent and the ids just before it among siblings that both versions share. */
function place(tree: Tree, id: string, shared: Set<string>): string {
  const node = tree.nodes.get(id);
  if (!node) return "";
  const siblings = (tree.children.get(node.parent) ?? []).filter((sibling) => shared.has(sibling));
  const index = siblings.indexOf(id);
  return `${node.parent ?? "root"}|${siblings[index - 1] ?? "^"}|${siblings[index + 1] ?? "$"}`;
}

type Change = "added" | "removed" | "edited" | "moved" | "edited+moved";

function changes(base: Tree, side: Tree): Map<string, Change> {
  const out = new Map<string, Change>();
  const shared = new Set([...base.nodes.keys()].filter((id) => side.nodes.has(id)));
  for (const id of side.nodes.keys()) if (!base.nodes.has(id)) out.set(id, "added");
  for (const id of base.nodes.keys()) {
    if (!side.nodes.has(id)) {
      out.set(id, "removed");
      continue;
    }
    const edited = body(base.nodes.get(id)) !== body(side.nodes.get(id));
    const moved = place(base, id, shared) !== place(side, id, shared);
    if (edited && moved) out.set(id, "edited+moved");
    else if (edited) out.set(id, "edited");
    else if (moved) out.set(id, "moved");
  }
  return out;
}

const describe = (node: Node | undefined): string => {
  if (!node) return "an element";
  const element = node.element;
  const name = element.label || element.type.replace(/-/g, " ");
  const text = typeof element.props["text"] === "string" ? element.props["text"] : typeof element.props["title"] === "string" ? element.props["title"] : "";
  return text ? `${name} "${String(text).slice(0, 40)}"` : name;
};

const isAncestor = (tree: Tree, maybeAncestor: string, id: string | null): boolean => {
  let current = id;
  const guard = new Set<string>();
  while (current !== null && current !== undefined) {
    if (current === maybeAncestor) return true;
    if (guard.has(current)) return false;
    guard.add(current);
    current = tree.nodes.get(current)?.parent ?? null;
  }
  return false;
};

/** Put `id` into `parent`'s children in `tree`, after the sibling it follows in `source` (when that sibling is there). */
function placeLike(tree: Tree, source: Tree, id: string): void {
  const node = source.nodes.get(id);
  if (!node) return;
  const parent = tree.nodes.has(node.parent ?? "") || node.parent === ROOT ? node.parent : ROOT;
  const siblings = tree.children.get(parent) ?? [];
  const without = siblings.filter((sibling) => sibling !== id);
  const sourceSiblings = source.children.get(node.parent) ?? [];
  const before = sourceSiblings.slice(0, sourceSiblings.indexOf(id)).reverse().find((sibling) => without.includes(sibling));
  const at = before === undefined ? 0 : without.indexOf(before) + 1;
  without.splice(at, 0, id);
  tree.children.set(parent, without);
  const target = tree.nodes.get(id);
  if (target) target.parent = parent;
}

function detach(tree: Tree, id: string): void {
  const node = tree.nodes.get(id);
  if (!node) return;
  tree.children.set(node.parent, (tree.children.get(node.parent) ?? []).filter((sibling) => sibling !== id));
}

export type LayoutMerge = { layout: LayoutDoc; conflicts: MergeConflict[] };

/**
 * Replay base -> mine onto theirs. Conflicts are left as theirs unless `resolutions`
 * says "mine" for that key; the returned conflicts are only the unresolved ones.
 */
export function mergeLayouts(base: LayoutDoc | null, mine: LayoutDoc, theirs: LayoutDoc | null, resolutions: Record<string, Resolution> = {}): LayoutMerge {
  const slug = mine.pageSlug;
  if (!theirs) {
    // The page was deleted since the draft began (or never existed): mine stands, unless it existed at base.
    if (base) {
      const key = `layout:${slug}`;
      if (resolutions[key] === "mine") return { layout: mine, conflicts: [] };
      return { layout: mine, conflicts: resolutions[key] === "theirs" ? [] : [{ key, page: slug, label: `The page "${mine.label ?? slug}" was deleted by someone else` }] };
    }
    return { layout: mine, conflicts: [] };
  }
  if (!base) {
    // Both created a page with this slug.
    const key = `layout:${slug}`;
    if (stableJson(mine.root) === stableJson(theirs.root) || resolutions[key] === "mine") return { layout: mine, conflicts: [] };
    if (resolutions[key] === "theirs") return { layout: theirs, conflicts: [] };
    return { layout: mine, conflicts: [{ key, page: slug, label: `Someone else also created the page "${theirs.label ?? slug}"` }] };
  }

  const b = flatten(base.root);
  const m = flatten(mine.root);
  const t = flatten(theirs.root);
  const mineChanges = changes(b, m);
  const theirChanges = changes(b, t);
  const conflicts: MergeConflict[] = [];

  // Start from theirs and replay mine.
  const out: Tree = { nodes: new Map([...t.nodes].map(([id, node]) => [id, { element: node.element, parent: node.parent }])), children: new Map([...t.children].map(([parent, ids]) => [parent, [...ids]])) };

  const conflict = (id: string, label: string): boolean => {
    const key = `layout:${slug}:${id}`;
    const choice = resolutions[key];
    if (choice === "mine") return true;
    if (choice !== "theirs") conflicts.push({ key, page: slug, elementId: id, label });
    return false;
  };

  // 1. Additions first (so moved or edited children can land inside new containers).
  const added = [...mineChanges].filter(([, change]) => change === "added").map(([id]) => id);
  // Parents before children: order by depth in mine.
  const depth = (tree: Tree, id: string) => {
    let d = 0;
    let current = tree.nodes.get(id)?.parent ?? null;
    while (current !== null && d < 50) {
      d += 1;
      current = tree.nodes.get(current)?.parent ?? null;
    }
    return d;
  };
  added.sort((a, c) => depth(m, a) - depth(m, c));
  for (const id of added) {
    const node = m.nodes.get(id);
    if (!node) continue;
    if (out.nodes.has(id)) continue;
    const parent = node.parent;
    if (parent !== ROOT && !out.nodes.has(parent)) {
      // Its container is gone on their side.
      if (!conflict(id, `${describe(node)} was added inside ${describe(b.nodes.get(parent) ?? m.nodes.get(parent))}, which someone else removed`)) continue;
      const restored = m.nodes.get(parent);
      if (restored && !out.nodes.has(parent)) {
        out.nodes.set(parent, { element: restored.element, parent: restored.parent });
        if (!out.children.has(parent)) out.children.set(parent, []);
        placeLike(out, m, parent);
      }
    }
    out.nodes.set(id, { element: node.element, parent });
    if (m.children.has(id) && !out.children.has(id)) out.children.set(id, []);
    placeLike(out, m, id);
  }

  // 2. Edits, moves and removals of elements that already existed.
  for (const [id, change] of mineChanges) {
    if (change === "added") continue;
    const theirs = theirChanges.get(id);
    const baseNode = b.nodes.get(id);
    const mineNode = m.nodes.get(id);
    if (change === "removed") {
      if (theirs && theirs !== "moved") {
        if (!conflict(id, `You deleted ${describe(baseNode)}; someone else changed it`)) continue;
      }
      // Remove it and everything inside it.
      const drop = (target: string) => {
        for (const child of out.children.get(target) ?? []) drop(child);
        detach(out, target);
        out.nodes.delete(target);
        out.children.delete(target);
      };
      if (out.nodes.has(id)) drop(id);
      continue;
    }
    if (!mineNode) continue;
    const edited = change === "edited" || change === "edited+moved";
    const moved = change === "moved" || change === "edited+moved";
    if (theirs === "removed") {
      if (!conflict(id, `You changed ${describe(mineNode)}; someone else deleted it`)) continue;
      out.nodes.set(id, { element: mineNode.element, parent: mineNode.parent });
      if (m.children.has(id) && !out.children.has(id)) out.children.set(id, []);
      placeLike(out, m, id);
      continue;
    }
    const theyEdited = theirs === "edited" || theirs === "edited+moved";
    const theyMoved = theirs === "moved" || theirs === "edited+moved";
    const current = out.nodes.get(id);
    if (!current) continue;
    if (edited) {
      const sameEdit = body(mineNode) === body(t.nodes.get(id));
      if (theyEdited && !sameEdit) {
        if (conflict(id, `Both you and someone else changed ${describe(mineNode)}`)) current.element = mineNode.element;
      } else {
        current.element = mineNode.element;
      }
    }
    if (moved) {
      const target = mineNode.parent;
      if (target !== ROOT && (!out.nodes.has(target) || isAncestor(out, id, target))) continue;
      if (theyMoved && place(m, id, new Set(m.nodes.keys())) !== place(t, id, new Set(t.nodes.keys()))) {
        if (!conflict(id, `Both you and someone else moved ${describe(mineNode)}`)) continue;
      }
      detach(out, id);
      current.parent = target;
      placeLike(out, m, id);
    }
  }

  const layout: LayoutDoc = { ...theirs, ...pageFields(base, mine), root: rebuild(out) };
  return { layout, conflicts };
}

/** The page's own settings (label, path, SEO, page settings): the ones I changed win, the rest stay theirs. */
function pageFields(base: LayoutDoc, mine: LayoutDoc): Partial<LayoutDoc> {
  const out: Record<string, unknown> = {};
  for (const key of ["label", "path", "seo", "pageSettings"] as const) {
    if (stableJson(base[key]) !== stableJson(mine[key])) out[key] = mine[key];
  }
  return out as Partial<LayoutDoc>;
}

/** Leaf paths of a JSON value ("colors.primary", "fonts.custom"); arrays are leaves. */
function leaves(value: unknown, prefix = "", out = new Map<string, unknown>()): Map<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0 && prefix) out.set(prefix, value);
    for (const [key, inner] of entries) leaves(inner, prefix ? `${prefix}.${key}` : key, out);
    return out;
  }
  if (prefix) out.set(prefix, value);
  return out;
}

function setLeaf(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current = target;
  for (const part of parts.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== "object" || Array.isArray(current[part])) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1] ?? "";
  if (value === undefined) delete current[last];
  else current[last] = value;
}

/** Merge two edits of one JSON document (the site kit, media metadata) value by value. */
export function mergeValues<T>(prefix: "kit" | "media", base: T | null, mine: T, theirs: T | null, resolutions: Record<string, Resolution> = {}, label: (path: string) => string = (path) => path): { value: T; conflicts: MergeConflict[] } {
  if (!theirs || !base) return { value: mine, conflicts: [] };
  const b = leaves(base);
  const m = leaves(mine);
  const t = leaves(theirs);
  const out = JSON.parse(JSON.stringify(theirs)) as Record<string, unknown>;
  const conflicts: MergeConflict[] = [];
  const paths = new Set([...b.keys(), ...m.keys()]);
  for (const path of paths) {
    const mineValue = m.get(path);
    const baseValue = b.get(path);
    if (stableJson(mineValue) === stableJson(baseValue)) continue;
    const theirValue = t.get(path);
    const theyChanged = stableJson(theirValue) !== stableJson(baseValue);
    if (theyChanged && stableJson(theirValue) !== stableJson(mineValue)) {
      const key = `${prefix}:${path}`;
      if (resolutions[key] === "mine") setLeaf(out, path, mineValue);
      else if (resolutions[key] !== "theirs") conflicts.push({ key, label: label(path) });
      continue;
    }
    setLeaf(out, path, mineValue);
  }
  return { value: out as T, conflicts };
}
