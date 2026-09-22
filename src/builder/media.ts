/**
 * The media library's bookkeeping: which pictures exist (the site's files, plus pictures
 * added in this draft, which travel as data: URLs until publish), and where each is used
 * (content fields and page layouts). Pure functions, so they are easy to test.
 */
import type { LayoutDoc } from "@shared/builder/index.ts";
import type { ContentTree } from "@shared/contentFile.ts";
import type { MediaFile } from "@shared/publishTypes.ts";

export type MediaEntry = {
  /** The path on the site ("/assets/…") or, for a picture added in this draft, its data: URL. */
  src: string;
  name: string;
  kind: "image" | "video";
  bytes: number;
  /** Added in this draft: goes out with the next publish. */
  draft: boolean;
};

const DATA_IMAGE = /^data:image\/(png|jpeg|webp|gif|avif);base64,/;

/** Every string anywhere inside a value (props, styles, SEO), each with the page it sits on. */
function walkStrings(value: unknown, visit: (text: string) => void, depth = 0): void {
  if (depth > 60) return;
  if (typeof value === "string") visit(value);
  else if (Array.isArray(value)) for (const item of value) walkStrings(item, visit, depth + 1);
  else if (value && typeof value === "object") for (const inner of Object.values(value)) walkStrings(inner, visit, depth + 1);
}

/** The approximate size in bytes of a base64 data: URL. */
export const dataUrlBytes = (url: string): number => Math.floor(((url.length - url.indexOf(",") - 1) * 3) / 4);

/** The site's files first (newest names sorted), then the pictures added in this draft. */
export function mediaEntries(files: MediaFile[], layouts: Record<string, LayoutDoc>): MediaEntry[] {
  const out: MediaEntry[] = files.map((file) => ({ src: file.path, name: file.path.split("/").pop() ?? file.path, kind: file.kind, bytes: file.bytes, draft: false }));
  const seen = new Set<string>();
  let n = 0;
  for (const layout of Object.values(layouts)) {
    walkStrings(layout.root, (text) => {
      if (!DATA_IMAGE.test(text) || seen.has(text)) return;
      seen.add(text);
      n += 1;
      out.push({ src: text, name: `New picture ${n}`, kind: "image", bytes: dataUrlBytes(text), draft: true });
    });
  }
  return out;
}

/** For each picture, the labels of the pages that use it (sorted, no repeats). */
export function mediaUsage(content: ContentTree, layouts: Record<string, LayoutDoc>, pageLabel: (slug: string) => string): Map<string, string[]> {
  const usage = new Map<string, Set<string>>();
  const note = (src: string, slug: string) => {
    if (!src.startsWith("/") && !src.startsWith("data:")) return;
    const key = src.split(/[?#]/)[0] ?? src;
    if (!usage.has(key)) usage.set(key, new Set());
    usage.get(key)!.add(pageLabel(slug));
  };
  for (const [slug, page] of Object.entries(content)) walkStrings(page, (text) => note(text, slug));
  for (const [slug, layout] of Object.entries(layouts)) {
    walkStrings(layout.root, (text) => note(text, slug));
    if (layout.seo?.ogImage) note(layout.seo.ogImage, slug);
  }
  return new Map([...usage].map(([src, pages]) => [src, [...pages].sort()]));
}

/** Where a thumbnail loads from: the live site for a path, the data itself for a new picture. */
export function thumbnailUrl(src: string, siteUrl: string | null): string | null {
  if (src.startsWith("data:")) return DATA_IMAGE.test(src) ? src : null;
  if (!siteUrl || !src.startsWith("/") || src.startsWith("//")) return null;
  try {
    const url = new URL(src, siteUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export const formatBytes = (bytes: number): string => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
