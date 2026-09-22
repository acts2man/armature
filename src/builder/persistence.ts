/**
 * The draft on disk (this browser, and later the builder_drafts table): the Stage 1
 * content changes plus only the pages whose layout differs from what is published (a
 * null layout means "deleted in the draft") and the kit when it changed. Pure module.
 */
import { validateLayout, validateSiteKit, type LayoutDoc, type SiteKit } from "@shared/builder/index.ts";
import { deepEqual } from "@shared/contentFile.ts";
import type { SiteSchema } from "@shared/schema.ts";
import { emptyDraft, isEmptyDraft, parseStoredDraft, reconcile, type Draft } from "@/visual/draftStore.ts";
import type { ContentTree } from "@shared/contentFile.ts";
import type { EditorState } from "./history.ts";
import { changedPages, mediaChanged, stripMeta, type BuilderBaseline, type BuilderState } from "./store.ts";
import type { MediaMeta } from "@shared/publishTypes.ts";

export const DRAFT_VERSION = 2;
export const draftKey = (siteId: string, userId: string): string => `armature:builder:draft:${siteId}:${userId}`;
/** The Stage 1 key, read once so an older draft is not lost. */
export const legacyDraftKey = (siteId: string, userId: string): string => `armature:visual:draft:${siteId}:${userId}`;

export type StoredEditorDraft = {
  version: typeof DRAFT_VERSION;
  savedAt: string;
  content: Draft;
  layouts: Record<string, LayoutDoc | null>;
  kit?: SiteKit;
  media?: MediaMeta;
};

/** Only what differs from the baseline, so the stored draft stays small and merges cleanly. */
export function diffBuilder(state: BuilderState, baseline: BuilderBaseline): { layouts: Record<string, LayoutDoc | null>; kit?: SiteKit; media?: MediaMeta } {
  const layouts: Record<string, LayoutDoc | null> = {};
  for (const change of changedPages(state, baseline)) {
    layouts[change.slug] = change.kind === "deleted" ? null : (state.layouts[change.slug] ?? null);
  }
  return { layouts, ...(deepEqual(state.kit, baseline.kit) ? {} : { kit: state.kit }), ...(mediaChanged(state, baseline) ? { media: state.media ?? {} } : {}) };
}

export function serializeEditorDraft(state: EditorState, baseline: BuilderBaseline, savedAt = new Date()): string {
  const diff = diffBuilder(state.builder, baseline);
  const stored: StoredEditorDraft = { version: DRAFT_VERSION, savedAt: savedAt.toISOString(), content: state.content, layouts: diff.layouts, ...(diff.kit ? { kit: diff.kit } : {}), ...(diff.media ? { media: diff.media } : {}) };
  return JSON.stringify(stored);
}

export const isEmptyEditorDraft = (state: EditorState, baseline: BuilderBaseline): boolean => {
  const diff = diffBuilder(state.builder, baseline);
  return isEmptyDraft(state.content) && Object.keys(diff.layouts).length === 0 && !diff.kit && !diff.media;
};

/** Every change in the draft, for the status line and the restore prompt. */
export function draftChangeCount(state: EditorState, baseline: BuilderBaseline): number {
  const diff = diffBuilder(state.builder, baseline);
  const fields = new Set(Object.keys(state.content.fields));
  for (const path of Object.keys(state.content.images)) fields.add(path.replace(/\[\d+\]\.[a-z0-9_]+$/, ""));
  return fields.size + Object.keys(diff.layouts).length + (diff.kit ? 1 : 0) + (diff.media ? 1 : 0);
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Alt text per picture path, keeping only well-formed entries. */
function parseMedia(raw: unknown): MediaMeta | undefined {
  if (!isRecord(raw)) return undefined;
  const out: MediaMeta = {};
  for (const [path, entry] of Object.entries(raw)) {
    if (/^\/assets\/[A-Za-z0-9._\-/]+$/.test(path) && isRecord(entry) && typeof entry["alt"] === "string") out[path] = { alt: entry["alt"].slice(0, 500) };
  }
  return out;
}

/** A stored draft (v2, or a Stage 1 v1 draft lifted into v2), or null. Never throws. */
export function parseEditorDraft(raw: string | null): StoredEditorDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Omit<Partial<StoredEditorDraft>, "version"> & { draft?: unknown; version?: unknown };
    if (parsed.version === 1) {
      const legacy = parseStoredDraft(raw);
      return legacy ? { version: DRAFT_VERSION, savedAt: legacy.savedAt, content: legacy.draft, layouts: {} } : null;
    }
    if (parsed.version !== DRAFT_VERSION || typeof parsed.savedAt !== "string") return null;
    const content = parseStoredDraft(JSON.stringify({ version: 1, savedAt: parsed.savedAt, draft: parsed.content ?? emptyDraft() }))?.draft ?? emptyDraft();
    const layouts: Record<string, LayoutDoc | null> = {};
    if (isRecord(parsed.layouts)) {
      for (const [slug, value] of Object.entries(parsed.layouts)) {
        if (value === null) layouts[slug] = null;
        else {
          const report = validateLayout(value, slug);
          if (report.value) layouts[slug] = report.value;
        }
      }
    }
    const kit = parsed.kit ? validateSiteKit(parsed.kit).value : undefined;
    const media = parseMedia(parsed.media);
    if (isEmptyDraft(content) && Object.keys(layouts).length === 0 && !kit && !media) return null;
    return { version: DRAFT_VERSION, savedAt: parsed.savedAt, content, layouts, ...(kit ? { kit } : {}), ...(media ? { media } : {}) };
  } catch {
    return null;
  }
}

/** Apply a stored draft over fresh published content, dropping anything that is now published. */
export function restoreEditorDraft(stored: StoredEditorDraft, baseline: BuilderBaseline, published: ContentTree, schema: SiteSchema): EditorState {
  const layouts = { ...baseline.layouts };
  const deletedPages: string[] = [];
  for (const [slug, layout] of Object.entries(stored.layouts)) {
    if (layout === null) {
      if (baseline.layouts[slug]) {
        delete layouts[slug];
        deletedPages.push(slug);
      }
    } else if (!baseline.layouts[slug] || !deepEqual(stripMeta(layout), stripMeta(baseline.layouts[slug] as LayoutDoc))) {
      layouts[slug] = layout;
    }
  }
  return {
    content: reconcile(stored.content, published, schema),
    builder: { layouts, deletedPages, kit: stored.kit && !deepEqual(stored.kit, baseline.kit) ? stored.kit : baseline.kit, media: stored.media ?? baseline.media },
  };
}
