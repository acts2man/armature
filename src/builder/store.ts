/**
 * The page builder's editor state and its commands. Pure module (no React, no DOM), so
 * every command is unit-tested.
 *
 * The state is the draft of the whole site: every layout (as trees, the same shape the
 * kit renders and the repository stores), the pages deleted in the draft, and the site
 * kit. A memoized index (element id → element, parent, position, page) gives the
 * by-id access the canvas and the Navigator need; it is rebuilt lazily per layout
 * object, so an unchanged page costs nothing. Every command returns a new state and
 * never mutates; unchanged branches are shared.
 */
import type { MediaMeta } from "@shared/publishTypes.ts";
import { CONTAINER_TYPES, newElementId, withFreshIds, type Advanced, type Element, type LayoutDoc, type SiteKit, type Style } from "@shared/builder/index.ts";
import { deepEqual } from "@shared/contentFile.ts";
import type { SlotInfo } from "@shared/visualProtocol.ts";
import { CHROME_SLUGS } from "@kit/types.ts";

export type BuilderState = {
  layouts: Record<string, LayoutDoc>;
  /** Builder pages removed in the draft (their layout file is deleted on publish). */
  deletedPages: string[];
  kit: SiteKit;
  /** Alt text per picture (content/media.json), used as the default when a picture is inserted. */
  media?: MediaMeta;
};

/** Where an element sits: its parent element id, or the page root. */
export type ParentKey = { slug: string; parentId: string | null };

export type IndexEntry = {
  element: Element;
  slug: string;
  parentId: string | null;
  /** Position among its siblings. */
  index: number;
  depth: number;
  /** Ids from the root down to (excluding) this element. */
  ancestors: string[];
};

export const isContainerType = (type: string): boolean => CONTAINER_TYPES.includes(type);

// --- the index -----------------------------------------------------------------------------

const indexCache = new WeakMap<LayoutDoc, Map<string, IndexEntry>>();

export function indexLayout(layout: LayoutDoc): Map<string, IndexEntry> {
  const cached = indexCache.get(layout);
  if (cached) return cached;
  const map = new Map<string, IndexEntry>();
  const walk = (elements: Element[], parentId: string | null, depth: number, ancestors: string[]) => {
    elements.forEach((element, index) => {
      map.set(element.id, { element, slug: layout.pageSlug, parentId, index, depth, ancestors });
      if (element.children) walk(element.children, element.id, depth + 1, [...ancestors, element.id]);
    });
  };
  walk(layout.root, null, 0, []);
  indexCache.set(layout, map);
  return map;
}

/** Find an element anywhere in the draft (the page is usually known; pass it to skip the search). */
/**
 * The layout that holds an element: the page's own, else a chrome part shown with it (the
 * header or footer built in the editor), so clicking the header on any page edits the header.
 */
export function ownerSlug(state: BuilderState, id: string, slug: string): string {
  const own = state.layouts[slug];
  if (own && indexLayout(own).has(id)) return slug;
  for (const chrome of CHROME_SLUGS) {
    const layout = state.layouts[chrome];
    if (layout && indexLayout(layout).has(id)) return chrome;
  }
  return slug;
}

/** A placement's real layout: the parent's owner when there is a parent, else the given slug. */
const resolveKey = (state: BuilderState, key: ParentKey): ParentKey => (key.parentId === null ? key : { ...key, slug: ownerSlug(state, key.parentId, key.slug) });

export function findElement(state: BuilderState, id: string, slug?: string): IndexEntry | undefined {
  if (slug) {
    const layout = state.layouts[ownerSlug(state, id, slug)];
    return layout ? indexLayout(layout).get(id) : undefined;
  }
  for (const layout of Object.values(state.layouts)) {
    const entry = indexLayout(layout).get(id);
    if (entry) return entry;
  }
  return undefined;
}

export const childrenOf = (state: BuilderState, rawKey: ParentKey): Element[] => {
  const key = resolveKey(state, rawKey);
  const layout = state.layouts[key.slug];
  if (!layout) return [];
  if (key.parentId === null) return layout.root;
  return indexLayout(layout).get(key.parentId)?.element.children ?? [];
};

/** The subtree rooted at an element, as a detached copy-free reference. */
export const subtreeIds = (element: Element): string[] => [element.id, ...(element.children ?? []).flatMap(subtreeIds)];

