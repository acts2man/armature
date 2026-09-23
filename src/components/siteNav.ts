/**
 * The one list of what a site's menu holds, in the order WordPress people expect:
 * Dashboard, Stats, Posts, Media, Pages, Contact, Appearance, Users, then Site settings
 * (agency staff only). The sidebar draws it, the first-run tour describes it, and the
 * tests read it. Anything not built yet is simply left out: never a dead link.
 */
import type { IconProps } from "./icons.tsx";
import type { ReactNode } from "react";
import { IconChart, IconGrid, IconImage, IconInbox, IconPage, IconPalette, IconParagraph, IconSettings, IconTeam } from "./icons.tsx";

export type SiteNavKey = "dashboard" | "stats" | "posts" | "media" | "pages" | "contact" | "appearance" | "users" | "settings";

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

/** Which items exist yet. Stats and Posts are planned in docs/BUILDER_SPEC.md and stay hidden until then. */
export const BUILT: Record<SiteNavKey, boolean> = {
  dashboard: true,
  stats: false,
  posts: false,
  media: true,
  pages: true,
  contact: false,
  appearance: false,
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
    { key: "stats", to: `${root}/stats`, label: "Stats", icon: IconChart, blurb: "who visits and what they read", show: true },
    { key: "posts", to: `${root}/posts`, label: "Posts", icon: IconParagraph, blurb: "news and articles", show: !hostingOnly },
    { key: "media", to: `${root}/media`, label: "Media", icon: IconImage, blurb: "every picture on the site", show: !hostingOnly },
    { key: "pages", to: `${root}/pages`, label: "Pages", icon: IconPage, blurb: "every page, ready to edit", show: !hostingOnly },
    { key: "contact", to: `${root}/contact`, label: "Contact", icon: IconInbox, blurb: "messages from the site's forms", show: true },
    { key: "appearance", to: `${root}/appearance`, label: "Appearance", icon: IconPalette, blurb: "colours, fonts, header and footer", show: !hostingOnly },
    { key: "users", to: `${root}/users`, label: "Users", icon: IconTeam, blurb: "who can sign in", show: isStaff },
    { key: "settings", to: `${root}/settings`, label: "Site settings", icon: IconSettings, blurb: "the connection, hosting and what the client may edit", show: isStaff },
  ];
  return all.filter((item) => item.show && BUILT[item.key]).map(({ show: _show, ...item }) => item);
}
