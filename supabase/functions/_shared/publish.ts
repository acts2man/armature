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
  type FieldUpdate,
  type ImageUpload,
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
};

/** Validate the uploads and decide where each one is committed. */
function prepareImages(
  slug: string,
  images: ImageUpload[],
  timestamp: number,
): { prepared: PreparedImage[]; errors: string[] } {
  const prepared: PreparedImage[] = [];
  const errors: string[] = [];
  let total = 0;

  images.forEach((image, index) => {
    const where = `image ${index + 1} (${image.filename || "unnamed"})`;

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

    const name = `${slug}-${timestamp}-${safeBaseName(image.filename)}.${extension}`;
    prepared.push({
      key: `${image.section}.${image.field}`,
      url: `${UPLOAD_URL_PREFIX}/${name}`,
      file: {
        path: `${UPLOAD_DIR}/${name}`,
        content: image.dataBase64.replace(/\s+/g, ""),
        encoding: "base64",
      },
    });
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

  return { prepared, errors };
}

// ---------------------------------------------------------------------------
// The publish
// ---------------------------------------------------------------------------

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
  const { repo, input, userEmail } = opts;
  const now = opts.now ?? (() => Date.now());

  const fields = input.fields ?? [];
  const images = input.images ?? [];
  if (fields.length === 0 && images.length === 0) {
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
  const head = await repo.getBranchHead();
  const current = await loadSiteFiles(repo, head);
  const pages = current.pages;

  const page = getPageDefinition(pages, input.slug);
  if (!page) {
    throw new ArmatureError("invalid", `"${input.slug}" is not a page this site can edit.`);
  }

  // --- validate everything before touching anything that writes -----------
  const errors: string[] = [];
  const updates = new Map<string, ContentValue>();

  for (const update of fields) {
    const key = `${update.section}.${update.field}`;
    if (updates.has(key)) {
      errors.push(`${key}: sent twice in one publish`);
      continue;
    }
    updates.set(key, update.value);
  }

  const { prepared, errors: imageErrors } = prepareImages(input.slug, images, now());
  errors.push(...imageErrors);
  // An uploaded image decides its field's value, whatever the client sent for it.
  for (const image of prepared) updates.set(image.key, image.url);

  for (const [key, value] of updates) {
    const [sectionKey, ...rest] = key.split(".");
    const fieldKey = rest.join(".");
    const result = validateFieldUpdate(pages, input.slug, sectionKey ?? "", fieldKey, value);
    errors.push(...result.errors);
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

    const theirChanges = changedFieldsForPage(pages, input.slug, base, current.content);
    const overlap = [...updates.keys()].filter((key) => theirChanges.has(key));
    if (overlap.length > 0) {
      const labels = overlap.map((key) => {
        const [sectionKey, ...rest] = key.split(".");
        return fieldLabel(pages, input.slug, sectionKey ?? "", rest.join("."));
      });
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
  for (const [key, value] of updates) {
    const [sectionKey, ...rest] = key.split(".");
    const fieldKey = rest.join(".");
    const section = (merged[input.slug] ??= {});
    const sectionContent = (section[sectionKey ?? ""] ??= {});
    sectionContent[fieldKey] = value;
  }

  // --- the same whole-file check site-connect runs ----------------------------
  const report = validateContentTree(merged, pages);
  if (report.errors.length > 0) {
    throw new ArmatureError(
      "invalid",
      `Publishing would have made the content file invalid, so nothing was published:\n${report.errors.join("\n")}`,
    );
  }

  const nextText = serializeContent(merged);
  if (nextText === current.contentText && prepared.length === 0) {
    throw new ArmatureError("invalid", "There are no changes to publish.");
  }

  // --- one commit ---------------------------------------------------------------
  const files: CommitFile[] = [
    { path: CONTENT_PATH, content: utf8ToBase64(nextText), encoding: "base64" },
    ...prepared.map((image) => image.file),
  ];

  const result = await repo.commit({
    message: `Content: ${page.label} updated by ${userEmail}`,
    files,
    parentCommitSha: head,
  });

  return {
    commitSha: result.commitSha,
    commitUrl: result.commitUrl,
    fields: [...updates.keys()],
    images: prepared.map((image) => image.url),
  };
}

// ---------------------------------------------------------------------------
// Defensive shaping of the request body; the real rules live in contentValidation.ts.
// ---------------------------------------------------------------------------
export function parsePublishRequest(raw: Record<string, unknown>): PublishRequest {
  const siteId = typeof raw["site_id"] === "string" ? raw["site_id"] : "";
  const slug = typeof raw["slug"] === "string" ? raw["slug"] : "";
  const baseCommitSha = typeof raw["baseCommitSha"] === "string" ? raw["baseCommitSha"] : "";

  const fields = Array.isArray(raw["fields"])
    ? raw["fields"].flatMap((entry): FieldUpdate[] => {
        if (!entry || typeof entry !== "object") return [];
        const item = entry as Record<string, unknown>;
        if (typeof item["section"] !== "string" || typeof item["field"] !== "string") return [];
        return [
          { section: item["section"], field: item["field"], value: item["value"] as ContentValue },
        ];
      })
    : [];

  const images = Array.isArray(raw["images"])
    ? raw["images"].flatMap((entry): ImageUpload[] => {
        if (!entry || typeof entry !== "object") return [];
        const item = entry as Record<string, unknown>;
        if (typeof item["section"] !== "string" || typeof item["field"] !== "string") return [];
        return [
          {
            section: item["section"],
            field: item["field"],
            filename: typeof item["filename"] === "string" ? item["filename"] : "",
            contentType: typeof item["contentType"] === "string" ? item["contentType"] : "",
            dataBase64: typeof item["dataBase64"] === "string" ? item["dataBase64"] : "",
          },
        ];
      })
    : [];

  if (!ACCEPTED_IMAGE_TYPES.length) throw new Error("unreachable");
  return { site_id: siteId, slug, baseCommitSha, fields, images };
}