export const countElements = (elements: Element[]): number => elements.reduce((sum, element) => sum + 1 + countElements(element.children ?? []), 0);

// --- tree surgery (immutable) -------------------------------------------------------------------

function mapTree(elements: Element[], fn: (element: Element) => Element | null): Element[] {
  const out: Element[] = [];
  for (const element of elements) {
    const next = fn(element);
    if (next === null) continue;
    if (next.children) {
      const children = mapTree(next.children, fn);
      out.push(children === next.children ? next : { ...next, children });
    } else {
      out.push(next);
    }
  }
  return out;
}

function insertInto(elements: Element[], parentId: string | null, index: number, inserted: Element[]): Element[] {
  if (parentId === null) {
    const at = Math.max(0, Math.min(index, elements.length));
    return [...elements.slice(0, at), ...inserted, ...elements.slice(at)];
  }
  return elements.map((element) => {
    if (element.id === parentId) {
      const children = element.children ?? [];
      const at = Math.max(0, Math.min(index, children.length));
      return { ...element, children: [...children.slice(0, at), ...inserted, ...children.slice(at)] };
    }
    if (element.children) {
      const children = insertInto(element.children, parentId, index, inserted);
      return children === element.children ? element : { ...element, children };
    }
    return element;
  });
}

function removeFrom(elements: Element[], id: string): Element[] {
  return mapTree(elements, (element) => (element.id === id ? null : element));
}

function withLayout(state: BuilderState, slug: string, root: Element[]): BuilderState {
  const layout = state.layouts[slug];
  if (!layout || layout.root === root) return state;
  return { ...state, layouts: { ...state.layouts, [slug]: { ...layout, root } } };
}

const stamp = (element: Element, by: string): Element => ({ ...element, meta: { createdBy: element.meta?.createdBy ?? by, updatedAt: new Date().toISOString() } });

// --- commands -------------------------------------------------------------------------------------

export type Placement = ParentKey & { index: number };

/** Can `element` (or a fresh tree) be placed under this parent? Containers only, never inside themselves, never inside a locked element. */
export function canPlace(state: BuilderState, rawKey: ParentKey, movingId?: string, allowLocked = false): boolean {
  const key = resolveKey(state, rawKey);
  const layout = state.layouts[key.slug];
  if (!layout) return false;
  if (key.parentId === null) return true;
  const parent = indexLayout(layout).get(key.parentId);
  if (!parent || !isContainerType(parent.element.type)) return false;
  if (!allowLocked && (parent.element.locked || parent.ancestors.some((ancestor) => indexLayout(layout).get(ancestor)?.element.locked))) return false;
  if (movingId && (movingId === key.parentId || parent.ancestors.includes(movingId))) return false;
  return true;
}

export function insertElement(state: BuilderState, element: Element, rawAt: Placement, by = "editor"): BuilderState | null {
  const at = { ...rawAt, ...resolveKey(state, rawAt) };
  if (!canPlace(state, at)) return null;
  const layout = state.layouts[at.slug];
  if (!layout) return null;
  const root = insertInto(layout.root, at.parentId, at.index, [stamp(element, by)]);
  return withLayout(state, at.slug, root);
}

export function removeElement(state: BuilderState, id: string, rawSlug: string): BuilderState | null {
  const slug = ownerSlug(state, id, rawSlug);
  const layout = state.layouts[slug];
  if (!layout || !indexLayout(layout).has(id)) return null;
  return withLayout(state, slug, removeFrom(layout.root, id));
}

/** Move an element within its page or to another page. `at.index` counts positions before the move. */
export function moveElement(state: BuilderState, id: string, rawFrom: string, rawAt: Placement, allowLocked = false): BuilderState | null {
  const from = ownerSlug(state, id, rawFrom);
  const at = { ...rawAt, ...resolveKey(state, rawAt) };
  const source = state.layouts[from];
  const entry = source ? indexLayout(source).get(id) : undefined;
  if (!source || !entry) return null;
  if (!canPlace(state, at, id, allowLocked)) return null;
  let index = at.index;
  if (at.slug === from && at.parentId === entry.parentId && entry.index < index) index -= 1;
  if (at.slug === from && at.parentId === entry.parentId && index === entry.index) return null;
  let next = withLayout(state, from, removeFrom(source.root, id));
  const target = next.layouts[at.slug];
  if (!target) return null;
  next = withLayout(next, at.slug, insertInto(target.root, at.parentId, index, [entry.element]));
  return next;
}

