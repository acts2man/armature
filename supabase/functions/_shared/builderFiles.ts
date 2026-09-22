/**
 * Reading the page builder's files from a site's repository: every layout under
 * content/layouts/, content/site-kit.json, content/media.json and the list of pictures
 * under public/assets/. Every file is validated with the shared zod schemas; a file
 * that fails is reported as a warning and left out, so one bad layout never blocks
 * editing the rest of the site.
 *
 * SERVER ONLY.
 */
import { LAYOUTS_DIR, MEDIA_META_PATH, SITE_KIT_PATH, validateLayout, validateSiteKit } from "../../../shared/builder/schema.ts";
import type { LayoutDoc, SiteKit } from "../../../kit/types.ts";
import type { MediaFile, MediaMeta } from "../../../shared/publishTypes.ts";
import type { ContentRepo } from "./githubRepo.ts";

export type BuilderFiles = {
  layouts: Record<string, LayoutDoc>;
  /** Blob shas per layout slug, for cheap "did it change" checks. */
  layoutShas: Record<string, string>;
  siteKit: SiteKit | null;
  media: MediaFile[];
  mediaMeta: MediaMeta;
  warnings: string[];
};

const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif|svg|avif)$/i;
const VIDEO_EXTENSIONS = /\.(mp4|webm)$/i;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function loadBuilderFiles(repo: ContentRepo, ref: string): Promise<BuilderFiles> {
  const warnings: string[] = [];
  const layouts: Record<string, LayoutDoc> = {};
  const layoutShas: Record<string, string> = {};

  const layoutEntries = (await repo.listTree(LAYOUTS_DIR, ref)).filter((entry) => entry.path.endsWith(".json"));
  for (const entry of layoutEntries) {
    const slug = entry.path.slice(LAYOUTS_DIR.length + 1, -".json".length);
    if (entry.size > 1024 * 1024) {
      warnings.push(`${entry.path}: larger than 1 MB, so it was skipped`);
      continue;
    }
    const file = await repo.readTextFile(entry.path, ref);
    const raw = parseJson(file.text);
    if (raw === undefined) {
      warnings.push(`${entry.path}: not valid JSON, so it was skipped`);
      continue;
    }
    const report = validateLayout(raw, entry.path);
    if (!report.value) {
      warnings.push(...report.errors);
      continue;
    }
    if (report.value.pageSlug !== slug) {
      warnings.push(`${entry.path}: its pageSlug is "${report.value.pageSlug}" but the file is named "${slug}"; the file name wins`);
    }
    layouts[slug] = { ...report.value, pageSlug: slug };
    layoutShas[slug] = file.sha;
  }

  let siteKit: SiteKit | null = null;
  const kitEntry = (await repo.listTree("content", ref)).find((entry) => entry.path === SITE_KIT_PATH);
  if (kitEntry) {
    const file = await repo.readTextFile(SITE_KIT_PATH, ref);
    const raw = parseJson(file.text);
    const report = raw === undefined ? { errors: [`${SITE_KIT_PATH}: not valid JSON`] } : validateSiteKit(raw);
    if (report.value) siteKit = report.value;
    else warnings.push(...report.errors, `${SITE_KIT_PATH} was ignored; the default kit applies until it is fixed`);
  }

  let mediaMeta: MediaMeta = {};
  const metaEntry = (await repo.listTree("content", ref)).find((entry) => entry.path === MEDIA_META_PATH);
  if (metaEntry) {
    const file = await repo.readTextFile(MEDIA_META_PATH, ref);
    const raw = parseJson(file.text);
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
        if (value && typeof value === "object" && typeof (value as { alt?: unknown }).alt === "string") mediaMeta[path] = { alt: (value as { alt: string }).alt.slice(0, 500) };
      }
    } else {
      warnings.push(`${MEDIA_META_PATH}: not a JSON object, so it was ignored`);
      mediaMeta = {};
    }
  }

  const assets = await repo.listTree("public/assets", ref);
  const media: MediaFile[] = assets
    .filter((entry) => IMAGE_EXTENSIONS.test(entry.path) || VIDEO_EXTENSIONS.test(entry.path))
    .map((entry) => ({
      path: `/${entry.path.replace(/^public\//, "")}`,
      bytes: entry.size,
      kind: VIDEO_EXTENSIONS.test(entry.path) ? "video" : "image",
      alt: mediaMeta[`/${entry.path.replace(/^public\//, "")}`]?.alt ?? "",
    }));

  return { layouts, layoutShas, siteKit, media, mediaMeta, warnings };
}
