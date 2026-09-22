/**
 * The git-first publish logic, ported from the pilot's publish.server.ts: take the
 * fields an editor changed, merge them into the committed content, and write one
 * commit.
 *
 * SERVER ONLY.
 *
 * Differences from the pilot, and nothing else:
 * - the field map comes from the site's own content/schema.json at the branch head
 *   instead of a module constant, because every site has its own;
 * - the per-image ceiling is 3 MB, because the browser resizes before upload.
 *
 * Everything here takes its dependencies as arguments (a `ContentRepo`, a clock), so
 * the whole flow is unit-testable without GitHub. All validation runs BEFORE the
 * first network call that could write, so an invalid publish never creates a commit.
 *
 * `runBatchPublish` is the engine: any number of pages, one commit. `runPublish` (the
 * form editor, one page) is the same engine with a one-page batch, so the two can
 * never enforce different rules.
 */
import {
  CONTENT_PATH,
  UPLOAD_DIR,
  UPLOAD_URL_PREFIX,
  cloneContent,
  isPlainObject,
  serializeContent,
  type ContentTree,
  type ContentValue,
} from "../../../shared/contentFile.ts";
import {
  SCHEMA_PATH,
  getPageDefinition,
  validateSiteSchema,
  type PageDefinition,
  type SiteSchema,
} from "../../../shared/schema.ts";
import {
  changedFieldsForPage,
  fieldLabel,
  validateContentTree,
  validateFieldUpdate,
} from "../../../shared/contentValidation.ts";
import { base64ByteLength, isValidBase64, utf8ToBase64 } from "../../../shared/base64.ts";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_TOTAL_IMAGE_BYTES,
  type BatchImageUpload,
  type BatchPageUpdate,
  type FieldUpdate,
  type ImageUpload,
  type PublishBatchRequest,
  type PublishRequest,
} from "../../../shared/publishTypes.ts";
import { ArmatureError } from "./errors.ts";
import type { CommitFile, ContentRepo } from "./githubRepo.ts";

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
};

export type PublishInput = {
  slug: string;
  /** Commit sha the editor loaded its content from. */
  baseCommitSha: string;
  fields: FieldUpdate[];
  images: ImageUpload[];
};

export type PublishOutcome = {
  commitSha: string;
  commitUrl: string;
  /** "section.field" keys written. */
  fields: string[];
  /** Public URLs of images added by this publish. */
  images: string[];
};

// ---------------------------------------------------------------------------
// Reading the two contract files at a ref
// ---------------------------------------------------------------------------

export type SiteFiles = {
  schema: SiteSchema;
  pages: PageDefinition[];
  content: ContentTree;
  contentText: string;
  /** Non-blocking notes from both validators. */
  warnings: string[];
  /** Problems in the committed content file. Publishing is blocked while any exist. */
  contentErrors: string[];
};

export function parseJsonFile(path: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ArmatureError(
      "github_error",
      `${path} on the content branch is not valid JSON, so it cannot be edited safely. Fix the file in the repository first.`,
    );
  }
}