export function updateElement(state: BuilderState, id: string, rawSlug: string, update: (element: Element) => Element, by = "editor"): BuilderState | null {
  const slug = ownerSlug(state, id, rawSlug);
  const layout = state.layouts[slug];
  if (!layout || !indexLayout(layout).has(id)) return null;
  let changed = false;
  const root = mapTree(layout.root, (element) => {
    if (element.id !== id) return element;
    const next = update(element);
    if (next === element) return element;
    changed = true;
    return stamp(next, by);
  });
  return changed ? withLayout(state, slug, root) : null;
}

/** Set a nested value immutably: path ["style", "color"] or ["props", "gap", "column"]. `undefined` deletes the key. */
export function setPath<T extends object>(target: T, path: readonly string[], value: unknown, depth = 0): T {
  if (path.length === 0) return value as T;
  const [head, ...rest] = path as [string, ...string[]];
  const record = target as unknown as Record<string, unknown>;
  const current = record[head];
  if (rest.length === 0) {
    if (value === undefined) {
      if (!(head in record)) return target;
      const copy = { ...record };
      delete copy[head];
      return copy as unknown as T;
    }
    if (deepEqual(current, value)) return target;
    return { ...record, [head]: value } as unknown as T;
  }
  const child = current && typeof current === "object" && !Array.isArray(current) ? (current as Record<string, unknown>) : {};
  const nextChild = setPath(child, rest, value, depth + 1);
  if (nextChild === child && head in record) return target;
  // Drop empty objects left behind by a delete so the file stays tidy (never the top-level
  // keys such as "style" and "props", which every element carries).
  if (value === undefined && depth > 0 && Object.keys(nextChild).length === 0) {
    if (!(head in record)) return target;
    const copy = { ...record };
    delete copy[head];
    return copy as unknown as T;
  }
  return { ...record, [head]: nextChild } as unknown as T;
}

export const setElementPath = (state: BuilderState, id: string, slug: string, path: readonly string[], value: unknown): BuilderState | null =>
  updateElement(state, id, slug, (element) => setPath(element, path, value));

export function duplicateElement(state: BuilderState, id: string, rawSlug: string): { state: BuilderState; newId: string } | null {
  const slug = ownerSlug(state, id, rawSlug);
  const layout = state.layouts[slug];
  const entry = layout ? indexLayout(layout).get(id) : undefined;
  if (!layout || !entry) return null;
  const copy = withFreshIds(entry.element);
  const next = withLayout(state, slug, insertInto(layout.root, entry.parentId, entry.index + 1, [stamp(copy, "editor")]));
  return { state: next, newId: copy.id };
}

export function setKit(state: BuilderState, kit: SiteKit): BuilderState {
  return deepEqual(kit, state.kit) ? state : { ...state, kit };
}

export const setKitPath = (state: BuilderState, path: readonly string[], value: unknown): BuilderState => setKit(state, setPath(state.kit, path, value));

/** Replace a page's layout wholesale (revision restore, page settings). */
export function setLayout(state: BuilderState, layout: LayoutDoc): BuilderState {
  if (deepEqual(state.layouts[layout.pageSlug], layout)) return state;
  return { ...state, layouts: { ...state.layouts, [layout.pageSlug]: layout }, deletedPages: state.deletedPages.filter((slug) => slug !== layout.pageSlug) };
}

export function deletePage(state: BuilderState, slug: string): BuilderState | null {
  if (!state.layouts[slug]) return null;
  const layouts = { ...state.layouts };
  delete layouts[slug];
  return { ...state, layouts, deletedPages: state.deletedPages.includes(slug) ? state.deletedPages : [...state.deletedPages, slug] };
}

// --- seeding a coded page from its slot ---------------------------------------------------------------

/** A stable id for a site section on a page, so seeding is deterministic across sessions. */
export function stableId(seed: string): string {
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  let out = "";
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let value = hash;
  for (let i = 0; i < 8; i++) {
    out += alphabet[value % alphabet.length];
    value = Math.floor(value / alphabet.length) + (i * 7919 + hash % 97);
  }
  return out;
}

