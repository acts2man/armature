/**
 * The site's own Supabase Storage bucket (site-files) for uploaded pictures and
 * documents. Every file lives at <agency_id>/<site_id>/<folder>/<file>; the site id
 * in the path is the authorisation key (see the RLS policies in the storage migration).
 *
 * The bucket is public, so a file's URL loads straight from Supabase's CDN — no signed
 * URLs, no per-visit auth. Upload sets a long Cache-Control so the CDN caches
 * aggressively (a file is only replaced by uploading it again).
 */
import { supabase } from "./supabase.ts";

export const SITE_FILES_BUCKET = "site-files";
export const DEFAULT_FOLDER = "uploads";
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const CACHE_HEADER = "public, max-age=31536000, immutable";

const VIDEO_MIME = /^video\//i;
const IMAGE_MIME = /^image\//i;

/** Turn a raw filename into a safe, dash-cased name that keeps the extension. */
export function safeFileName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return cleaned || `file-${Date.now()}`;
}

/** The final <agency_id>/<site_id>/<folder>/<file> object path for a new upload. */
export function storagePath(agencyId: string, siteId: string, folder: string, fileName: string): string {
  const safeFolder = folder.replace(/[^a-z0-9_\-/]+/gi, "").replace(/^\/+|\/+$/g, "") || DEFAULT_FOLDER;
  return `${agencyId}/${siteId}/${safeFolder}/${safeFileName(fileName)}`;
}

/** The public URL a browser fetches. Public buckets serve directly from the CDN. */
export function publicUrl(objectPath: string): string {
  return supabase.storage.from(SITE_FILES_BUCKET).getPublicUrl(objectPath).data.publicUrl;
}

export type UploadResult =
  | { ok: true; path: string; url: string; size: number; contentType: string }
  | { ok: false; error: string };

/**
 * Upload a file to the site's folder. Adds a unique suffix to the name if a file with
 * the same name is there, so an accidental repeated upload doesn't overwrite the
 * previous one silently. Videos are refused with advice to use YouTube / Vimeo /
 * Wistia (embed with the Video widget); nothing about the widget or the kit changes.
 */
export async function uploadSiteFile(input: { agencyId: string; siteId: string; file: File; folder?: string }): Promise<UploadResult> {
  const { agencyId, siteId, file } = input;
  if (VIDEO_MIME.test(file.type)) {
    return { ok: false, error: "Video files aren't supported here. Upload the video to YouTube, Vimeo or Wistia and paste its address into the Video widget." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, error: `That file is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). The limit is ${MAX_FILE_BYTES / 1024 / 1024} MB.` };
  }
  const folder = input.folder ?? (IMAGE_MIME.test(file.type) ? "images" : "documents");
  let path = storagePath(agencyId, siteId, folder, file.name);
  // Find a free name if one already exists.
  const parts = path.split("/");
  const base = parts.slice(0, -1).join("/");
  const nameParts = (parts[parts.length - 1] ?? "").split(".");
  const extension = nameParts.length > 1 ? nameParts.pop() : undefined;
  const stem = nameParts.join(".") || "file";
  let attempt = 0;
  while (attempt < 10) {
    const candidate = attempt === 0 ? path : `${base}/${stem}-${attempt + 1}${extension ? `.${extension}` : ""}`;
    const result = await supabase.storage.from(SITE_FILES_BUCKET).upload(candidate, file, {
      cacheControl: CACHE_HEADER,
      upsert: false,
      contentType: file.type || "application/octet-stream",
    });
    if (!result.error) {
      return {
        ok: true,
        path: candidate,
        url: publicUrl(candidate),
        size: file.size,
        contentType: file.type || "application/octet-stream",
      };
    }
    if (!/already exists|duplicate/i.test(result.error.message)) {
      return { ok: false, error: result.error.message };
    }
    attempt += 1;
    path = candidate;
  }
  return { ok: false, error: "A file with this name already exists. Rename it and try again." };
}

/** List every file the caller may see under a site's folder, newest first. */
export async function listSiteFiles(agencyId: string, siteId: string): Promise<{ path: string; url: string; size: number; updatedAt: string; contentType: string }[]> {
  const prefix = `${agencyId}/${siteId}/`;
  const out: { path: string; url: string; size: number; updatedAt: string; contentType: string }[] = [];
  const walk = async (folder: string): Promise<void> => {
    const { data, error } = await supabase.storage.from(SITE_FILES_BUCKET).list(folder, { limit: 100, sortBy: { column: "updated_at", order: "desc" } });
    if (error || !data) return;
    for (const entry of data) {
      if (entry.metadata) {
        const path = `${folder}/${entry.name}`;
        out.push({
          path,
          url: publicUrl(path),
          size: (entry.metadata["size"] as number) ?? 0,
          updatedAt: entry.updated_at ?? entry.created_at ?? new Date().toISOString(),
          contentType: (entry.metadata["mimetype"] as string) ?? "application/octet-stream",
        });
      } else {
        // Folder — recurse one level. (The Media library folder tree is shallow: images/, documents/.)
        await walk(`${folder}/${entry.name}`);
      }
    }
  };
  await walk(prefix.replace(/\/$/, ""));
  return out;
}

/** Remove a single file the caller owns. */
export async function deleteSiteFile(path: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.storage.from(SITE_FILES_BUCKET).remove([path]);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** The site's total bytes and file count, from the site_storage_totals view. RLS covers rows the caller may see. */
export async function readStorageTotals(siteId: string): Promise<{ files: number; bytes: number }> {
  const { data, error } = await supabase.from("site_storage_totals").select("file_count, total_bytes").eq("site_id", siteId).maybeSingle();
  if (error || !data) return { files: 0, bytes: 0 };
  const row = data as { file_count: number | string | null; total_bytes: number | string | null };
  return { files: Number(row.file_count ?? 0), bytes: Number(row.total_bytes ?? 0) };
}
