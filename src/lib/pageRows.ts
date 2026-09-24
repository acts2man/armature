/**
 * The rows of the Pages screen: which pages exist, what type each one is, and which of
 * them the editor may duplicate or trash. Pure module, unit-tested against the demo site
 * and the first real converted site.
 *
 * A page's type:
 *   - Builder: it has a layout file whose root is builder content. A page that exists
 *     only as a layout file (no entry in content/schema.json) always is; so is a coded
 *     page whose layout holds anything beyond bare site-section wrappers (a container,
 *     a heading, a grid, or a section that was given inner elements).
 *   - Coded: no layout file, or a layout whose root is only bare site-section wrappers
 *     (the layout the editor writes the first time it restyles a coded page).
 * The header and footer parts (_header, _footer) are not pages and never appear here.
 */
import type { Element, LayoutDoc } from "@kit/types.ts";
import { isChromeSlug } from "@kit/types.ts";
import { SHARED_SLUG, type PageDefinition } from "@shared/schema.ts";

export type PageRow = {
  slug: string;
  label: string;
  path: string;
  /** Rendered from a layout built in the editor (see the module note); a coded page is rendered by the site's own code. */
  builder: boolean;
  /** Exists only as a layout file: the editor may duplicate or trash it (a coded page stays in the site's code either way). */
  layoutOnly: boolean;
  /** Still has the older form fields (Stage 1), so "Edit text" applies. */
  hasFields: boolean;
  description?: string;
};

const isBareSection = (element: Element): boolean => element.type === "site-section" && !(element.children?.length ?? 0);

/** True when the layout's root is builder content rather than a mirror of the coded page's sections. */
export const isBuilderLayout = (layout: LayoutDoc): boolean => layout.root.length === 0 || layout.root.some((element) => !isBareSection(element));

/** Every page as a row: the coded pages in the site's order, then layout-only pages by title. */
export function pageRows(pages: PageDefinition[], layouts: Record<string, LayoutDoc>): PageRow[] {
  const coded = pages
    .filter((page) => page.slug !== SHARED_SLUG)
    .map((page): PageRow => {
      const layout = layouts[page.slug];
      return { slug: page.slug, label: page.label, path: page.path, builder: !!layout && isBuilderLayout(layout), layoutOnly: false, hasFields: page.sections.some((section) => section.fields.length > 0), description: page.description };
    });
  const builder = Object.values(layouts)
    .filter((layout) => !isChromeSlug(layout.pageSlug) && !pages.some((page) => page.slug === layout.pageSlug))
    .map((layout): PageRow => ({ slug: layout.pageSlug, label: layout.label ?? layout.pageSlug, path: layout.path, builder: true, layoutOnly: true, hasFields: false }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [...coded, ...builder];
}

/** The name to show for who published: their profile name, else the part of their email before the @, never an id. */
export function publisherName(person: { full_name?: string | null; email?: string | null } | undefined): string | null {
  const name = person?.full_name?.trim();
  if (name) return name;
  const local = person?.email?.trim().split("@")[0];
  return local || null;
}