/** A layout for a coded page that has none yet: one site-section element per default. */
export function seedLayout(slot: SlotInfo, path: string, by = "editor"): LayoutDoc {
  const now = new Date().toISOString();
  return {
    version: 1,
    pageSlug: slot.slug,
    path,
    root: slot.defaults.map((key) => ({ id: stableId(`${slot.slug}:${key}`), type: "site-section", props: { key }, style: {}, advanced: {}, meta: { createdBy: by, updatedAt: now } })),
  };
}

// --- element factory -------------------------------------------------------------------------------------

export function createElement(type: string, props: Record<string, unknown>, extra: { style?: Style; advanced?: Advanced; children?: Element[]; label?: string } = {}, by = "editor"): Element {
  const element: Element = { id: newElementId(), type, props, style: extra.style ?? {}, advanced: extra.advanced ?? {}, meta: { createdBy: by, updatedAt: new Date().toISOString() } };
  if (extra.children) element.children = extra.children;
  if (extra.label) element.label = extra.label;
  return element;
}

// --- comparing with what is published ---------------------------------------------------------------------

export type BuilderBaseline = { layouts: Record<string, LayoutDoc>; kit: SiteKit; media?: MediaMeta };

/** Pages whose layout differs from the published one (or is new), plus deleted pages and the kit. */
export function changedPages(state: BuilderState, baseline: BuilderBaseline): { slug: string; kind: "changed" | "new" | "deleted" }[] {
  const out: { slug: string; kind: "changed" | "new" | "deleted" }[] = [];
  for (const [slug, layout] of Object.entries(state.layouts)) {
    const published = baseline.layouts[slug];
    if (!published) {
      if (!isSeedOnly(layout)) out.push({ slug, kind: "new" });
    } else if (!deepEqual(stripMeta(layout), stripMeta(published))) out.push({ slug, kind: "changed" });
  }
  for (const slug of state.deletedPages) if (baseline.layouts[slug]) out.push({ slug, kind: "deleted" });
  return out;
}

export const kitChanged = (state: BuilderState, baseline: BuilderBaseline): boolean => !deepEqual(state.kit, baseline.kit);
export const mediaChanged = (state: BuilderState, baseline: BuilderBaseline): boolean => !deepEqual(state.media ?? {}, baseline.media ?? {});

/** Set (or clear) one picture's default alt text. */
export function setMediaAlt(state: BuilderState, path: string, alt: string): BuilderState {
  const media = { ...(state.media ?? {}) };
  if (alt.trim() === "") delete media[path];
  else media[path] = { alt: alt.slice(0, 500) };
  return deepEqual(media, state.media ?? {}) ? state : { ...state, media };
}

/** A seeded layout the person never touched: only site sections in their default order, nothing else. */
export function isSeedOnly(layout: LayoutDoc): boolean {
  return layout.root.every((element) => element.type === "site-section" && Object.keys(element.style).length === 0 && Object.keys(element.advanced).length === 0 && !element.label && !element.locked) && !layout.seo?.title && !layout.seo?.description && !layout.pageSettings;
}

/** Timestamps never make a page "changed" on their own. */
export function stripMeta(layout: LayoutDoc): unknown {
  const strip = (element: Element): unknown => ({ ...element, meta: undefined, children: element.children?.map(strip) });
  return { ...layout, root: layout.root.map(strip) };
}

/** Ids of every element that differs from the published tree (edited, added, or with moved children). */
export function changedElementIds(layout: LayoutDoc | undefined, published: LayoutDoc | undefined): Set<string> {
  const ids = new Set<string>();
  if (!layout) return ids;
  const before = published ? indexLayout(published) : new Map<string, IndexEntry>();
  for (const [id, entry] of indexLayout(layout)) {
    const old = before.get(id);
    if (!old) {
      ids.add(id);
      continue;
    }
    const a = { ...entry.element, children: undefined, meta: undefined };
    const b = { ...old.element, children: undefined, meta: undefined };
    if (!deepEqual(a, b) || old.parentId !== entry.parentId || old.index !== entry.index) ids.add(id);
    const childIds = (entry.element.children ?? []).map((child) => child.id);
    const oldChildIds = (old.element.children ?? []).map((child) => child.id);
    if (!deepEqual(childIds, oldChildIds)) ids.add(id);
  }
  return ids;
}
