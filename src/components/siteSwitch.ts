/**
 * The rules behind the site switcher (src/components/SiteSwitcher.tsx), kept apart from
 * the component so they can be unit-tested and so the file with the component only
 * exports components.
 */
import type { Site } from "@/lib/types.ts";
import { siteNavItems } from "./siteNav.ts";

export type SiteOption = Pick<Site, "id" | "name" | "status">;

/** With at least this many sites, the menu gets a search box. */
export const SEARCH_FROM = 6;

/**
 * Where a switch lands: the same section of the chosen site when that site has it (its
 * menu is built from the same list as the sidebar), else its Dashboard. Anything deeper
 * than the section (a page, a request, a settings tab) belongs to the site being left.
 */
export function switchTarget(pathname: string, fromSiteId: string, to: SiteOption, isStaff: boolean): string {
  const root = `/sites/${to.id}`;
  const prefix = `/sites/${fromSiteId}/`;
  const section = pathname.startsWith(prefix) ? (pathname.slice(prefix.length).split("/")[0] ?? "") : "";
  if (!section) return root;
  const items = siteNavItems({ root, isStaff, hostingOnly: to.status === "hosting_only" });
  return items.some((item) => item.to === `${root}/${section}`) ? `${root}/${section}` : root;
}