/** Read and validate content/schema.json and content/pages.json at `ref`. */
export async function loadSiteFiles(repo: ContentRepo, ref: string): Promise<SiteFiles> {
  const schemaFile = await repo.readTextFile(SCHEMA_PATH, ref);
  const schemaReport = validateSiteSchema(parseJsonFile(SCHEMA_PATH, schemaFile.text));
  if (!schemaReport.schema) {
    throw new ArmatureError(
      "invalid",
      `${SCHEMA_PATH} does not follow the site contract, so nothing can be edited:\n${schemaReport.errors.join("\n")}`,
    );
  }

  const contentFile = await repo.readTextFile(CONTENT_PATH, ref);
  const content = parseJsonFile(CONTENT_PATH, contentFile.text);
  if (!isPlainObject(content)) {
    throw new ArmatureError("github_error", `${CONTENT_PATH} is not a JSON object.`);
  }
  const contentReport = validateContentTree(content, schemaReport.schema.pages);

  return {
    schema: schemaReport.schema,
    pages: schemaReport.schema.pages,
    content: content as ContentTree,
    contentText: contentFile.text,
    warnings: [...schemaReport.warnings, ...contentReport.warnings],
    contentErrors: contentReport.errors,
  };
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

/** Turn an uploaded filename into a short, safe slug for the committed path. */
function safeBaseName(filename: string): string {
  const withoutExtension = filename.replace(/\.[^./\\]*$/, "");
  const cleaned = withoutExtension
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (cleaned || "image").slice(0, 60);
}

type PreparedImage = {
  key: string;
  url: string;
  file: CommitFile;
  /** For a list item picture: which item and which of its fields. */
  index?: number;
  itemKey?: string;
};

/** Validate the uploads and decide where each one is committed. */
function prepareImages(
  slug: string,
  images: BatchImageUpload[],
  timestamp: number,
  totalSoFar = 0,
): { prepared: PreparedImage[]; errors: string[]; total: number } {
  const prepared: PreparedImage[] = [];
  const errors: string[] = [];
  let total = totalSoFar;

  images.forEach((image, position) => {
    const where = `image ${position + 1} (${image.filename || "unnamed"})`;

    const extension = IMAGE_EXTENSIONS[image.contentType?.toLowerCase() ?? ""];
    if (!extension) {
      errors.push(
        `${where}: only PNG, JPEG and WebP images can be uploaded — got "${image.contentType}"`,
      );
      return;
    }

    if (typeof image.dataBase64 !== "string" || !isValidBase64(image.dataBase64)) {
      errors.push(`${where}: the uploaded file data is not valid base64`);
      return;
    }

    const bytes = base64ByteLength(image.dataBase64);
    if (bytes === 0) {
      errors.push(`${where}: the uploaded file is empty`);
      return;
    }
    if (bytes > MAX_IMAGE_BYTES) {
      errors.push(
        `${where}: too large (${(bytes / 1024 / 1024).toFixed(1)} MB, limit ${MAX_IMAGE_BYTES / 1024 / 1024} MB)`,
      );
      return;
    }
    total += bytes;

    const suffix = prepared.length > 0 ? `-${prepared.length + 1}` : "";
    const name = `${slug}-${timestamp}-${safeBaseName(image.filename)}${suffix}.${extension}`;
    const item: PreparedImage = {
      key: `${image.section}.${image.field}`,
      url: `${UPLOAD_URL_PREFIX}/${name}`,
      file: {
        path: `${UPLOAD_DIR}/${name}`,
        content: image.dataBase64.replace(/\s+/g, ""),
        encoding: "base64",
      },
    };
    if (typeof image.index === "number" && typeof image.itemKey === "string") {
      item.index = image.index;
      item.itemKey = image.itemKey;
    }
    prepared.push(item);
  });

  if (total > MAX_TOTAL_IMAGE_BYTES) {
    errors.push(
      `The images in this publish total ${(total / 1024 / 1024).toFixed(1)} MB, more than the ${(
        MAX_TOTAL_IMAGE_BYTES /
        1024 /
        1024
      ).toFixed(0)} MB a single publish can carry. Publish fewer images at a time.`,
    );
  }

  return { prepared, errors, total };
}

// ---------------------------------------------------------------------------
// The publish
// ---------------------------------------------------------------------------

export type BatchPublishInput = {
  /** Commit sha the editor loaded its content from. */
  baseCommitSha: string;
  pages: BatchPageUpdate[];
};

export type BatchPublishOutcome = {
  commitSha: string;
  commitUrl: string;
  /** "slug.section.field" keys written, in page order. */
  fields: string[];
  /** Public URLs of images added by this publish. */
  images: string[];
  /** Slugs of the pages the commit touched, in request order. */
  slugs: string[];
};

/**
 * Merge every page's changes into the committed content and write ONE commit.
 *
 * Throws `ArmatureError` with a code the editor can act on:
 * - `invalid`   — bad input or content that would fail the whole-file check. Nothing committed.
 * - `conflict`  — someone else changed the same fields (on any page). Nothing committed.
 * - `forbidden` / `not_configured` / `github_error` — see githubRepo.ts.
 */
/** What a content publish would write, checked and merged but not committed yet. */
export type BatchPlan = {
  head: string;
  files: CommitFile[];
  fields: string[];
  images: string[];
  slugs: string[];
  pageLabels: string[];
};

export async function planBatchPublish(opts: {
  repo: ContentRepo;
  input: BatchPublishInput;
  now?: () => number;
  /** Prefix conflict labels with the page label ("Home → Hero → Headline"). */
  labelPages?: boolean;
  /** The builder publish may carry no content changes at all (layouts only). */
  allowEmpty?: boolean;
  /** The branch head the whole publish is based on (read once by the caller). */
  head?: string;
}): Promise<BatchPlan> {
  const { repo, input } = opts;
  const now = opts.now ?? (() => Date.now());

  const pagesInput = (input.pages ?? []).filter((page) => page && typeof page.slug === "string");
  const anyChange = pagesInput.some((page) => (page.fields ?? []).length > 0 || (page.images ?? []).length > 0);
  if (!anyChange && !opts.allowEmpty) {
    throw new ArmatureError("invalid", "There are no changes to publish.");
  }

  if (typeof input.baseCommitSha !== "string" || input.baseCommitSha.length === 0) {
    throw new ArmatureError(
      "invalid",
      "This editor session did not record which version it loaded. Reload the page and try again.",
    );
  }

  // --- read the current state -----------------------------------------------
  // The schema is read first because every validation below depends on it.
  const head = opts.head ?? (await repo.getBranchHead());
  const current = await loadSiteFiles(repo, head);
  if (!anyChange) return { head, files: [], fields: [], images: [], slugs: [], pageLabels: [] };
  const pages = current.pages;

  // --- validate everything before touching anything that writes -----------
  const errors: string[] = [];
  const timestamp = now();
  type PagePlan = { page: PageDefinition; updates: Map<string, ContentValue>; prepared: PreparedImage[] };
  const plans: PagePlan[] = [];
  const seenSlugs = new Set<string>();
  let imageTotal = 0;

  for (const pageInput of pagesInput) {
    const page = getPageDefinition(pages, pageInput.slug);
    if (!page) {
      throw new ArmatureError("invalid", `"${pageInput.slug}" is not a page this site can edit.`);
    }
    if (seenSlugs.has(page.slug)) {
      errors.push(`${page.slug}: sent twice in one publish`);
      continue;
    }
    seenSlugs.add(page.slug);

    const updates = new Map<string, ContentValue>();
    for (const update of pageInput.fields ?? []) {
      const key = `${update.section}.${update.field}`;
      if (updates.has(key)) {
        errors.push(`${key}: sent twice in one publish`);
        continue;
      }
      updates.set(key, update.value);
    }

    const images = prepareImages(page.slug, pageInput.images ?? [], timestamp, imageTotal);
    imageTotal = images.total;
    errors.push(...images.errors);

    for (const image of images.prepared) {
      if (image.index === undefined || image.itemKey === undefined) {
        // An uploaded image decides its field's value, whatever the client sent for it.
        updates.set(image.key, image.url);
        continue;
      }
      // A list item picture: write the path into that item of the list being published
      // (or of the committed list, if the list itself was not sent).
      const [sectionKey = "", ...rest] = image.key.split(".");
      const fieldKey = rest.join(".");
      const existing = updates.get(image.key) ?? current.content[page.slug]?.[sectionKey]?.[fieldKey];
      if (!Array.isArray(existing)) {
        errors.push(`${page.slug}.${image.key}: is not a list, so it cannot take an item picture`);
        continue;
      }
      const list = cloneContent(existing) as Record<string, string>[];
      const item = list[image.index];
      if (!item) {
        errors.push(`${page.slug}.${image.key}[${image.index}]: there is no item ${image.index + 1} to attach the picture to`);
        continue;
      }
      item[image.itemKey] = image.url;
      updates.set(image.key, list);
    }

    for (const [key, value] of updates) {
      const [sectionKey, ...rest] = key.split(".");
      const fieldKey = rest.join(".");
      const result = validateFieldUpdate(pages, page.slug, sectionKey ?? "", fieldKey, value);
      errors.push(...result.errors);
    }

    plans.push({ page, updates, prepared: images.prepared });
  }

  if (errors.length > 0) {
    throw new ArmatureError("invalid", errors.join("\n"));
  }

  // --- conflict check ---------------------------------------------------------
  if (head !== input.baseCommitSha) {
    let base: unknown;
    try {
      const baseFile = await repo.readTextFile(CONTENT_PATH, input.baseCommitSha);
      base = JSON.parse(baseFile.text);
    } catch {
      throw new ArmatureError(
        "conflict",
        "The content has changed since you opened this page, and the version you started from is no longer available. Reload to get the latest content.",
      );
    }

    const labels: string[] = [];
    for (const plan of plans) {
      const theirChanges = changedFieldsForPage(pages, plan.page.slug, base, current.content);
      for (const key of plan.updates.keys()) {
        if (!theirChanges.has(key)) continue;
        const [sectionKey, ...rest] = key.split(".");
        const label = fieldLabel(pages, plan.page.slug, sectionKey ?? "", rest.join("."));
        labels.push(opts.labelPages ? `${plan.page.label} → ${label}` : label);
      }
    }
    if (labels.length > 0) {
      throw new ArmatureError(
        "conflict",
        `Someone else changed ${labels.length === 1 ? "this field" : "these fields"} while you were editing: ${labels.join(", ")}. Nothing was published. Reload to get their version, then reapply your change.`,
        labels,
      );
    }
    // No overlap: their changes are already in `current`, and ours merge on top.
  }

  // --- merge ------------------------------------------------------------------
  const merged = cloneContent(current.content) as ContentTree;
  for (const plan of plans) {
    for (const [key, value] of plan.updates) {
      const [sectionKey, ...rest] = key.split(".");
      const fieldKey = rest.join(".");
      const section = (merged[plan.page.slug] ??= {});
      const sectionContent = (section[sectionKey ?? ""] ??= {});
      sectionContent[fieldKey] = value;
    }
  }

  // --- the same whole-file check site-connect runs ----------------------------
  const report = validateContentTree(merged, pages);
  if (report.errors.length > 0) {
    throw new ArmatureError(
      "invalid",
      `Publishing would have made the content file invalid, so nothing was published:\n${report.errors.join("\n")}`,
    );
  }

  const allPrepared = plans.flatMap((plan) => plan.prepared);
  const nextText = serializeContent(merged);
  if (nextText === current.contentText && allPrepared.length === 0 && !opts.allowEmpty) {
    throw new ArmatureError("invalid", "There are no changes to publish.");
  }
  const files: CommitFile[] =
    nextText === current.contentText && allPrepared.length === 0
      ? []
      : [{ path: CONTENT_PATH, content: utf8ToBase64(nextText), encoding: "base64" }, ...allPrepared.map((image) => image.file)];

  return {
    head,
    files,
    fields: plans.flatMap((plan) => [...plan.updates.keys()].map((key) => `${plan.page.slug}.${key}`)),
    images: allPrepared.map((image) => image.url),
    slugs: plans.map((plan) => plan.page.slug),
    pageLabels: plans.map((plan) => plan.page.label),
  };
}

export async function runBatchPublish(opts: {
  repo: ContentRepo;
  input: BatchPublishInput;
  userEmail: string;
  now?: () => number;
  /** Prefix conflict labels with the page label ("Home → Hero → Headline"). */
  labelPages?: boolean;
}): Promise<BatchPublishOutcome> {
  const plan = await planBatchPublish({ repo: opts.repo, input: opts.input, now: opts.now, labelPages: opts.labelPages });
  const result = await opts.repo.commit({
    message: `Content: ${plan.pageLabels.join(", ")} updated by ${opts.userEmail}`,
    files: plan.files,
    parentCommitSha: plan.head,
  });
  return { commitSha: result.commitSha, commitUrl: result.commitUrl, fields: plan.fields, images: plan.images, slugs: plan.slugs };
}

/**
 * Merge the editor's changes into the committed content and write one commit.
 *
 * Throws `ArmatureError` with a code the editor can act on:
 * - `invalid`   — bad input or content that would fail the whole-file check. Nothing committed.
 * - `conflict`  — someone else changed the same fields. Nothing committed.
 * - `forbidden` / `not_configured` / `github_error` — see githubRepo.ts.
 */
export async function runPublish(opts: {
  repo: ContentRepo;
  input: PublishInput;
  userEmail: string;
  now?: () => number;
}): Promise<PublishOutcome> {
  const { input } = opts;
  const outcome = await runBatchPublish({
    repo: opts.repo,
    userEmail: opts.userEmail,
    now: opts.now,
    input: {
      baseCommitSha: input.baseCommitSha,
      pages: [{ slug: input.slug, fields: input.fields ?? [], images: input.images ?? [] }],
    },
  });
  const prefix = `${input.slug}.`;
  return {
    commitSha: outcome.commitSha,
    commitUrl: outcome.commitUrl,
    fields: outcome.fields.map((key) => (key.startsWith(prefix) ? key.slice(prefix.length) : key)),
    images: outcome.images,
  };
}

// ---------------------------------------------------------------------------
// Defensive shaping of the request body; the real rules live in contentValidation.ts.
// ---------------------------------------------------------------------------
function parseFields(raw: unknown): FieldUpdate[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): FieldUpdate[] => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    if (typeof item["section"] !== "string" || typeof item["field"] !== "string") return [];
    return [{ section: item["section"], field: item["field"], value: item["value"] as ContentValue }];
  });
}

