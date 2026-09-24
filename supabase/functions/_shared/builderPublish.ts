/**
 * The page builder's publish, without the network: content fields (through the same
 * engine as content-publish-batch), layouts, the site kit and media metadata, all in
 * ONE commit, with every guarantee the other publishes keep: the kit's validator, URL
 * and image rules, whole-file checks, no force-push. When the branch moved since the
 * draft began, layouts merge per element and the kit and media per value; anything both
 * sides changed comes back as a conflict naming each element, for "keep mine" / "take
 * theirs".
 *
 * Values the validator cannot read are never lost: one that is already in the committed
 * file is written back exactly as it was (unless that very setting was changed); one
 * that is new is refused with a plain-English message.
 */
import type { BatchPageUpdate, BuilderPublishResponse, EditingLevel, MediaMeta, MediaUpload, PageCopy, TrashAction } from "../../../shared/publishTypes.ts";
import { defaultSiteKit } from "../../../kit/defaults.ts";
import type { LayoutDoc, PostDoc, PostIndex, PostIndexEntry, SiteKit } from "../../../kit/types.ts";
import { robotsTxt, sitemapXml, type SitemapEntry } from "../../../kit/seo.ts";
import { rssXml } from "../../../kit/rss.ts";
import { checkPost } from "../../../kit/validate.ts";
import { mergeLayouts, mergeValues, stableJson, type MergeConflict, type Resolution } from "../../../shared/builder/merge.ts";
import { kitPermissionErrors, layoutPermissionErrors, type Permissions } from "../../../shared/builder/permissions.ts";
import { checkLayout, checkSiteKit, describeProblem, isLayoutSlug, LAYOUT_LIMITS, MEDIA_META_PATH, PAGE_SLUG_PATTERN, SITE_KIT_PATH, layoutBytes, layoutPath, serializeBuilderFile, trashPath, type Problem } from "../../../shared/builder/schema.ts";
import { isChromeSlug } from "../../../kit/types.ts";
import { restoreKitProblems, restoreLayoutProblems, unpreservedProblems } from "../../../shared/builder/preserve.ts";
import { base64ByteLength, isValidBase64 } from "../../../shared/base64.ts";
import { MAX_IMAGE_BYTES, MAX_TOTAL_IMAGE_BYTES } from "../../../shared/publishTypes.ts";
import { ArmatureError } from "./errors.ts";
import type { CommitFile, ContentRepo } from "./githubRepo.ts";
import { loadSiteFiles, planBatchPublish } from "./publish.ts";

export type BuilderPublishInput = {
  baseCommitSha: string;
  pages: BatchPageUpdate[];
  layouts: Record<string, unknown>;
  kit: unknown;
  media: unknown;
  resolutions: Record<string, Resolution>;
  trash?: Record<string, TrashAction>;
  copies?: Record<string, PageCopy>;
  uploads?: MediaUpload[];
  deleteAssets?: string[];
  /** Post files to write, keyed by slug. A value of null deletes the post. */
  posts?: Record<string, unknown | null>;
};

const POSTS_DIR = "content/posts";
const POST_INDEX_PATH = `${POSTS_DIR}/index.json`;
const postPath = (slug: string) => `${POSTS_DIR}/${slug}.json`;
const POST_SLUG_PATTERN_LOCAL = /^[a-z0-9][a-z0-9-]{0,80}$/;

/** Read every post file in the repo at `ref`, sorted newest first for the index. */
async function readAllPostsAt(repo: ContentRepo, ref: string): Promise<PostDoc[]> {
  const list = await repo.listTree(POSTS_DIR, ref);
  const out: PostDoc[] = [];
  for (const entry of list) {
    const slug = entry.path.replace(/^content\/posts\//, "").replace(/\.json$/, "");
    if (slug === "index" || !POST_SLUG_PATTERN_LOCAL.test(slug)) continue;
    const raw = await readJson(repo, entry.path, ref);
    const report = checkPost(raw);
    if (report.value) out.push(report.value);
  }
  return out;
}

/** Turn a post into its index entry. */
function toIndexEntry(post: PostDoc): PostIndexEntry {
  return {
    slug: post.slug,
    path: post.path,
    title: post.settings.title,
    excerpt: post.settings.excerpt ?? "",
    coverImage: post.settings.coverImage ?? null,
    authorName: post.settings.authorName ?? "",
    publishedAt: post.settings.publishedAt ?? "",
    categories: post.settings.categories ?? [],
    tags: post.settings.tags ?? [],
  };
}

const UPLOADS = { dir: "public/assets/uploads", url: "/assets/uploads" };
const DATA_IMAGE = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/i;
const EXTENSIONS: Record<string, string> = { png: "png", jpeg: "jpg", webp: "webp", gif: "gif" };

async function shortHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest).slice(0, 6), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Pictures added in the editor are data: URLs inside the layout. Each becomes a file
 * under public/assets/uploads/ and the layout points at it. Returns the rewritten value.
 */
