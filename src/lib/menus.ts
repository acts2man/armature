/**
 * Navigation menus for the Menus screen: pure helpers over the site kit's `menus`
 * (add, rename, reorder, nest one level, remove), so the screen stays simple and the
 * rules are unit-tested. Ids follow the kit's id rule (lowercase, digits, - and _).
 */
import type { Menu, MenuItem } from "@kit/types.ts";

let counter = 0;
/** A fresh id that satisfies the kit's id rule and never repeats in this session. */
export const newMenuId = (): string => `m${Date.now().toString(36)}${(++counter).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const findMenu = (menus: Menu[], id: string): Menu | undefined => menus.find((menu) => menu.id === id);

export function addMenu(menus: Menu[], name: string): { menus: Menu[]; id: string } {
  const id = newMenuId();
  return { menus: [...menus, { id, name: name.trim().slice(0, 80) || "Menu", items: [] }], id };
}

export const renameMenu = (menus: Menu[], id: string, name: string): Menu[] => menus.map((menu) => (menu.id === id ? { ...menu, name: name.trim().slice(0, 80) || menu.name } : menu));
export const removeMenu = (menus: Menu[], id: string): Menu[] => menus.filter((menu) => menu.id !== id);

const updateItems = (menus: Menu[], menuId: string, update: (items: MenuItem[]) => MenuItem[]): Menu[] => menus.map((menu) => (menu.id === menuId ? { ...menu, items: update(menu.items) } : menu));

/** Where an item sits: at the top level, or under a top-level parent. */
type Place = { parent: MenuItem | null; list: MenuItem[]; index: number };

function locate(items: MenuItem[], id: string): Place | null {
  const top = items.findIndex((item) => item.id === id);
  if (top >= 0) return { parent: null, list: items, index: top };
  for (const parent of items) {
    const children = parent.children ?? [];
    const index = children.findIndex((item) => item.id === id);
    if (index >= 0) return { parent, list: children, index };
  }
  return null;
}

/** Replace a top-level item (by id) or a child list, keeping everything else. */
const replaceTop = (items: MenuItem[], id: string, next: MenuItem): MenuItem[] => items.map((item) => (item.id === id ? next : item));

export function addItem(menus: Menu[], menuId: string, item: Omit<MenuItem, "id">, parentId: string | null = null): { menus: Menu[]; id: string } {
  const id = newMenuId();
  const fresh: MenuItem = { ...item, id, label: item.label.trim().slice(0, 120) || (item.kind === "page" ? (item.page ?? "Page") : "Link") };
  const next = updateItems(menus, menuId, (items) => {
    if (!parentId) return [...items, fresh];
    return items.map((parent) => (parent.id === parentId ? { ...parent, children: [...(parent.children ?? []), fresh] } : parent));
  });
  return { menus: next, id };
}

export function updateItem(menus: Menu[], menuId: string, id: string, patch: Partial<Omit<MenuItem, "id" | "children">>): Menu[] {
  const apply = (item: MenuItem): MenuItem => {
    if (item.id === id) {
      const next = { ...item, ...patch };
      if (patch.label !== undefined) next.label = patch.label.trim().slice(0, 120) || item.label;
      return next;
    }
    return item.children ? { ...item, children: item.children.map(apply) } : item;
  };
  return updateItems(menus, menuId, (items) => items.map(apply));
}

export function removeItem(menus: Menu[], menuId: string, id: string): Menu[] {
  return updateItems(menus, menuId, (items) => items.filter((item) => item.id !== id).map((item) => (item.children ? { ...item, children: item.children.filter((child) => child.id !== id) } : item)));
}

/** Swap with the neighbour above (-1) or below (+1), within the same list. */
export function moveItem(menus: Menu[], menuId: string, id: string, direction: -1 | 1): Menu[] {
  return updateItems(menus, menuId, (items) => {
    const place = locate(items, id);
    if (!place) return items;
    const target = place.index + direction;
    if (target < 0 || target >= place.list.length) return items;
    const swapped = [...place.list];
    [swapped[place.index], swapped[target]] = [swapped[target]!, swapped[place.index]!];
    if (!place.parent) return swapped;
    return replaceTop(items, place.parent.id, { ...place.parent, children: swapped });
  });
}

/** Make a top-level item the last child of the item above it (a dropdown entry). Its own children come along only one level deep, so they are lifted next to it. */
export function indentItem(menus: Menu[], menuId: string, id: string): Menu[] {
  return updateItems(menus, menuId, (items) => {
    const index = items.findIndex((item) => item.id === id);
    if (index <= 0) return items;
    const item = items[index]!;
    const above = items[index - 1]!;
    const { children: lifted = [], ...bare } = item;
    const next = [...items];
    next.splice(index, 1, ...lifted);
    return next.map((entry) => (entry.id === above.id ? { ...above, children: [...(above.children ?? []), bare] } : entry));
  });
}

/** Lift a child out of its dropdown to sit right after its parent. */
export function outdentItem(menus: Menu[], menuId: string, id: string): Menu[] {
  return updateItems(menus, menuId, (items) => {
    const place = locate(items, id);
    if (!place || !place.parent) return items;
    const parent = place.parent;
    const item = place.list[place.index]!;
    const remaining = place.list.filter((entry) => entry.id !== id);
    const parentIndex = items.findIndex((entry) => entry.id === parent.id);
    const next = items.map((entry) => (entry.id === parent.id ? (remaining.length > 0 ? { ...parent, children: remaining } : (({ children: _drop, ...rest }) => rest)(parent)) : entry));
    next.splice(parentIndex + 1, 0, item);
    return next;
  });
}

/** Every item, top level then children, flattened with its depth (for lists and tests). */
export function flattenItems(items: MenuItem[]): { item: MenuItem; depth: number }[] {
  const out: { item: MenuItem; depth: number }[] = [];
  for (const item of items) {
    out.push({ item, depth: 0 });
    for (const child of item.children ?? []) out.push({ item: child, depth: 1 });
  }
  return out;
}