function parseImages(raw: unknown): BatchImageUpload[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): BatchImageUpload[] => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    if (typeof item["section"] !== "string" || typeof item["field"] !== "string") return [];
    const image: BatchImageUpload = {
      section: item["section"],
      field: item["field"],
      filename: typeof item["filename"] === "string" ? item["filename"] : "",
      contentType: typeof item["contentType"] === "string" ? item["contentType"] : "",
      dataBase64: typeof item["dataBase64"] === "string" ? item["dataBase64"] : "",
    };
    if (Number.isInteger(item["index"]) && (item["index"] as number) >= 0 && typeof item["itemKey"] === "string") {
      image.index = item["index"] as number;
      image.itemKey = item["itemKey"];
    }
    return [image];
  });
}

export function parsePublishRequest(raw: Record<string, unknown>): PublishRequest {
  const siteId = typeof raw["site_id"] === "string" ? raw["site_id"] : "";
  const slug = typeof raw["slug"] === "string" ? raw["slug"] : "";
  const baseCommitSha = typeof raw["baseCommitSha"] === "string" ? raw["baseCommitSha"] : "";
  const fields = parseFields(raw["fields"]);
  const images: ImageUpload[] = parseImages(raw["images"]).map(({ section, field, filename, contentType, dataBase64 }) => ({
    section,
    field,
    filename,
    contentType,
    dataBase64,
  }));
  if (!ACCEPTED_IMAGE_TYPES.length) throw new Error("unreachable");
  return { site_id: siteId, slug, baseCommitSha, fields, images };
}

export function parseBatchPublishRequest(raw: Record<string, unknown>): PublishBatchRequest {
  const siteId = typeof raw["site_id"] === "string" ? raw["site_id"] : "";
  const baseCommitSha = typeof raw["baseCommitSha"] === "string" ? raw["baseCommitSha"] : "";
  const pages: BatchPageUpdate[] = Array.isArray(raw["pages"])
    ? raw["pages"].flatMap((entry): BatchPageUpdate[] => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as Record<string, unknown>;
      if (typeof item["slug"] !== "string") return [];
      return [{ slug: item["slug"], fields: parseFields(item["fields"]), images: parseImages(item["images"]) }];
    })
    : [];
  return { site_id: siteId, baseCommitSha, pages };
}
