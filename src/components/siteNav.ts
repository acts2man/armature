/**
 * The one list of what a site's menu holds, in the order WordPress people expect:
 * Dashboard, Posts, Media, Pages, Contact, Requests (change requests to the
 * agency), Appearance, Users, then Site settings (agency staff only). The sidebar draws
 * it, the first-run tour describes it, and the tests read it. Anything not built yet is
 * simply left out: never a dead link.
 *
 * Stats was removed on request in kit 2.9.0; the design in docs/BUILDER_SPEC.md is
 * kept for a possible later reintroduction. If it comes back, add a 'stats' entry
 * here and everywhere else works unchanged.
 */
import type { IconProps } from "./icons.tsx";
import type { ReactNode } from "react";
import { IconBranch, IconGrid, IconImage, IconInbox, IconPage, IconPalette, IconParagraph, IconSettings, IconTeam } from "./icons.tsx";

export type SiteNavKey = "dashboard" | "posts" | "media" | "pages" | "contact" | "requests" | "appearance" | "users" | "settings";

export type SiteNavEntry = {
  key: SiteNavKey;
  to: string;
  label: string;
  icon: (props: IconProps) => ReactNode;
  /** Match this route only exactly (the Dashboard would otherwise light up everywhere). */
  end?: boolean;
  /** One line for the first-run tour. */
  blurb: string;
};

/** Which items exist yet. */
export const BUILT: Record<SiteNavKey, boolean> = {
  dashboard: true,
  posts: true,
  media: true,
  pages: true,
  contact: true,
  requests: true,
  appearance: true,
  users: true,
  settings: true,
};

export type SiteNavContext = {
  /** "/sites/<id>" */
  root: string;
  /** Agency staff for this site's agency. */
  isStaff: boolean;
  /** No repository connected: nothing to edit, so the editing items stay out. */
  hostingOnly: boolean;
};

export function siteNavItems({ root, isStaff, hostingOnly }: SiteNavContext): SiteNavEntry[] {
  const all: (SiteNavEntry & { show: boolean })[] = [
    { key: "dashboard", to: root, label: "Dashboard", icon: IconGrid, end: true, blurb: "what needs you, and where to start", show: true },
    { key: "posts", to: `${root}/posts`, label: "Posts", icon: IconParagraph, blurb: "news and articles", show: !hostingOnly },
    { key: "media", to: `${root}/media`, label: "Media", icon: IconImage, blurb: "every picture on the site", show: !hostingOnly },
    { key: "pages", to: `${root}/pages`, label: "Pages", icon: IconPage, blurb: "every page, ready to edit", show: !hostingOnly },
    { key: "contact", to: `${root}/contact`, label: "Contact", icon: IconInbox, blurb: "messages from the site's forms", show: true },
    { key: "requests", to: `${root}/requests`, label: "Requests", icon: IconBranch, blurb: isStaff ? "what the client has asked for" : "ask the agency for anything bigger", show: true },
    { key: "appearance", to: `${root}/appearance`, label: "Appearance", icon: IconPalette, blurb: "colours, fonts, header and footer", show: !hostingOnly },
    { key: "users", to: `${root}/users`, label: "Users", icon: IconTeam, blurb: "who can sign in", show: true },
    { key: "settings", to: `${root}/settings`, label: "Site settings", icon: IconSettings, blurb: "the connection, hosting and what the client may edit", show: isStaff },
  ];
  return all.filter((item) => item.show && BUILT[item.key]).map(({ show: _show, ...item }) => item);
}
