import { describe, expect, it } from "vitest";
import type { Menu } from "@kit/types.ts";
import { addItem, addMenu, flattenItems, indentItem, moveItem, outdentItem, removeItem, removeMenu, renameMenu, updateItem } from "./menus.ts";

const KIT_ID = /^[a-z0-9][a-z0-9_-]{0,40}$/;

describe("menus", () => {
  it("creates, renames and removes menus with ids the kit accepts", () => {
    const { menus, id } = addMenu([], "  Main menu ");
    expect(id).toMatch(KIT_ID);
    expect(menus[0]).toEqual({ id, name: "Main menu", items: [] });
    expect(renameMenu(menus, id, "Top")[0]?.name).toBe("Top");
    expect(renameMenu(menus, id, "   ")[0]?.name).toBe("Main menu");
    expect(removeMenu(menus, id)).toEqual([]);
  });

  it("adds, edits, reorders, nests one level and removes items", () => {
    let menus: Menu[] = addMenu([], "Main").menus;
    const menuId = menus[0]!.id;
    const home = addItem(menus, menuId, { label: "Home", kind: "page", page: "home" });
    menus = home.menus;
    const about = addItem(menus, menuId, { label: "About", kind: "page", page: "about" });
    menus = about.menus;
    const blog = addItem(menus, menuId, { label: "", kind: "url", href: "https://example.com/blog" });
    menus = blog.menus;
    expect(flattenItems(menus[0]!.items).map(({ item }) => item.label)).toEqual(["Home", "About", "Link"]);
    expect(blog.id).toMatch(KIT_ID);

    menus = updateItem(menus, menuId, blog.id, { label: "Blog", newTab: true });
    expect(menus[0]!.items[2]).toMatchObject({ label: "Blog", newTab: true, href: "https://example.com/blog" });

    menus = moveItem(menus, menuId, blog.id, -1);
    expect(menus[0]!.items.map((item) => item.label)).toEqual(["Home", "Blog", "About"]);
    expect(moveItem(menus, menuId, home.id, -1)).toEqual(menus);

    // Nest Blog under Home, then move About under Home too and reorder the children.
    menus = indentItem(menus, menuId, blog.id);
    expect(flattenItems(menus[0]!.items).map(({ item, depth }) => `${depth}:${item.label}`)).toEqual(["0:Home", "1:Blog", "0:About"]);
    menus = indentItem(menus, menuId, about.id);
    expect(flattenItems(menus[0]!.items).map(({ item, depth }) => `${depth}:${item.label}`)).toEqual(["0:Home", "1:Blog", "1:About"]);
    menus = moveItem(menus, menuId, about.id, -1);
    expect(menus[0]!.items[0]!.children?.map((item) => item.label)).toEqual(["About", "Blog"]);
    expect(indentItem(menus, menuId, home.id)).toEqual(menus);

    // Lift Blog back out: it lands right after Home.
    menus = outdentItem(menus, menuId, blog.id);
    expect(flattenItems(menus[0]!.items).map(({ item, depth }) => `${depth}:${item.label}`)).toEqual(["0:Home", "1:About", "0:Blog"]);
    // Indenting an item that has children lifts its children next to it (one level only).
    menus = indentItem(menus, menuId, blog.id);
    menus = outdentItem(menus, menuId, about.id);
    menus = indentItem(menus, menuId, blog.id);
    expect(flattenItems(menus[0]!.items).map(({ item, depth }) => `${depth}:${item.label}`)).toEqual(["0:Home", "1:Blog", "0:About"]);
    menus = outdentItem(menus, menuId, blog.id);
    expect(menus[0]!.items[0]!.children).toBeUndefined();

    menus = removeItem(menus, menuId, home.id);
    expect(menus[0]!.items.map((item) => item.label)).toEqual(["Blog", "About"]);
  });
});
