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
  return chromePartOf(schema, path) !== null;
}

/**
 * Which coded part a field belongs to: "header" for the shared page's header or
 * navigation section, "footer" for its footer section, "chrome" for anything else on the
 * shared page, null for a field on an ordinary page.
 */
export function chromePartOf(schema: SiteSchema, path: string): "header" | "footer" | "chrome" | null {
  const parsed = parseFieldPath(path);
  if (!parsed) return null;
  const page = schema.pages.find((item) => item.slug === parsed.slug);
  const section = page?.sections.find((item) => item.key === parsed.section);
  const key = section?.key ?? parsed.section;
  if (/^(header|nav|navigation|site-header)$/.test(key)) return "header";
  if (/^(footer|site-footer)$/.test(key)) return "footer";
  return parsed.slug === SHARED_SLUG ? "chrome" : null;
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

/** Which of the header and footer are built in the editor (content/layouts/_header.json, _footer.json). */
export type BuiltParts = { header: boolean; footer: boolean };

/**
 * The note above a coded header or footer field: what the site really does with that
 * part today. When the part has been built in the editor the coded one no longer shows,
 * so the field is kept for the fallback and the person is pointed at Appearance.
 */
export function chromeNote(part: "header" | "footer" | "chrome", built: BuiltParts, isStaff: boolean): string {
  const builtHere = part === "header" ? built.header : part === "footer" ? built.footer : false;
  if (builtHere) {
    return isStaff
      ? `The ${part} is built in the editor now, so this coded ${part} no longer shows on the site; it stays as the fallback. Edit the live ${part} under Appearance › ${part === "header" ? "Header" : "Footer"}.`
      : `The ${part} is built in the editor now, so this coded ${part} no longer shows on the site. Change the ${part} under Appearance › ${part === "header" ? "Header" : "Footer"}.`;
  }
  if (part !== "chrome" && (built.header || built.footer)) {
    const other = part === "header" ? "footer" : "header";
    return isStaff ? `The ${part} is still coded (the ${other} is built in the editor). It becomes fully editable once converted to a builder part.` : `The ${part} is part of the site's code (the ${other} is built in the editor). Your agency can make it editable.`;
  }
  return isStaff ? "The header and footer are still coded. They become fully editable once converted to builder parts." : "The header and footer are part of the site's code. Your agency can make them editable.";
}
