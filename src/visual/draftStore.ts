/**
 * The visual editor's draft: every unpublished change for one site, across all of
 * its pages, with undo/redo. Pure module (no React, no DOM) so it is unit-tested.
 *
 * A draft is a map of changes keyed by what they change. Stage 1 has two kinds:
 * `fields` (a whole field value: string, link or list, keyed by "slug.section.field")
 * and `images` (a picture waiting to be uploaded, keyed by the field path or the list
 * item path it belongs to). Stage 2 (design tokens) and Stage 3 (sections) add new
 * keyed maps beside these two; the history, persistence and publish code below only
 * ever look at the draft as a whole, so those stages plug in without rewrites.
 */
import { deepEqual, type ContentTree, type ContentValue, type LinkValue, type ListValue } from "@shared/contentFile.ts";
import type { BatchImageUpload, BatchPageUpdate, FieldUpdate, PublishBatchRequest } from "@shared/publishTypes.ts";
import type { ItemField, PageDefinition, PageField, PageSection, SiteSchema } from "@shared/schema.ts";
import { fieldPath, fieldRoot, parseFieldPath, type FieldPath } from "@shared/visualProtocol.ts";

/** A picture prepared in the browser (resized to WebP) and waiting for Publish. */
export type ImageDraft = {
  name: string;
  type: string;
  width: number;
  height: number;
  bytes: number;
  /** `data:<type>;base64,...`. Doubles as the preview URL and survives a reload. */
  dataUrl: string;
};

export type Draft = {
  fields: Record<FieldPath, ContentValue>;
  images: Record<FieldPath, ImageDraft>;
  /** Reserved for Stage 2: `{ [tokenName]: value }`. Always empty in Stage 1. */
  tokens: Record<string, string>;
  /** Reserved for Stage 3: section operations per page. Always empty in Stage 1. */
  sections: Record<string, unknown>;
};

export type History = {
  present: Draft;
  past: Draft[];
  future: Draft[];
  /** The last push's grouping key and time, so a run of keystrokes is one undo step. */
  group: { key: string; at: number } | null;
};

export const TYPING_GROUP_MS = 900;
const MAX_HISTORY = 200;

export const emptyDraft = (): Draft => ({ fields: {}, images: {}, tokens: {}, sections: {} });
export const emptyHistory = (draft: Draft = emptyDraft()): History => ({ present: draft, past: [], future: [], group: null });

export const isEmptyDraft = (draft: Draft): boolean =>
  Object.keys(draft.fields).length === 0 && Object.keys(draft.images).length === 0 && Object.keys(draft.tokens).length === 0 && Object.keys(draft.sections).length === 0;

// --- reading ------------------------------------------------------------------

export function baselineValue(baseline: ContentTree, root: FieldPath): ContentValue | undefined {
  const parsed = parseFieldPath(root);
  if (!parsed) return undefined;
  return baseline[parsed.slug]?.[parsed.section]?.[parsed.field];
}

/** The value the site should show right now: the draft's, else the published one. */
export function currentValue(draft: Draft, baseline: ContentTree, root: FieldPath): ContentValue | undefined {
  return root in draft.fields ? draft.fields[root] : baselineValue(baseline, root);
}

/** The string at a text path: a text field, a link label, or one list item field. */
export function currentText(draft: Draft, baseline: ContentTree, path: FieldPath): string {
  const parsed = parseFieldPath(path);
  if (!parsed) return "";
  const value = currentValue(draft, baseline, fieldRoot(path));
  if (parsed.itemKey !== undefined && parsed.index !== undefined) {
    return Array.isArray(value) ? (value[parsed.index]?.[parsed.itemKey] ?? "") : "";
  }
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) return (value as LinkValue).label ?? "";
  return "";
}

/** Field roots with any unpublished change. */
export function changedRoots(draft: Draft): Set<FieldPath> {
  const roots = new Set<FieldPath>(Object.keys(draft.fields));
  for (const path of Object.keys(draft.images)) roots.add(fieldRoot(path));
  return roots;
}

export const changeCount = (draft: Draft): number => changedRoots(draft).size;

// --- history -------------------------------------------------------------------

function push(history: History, next: Draft, group?: string, now = Date.now()): History {
  if (group && history.group && history.group.key === group && now - history.group.at < TYPING_GROUP_MS) {
    // Same run of typing: replace the present instead of adding a step.
    return { ...history, present: next, future: [], group: { key: group, at: now } };
  }
  const past = [...history.past, history.present].slice(-MAX_HISTORY);
  return { present: next, past, future: [], group: group ? { key: group, at: now } : null };
}