export async function extractUploads(value: unknown, slug: string, files: Map<string, CommitFile>, errors: string[]): Promise<unknown> {
  if (typeof value === "string") {
    const match = DATA_IMAGE.exec(value);
    if (!match) {
      // Nothing inline reaches the repository except a valid picture.
      if (/^data:/i.test(value.trim())) errors.push(`${slug}: an inline file is not a PNG, JPEG, WebP or GIF picture`);
      return value;
    }
    const data = (match[2] ?? "").replace(/\s+/g, "");
    if (!isValidBase64(data)) {
      errors.push(`${slug}: a picture's data is not valid`);
      return value;
    }
    const bytes = base64ByteLength(data);
    if (bytes > MAX_IMAGE_BYTES) {
      errors.push(`${slug}: a picture is too large (${(bytes / 1024 / 1024).toFixed(1)} MB, limit ${MAX_IMAGE_BYTES / 1024 / 1024} MB)`);
      return value;
    }
    const name = `${slug}-${await shortHash(data)}.${EXTENSIONS[(match[1] ?? "").toLowerCase()] ?? "png"}`;
    files.set(name, { path: `${UPLOADS.dir}/${name}`, content: data, encoding: "base64" });
    return `${UPLOADS.url}/${name}`;
  }
  if (Array.isArray(value)) return Promise.all(value.map((item) => extractUploads(item, slug, files, errors)));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) out[key] = await extractUploads(inner, slug, files, errors);
    return out;
  }
  return value;
}

async function readJson(repo: ContentRepo, path: string, ref: string): Promise<unknown | null> {
  try {
    return JSON.parse((await repo.readTextFile(path, ref)).text);
  } catch {
    return null;
  }
}

/** A committed layout as the validator cleans it, with its raw form and problems (for preserving unread values). */
type CommittedLayout = { raw: unknown; layout: LayoutDoc | null; problems: Problem[] };

/** A file's exact text at a ref, or null when it is not there. */
async function readText(repo: ContentRepo, path: string, ref: string): Promise<string | null> {
  try {
    return (await repo.readTextFile(path, ref)).text;
  } catch {
    return null;
  }
}
const readLayout = async (repo: ContentRepo, slug: string, ref: string): Promise<CommittedLayout> => {
  const raw = await readJson(repo, layoutPath(slug), ref);
  if (raw === null) return { raw: null, layout: null, problems: [] };
  const report = checkLayout(raw);
  return { raw, layout: report.value, problems: report.problems };
};

