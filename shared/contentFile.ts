/**
 * Shape and on-disk format of content/pages.json — the git-first content of record.
 *
 * Pure module: no filesystem, no network, no secrets. It is imported by the editor,
 * the site-connect check and the publish function, so all of them agree on exactly
 * how the file is written.
 */

/** The path of the content file inside a site repository. */
export const CONTENT_PATH = "content/pages.json";

/** Directory (repo-relative) that editor image uploads are committed into. */
export const UPLOAD_DIR = "public/assets/uploads";

/** Public URL prefix that `UPLOAD_DIR` is served at. */
export const UPLOAD_URL_PREFIX = "/assets/uploads";

export type LinkValue = { label: string; href: string };
export type ListValue = Record<string, string>[];
export type ContentValue = string | LinkValue | ListValue;

/** `{ [slug]: { [section]: { [field]: value } } }` */
export type ContentTree = Record<string, Record<string, Record<string, ContentValue>>>;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Recursively rewrite objects with alphabetically ordered keys so the serialised
 * output is byte-stable no matter who produced the input. Arrays keep their order,
 * because lists (navigation, FAQ items) are ordered content.
 */
export function sortContentKeys(value: unknown): Json {
  if (Array.isArray(value)) return value.map(sortContentKeys);
  if (isPlainObject(value)) {
    const out: { [key: string]: Json } = {};
    for (const key of Object.keys(value).sort()) out[key] = sortContentKeys(value[key]);
    return out;
  }
  return value as Json;
}

/** The canonical on-disk form: sorted keys, 2-space indent, trailing newline. */
export function serializeContent(content: unknown): string {
  return `${JSON.stringify(sortContentKeys(content), null, 2)}\n`;
}

/** Structural equality that ignores key order. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const leftKeys = Object.keys(a).sort();
    const rightKeys = Object.keys(b).sort();
    if (leftKeys.length !== rightKeys.length) return false;
    if (!leftKeys.every((key, i) => key === rightKeys[i])) return false;
    return leftKeys.every((key) => deepEqual(a[key], b[key]));
  }
  return false;
}

/** Deep clone via the content's own JSON form. Safe because content is plain JSON. */
export function cloneContent<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