export const canUndo = (history: History): boolean => history.past.length > 0;
export const canRedo = (history: History): boolean => history.future.length > 0;

export function undo(history: History): History {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return { present: previous, past: history.past.slice(0, -1), future: [history.present, ...history.future], group: null };
}

export function redo(history: History): History {
  const next = history.future[0];
  if (!next) return history;
  return { present: next, past: [...history.past, history.present], future: history.future.slice(1), group: null };
}

// --- changes --------------------------------------------------------------------

type Opts = { group?: string; now?: number };

/** Set a whole field. A value equal to the published one clears the change. */
export function setFieldValue(history: History, baseline: ContentTree, root: FieldPath, value: ContentValue, opts: Opts = {}): History {
  const fields = { ...history.present.fields };
  if (deepEqual(value, baselineValue(baseline, root))) delete fields[root];
  else fields[root] = value;
  return push(history, { ...history.present, fields }, opts.group, opts.now);
}

/** Set the string at a text path (field, link label, or list item field). */
export function setText(history: History, baseline: ContentTree, path: FieldPath, text: string, opts: Opts = {}): History {
  const parsed = parseFieldPath(path);
  if (!parsed) return history;
  const root = fieldRoot(path);
  const value = currentValue(history.present, baseline, root);
  if (parsed.itemKey !== undefined && parsed.index !== undefined) {
    const list = Array.isArray(value) ? (value as ListValue) : [];
    const next = list.map((item, index) => (index === parsed.index ? { ...item, [parsed.itemKey as string]: text } : item));
    if (!list[parsed.index]) return history;
    return setFieldValue(history, baseline, root, next, opts);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return setFieldValue(history, baseline, root, { ...(value as LinkValue), label: text }, opts);
  }
  return setFieldValue(history, baseline, root, text, opts);
}

export function setLinkHref(history: History, baseline: ContentTree, root: FieldPath, href: string, opts: Opts = {}): History {
  const value = currentValue(history.present, baseline, root);
  const link = value && typeof value === "object" && !Array.isArray(value) ? (value as LinkValue) : { label: "", href: "" };
  return setFieldValue(history, baseline, root, { ...link, href }, opts);
}

export function setImage(history: History, path: FieldPath, image: ImageDraft): History {
  return push(history, { ...history.present, images: { ...history.present.images, [path]: image } });
}

export function clearImage(history: History, path: FieldPath): History {
  if (!(path in history.present.images)) return history;
  const images = { ...history.present.images };
  delete images[path];
  return push(history, { ...history.present, images });
}

/** Drop every change to one field (its value and any pictures under it). */
export function revertField(history: History, root: FieldPath): History {
  const fields = { ...history.present.fields };
  delete fields[root];
  const images: Record<FieldPath, ImageDraft> = {};
  for (const [path, image] of Object.entries(history.present.images)) {
    if (fieldRoot(path) !== root) images[path] = image;
  }
  return push(history, { ...history.present, fields, images });
}

export function discardAll(history: History): History {
  if (isEmptyDraft(history.present)) return history;
  return push(history, emptyDraft());
}

/** Keep every change except the ones on the given roots (after a conflict). */
export function dropRoots(history: History, roots: Iterable<FieldPath>): History {
  let next = history;
  for (const root of roots) next = revertField(next, root);
  return next;
}

// --- lists ------------------------------------------------------------------------

function listOf(draft: Draft, baseline: ContentTree, root: FieldPath): ListValue {
  const value = currentValue(draft, baseline, root);
  return Array.isArray(value) ? (value as ListValue) : [];
}

export const blankItem = (itemFields: ItemField[]): Record<string, string> => Object.fromEntries(itemFields.map((item) => [item.key, ""]));

export function addListItem(history: History, baseline: ContentTree, root: FieldPath, item: Record<string, string>, at?: number): History {
  const list = [...listOf(history.present, baseline, root)];
  list.splice(at ?? list.length, 0, item);
  return setFieldValue(history, baseline, root, list);
}

export function duplicateListItem(history: History, baseline: ContentTree, root: FieldPath, index: number): History {
  const list = listOf(history.present, baseline, root);
  const item = list[index];
  if (!item) return history;
  return addListItem(history, baseline, root, { ...item }, index + 1);
}

