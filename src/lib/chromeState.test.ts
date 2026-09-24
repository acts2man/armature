import { describe, expect, it } from "vitest";
import type { Element, LayoutDoc, Menu } from "../../kit/types.ts";
import { countElements, describeMenuUsage, menuUsage, navMenusIn, partState } from "./chromeState.ts";

const meta = { createdBy: "test", updatedAt: "" };
const element = (id: string, type: string, props: Record<string, unknown> = {}, children?: Element[]): Element => ({ id, type, props, style: {}, advanced: {}, meta, ...(children ? { children } : {}) }) as Element;
const layout = (pageSlug: string, root: Element[], label?: string): LayoutDoc => ({ version: 1, pageSlug, path: "/", root, ...(label ? { label } : {}) });
const menus: Menu[] = [
  { id: "main", name: "Main menu", items: [{ id: "a", label: "Home", kind: "page", page: "home" }] },
  { id: "foot", name: "Footer links", items: [] },
];
const header = layout("_header", [element("row00001", "container", {}, [element("logo0001", "site-logo", { src: "" }), element("nav00001", "nav-menu", { menu: "main" })])], "Header");
const emptyNav = layout("_header", [element("row00001", "container", {}, [element("nav00001", "nav-menu", {})])], "Header");
const about = layout("about", [element("nav00002", "nav-menu", { menu: "foot" })], "About");

describe("the true state of a built part", () => {
  it("counts every element, nested ones included, and names the menu each Nav Menu shows", () => {
    expect(countElements(header)).toBe(3);
    expect(navMenusIn(header)).toEqual([{ id: "nav00001", menu: "main" }]);
    expect(partState(header, menus)).toEqual({ built: true, elements: 3, navMenus: [{ menu: menus[0] }] });
  });
  it("a Nav Menu with no menu chosen, or whose menu was deleted, shows as none", () => {
    expect(partState(emptyNav, menus)).toEqual({ built: true, elements: 2, navMenus: [{ menu: null }] });
    expect(partState(header, [])).toEqual({ built: true, elements: 3, navMenus: [{ menu: null }] });
  });
  it("no layout: still coded", () => {
    expect(partState(undefined, menus)).toEqual({ built: false });
  });
});

describe("where a menu is shown", () => {
  it("names the header, the footer and the pages that show it", () => {
    const layouts = { _header: header, _footer: layout("_footer", [element("nav00003", "nav-menu", { menu: "main" })]), about };
    expect(menuUsage("main", layouts)).toEqual(["header", "footer"]);
    expect(menuUsage("foot", layouts)).toEqual(["About"]);
    expect(menuUsage("nope", layouts)).toEqual([]);
  });
  it("reads in plain English", () => {
    expect(describeMenuUsage([])).toBe("Not shown anywhere yet");
    expect(describeMenuUsage(["header"])).toBe("Shown in the header");
    expect(describeMenuUsage(["header", "About"])).toBe("Shown in the header and on About");
    expect(describeMenuUsage(["header", "footer", "About"])).toBe("Shown in the header, in the footer and on About");
  });
});
