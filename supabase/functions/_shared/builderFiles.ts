/**
 * Reading the page builder's files from a site's repository: every layout under
 * content/layouts/, content/site-kit.json, content/media.json and the list of pictures
 * under public/assets/. Every file goes through the kit's validator: a setting it cannot
 * read is left out and reported as a problem (with its raw value, so a publish keeps
 * it), an element it cannot read becomes an "unsupported" placeholder, the kit fills
 * anything unreadable from the defaults, and only a file that is not a layout at all is
 * left out. One bad value never blocks editing the rest of the site.
 *
 * SERVER ONLY.
 */
import { checkLayout, checkPost, checkPostIndex, checkSiteKit, describeProblem, LAYOUT_LIMITS, LAYOUTS_DIR, MEDIA_META_PATH, SITE_KIT_PATH, TRASH_DIR } from "../../../shared/builder/schema.ts";
import type { LayoutDoc, PostDoc, PostIndex, SiteKit } from "../../../kit/types.ts";
import type { FileProblem, MediaFile, MediaMeta } from "../../../shared/publishTypes.ts";
import type { ContentRepo } from "./githubRepo.ts";

const POSTS_DIR = "content/posts";

export type BuilderFiles = {
  layouts: Record<string, LayoutDoc>;
  /** Blob shas per layout slug, for cheap "did it change" checks. */
  layoutShas: Record<string, string>;
  siteKit: SiteKit | null;
  /** Builder pages in the bin (content/trash/), by slug. */
  trash: Record<string, LayoutDoc>;
  media: MediaFile[];
  mediaMeta: MediaMeta;
  /** Every blog post the site ships. */
  posts: Record<string, PostDoc>;
  /** The regenerated posts index (content/posts/index.json). */
  postIndex: PostIndex;
  /** File-level notes (a file skipped, a kit that could not be parsed). */
  warnings: string[];
  /** Every value the validator could not read, with where it is and what is allowed. */
  problems: FileProblem[];
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
  const problems: FileProblem[] = [];
  const layouts: Record<string, LayoutDoc> = {};
  const layoutShas: Record<string, string> = {};

  const layoutEntries = (await repo.listTree(LAYOUTS_DIR, ref)).filter((entry) => entry.path.endsWith(".json"));
  for (const entry of layoutEntries) {
    const slug = entry.path.slice(LAYOUTS_DIR.length + 1, -".json".length);
    if (entry.size > LAYOUT_LIMITS.fileBytes) {
      warnings.push(`${entry.path}: larger than ${LAYOUT_LIMITS.fileBytes / 1024 / 1024} MB, so it was skipped`);
      continue;
    }
    const file = await repo.readTextFile(entry.path, ref);
    const raw = parseJson(file.text);
    if (raw === undefined) {
      warnings.push(`${entry.path}: not valid JSON, so it was skipped`);
      continue;
    }
    const report = checkLayout(raw);
    problems.push(...report.problems.map((problem) => ({ ...problem, file: entry.path, slug })));
    if (!report.value) {
      warnings.push(...report.problems.map((problem) => describeProblem(problem, entry.path)));
      continue;
    }
    if (report.value.pageSlug !== slug) {
      warnings.push(`${entry.path}: its pageSlug is "${report.value.pageSlug}" but the file is named "${slug}"; the file name wins`);
    }
    layouts[slug] = { ...report.value, pageSlug: slug };
    layoutShas[slug] = file.sha;
  }

  // The bin: readable pages only; anything else is noted and skipped, never a problem on the live site.
  const trash: Record<string, LayoutDoc> = {};
  for (const entry of (await repo.listTree(TRASH_DIR, ref)).filter((item) => item.path.endsWith(".json"))) {
    const slug = entry.path.slice(TRASH_DIR.length + 1, -".json".length);
    if (entry.size > LAYOUT_LIMITS.fileBytes) continue;
    const raw = parseJson((await repo.readTextFile(entry.path, ref)).text);
    const report = raw === undefined ? null : checkLayout(raw);
    if (!report?.value) {
      warnings.push(`${entry.path}: not a readable page, so it stays in the bin`);
      continue;
    }
    trash[slug] = { ...report.value, pageSlug: slug };
  }

  let siteKit: SiteKit | null = null;
  const kitEntry = (await repo.listTree("content", ref)).find((entry) => entry.path === SITE_KIT_PATH);
  if (kitEntry) {
    const file = await repo.readTextFile(SITE_KIT_PATH, ref);
    const raw = parseJson(file.text);
    if (raw === undefined) {
      warnings.push(`${SITE_KIT_PATH}: not valid JSON, so the default kit applies until it is fixed`);
    } else {
      // The kit always loads: anything unreadable falls back to the default kit's value and is listed.
      const report = checkSiteKit(raw);
      siteKit = report.value;
      problems.push(...report.problems.map((problem) => ({ ...problem, file: SITE_KIT_PATH })));
    }
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

  // Posts (content/posts/*.json) and the generated index (content/posts/index.json).
  const posts: Record<string, PostDoc> = {};
  let postIndex: PostIndex = { version: 1, posts: [] };
  const postEntries = (await repo.listTree(POSTS_DIR, ref)).filter((entry) => entry.path.endsWith(".json"));
  for (const entry of postEntries) {
    const slug = entry.path.slice(POSTS_DIR.length + 1, -".json".length);
    if (slug === "index") {
      const raw = parseJson((await repo.readTextFile(entry.path, ref)).text);
      const report = checkPostIndex(raw);
      if (report.value) postIndex = report.value;
      continue;
    }
    if (entry.size > LAYOUT_LIMITS.fileBytes) continue;
    const raw = parseJson((await repo.readTextFile(entry.path, ref)).text);
    const report = raw === undefined ? null : checkPost(raw);
    if (!report?.value) {
      warnings.push(`${entry.path}: not a readable post, so it stays out of the list`);
      continue;
    }
    posts[slug] = { ...report.value, slug };
  }

  return { layouts, layoutShas, siteKit, trash, media, mediaMeta, warnings, problems, posts, postIndex };
}