export function removeListItem(history: History, baseline: ContentTree, root: FieldPath, index: number): History {
  const list = listOf(history.present, baseline, root);
  if (!list[index]) return history;
  const next = list.filter((_, i) => i !== index);
  // Pictures waiting on later items shift down with them.
  const images: Record<FieldPath, ImageDraft> = {};
  for (const [path, image] of Object.entries(history.present.images)) {
    const parsed = parseFieldPath(path);
    if (!parsed || parsed.index === undefined || fieldRoot(path) !== root) {
      images[path] = image;
    } else if (parsed.index < index) {
      images[path] = image;
    } else if (parsed.index > index) {
      images[fieldPath(parsed.slug, parsed.section, parsed.field, parsed.index - 1, parsed.itemKey)] = image;
    }
  }
  const stepped = setFieldValue(history, baseline, root, next);
  return { ...stepped, present: { ...stepped.present, images } };
}

export function moveListItem(history: History, baseline: ContentTree, root: FieldPath, from: number, to: number): History {
  const list = [...listOf(history.present, baseline, root)];
  if (from === to || !list[from] || to < 0 || to >= list.length) return history;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item as Record<string, string>);
  // Re-key item pictures to follow their items.
  const images: Record<FieldPath, ImageDraft> = {};
  const order = Array.from({ length: list.length }, (_, i) => i);
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved as number);
  for (const [path, image] of Object.entries(history.present.images)) {
    const parsed = parseFieldPath(path);
    if (!parsed || parsed.index === undefined || fieldRoot(path) !== root) {
      images[path] = image;
      continue;
    }
    const newIndex = order.indexOf(parsed.index);
    images[fieldPath(parsed.slug, parsed.section, parsed.field, newIndex < 0 ? parsed.index : newIndex, parsed.itemKey)] = image;
  }
  const stepped = setFieldValue(history, baseline, root, list);
  return { ...stepped, present: { ...stepped.present, images } };
}

// --- persistence ---------------------------------------------------------------------

export const DRAFT_STORAGE_VERSION = 1;
export const draftStorageKey = (siteId: string, userId: string): string => `armature:visual:draft:${siteId}:${userId}`;

export type StoredDraft = { version: number; savedAt: string; draft: Draft };

export function serializeDraft(draft: Draft, savedAt = new Date()): string {
  return JSON.stringify({ version: DRAFT_STORAGE_VERSION, savedAt: savedAt.toISOString(), draft } satisfies StoredDraft);
}

