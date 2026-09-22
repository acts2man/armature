/** Small pure helpers for the visual editor: pages, routes and devices. */
import type { PageDefinition, SiteSchema } from "@shared/schema.ts";
import { SHARED_SLUG } from "@shared/schema.ts";

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

export function tourSeen(): boolean {
  try {
    return localStorage.getItem(TOUR_KEY) === "done";
  } catch {
    return true;
  }
}

export function markTourSeen(): void {
  try {
    localStorage.setItem(TOUR_KEY, "done");
  } catch {
    // storage unavailable: the tour just shows again next time
  }
}
