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
import type { BatchPageUpdate, BuilderPublishResponse, EditingLevel, MediaMeta, PageCopy, TrashAction } from "../../../shared/publishTypes.ts";
import { defaultSiteKit } from "../../../kit/defaults.ts";
import type { LayoutDoc, SiteKit } from "../../../kit/types.ts";
import { mergeLayouts, mergeValues, stableJson, type MergeConflict, type Resolution } from "../../../shared/builder/merge.ts";
import { kitPermissionErrors, layoutPermissionErrors, type Permissions } from "../../../shared/builder/permissions.ts";
import { checkLayout, checkSiteKit, describeProblem, LAYOUT_LIMITS, MEDIA_META_PATH, PAGE_SLUG_PATTERN, SITE_KIT_PATH, layoutBytes, layoutPath, serializeBuilderFile, trashPath, type Problem } from "../../../shared/builder/schema.ts";
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
};

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
  const { repo, input, permissions } = opts;
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
    if (!PAGE_SLUG_PATTERN.test(slug) || slug.length > 100) {
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
    if (!finalLayouts.has(slug) && PAGE_SLUG_PATTERN.test(slug)) {
      const { layout } = await readLayout(repo, slug, head);
      if (layout) allLayouts.set(slug, layout);
    }
  }
  for (const [slug, layout] of finalLayouts) if (layout) allLayouts.set(slug, layout);
  for (const [slug, layout] of restored) allLayouts.set(slug, layout);
  for (const [slug, layout] of allLayouts) {
    if (codedSlugs.has(slug)) continue;
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

  // --- media metadata (alt text) -----------------------------------------------------------
  let mediaWritten = false;
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

  const result = await repo.commit({
    message: `Pages: ${Array.from(new Set(labels)).join(", ") || "site"} updated by ${opts.userEmail}`,
    files,
    parentCommitSha: head,
  });
  return {
    commitSha: result.commitSha,
    commitUrl: result.commitUrl,
    fields: content.fields,
    images: [...content.images, ...[...uploads.keys()].map((name) => `${UPLOADS.url}/${name}`)],
    slugs: Array.from(new Set([...content.slugs, ...writtenLayouts])),
    layouts: writtenLayouts,
    trash: trashed,
    kit: kitWritten,
    media: mediaWritten,
    merged: moved,
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
  return {
    site_id: typeof raw["site_id"] === "string" ? raw["site_id"] : "",
    baseCommitSha: typeof raw["baseCommitSha"] === "string" ? raw["baseCommitSha"] : "",
    pages: pages.map((page) => ({ slug: String(page?.slug ?? ""), fields: Array.isArray(page?.fields) ? page.fields : [], images: Array.isArray(page?.images) ? page.images : [] })),
    layouts,
    kit: raw["kit"] ?? null,
    media: raw["media"] ?? null,
    trash,
    copies,
    resolutions,
  };
}

export const permissionsFor = (staff: boolean, level: EditingLevel | null | undefined): Permissions => ({ staff, level: level === "style" || level === "builder" ? level : "content" });
