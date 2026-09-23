/** Small pure helpers for the visual editor: pages, routes and devices. */
import type { PageDefinition, SiteSchema } from "@shared/schema.ts";
import { SHARED_SLUG } from "@shared/schema.ts";
import { parseFieldPath } from "@shared/visualProtocol.ts";

export type Device = "desktop" | "tablet" | "phone";

export const DEVICES: { id: Device; label: string; width: number }[] = [
  { id: "desktop", label: "Desktop", width: 1440 },
  { id: "tablet", label: "Tablet", width: 820 },
  { id: "phone", label: "Phone", width: 390 },
];

export const deviceWidth = (device: Device): number => DEVICES.find((item) => item.id === device)?.width ?? 1440;

/** Site contract v2: the tablet canvas is as wide as the kit's tablet breakpoint; the phone stays a real phone (below the mobile breakpoint). */
export function deviceWidthFor(device: Device, breakpoints: { tablet: number; mobile: number } | null): number {
  if (!breakpoints) return deviceWidth(device);
  if (device === "tablet") return breakpoints.tablet;
  if (device === "phone") return Math.min(390, breakpoints.mobile);
  return deviceWidth(device);
}

/** The editor's device names map to the model's ("phone" is "mobile"). */
export const modelDevice = (device: Device): "desktop" | "tablet" | "mobile" => (device === "phone" ? "mobile" : device);

/** "/about/" and "/about" and "/About" are the same page. */
export function normalizePath(path: string): string {
  let out = path.trim().split(/[?#]/)[0] ?? "";
  if (!out.startsWith("/")) out = `/${out}`;
  out = out.replace(/\/+$/, "").toLowerCase();
  return out === "" ? "/" : out;
}

/** A field of the hand-coded header or footer: the shared page, or a section named for the chrome. Its words still edit; its layout is the site's code. */
export function isChromeField(schema: SiteSchema, path: string): boolean {
  const parsed = parseFieldPath(path);
  if (!parsed) return false;
  if (parsed.slug === SHARED_SLUG) return true;
  const page = schema.pages.find((item) => item.slug === parsed.slug);
  const section = page?.sections.find((item) => item.key === parsed.section);
  return !!section && /^(header|footer|nav|navigation|site-header|site-footer)$/.test(section.key);
}

/** Pages that can be opened on the canvas: everything but the shared header/footer page. */
export const editablePages = (schema: SiteSchema): PageDefinition[] => schema.pages.filter((page) => page.slug !== SHARED_SLUG || schema.pages.length === 1);

/** The page the site is showing for a route, preferring a real page over "shared". */
export function pageForRoute(schema: SiteSchema, route: string): PageDefinition | undefined {
  const wanted = normalizePath(route);
  const matches = schema.pages.filter((page) => normalizePath(page.path) === wanted);
  return matches.find((page) => page.slug !== SHARED_SLUG) ?? matches[0];
}

export const defaultPage = (schema: SiteSchema): PageDefinition | undefined => editablePages(schema)[0] ?? schema.pages[0];

/** The page's address on the live site, or null when the site has no live URL yet. */
export function liveHref(liveUrl: string | null, path: string): string | null {
  if (!liveUrl) return null;
  return `${liveUrl.replace(/\/+$/, "")}${path}`;
}

export const isMac = (): boolean => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = (): string => (isMac() ? "⌘" : "Ctrl");

// --- first-run tour ------------------------------------------------------------------------
export const TOUR_KEY = "armature:visual:tour:v1";
export const BUILDER_TOUR_KEY = "armature:builder:tour:v1";

export function tourSeen(kind: "content" | "builder" = "content"): boolean {
  try {
    return localStorage.getItem(kind === "builder" ? BUILDER_TOUR_KEY : TOUR_KEY) === "done";
  } catch {
    return true;
  }
}

export function markTourSeen(kind: "content" | "builder" = "content"): void {
  try {
    localStorage.setItem(kind === "builder" ? BUILDER_TOUR_KEY : TOUR_KEY, "done");
  } catch {
    // storage unavailable: the tour just shows again next time
  }
}

// --- "Add New Page" from the Pages screen ----------------------------------------------------
// The screen builds the page and hands it to the editor through sessionStorage (never the
// URL: a layout is too big for it), and the editor creates it in the draft once the site is up.
import { checkLayout, type LayoutDoc } from "@shared/builder/index.ts";

export const newPageHandoffKey = (siteId: string): string => `armature:new-page:${siteId}`;

export function writeNewPageHandoff(siteId: string, layout: LayoutDoc): boolean {
  try {
    window.sessionStorage.setItem(newPageHandoffKey(siteId), JSON.stringify(layout));
    return true;
  } catch {
    return false;
  }
}

export function readNewPageHandoff(siteId: string): LayoutDoc | null {
  try {
    const raw = window.sessionStorage.getItem(newPageHandoffKey(siteId));
    if (!raw) return null;
    return checkLayout(JSON.parse(raw)).value ?? null;
  } catch {
    return null;
  }
}

export function clearNewPageHandoff(siteId: string): void {
  try {
    window.sessionStorage.removeItem(newPageHandoffKey(siteId));
  } catch {
    // Nothing to clear.
  }
}
