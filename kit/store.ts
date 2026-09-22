/**
 * The kit's store: the site's content, layouts and kit as built, with the draft the
 * editor pushes on top in edit mode. Read with useSyncExternalStore; every change
 * produces a new snapshot object. No React, no DOM: unit-testable.
 */
import { defaultSiteKit } from "./defaults.ts";
import type { LayoutDoc, SiteKit, SiteSectionInfo } from "./types.ts";

export type LinkValue = { label: string; href: string };
export type ListValue = Record<string, string>[];
export type ContentValue = string | LinkValue | ListValue;
export type ContentTree = Record<string, Record<string, Record<string, ContentValue>>>;

export type KitSnapshot = {
  content: ContentTree;
  layouts: Record<string, LayoutDoc>;
  kit: SiteKit;
  editMode: boolean;
  /** The element being typed into on the page: the renderer leaves its DOM alone meanwhile. */
  editing: string | null;
  /** Bumped when an edit on the page ends, so the renderer remounts that element from the saved value. */
  editEpoch: Record<string, number>;
};

export type SiteSectionRegistration = SiteSectionInfo & { component: unknown };

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const PATH_PATTERN = /^([a-z0-9][a-z0-9-]*)\.([a-z0-9][a-z0-9_]*)\.([a-z0-9][a-z0-9_]*)(?:\[(\d+)\]\.([a-z0-9][a-z0-9_]*))?$/;
export type ParsedPath = { slug: string; section: string; field: string; index?: number; itemKey?: string };
export function parseFieldPath(path: string): ParsedPath | null {
  const match = PATH_PATTERN.exec(path);
  if (!match) return null;
  const [, slug = "", section = "", field = "", index, itemKey] = match;
  if (index !== undefined && itemKey !== undefined) return { slug, section, field, index: Number(index), itemKey };
  return { slug, section, field };
}

/** Unwrap `import.meta.glob(..., { eager: true })` modules (or plain objects) into layouts by slug. */
export function collectLayouts(input: Record<string, unknown> | LayoutDoc[] | undefined): Record<string, LayoutDoc> {
  const out: Record<string, LayoutDoc> = {};
  const values = Array.isArray(input) ? input : Object.values(input ?? {});
  for (const raw of values) {
    const candidate = raw && typeof raw === "object" && "default" in (raw as object) ? (raw as { default: unknown }).default : raw;
    if (isLayoutLike(candidate)) out[candidate.pageSlug] = candidate;
  }
  return out;
}

/** The light guard the renderer relies on: the strict check ran before the file was committed. */
export function isLayoutLike(value: unknown): value is LayoutDoc {
  if (!value || typeof value !== "object") return false;
  const layout = value as Partial<LayoutDoc>;
  return layout.version === 1 && typeof layout.pageSlug === "string" && typeof layout.path === "string" && Array.isArray(layout.root);
}

export function createKitStore(config: { content?: ContentTree; layouts?: Record<string, unknown> | LayoutDoc[]; siteKit?: SiteKit | null }) {
  const baseContent: ContentTree = clone(config.content ?? {});
  const baseLayouts = collectLayouts(config.layouts);
  const baseKit: SiteKit = config.siteKit ? clone(config.siteKit) : defaultSiteKit();

  const fieldDraft = new Map<string, unknown>();
  let draftLayouts: Record<string, LayoutDoc | null> | null = null;
  let draftKit: SiteKit | null = null;
  let editMode = false;
  let editing: string | null = null;
  let editEpoch: Record<string, number> = {};

  const sections = new Map<string, SiteSectionRegistration>();
  const listeners = new Set<() => void>();
  let snapshot: KitSnapshot = { content: baseContent, layouts: baseLayouts, kit: baseKit, editMode, editing, editEpoch };

  const rebuild = () => {
    let content = baseContent;
    if (fieldDraft.size > 0) {
      content = clone(baseContent);
      for (const [root, value] of fieldDraft) {
        const parsed = parseFieldPath(root);
        if (!parsed) continue;
        const page = (content[parsed.slug] ??= {});
        const section = (page[parsed.section] ??= {});
        section[parsed.field] = value as ContentValue;
      }
    }
    let layouts = baseLayouts;
    if (draftLayouts) {
      layouts = { ...baseLayouts };
      for (const [slug, layout] of Object.entries(draftLayouts)) {
        if (layout === null) delete layouts[slug];
        else layouts[slug] = layout;
      }
    }
    snapshot = { content, layouts, kit: draftKit ?? baseKit, editMode, editing, editEpoch };
    for (const listener of listeners) listener();
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    /** Replace the whole set of field overrides (the editor sends every field it holds). */
    applyFields(fields: Record<string, unknown>, holdBack?: (root: string) => boolean) {
      const held = new Map<string, unknown>();
      const incoming = new Set(Object.keys(fields));
      for (const root of Array.from(fieldDraft.keys())) if (!incoming.has(root)) fieldDraft.delete(root);
      for (const [root, value] of Object.entries(fields)) {
        if (!parseFieldPath(root)) continue;
        if (holdBack?.(root)) held.set(root, value);
        else fieldDraft.set(root, value);
      }
      rebuild();
      return held;
    },
    setField(root: string, value: unknown) {
      fieldDraft.set(root, value);
      rebuild();
    },
    /** Replace the draft layouts and kit. A null layout means "deleted in the draft". */
    applyLayouts(layouts: Record<string, LayoutDoc | null> | null, kit: SiteKit | null) {
      draftLayouts = layouts;
      draftKit = kit;
      rebuild();
    },
    setEditMode(next: boolean) {
      if (editMode === next) return;
      editMode = next;
      rebuild();
    },
    /**
     * Set one prop of one element in the draft (the value typed on the page), so the
     * element remounts showing it before the editor's next full draft arrives.
     */
    patchElementProp(id: string, key: string, value: unknown) {
      const patch = (elements: LayoutDoc["root"]): LayoutDoc["root"] => {
        let changed = false;
        const next = elements.map((element) => {
          if (element.id === id) {
            changed = true;
            return { ...element, props: { ...element.props, [key]: value } };
          }
          if (!element.children) return element;
          const children = patch(element.children);
          if (children === element.children) return element;
          changed = true;
          return { ...element, children };
        });
        return changed ? next : elements;
      };
      for (const [slug, layout] of Object.entries(snapshot.layouts)) {
        const root = patch(layout.root);
        if (root !== layout.root) {
          draftLayouts = { ...(draftLayouts ?? {}), [slug]: { ...layout, root } };
          rebuild();
          return;
        }
      }
    },
    /** The bridge marks the element being typed into; clearing it remounts that element. */
    setEditing(id: string | null) {
      if (editing === id) return;
      if (editing) editEpoch = { ...editEpoch, [editing]: (editEpoch[editing] ?? 0) + 1 };
      editing = id;
      rebuild();
    },
    registerSection(key: string, registration: Omit<SiteSectionRegistration, "key">) {
      sections.set(key, { key, ...registration });
    },
    getSection: (key: string) => sections.get(key),
    listSections: (): SiteSectionInfo[] => Array.from(sections.values()).map(({ key, label, repeatable }) => ({ key, label, repeatable })),
    baseContent,
    baseLayouts,
    baseKit,
  };
}

export type KitStore = ReturnType<typeof createKitStore>;
