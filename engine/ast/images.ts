/**
 * Pictures: swap the address, change the alt text, or bring a new file into the repo
 * following the site's own pattern (public/ paths stay public/ paths, imported assets
 * stay imported assets).
 */
import { posix } from "node:path";
import type { ImageSource } from "../shared/types.ts";
import type { Project } from "./project.ts";

const EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".svg"]);

export function safeFileName(name: string): string {
  const extension = posix.extname(name).toLowerCase();
  const base = posix
    .basename(name, posix.extname(name))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "image"}${EXTENSIONS.has(extension) ? extension : ".png"}`;
}

/** Where a new picture goes and what the code should reference. */
export function placeUpload(project: Project, image: Extract<ImageSource, { editable: true }>, fileName: string): { repoPath: string; reference: string } {
  const name = safeFileName(fileName);
  if (image.pattern === "import") {
    // The import source is relative to the file that imports it.
    const importer = image.where.file;
    const currentTarget = image.src.startsWith(".") ? posix.normalize(posix.join(posix.dirname(importer), image.src)) : project.resolveImport(importer, image.src) ?? "src/assets/x";
    const directory = posix.dirname(currentTarget);
    const repoPath = unique(project, posix.join(directory, name));
    let reference = posix.relative(posix.dirname(importer), repoPath);
    if (!reference.startsWith(".")) reference = `./${reference}`;
    if (!image.src.startsWith(".")) {
      // Keep an alias like "@/assets/x.png" when the site used one.
      const aliasPrefix = image.src.slice(0, image.src.indexOf("/") + 1);
      const resolvedAliasRoot = project.resolveImport(importer, image.src) ? posix.dirname(project.resolveImport(importer, image.src) as string) : null;
      if (resolvedAliasRoot && aliasPrefix && repoPath.startsWith(resolvedAliasRoot)) reference = `${posix.dirname(image.src)}/${posix.basename(repoPath)}`;
    }
    return { repoPath, reference };
  }
  const isSitePath = image.src.startsWith("/") && !image.src.startsWith("//");
  const directory = isSitePath && project.isDirectory(posix.join("public", posix.dirname(image.src))) ? posix.join("public", posix.dirname(image.src)) : "public/uploads";
  const repoPath = unique(project, posix.join(directory, name));
  return { repoPath, reference: `/${posix.relative("public", repoPath)}` };
}

function unique(project: Project, path: string): string {
  if (!project.exists(path)) return path;
  const extension = posix.extname(path);
  const base = path.slice(0, -extension.length);
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}${extension}`;
    if (!project.exists(candidate)) return candidate;
  }
  return `${base}-${Date.now()}${extension}`;
}
