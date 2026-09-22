/** Addresses for pages built in the editor: a slug from a title, and why a path cannot be used. */
import { normalizePath } from "@/visual/pages.ts";

export const slugFromTitle = (title: string): string =>
  title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

/** Why an address cannot be used, or null. `taken` maps normalized paths to the page using them. */
export function pathProblem(path: string, taken: Map<string, string>, ownSlug?: string): string | null {
  const trimmed = path.trim();
  if (!/^\/[a-z0-9-]+(\/[a-z0-9-]+)*\/?$/.test(trimmed)) return "Use lowercase letters, digits and hyphens between slashes, for example /about-us/.";
  const owner = taken.get(normalizePath(trimmed));
  if (owner && owner !== ownSlug) return `The page "${owner}" already uses this address.`;
  return null;
}

/** The address as stored in a layout: lowercase, leading and trailing slash ("/about-us/"). */
export const storedPath = (path: string): string => {
  const normalized = normalizePath(path);
  return normalized === "/" ? "/" : `${normalized}/`;
};