/** A stored draft, or null when there is none or it cannot be read. Never throws. */
export function parseStoredDraft(raw: string | null): StoredDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    if (parsed.version !== DRAFT_STORAGE_VERSION || !parsed.draft || typeof parsed.savedAt !== "string") return null;
    const draft: Draft = {
      fields: isRecord(parsed.draft.fields) ? (parsed.draft.fields as Draft["fields"]) : {},
      images: isRecord(parsed.draft.images) ? (parsed.draft.images as Draft["images"]) : {},
      tokens: isRecord(parsed.draft.tokens) ? (parsed.draft.tokens as Draft["tokens"]) : {},
      sections: isRecord(parsed.draft.sections) ? (parsed.draft.sections as Draft["sections"]) : {},
    };
    for (const [path, image] of Object.entries(draft.images)) {
      if (!image || typeof image.dataUrl !== "string" || !image.dataUrl.startsWith("data:image/")) delete draft.images[path];
    }
    if (isEmptyDraft(draft)) return null;
    return { version: DRAFT_STORAGE_VERSION, savedAt: parsed.savedAt, draft };
  } catch {
    return null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Drop changes that no longer make sense against freshly published content: a field
 * whose draft value equals what is now published, and anything on fields the schema
 * no longer declares.
 */
export function reconcile(draft: Draft, baseline: ContentTree, schema: SiteSchema): Draft {
  const known = new Set<FieldPath>();
  for (const page of schema.pages) for (const section of page.sections) for (const field of section.fields) known.add(fieldPath(page.slug, section.key, field.key));
  const fields: Draft["fields"] = {};
  for (const [root, value] of Object.entries(draft.fields)) {
    if (known.has(root) && !deepEqual(value, baselineValue(baseline, root))) fields[root] = value;
  }
  const images: Draft["images"] = {};
  for (const [path, image] of Object.entries(draft.images)) if (known.has(fieldRoot(path))) images[path] = image;
  return { ...draft, fields, images };
}

// --- schema lookups -----------------------------------------------------------------------

export type FieldMeta = {
  page: PageDefinition;
  section: PageSection;
  field: PageField;
  /** Present for a list item path. */
  itemField?: ItemField;
  index?: number;
  /** "Headline", or "Question 3" for a list item field. */
  label: string;
};

export function fieldMeta(schema: SiteSchema, path: FieldPath): FieldMeta | null {
  const parsed = parseFieldPath(path);
  if (!parsed) return null;
  const page = schema.pages.find((item) => item.slug === parsed.slug);
  const section = page?.sections.find((item) => item.key === parsed.section);
  const field = section?.fields.find((item) => item.key === parsed.field);
  if (!page || !section || !field) return null;
  if (parsed.itemKey !== undefined && parsed.index !== undefined) {
    const itemField = field.itemFields?.find((item) => item.key === parsed.itemKey);
    if (!itemField) return null;
    return { page, section, field, itemField, index: parsed.index, label: `${itemField.label} ${parsed.index + 1}` };
  }
  return { page, section, field, label: field.label };
}

// --- publishing ------------------------------------------------------------------------------

export type ChangeSummaryItem = { root: FieldPath; label: string; sectionLabel: string; type: PageField["type"]; images: number };
export type ChangeSummaryPage = { slug: string; label: string; items: ChangeSummaryItem[] };

/** Every change grouped by page, in schema order, for the publish dialog. */
export function summarizeDraft(draft: Draft, schema: SiteSchema): ChangeSummaryPage[] {
  const roots = changedRoots(draft);
  const pages: ChangeSummaryPage[] = [];
  for (const page of schema.pages) {
    const items: ChangeSummaryItem[] = [];
    for (const section of page.sections) {
      for (const field of section.fields) {
        const root = fieldPath(page.slug, section.key, field.key);
        if (!roots.has(root)) continue;
        const images = Object.keys(draft.images).filter((path) => fieldRoot(path) === root).length;
        items.push({ root, label: field.label, sectionLabel: section.label, type: field.type, images });
      }
    }
    if (items.length > 0) pages.push({ slug: page.slug, label: page.label, items });
  }
  return pages;
}

const base64OfDataUrl = (dataUrl: string): string => {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
};

/** The one request that publishes the whole draft. */
export function toPublishRequest(draft: Draft, schema: SiteSchema, siteId: string, baseCommitSha: string): PublishBatchRequest {
  const byPage = new Map<string, BatchPageUpdate>();
  const pageFor = (slug: string): BatchPageUpdate => {
    let page = byPage.get(slug);
    if (!page) {
      page = { slug, fields: [], images: [] };
      byPage.set(slug, page);
    }
    return page;
  };
  for (const page of schema.pages) {
    for (const section of page.sections) {
      for (const field of section.fields) {
        const root = fieldPath(page.slug, section.key, field.key);
        if (root in draft.fields) {
          const update: FieldUpdate = { section: section.key, field: field.key, value: draft.fields[root] as ContentValue };
          pageFor(page.slug).fields.push(update);
        }
        for (const [path, image] of Object.entries(draft.images)) {
          if (fieldRoot(path) !== root) continue;
          const parsed = parseFieldPath(path);
          const upload: BatchImageUpload = {
            section: section.key,
            field: field.key,
            filename: image.name,
            contentType: image.type,
            dataBase64: base64OfDataUrl(image.dataUrl),
          };
          if (parsed?.index !== undefined && parsed.itemKey !== undefined) {
            upload.index = parsed.index;
            upload.itemKey = parsed.itemKey;
          }
          pageFor(page.slug).images.push(upload);
        }
      }
    }
  }
  return { site_id: siteId, baseCommitSha, pages: [...byPage.values()] };
}

/** The whole draft as the bridge wants it: `{ "<root>": value }`, pictures previewed by data URL. */
export function draftForBridge(draft: Draft, baseline: ContentTree): Record<FieldPath, ContentValue> {
  const out: Record<FieldPath, ContentValue> = { ...draft.fields };
  for (const [path, image] of Object.entries(draft.images)) {
    const parsed = parseFieldPath(path);
    if (!parsed) continue;
    const root = fieldRoot(path);
    if (parsed.index !== undefined && parsed.itemKey !== undefined) {
      const value = root in out ? out[root] : baselineValue(baseline, root);
      const list = Array.isArray(value) ? (value as ListValue) : [];
      out[root] = list.map((item, index) => (index === parsed.index ? { ...item, [parsed.itemKey as string]: image.dataUrl } : item));
    } else {
      out[root] = image.dataUrl;
    }
  }
  return out;
}