const normalizePath = (path: string) => {
  const trimmed = path.trim().toLowerCase().split(/[?#]/)[0] ?? "";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withSlash.endsWith("/") ? withSlash : `${withSlash}/`;
};

function validateMedia(raw: unknown): { value: MediaMeta | null; errors: string[] } {
  if (raw === null || raw === undefined) return { value: null, errors: [] };
  if (typeof raw !== "object" || Array.isArray(raw)) return { value: null, errors: ["media.json must be an object of picture paths"] };
  const out: MediaMeta = {};
  const errors: string[] = [];
  for (const [path, entry] of Object.entries(raw as Record<string, unknown>)) {
    const alt = entry && typeof entry === "object" ? (entry as { alt?: unknown }).alt : undefined;
    if (!/^\/assets\/[A-Za-z0-9._\-/]+$/.test(path) || path.includes("..")) errors.push(`media.json: "${path.slice(0, 80)}" is not a picture on this site`);
    else if (typeof alt !== "string" || alt.length > 500) errors.push(`media.json: the alt text for ${path} must be text under 500 characters`);
    else out[path] = { alt };
  }
  return { value: out, errors };
}

export type BuilderPublishOutcome = Omit<BuilderPublishResponse, "ok">;

export async function runBuilderPublish(opts: {
  repo: ContentRepo;
  input: BuilderPublishInput;
  userEmail: string;
  permissions: Permissions;
  now?: () => number;
}): Promise<BuilderPublishOutcome> {
  const { repo, permissions } = opts;
  let input = opts.input;
  if (typeof input.baseCommitSha !== "string" || input.baseCommitSha.length === 0) {
    throw new ArmatureError("invalid", "This editor session did not record which version it loaded. Reload the page and try again.");
  }
  const head = await repo.getBranchHead();
  const moved = head !== input.baseCommitSha;

  // Content fields and their pictures: validated, conflict-checked and merged as before.
  const content = await planBatchPublish({ repo, input: { baseCommitSha: input.baseCommitSha, pages: input.pages ?? [] }, head, now: opts.now, labelPages: true, allowEmpty: true });
  const site = await loadSiteFiles(repo, head);
  const codedSlugs = new Set(site.pages.map((page) => page.slug));

  const errors: string[] = [];
  const conflicts: MergeConflict[] = [];
  const files: CommitFile[] = [...content.files];
  const uploads = new Map<string, CommitFile>();
  const writtenLayouts: string[] = [];
  const labels: string[] = [...content.pageLabels];
  const finalLayouts = new Map<string, LayoutDoc | null>();

  // --- layouts ------------------------------------------------------------------
  for (const [slug, raw] of Object.entries(input.layouts ?? {})) {
    if (!isLayoutSlug(slug) || slug.length > 100) {
      errors.push(`"${slug.slice(0, 60)}" is not a valid page name`);
      continue;
    }
    const committed = await readLayout(repo, slug, head);
    const theirs = committed.layout;
    const base = moved ? (await readLayout(repo, slug, input.baseCommitSha)).layout : theirs;

    if (raw === null) {
      // Deleting a page's layout (a builder page goes away; a coded page returns to its sections).
      if (!theirs) continue;
      if (moved && stableJson(base) !== stableJson(theirs)) {
        const key = `layout:${slug}`;
        if (input.resolutions?.[key] === "theirs") continue;
        if (input.resolutions?.[key] !== "mine") {
          conflicts.push({ key, page: slug, label: `You deleted the page "${theirs.label ?? slug}"; someone else changed it` });
          continue;
        }
      }
      errors.push(...layoutPermissionErrors(theirs, null, permissions));
      finalLayouts.set(slug, null);
      continue;
    }

    const extracted = await extractUploads(raw, slug, uploads, errors);
    const report = checkLayout(extracted);
    if (!report.value) {
      errors.push(...report.problems.map((problem) => describeProblem(problem, `${slug}.json`)));
      continue;
    }
    // A value the validator cannot read is fine when the committed file already has it
    // (it is put back below, untouched); a new one is refused.
    const fresh = unpreservedProblems(report.problems, committed.raw);
    if (fresh.length > 0) {
      errors.push(...fresh.map((problem) => `${describeProblem(problem, `${slug}.json`)} Publishing is refused because this value is new.`));
      continue;
    }
    const mine = report.value;
    if (mine.pageSlug !== slug) {
      errors.push(`${slug}.json: its pageSlug says "${mine.pageSlug}"`);
      continue;
    }
    let result: LayoutDoc = mine;
    if (moved) {
      if (!theirs && base && input.resolutions?.[`layout:${slug}`] === "theirs") continue;
      const merge = mergeLayouts(base, mine, theirs, input.resolutions ?? {});
      conflicts.push(...merge.conflicts);
      result = merge.layout;
    }
    errors.push(...layoutPermissionErrors(theirs, result, permissions, { coded: codedSlugs.has(slug) }));
    finalLayouts.set(slug, restoreLayoutProblems(result, theirs ?? undefined, committed.problems));
  }

  // --- the bin: trash, restore, delete (the file moves as it is, byte for byte) ---------------
  const trashed: string[] = [];
  const restored = new Map<string, LayoutDoc>();
  for (const [slug, action] of Object.entries(input.trash ?? {})) {
    if (!PAGE_SLUG_PATTERN.test(slug) || slug.length > 100) {
      errors.push(`"${slug.slice(0, 60)}" is not a valid page name`);
      continue;
    }
    if (action === "trash") {
      if (codedSlugs.has(slug)) {
        errors.push(`"${slug}" is a page coded into the site; it cannot be moved to the bin.`);
        continue;
      }
      if (finalLayouts.has(slug)) {
        errors.push(`"${slug}" cannot be changed and moved to the bin in the same publish.`);
        continue;
      }
      const text = await readText(repo, layoutPath(slug), head);
      const committed = await readLayout(repo, slug, head);
      if (text === null || !committed.layout) {
        errors.push(`There is no page called "${slug}" to move to the bin; it may already be gone.`);
        continue;
      }
      errors.push(...layoutPermissionErrors(committed.layout, null, permissions));
      files.push({ path: layoutPath(slug), content: "", encoding: "utf-8", delete: true });
      files.push({ path: trashPath(slug), content: text, encoding: "utf-8" });
      finalLayouts.set(slug, null);
      trashed.push(slug);
      labels.push(`${committed.layout.label ?? slug} (to the bin)`);
    } else if (action === "restore") {
      const text = await readText(repo, trashPath(slug), head);
      const report = text === null ? null : checkLayout(JSON.parse(text));
      if (text === null || !report?.value) {
        errors.push(`There is no page called "${slug}" in the bin.`);
        continue;
      }
      if (codedSlugs.has(slug) || (await readText(repo, layoutPath(slug), head)) !== null) {
        errors.push(`A page called "${slug}" already exists, so the one in the bin cannot be restored under that name.`);
        continue;
      }
      const layout = { ...report.value, pageSlug: slug };
      errors.push(...layoutPermissionErrors(null, layout, permissions));
      files.push({ path: trashPath(slug), content: "", encoding: "utf-8", delete: true });
      files.push({ path: layoutPath(slug), content: text, encoding: "utf-8" });
      restored.set(slug, layout);
      trashed.push(slug);
      labels.push(`${layout.label ?? slug} (restored)`);
    } else if (action === "delete") {
      const text = await readText(repo, trashPath(slug), head);
      if (text === null) {
        errors.push(`There is no page called "${slug}" in the bin.`);
        continue;
      }
      const report = checkLayout(JSON.parse(text));
      errors.push(...layoutPermissionErrors(report.value ? { ...report.value, pageSlug: slug } : null, null, permissions));
      files.push({ path: trashPath(slug), content: "", encoding: "utf-8", delete: true });
      trashed.push(slug);
      labels.push(`${report.value?.label ?? slug} (deleted from the bin)`);
    } else {
      errors.push(`"${String(action).slice(0, 20)}" is not something the bin can do.`);
    }
  }

  // --- copies: a new page from an existing builder page's file, nothing lost ------------------
  for (const [slug, copy] of Object.entries(input.copies ?? {})) {
    if (!PAGE_SLUG_PATTERN.test(slug) || slug.length > 100) {
      errors.push(`"${slug.slice(0, 60)}" is not a valid page name`);
      continue;
    }
    if (codedSlugs.has(slug) || finalLayouts.has(slug) || restored.has(slug) || (await readText(repo, layoutPath(slug), head)) !== null) {
      errors.push(`A page called "${slug}" already exists.`);
      continue;
    }
    const text = typeof copy?.from === "string" && PAGE_SLUG_PATTERN.test(copy.from) ? await readText(repo, layoutPath(copy.from), head) : null;
    const source = text === null ? undefined : (JSON.parse(text) as Record<string, unknown>);
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      errors.push(`There is no page called "${String(copy?.from ?? "").slice(0, 60)}" to copy.`);
      continue;
    }
    const label = typeof copy.label === "string" ? copy.label.trim().slice(0, 120) : "";
    const path = typeof copy.path === "string" ? copy.path.trim() : "";
    const raw = { ...source, pageSlug: slug, label: label || `${String(source["label"] ?? copy.from)} (copy)`, path: path || `/${slug}/` };
    const report = checkLayout(raw);
    if (!report.value) {
      errors.push(...report.problems.map((problem) => describeProblem(problem, `${slug}.json`)));
      continue;
    }
    const layout = { ...report.value, pageSlug: slug };
    errors.push(...layoutPermissionErrors(null, layout, permissions));
    files.push({ path: layoutPath(slug), content: serializeBuilderFile(raw), encoding: "utf-8" });
    restored.set(slug, layout);
    writtenLayouts.push(slug);
    labels.push(`${layout.label ?? slug} (copied from ${String(source["label"] ?? copy.from)})`);
  }

  // Paths: a builder page may not take a coded page's path or another page's.
  const pathOwners = new Map<string, string>();
  for (const page of site.pages) pathOwners.set(normalizePath(page.path), page.slug);
  const allLayouts = new Map<string, LayoutDoc>();
  for (const entry of await repo.listTree("content/layouts", head)) {
    const slug = entry.path.replace(/^content\/layouts\//, "").replace(/\.json$/, "");
    if (!finalLayouts.has(slug) && isLayoutSlug(slug)) {
      const { layout } = await readLayout(repo, slug, head);
      if (layout) allLayouts.set(slug, layout);
    }
  }
  for (const [slug, layout] of finalLayouts) if (layout) allLayouts.set(slug, layout);
  for (const [slug, layout] of restored) allLayouts.set(slug, layout);
  for (const [slug, layout] of allLayouts) {
    // Coded pages own their paths already; the header and footer parts have no address of their own.
    if (codedSlugs.has(slug) || isChromeSlug(slug)) continue;
    const path = normalizePath(layout.path);
    const owner = pathOwners.get(path);
    if (owner && owner !== slug) errors.push(`The page "${layout.label ?? slug}" uses the address ${layout.path}, which ${codedSlugs.has(owner) ? "a page coded into the site" : `the page "${allLayouts.get(owner)?.label ?? owner}"`} already uses.`);
    else pathOwners.set(path, slug);
  }

  for (const [slug, layout] of finalLayouts) {
    if (trashed.includes(slug)) continue;
    if (layout === null) {
      files.push({ path: layoutPath(slug), content: "", encoding: "utf-8", delete: true });
    } else {
      const text = serializeBuilderFile(layout);
      if (layoutBytes(layout) > LAYOUT_LIMITS.fileBytes) errors.push(`${slug}.json: the page is larger than ${LAYOUT_LIMITS.fileBytes / 1024 / 1024} MB; split it into two pages`);
      files.push({ path: layoutPath(slug), content: text, encoding: "utf-8" });
    }
    writtenLayouts.push(slug);
    labels.push(layout?.label ?? site.pages.find((page) => page.slug === slug)?.label ?? slug);
  }
  let uploadBytes = 0;
  for (const file of uploads.values()) uploadBytes += base64ByteLength(file.content);
  if (uploadBytes > MAX_TOTAL_IMAGE_BYTES) errors.push(`The new pictures total ${(uploadBytes / 1024 / 1024).toFixed(1)} MB, more than one publish can carry (${MAX_TOTAL_IMAGE_BYTES / 1024 / 1024} MB). Publish fewer at a time.`);

  // --- the site kit ------------------------------------------------------------------
  let kitWritten = false;
  if (input.kit !== null && input.kit !== undefined) {
    const theirsRaw = await readJson(repo, SITE_KIT_PATH, head);
    const report = checkSiteKit(input.kit);
    const fresh = unpreservedProblems(report.problems, theirsRaw);
    if (fresh.length > 0 || !report.value) errors.push(...fresh.map((problem) => `${describeProblem(problem, "site-kit.json")} Publishing is refused because this value is new.`));
    else {
      const committed = theirsRaw ? checkSiteKit(theirsRaw) : null;
      const theirs = committed?.value ?? defaultSiteKit();
      let next: SiteKit = report.value;
      if (moved) {
        const baseRaw = await readJson(repo, SITE_KIT_PATH, input.baseCommitSha);
        const base = (baseRaw ? checkSiteKit(baseRaw).value : null) ?? defaultSiteKit();
        const merge = mergeValues("kit", base, report.value, theirs, input.resolutions ?? {}, (path) => `Site settings: ${path.replace(/\./g, " → ")}`);
        conflicts.push(...merge.conflicts);
        next = merge.value;
      }
      const changed = stableJson(next) !== stableJson(theirs) || !theirsRaw;
      errors.push(...kitPermissionErrors(stableJson(next) !== stableJson(theirs), permissions));
      if (changed) {
        const check = checkSiteKit(next);
        if (check.problems.length > 0) errors.push(...check.problems.map((problem) => describeProblem(problem, "site-kit.json")));
        files.push({ path: SITE_KIT_PATH, content: serializeBuilderFile(restoreKitProblems(next, theirs, committed?.problems ?? [])), encoding: "utf-8" });
        kitWritten = true;
        labels.push("Site settings");
      }
    }
  }

  // --- the media library: uploads and deletions ---------------------------------------------
  const libraryUploads: string[] = [];
  const deleted: string[] = [];
  if ((input.uploads?.length ?? 0) > 0 || (input.deleteAssets?.length ?? 0) > 0) {
    const existing = new Set((await repo.listTree("public/assets", head)).map((entry) => `/${entry.path.replace(/^public\//, "")}`));
    for (const upload of input.uploads ?? []) {
      const match = typeof upload?.data === "string" ? DATA_IMAGE.exec(upload.data) : null;
      if (!match) {
        errors.push(`"${String(upload?.name ?? "").slice(0, 60)}" is not a PNG, JPEG, WebP or GIF picture`);
        continue;
      }
      const data = (match[2] ?? "").replace(/\s+/g, "");
      if (!isValidBase64(data)) {
        errors.push(`"${String(upload.name).slice(0, 60)}": the picture's data is not valid`);
        continue;
      }
      const bytes = base64ByteLength(data);
      if (bytes > MAX_IMAGE_BYTES) {
        errors.push(`"${String(upload.name).slice(0, 60)}" is too large (${(bytes / 1024 / 1024).toFixed(1)} MB, limit ${MAX_IMAGE_BYTES / 1024 / 1024} MB)`);
        continue;
      }
      const ext = EXTENSIONS[(match[1] ?? "").toLowerCase()] ?? "png";
      const base =
        String(upload.name ?? "")
          .replace(/\.[a-z0-9]+$/i, "")
          .toLowerCase()
          .normalize("NFKD")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 60) || "picture";
      let name = `${base}.${ext}`;
      let n = 2;
      while (existing.has(`${UPLOADS.url}/${name}`)) name = `${base}-${n++}.${ext}`;
      existing.add(`${UPLOADS.url}/${name}`);
      files.push({ path: `${UPLOADS.dir}/${name}`, content: data, encoding: "base64" });
      libraryUploads.push(`${UPLOADS.url}/${name}`);
    }
    for (const path of input.deleteAssets ?? []) {
      if (typeof path !== "string" || !/^\/assets\/[A-Za-z0-9._\-/]+$/.test(path) || path.includes("..")) {
        errors.push(`"${String(path).slice(0, 80)}" is not a picture on this site`);
        continue;
      }
      if (!existing.has(path)) {
        errors.push(`There is no picture at ${path}; it may already be gone.`);
        continue;
      }
      if (!permissions.staff && permissions.level !== "builder") {
        errors.push("Your account cannot delete pictures from the library; ask the agency.");
        continue;
      }
      files.push({ path: `public${path}`, content: "", encoding: "utf-8", delete: true });
      deleted.push(path);
    }
    if (libraryUploads.length > 0 || deleted.length > 0) labels.push("Media library");
  }

  // --- media metadata (alt text) -----------------------------------------------------------
  let mediaWritten = false;
  if (deleted.length > 0 && (input.media === null || input.media === undefined)) {
    // A deleted picture's alt text goes with it.
    const theirs = validateMedia(await readJson(repo, MEDIA_META_PATH, head)).value ?? {};
    if (deleted.some((path) => path in theirs)) input = { ...input, media: Object.fromEntries(Object.entries(theirs).filter(([path]) => !deleted.includes(path))) };
  }
  if (input.media !== null && input.media !== undefined) {
    const mine = validateMedia(input.media);
    errors.push(...mine.errors);
    if (mine.value) {
      const theirs = validateMedia(await readJson(repo, MEDIA_META_PATH, head)).value ?? {};
      let next = mine.value;
      if (moved) {
        const base = validateMedia(await readJson(repo, MEDIA_META_PATH, input.baseCommitSha)).value ?? {};
        const merge = mergeValues("media", base, mine.value, theirs, input.resolutions ?? {}, (path) => `Alt text for ${path.replace(/\.alt$/, "")}`);
        conflicts.push(...merge.conflicts);
        next = merge.value;
      }
      if (!permissions.staff && permissions.level === "content" && stableJson(next) !== stableJson(theirs)) errors.push("Your account cannot change the media library's alt text.");
      if (stableJson(next) !== stableJson(theirs)) {
        files.push({ path: MEDIA_META_PATH, content: serializeBuilderFile(next), encoding: "utf-8" });
        mediaWritten = true;
      }
    }
  }

  // --- posts (the blog) ------------------------------------------------------
  // A post is a layout file with kind: "post". `input.posts` is a slug → cleaned
  // post document (or null to delete). Whenever any post changes we regenerate
  // content/posts/index.json and public/rss.xml so the site's list, individual
  // post pages and RSS feed stay in step. Scheduled posts (a future publishedAt)
  // sit in the repo and the site filters them out at render time.
  const writtenPosts: string[] = [];
  const finalPosts = new Map<string, PostDoc | null>();
  if (input.posts) {
    for (const [slug, raw] of Object.entries(input.posts)) {
      if (!POST_SLUG_PATTERN_LOCAL.test(slug)) {
        errors.push(`"${slug.slice(0, 60)}" is not a valid post name`);
        continue;
      }
      if (raw === null) {
        finalPosts.set(slug, null);
        continue;
      }
      const withUploads = await extractUploads(raw, `post:${slug}`, uploads, errors);
      const report = checkPost(withUploads);
      if (!report.value) {
        errors.push(...report.problems.map((problem) => describeProblem(problem, `posts/${slug}.json`)));
        continue;
      }
      if (report.value.slug !== slug) {
        errors.push(`posts/${slug}.json: its slug says "${report.value.slug}"`);
        continue;
      }
      finalPosts.set(slug, report.value);
    }
    // Write the changed post files.
    for (const [slug, post] of finalPosts) {
      if (post === null) {
        files.push({ path: postPath(slug), content: "", encoding: "utf-8", delete: true });
      } else {
        files.push({ path: postPath(slug), content: serializeBuilderFile(post), encoding: "utf-8" });
      }
      writtenPosts.push(slug);
      labels.push(post ? `post: ${post.settings.title}` : `post: ${slug} (deleted)`);
    }
  }
  // If any post changed, regenerate the index and rss.xml. Both are computed from what
  // the repo would look like after this commit (existing posts, minus deleted, plus new).
  let kitForFeeds: SiteKit | null = null;
  if (finalPosts.size > 0) {
    kitForFeeds = kitWritten
      ? (checkSiteKit(JSON.parse(files.find((file) => file.path === SITE_KIT_PATH)?.content ?? "null") ?? {}).value ?? null)
      : (checkSiteKit(await readJson(repo, SITE_KIT_PATH, head)).value ?? null);
    const existing = await readAllPostsAt(repo, head);
    const bySlug = new Map<string, PostDoc>();
    for (const post of existing) bySlug.set(post.slug, post);
    for (const [slug, post] of finalPosts) {
      if (post === null) bySlug.delete(slug);
      else bySlug.set(slug, post);
    }
    const entries = Array.from(bySlug.values()).map(toIndexEntry).sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
    const nextIndex: PostIndex = { version: 1, posts: entries };
    files.push({ path: POST_INDEX_PATH, content: serializeBuilderFile(nextIndex), encoding: "utf-8" });
    const nextRss = rssXml(kitForFeeds, entries);
    files.push({ path: "public/rss.xml", content: nextRss, encoding: "utf-8" });
  }

  if (errors.length > 0) throw new ArmatureError(errors.some((error) => /your account|managed by the agency|only the agency|is locked/i.test(error)) ? "forbidden" : "invalid", Array.from(new Set(errors)).join("\n"));
  if (conflicts.length > 0) {
    throw new ArmatureError(
      "conflict",
      `Someone else published changes to the same ${conflicts.length === 1 ? "thing" : `${conflicts.length} things`} while you were editing. Choose, for each, whether to keep your version or theirs; everything else in your draft is kept.`,
      conflicts.map((conflict) => conflict.label),
      conflicts,
    );
  }
  files.push(...uploads.values());
  if (files.length === 0) throw new ArmatureError("invalid", "There are no changes to publish.");

  // --- sitemap.xml and robots.txt ---------------------------------------------------------
  // Written on every publish so the site's search-engine files stay in step with the pages
  // that exist. Both live under public/ so a static host serves them at /sitemap.xml and
  // /robots.txt without any extra route.
  const seoLayouts = new Map<string, LayoutDoc>(allLayouts);
  // Coded pages need a layout entry too, else they are absent from the sitemap. Use the
  // schema's label as the pseudo layout for them.
  for (const page of site.pages) if (!seoLayouts.has(page.slug)) seoLayouts.set(page.slug, { version: 1, pageSlug: page.slug, path: page.path, label: page.label, root: [] });
  // Use the calendar day (UTC) for lastmod so re-running the same publish doesn't spam a
  // new sitemap commit every time — search engines don't care about sub-day precision.
  const publishedIso = new Date(opts.now ? opts.now() : Date.now()).toISOString().slice(0, 10);
  const sitemapPaths = new Map<string, SitemapEntry>();
  for (const [slug, layout] of seoLayouts) {
    if (isChromeSlug(slug)) continue;
    if (layout.seo?.noindex) continue;
    const key = normalizePath(layout.path || "/");
    // Dedupe by path — several slugs may map to the same URL (a coded chrome page's
    // "shared" pseudo-page, for example). Keep the first (they hold the same URL).
    if (!sitemapPaths.has(key)) sitemapPaths.set(key, { path: layout.path || "/", lastmod: publishedIso });
  }
  const sitemapEntries: SitemapEntry[] = Array.from(sitemapPaths.values()).sort((a, b) => a.path.localeCompare(b.path));
  // Read the kit that will actually be committed (either the freshly written one, or the
  // committed one when nothing about the kit changed in this publish) so the sitemap URL
  // comes from siteSeo.siteUrl. Reuses kitForFeeds if it was already computed above.
  const kitForSeo: SiteKit | null = kitForFeeds ?? (kitWritten
    ? (checkSiteKit(JSON.parse(files.find((file) => file.path === SITE_KIT_PATH)?.content ?? "null") ?? {}).value ?? null)
    : (checkSiteKit(await readJson(repo, SITE_KIT_PATH, head)).value ?? null));
  const siteUrl = kitForSeo?.seo?.siteUrl ?? "";
  const nextSitemap = sitemapXml(siteUrl, sitemapEntries);
  const nextRobots = robotsTxt(siteUrl, kitForSeo?.seo?.robotsExtras);
  const existingSitemap = await readText(repo, "public/sitemap.xml", head);
  const existingRobots = await readText(repo, "public/robots.txt", head);
  if (existingSitemap !== nextSitemap) files.push({ path: "public/sitemap.xml", content: nextSitemap, encoding: "utf-8" });
  if (existingRobots !== nextRobots) files.push({ path: "public/robots.txt", content: nextRobots, encoding: "utf-8" });

  const result = await repo.commit({
    message: `Pages: ${Array.from(new Set(labels)).join(", ") || "site"} updated by ${opts.userEmail}`,
    files,
    parentCommitSha: head,
  });
  return {
    commitSha: result.commitSha,
    commitUrl: result.commitUrl,
    fields: content.fields,
    images: [...content.images, ...[...uploads.keys()].map((name) => `${UPLOADS.url}/${name}`), ...libraryUploads],
    deleted,
    slugs: Array.from(new Set([...content.slugs, ...writtenLayouts])),
    layouts: writtenLayouts,
    trash: trashed,
    kit: kitWritten,
    media: mediaWritten,
    merged: moved,
    posts: writtenPosts,
  };
}

/** Parse the request body (shapes only; every value is validated by runBuilderPublish). */
export function parseBuilderPublishRequest(raw: Record<string, unknown>): BuilderPublishInput & { site_id: string } {
  const pages = Array.isArray(raw["pages"]) ? (raw["pages"] as BatchPageUpdate[]) : [];
  const layouts = raw["layouts"] && typeof raw["layouts"] === "object" && !Array.isArray(raw["layouts"]) ? (raw["layouts"] as Record<string, unknown>) : {};
  const resolutionsRaw = raw["resolutions"] && typeof raw["resolutions"] === "object" ? (raw["resolutions"] as Record<string, unknown>) : {};
  const resolutions: Record<string, Resolution> = {};
  for (const [key, value] of Object.entries(resolutionsRaw)) if ((value === "mine" || value === "theirs") && key.length < 200) resolutions[key] = value;
  const trashRaw = raw["trash"] && typeof raw["trash"] === "object" && !Array.isArray(raw["trash"]) ? (raw["trash"] as Record<string, unknown>) : {};
  const trash: Record<string, TrashAction> = {};
  for (const [slug, action] of Object.entries(trashRaw)) if ((action === "trash" || action === "restore" || action === "delete") && slug.length <= 100) trash[slug] = action;
  const copiesRaw = raw["copies"] && typeof raw["copies"] === "object" && !Array.isArray(raw["copies"]) ? (raw["copies"] as Record<string, unknown>) : {};
  const copies: Record<string, PageCopy> = {};
  for (const [slug, copy] of Object.entries(copiesRaw)) {
    if (slug.length > 100 || !copy || typeof copy !== "object") continue;
    const entry = copy as Record<string, unknown>;
    copies[slug] = { from: String(entry["from"] ?? ""), label: String(entry["label"] ?? ""), path: String(entry["path"] ?? "") };
  }
  const uploads: MediaUpload[] = (Array.isArray(raw["uploads"]) ? raw["uploads"] : []).slice(0, 50).map((entry) => ({ name: String((entry as Record<string, unknown>)?.["name"] ?? ""), data: String((entry as Record<string, unknown>)?.["data"] ?? "") }));
  const deleteAssets: string[] = (Array.isArray(raw["deleteAssets"]) ? raw["deleteAssets"] : []).slice(0, 100).map((entry) => String(entry));
  const posts: Record<string, unknown | null> = {};
  const postsRaw = raw["posts"] && typeof raw["posts"] === "object" && !Array.isArray(raw["posts"]) ? (raw["posts"] as Record<string, unknown>) : {};
  for (const [slug, value] of Object.entries(postsRaw)) if (slug.length <= 100) posts[slug] = value;
  return {
    site_id: typeof raw["site_id"] === "string" ? raw["site_id"] : "",
    baseCommitSha: typeof raw["baseCommitSha"] === "string" ? raw["baseCommitSha"] : "",
    pages: pages.map((page) => ({ slug: String(page?.slug ?? ""), fields: Array.isArray(page?.fields) ? page.fields : [], images: Array.isArray(page?.images) ? page.images : [] })),
    layouts,
    kit: raw["kit"] ?? null,
    media: raw["media"] ?? null,
    trash,
    copies,
    uploads,
    deleteAssets,
    resolutions,
    posts,
  };
}

export const permissionsFor = (staff: boolean, level: EditingLevel | null | undefined): Permissions => ({ staff, level: level === "style" || level === "builder" ? level : "content" });
