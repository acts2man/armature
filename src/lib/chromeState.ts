/**
 * What the site really does with its header, footer and menus, read from its files:
 * which parts are built in the editor, what a built part holds, and where each menu is
 * shown. The Appearance screens say this instead of a fixed message. Pure module.
 */
import type { Element, LayoutDoc, Menu, NavMenuProps } from "@kit/types.ts";
import { CHROME_SLUGS, isChromeSlug } from "@kit/types.ts";

const walk = (elements: Element[], visit: (element: Element) => void): void => {
  for (const element of elements) {
    visit(element);
    if (element.children) walk(element.children, visit);
  }
};

/** Every element in a layout, nested ones included. */
export function countElements(layout: LayoutDoc): number {
  let count = 0;
  walk(layout.root, () => {
    count += 1;
  });
  return count;
}

/** The Nav Menu widgets in a layout, with the id of the menu each one shows (undefined when none is chosen yet). */
export function navMenusIn(layout: LayoutDoc): { id: string; menu: string | undefined }[] {
  const out: { id: string; menu: string | undefined }[] = [];
  walk(layout.root, (element) => {
    if (element.type === "nav-menu") out.push({ id: element.id, menu: (element.props as NavMenuProps).menu || undefined });
  });
  return out;
}

export type PartState =
  | { built: false }
  | {
      built: true;
      elements: number;
      /** The Nav Menu widgets in the part and the menu each shows, by name (null: none chosen, or the menu no longer exists). */
      navMenus: { menu: Menu | null }[];
    };

/** The true state of a header or footer: coded, or built and what it holds. */
export function partState(layout: LayoutDoc | undefined, menus: Menu[]): PartState {
  if (!layout) return { built: false };
  return { built: true, elements: countElements(layout), navMenus: navMenusIn(layout).map((nav) => ({ menu: menus.find((menu) => menu.id === nav.menu) ?? null })) };
}

/** Where a menu is shown: "header", "footer", or the label of each page whose layout has a Nav Menu showing it. */
export function menuUsage(menuId: string, layouts: Record<string, LayoutDoc>): string[] {
  const places: string[] = [];
  for (const slug of CHROME_SLUGS) {
    const layout = layouts[slug];
    if (layout && navMenusIn(layout).some((nav) => nav.menu === menuId)) places.push(slug === "_header" ? "header" : "footer");
  }
  for (const layout of Object.values(layouts)) {
    if (isChromeSlug(layout.pageSlug)) continue;
    if (navMenusIn(layout).some((nav) => nav.menu === menuId)) places.push(layout.label ?? layout.pageSlug);
  }
  return places;
}

/** "Shown in the header", "Shown in the header and on About", "Not shown anywhere yet". */
export function describeMenuUsage(places: string[]): string {
  if (places.length === 0) return "Not shown anywhere yet";
  const parts = places.map((place) => (place === "header" || place === "footer" ? `in the ${place}` : `on ${place}`));
  return `Shown ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`}`;
}
