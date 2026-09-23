/**
 * The command system: element commands (insert, move, remove, update, duplicate),
 * placement rules, the unified undo stack with grouping and click-to-jump, seeding,
 * change detection and drag-and-drop hit testing.
 */
import { describe, expect, it } from "vitest";
import { defaultSiteKit, type Element, type LayoutDoc } from "@shared/builder/index.ts";
import type { ElementRect } from "@shared/visualProtocol.ts";
import { emptyDraft } from "@/visual/draftStore.ts";
import { dropLabel, flowAxis, flowOf, hitTest, sectionGapAt } from "./dnd.ts";
import { apply, canRedo, canUndo, createHistory, jumpTo, redo, undo, type EditorState } from "./history.ts";
import {
  canPlace,
  changedElementIds,
  changedPages,
  createElement,
  deletePage,
  duplicateElement,
  findElement,
  insertElement,
  isSeedOnly,
  moveElement,
  removeElement,
  seedLayout,
  setElementPath,
  setKitPath,
  setPath,
  stableId,
  type BuilderState,
} from "./store.ts";
import { createStructure, STRUCTURES } from "./widgets/registry.ts";

const el = (type: string, id: string, children?: Element[]): Element => ({ id, type, props: type === "heading" ? { text: id } : {}, style: {}, advanced: {}, meta: { createdBy: "t", updatedAt: "t" }, ...(children ? { children } : {}) });

const layout = (): LayoutDoc => ({
  version: 1,
  pageSlug: "home",
  path: "/",
  root: [el("site-section", "sec00001"), el("container", "con00001", [el("heading", "hed00001"), el("container", "con00002", [el("text", "txt00001")])]), el("spacer", "spc00001")],
});

const state = (): BuilderState => ({ layouts: { home: layout() }, deletedPages: [], kit: defaultSiteKit() });
const ids = (elements: Element[]): string[] => elements.map((element) => element.id);

describe("element commands", () => {
  it("indexes elements with parent, position and depth", () => {
    const entry = findElement(state(), "txt00001");
    expect(entry).toMatchObject({ slug: "home", parentId: "con00002", index: 0, depth: 2, ancestors: ["con00001", "con00002"] });
  });

  it("inserts into containers and the root, never into widgets or an element's own subtree", () => {
    const s = state();
    const fresh = createElement("button", { text: "Go" });
    const inserted = insertElement(s, fresh, { slug: "home", parentId: "con00002", index: 1 });
    expect(ids(findElement(inserted!, "con00002")!.element.children!)).toEqual(["txt00001", fresh.id]);
    expect(insertElement(s, fresh, { slug: "home", parentId: "hed00001", index: 0 })).toBeNull();
    expect(canPlace(s, { slug: "home", parentId: "con00002" }, "con00001")).toBe(false);
    expect(canPlace(s, { slug: "home", parentId: null }, "con00001")).toBe(true);
    // Untouched branches keep their identity.
    expect(inserted!.layouts["home"]!.root[0]).toBe(s.layouts["home"]!.root[0]);
    expect(s.layouts["home"]!.root[1]!.children![1]!.children).toHaveLength(1);
  });

  it("moves within a parent (adjusting the index), across parents and refuses no-ops", () => {
    const s = state();
    const moved = moveElement(s, "sec00001", "home", { slug: "home", parentId: null, index: 3 });
    expect(ids(moved!.layouts["home"]!.root)).toEqual(["con00001", "spc00001", "sec00001"]);
    const nested = moveElement(s, "spc00001", "home", { slug: "home", parentId: "con00002", index: 0 });
    expect(ids(findElement(nested!, "con00002")!.element.children!)).toEqual(["spc00001", "txt00001"]);
    expect(ids(nested!.layouts["home"]!.root)).toEqual(["sec00001", "con00001"]);
    expect(moveElement(s, "hed00001", "home", { slug: "home", parentId: "con00001", index: 0 })).toBeNull();
    expect(moveElement(s, "con00001", "home", { slug: "home", parentId: "con00002", index: 0 })).toBeNull();
  });

  it("removes, updates by path, duplicates with fresh ids and respects locks", () => {
    const s = state();
    expect(findElement(removeElement(s, "con00001", "home")!, "txt00001")).toBeUndefined();
    const styled = setElementPath(s, "hed00001", "home", ["style", "color"], "kit:color.primary")!;
    expect(findElement(styled, "hed00001")!.element.style.color).toBe("kit:color.primary");
    expect(setElementPath(styled, "hed00001", "home", ["style", "color"], "kit:color.primary")).toBeNull();
    const cleared = setElementPath(styled, "hed00001", "home", ["style", "color"], undefined)!;
    expect(findElement(cleared, "hed00001")!.element.style).toEqual({});
    const dup = duplicateElement(s, "con00002", "home")!;
    const children = findElement(dup.state, "con00001")!.element.children!;
    expect(children).toHaveLength(3);
    expect(children[2]!.id).toBe(dup.newId);
    expect(children[2]!.children![0]!.id).not.toBe("txt00001");
    const locked = setElementPath(s, "con00002", "home", ["locked"], true)!;
    expect(canPlace(locked, { slug: "home", parentId: "con00002" })).toBe(false);
    expect(canPlace(locked, { slug: "home", parentId: "con00002" }, undefined, true)).toBe(true);
  });

  it("setPath creates and prunes nested objects", () => {
    const base = { props: { gap: { column: 1 } } };
    expect(setPath(base, ["props", "gap", "row"], 2)).toEqual({ props: { gap: { column: 1, row: 2 } } });
    expect(setPath(base, ["props", "gap", "column"], undefined)).toEqual({ props: {} });
    expect(setPath(base, ["style", "hover", "opacity"], 0.5)).toEqual({ props: { gap: { column: 1 } }, style: { hover: { opacity: 0.5 } } });
    expect(setPath(base, ["props", "gap", "column"], 1)).toBe(base);
  });

  it("edits the kit by path and deletes pages", () => {
    const s = setKitPath(state(), ["colors", "primary"], "#123456");
    expect(s.kit.colors.primary).toBe("#123456");
    const gone = deletePage(s, "home")!;
    expect(gone.layouts["home"]).toBeUndefined();
    expect(gone.deletedPages).toEqual(["home"]);
  });
});

describe("seeding and change detection", () => {
  it("seeds a coded page with stable site-section ids and tells a seed from an edit", () => {
    const seeded = seedLayout({ slug: "home", defaults: ["hero", "faq"] }, "/");
    expect(seeded.root.map((element) => element.id)).toEqual([stableId("home:hero"), stableId("home:faq")]);
    expect(stableId("home:hero")).toMatch(/^[a-z0-9]{8}$/);
    expect(stableId("home:hero")).not.toBe(stableId("home:faq"));
    expect(isSeedOnly(seeded)).toBe(true);
    const baseline = { layouts: {}, kit: defaultSiteKit() };
    const untouched: BuilderState = { layouts: { home: seeded }, deletedPages: [], kit: defaultSiteKit() };
    expect(changedPages(untouched, baseline)).toEqual([]);
    const edited = insertElement(untouched, createElement("spacer", {}), { slug: "home", parentId: null, index: 1 })!;
    expect(changedPages(edited, baseline)).toEqual([{ slug: "home", kind: "new" }]);
  });

  it("lists changed, new and deleted pages against the published layouts, ignoring timestamps", () => {
    const published = layout();
    const baseline = { layouts: { home: published }, kit: defaultSiteKit() };
    const same: BuilderState = { layouts: { home: { ...published, root: published.root.map((element) => ({ ...element, meta: { createdBy: "x", updatedAt: "later" } })) } }, deletedPages: [], kit: defaultSiteKit() };
    expect(changedPages(same, baseline)).toEqual([]);
    const changed = setElementPath(same, "hed00001", "home", ["props", "text"], "New")!;
    expect(changedPages(changed, baseline)).toEqual([{ slug: "home", kind: "changed" }]);
    expect([...changedElementIds(changed.layouts["home"], published)]).toEqual(["hed00001"]);
    const moved = moveElement(same, "spc00001", "home", { slug: "home", parentId: null, index: 0 })!;
    expect([...changedElementIds(moved.layouts["home"], published)].sort()).toEqual(["con00001", "sec00001", "spc00001"]);
    expect(changedPages(deletePage(same, "home")!, baseline)).toEqual([{ slug: "home", kind: "deleted" }]);
  });
});

describe("the unified history", () => {
  const initial = (): EditorState => ({ content: emptyDraft(), builder: state() });
  const command = (label: string, group?: string) => ({ label, group, run: (s: EditorState) => ({ ...s, builder: setElementPath(s.builder, "hed00001", "home", ["props", "text"], `${label}`) ?? s.builder }) });

  it("records steps, undoes, redoes, merges grouped commands and jumps", () => {
    let history = createHistory(initial());
    history = apply(history, command("A"), 1000);
    history = apply(history, command("B", "typing"), 1100);
    history = apply(history, command("C", "typing"), 1300);
    history = apply(history, command("D", "typing"), 5000);
    expect(history.past.map((entry) => entry.label)).toEqual(["A", "B", "D"]);
    expect(findElement(history.present.builder, "hed00001")!.element.props["text"]).toBe("D");
    history = undo(history);
    expect(findElement(history.present.builder, "hed00001")!.element.props["text"]).toBe("C");
    history = undo(history);
    expect(findElement(history.present.builder, "hed00001")!.element.props["text"]).toBe("A");
    expect(canRedo(history)).toBe(true);
    history = redo(history);
    expect(findElement(history.present.builder, "hed00001")!.element.props["text"]).toBe("C");
    history = jumpTo(history, 0);
    expect(canUndo(history)).toBe(false);
    expect(findElement(history.present.builder, "hed00001")!.element.props["text"]).toBe("hed00001");
    history = jumpTo(history, 3);
    expect(findElement(history.present.builder, "hed00001")!.element.props["text"]).toBe("D");
    // A no-op command records nothing.
    expect(apply(history, { label: "nothing", run: () => null })).toBe(history);
  });
});

describe("drag-and-drop hit testing", () => {
  const rect = (id: string, type: string, x: number, y: number, width: number, height: number, parentId: string | null, extra: Partial<ElementRect> = {}): ElementRect => ({ id, type, tag: "div", rect: { x, y, width, height }, padding: { top: 0, right: 0, bottom: 0, left: 0 }, margin: { top: 0, right: 0, bottom: 0, left: 0 }, parentId, page: "home", empty: false, ...extra });
  const elements = [
    rect("sec00001", "site-section", 0, 0, 1000, 200, null),
    rect("con00001", "container", 0, 200, 1000, 400, null, { inner: { x: 100, y: 240, width: 800, height: 320 } }),
    rect("hed00001", "heading", 100, 240, 800, 60, "con00001"),
    rect("con00002", "container", 100, 320, 800, 240, "con00001", { inner: { x: 100, y: 320, width: 800, height: 240 } }),
    rect("txt00001", "text", 100, 320, 800, 100, "con00002"),
    rect("spc00001", "spacer", 0, 600, 1000, 50, null),
  ];

  it("drops before or after a widget along its parent's axis", () => {
    const s = state();
    const above = hitTest({ state: s, elements, slug: "home", x: 500, y: 250 });
    expect(above).toMatchObject({ parentId: "con00001", index: 0, indicator: { kind: "line", edge: "before", axis: "y" } });
    const below = hitTest({ state: s, elements, slug: "home", x: 500, y: 290 });
    expect(below).toMatchObject({ parentId: "con00001", index: 1, indicator: { kind: "line", edge: "after" } });
  });

  it("drops inside a container's gap and never into the element being moved", () => {
    const s = state();
    const gap = hitTest({ state: s, elements, slug: "home", x: 500, y: 310 });
    expect(gap).toMatchObject({ parentId: "con00001", index: 1 });
    // Inside the element being moved there is no target at all (dropping onto yourself means nothing).
    const intoSelf = hitTest({ state: s, elements, slug: "home", x: 500, y: 350, movingId: "con00001" });
    expect(intoSelf).toBeNull();
    // Just below it, the drop lands after it at the root.
    const belowSelf = hitTest({ state: s, elements, slug: "home", x: 500, y: 610, movingId: "con00001" });
    expect(belowSelf).toMatchObject({ parentId: null, index: 2 });
    const root = hitTest({ state: s, elements, slug: "home", x: 500, y: 90 });
    expect(root).toMatchObject({ parentId: null, index: 0, indicator: { kind: "line", edge: "before" } });
    const end = hitTest({ state: s, elements, slug: "home", x: 500, y: 640 });
    expect(end).toMatchObject({ parentId: null, index: 3 });
  });

  it("fills an empty container and finds section gaps", () => {
    const s = state();
    const empty = elements.map((element) => (element.id === "con00002" ? { ...element, empty: true } : element)).filter((element) => element.id !== "txt00001");
    const emptied = removeElement(s, "txt00001", "home")!;
    const inside = hitTest({ state: emptied, elements: empty, slug: "home", x: 500, y: 400 });
    expect(inside).toMatchObject({ parentId: "con00002", index: 0, indicator: { kind: "inside" } });
    expect(flowAxis([rect("a", "x", 0, 0, 100, 50, null), rect("b", "x", 120, 0, 100, 50, null)])).toBe("x");
    expect(sectionGapAt(elements, "home", ["sec00001", "con00001", "spc00001"], 205)).toMatchObject({ index: 1, y: 200 });
    expect(sectionGapAt(elements, "home", ["sec00001", "con00001", "spc00001"], 400)).toBeNull();
  });

  it("follows the parent's flow from the layout: a row drops left or right, reversed rows flip, a grid uses the nearest cell edge", () => {
    // A row with one column (the rectangles alone could not tell it is a row), a reversed row, and a 2x2 grid.
    const row = el("container", "row00001", [el("heading", "hedrow01")]);
    row.props = { direction: { desktop: "row", mobile: "column" } };
    const reversed = el("container", "rev00001", [el("heading", "hedrev01"), el("heading", "hedrev02")]);
    reversed.props = { direction: "row-reverse" };
    const grid = el("grid", "grd00001", [el("heading", "hedgrd01"), el("heading", "hedgrd02"), el("heading", "hedgrd03"), el("heading", "hedgrd04")]);
    const s: BuilderState = { layouts: { home: { version: 1, pageSlug: "home", path: "/", root: [row, reversed, grid] } }, deletedPages: [], kit: defaultSiteKit() };
    const rects = [
      rect("row00001", "container", 0, 0, 1000, 100, null, { inner: { x: 0, y: 0, width: 1000, height: 100 } }),
      rect("hedrow01", "heading", 0, 0, 400, 100, "row00001"),
      rect("rev00001", "container", 0, 100, 1000, 100, null, { inner: { x: 0, y: 100, width: 1000, height: 100 } }),
      rect("hedrev02", "heading", 0, 100, 500, 100, "rev00001"),
      rect("hedrev01", "heading", 500, 100, 500, 100, "rev00001"),
      rect("grd00001", "grid", 0, 200, 1000, 400, null, { inner: { x: 0, y: 200, width: 1000, height: 400 } }),
      rect("hedgrd01", "heading", 0, 200, 500, 200, "grd00001"),
      rect("hedgrd02", "heading", 500, 200, 500, 200, "grd00001"),
      rect("hedgrd03", "heading", 0, 400, 500, 200, "grd00001"),
      rect("hedgrd04", "heading", 500, 400, 500, 200, "grd00001"),
    ];
    expect(flowOf(row, [], "desktop")).toEqual({ axis: "x", reversed: false });
    expect(flowOf(row, [], "mobile")).toEqual({ axis: "y", reversed: false });
    // Over the single column's right half: a vertical line after it (a horizontal line on phones).
    expect(hitTest({ state: s, elements: rects, slug: "home", x: 300, y: 50, device: "desktop" })).toMatchObject({ parentId: "row00001", index: 1, indicator: { kind: "line", axis: "x", edge: "after" }, beside: { id: "hedrow01", edge: "after" } });
    expect(hitTest({ state: s, elements: rects, slug: "home", x: 300, y: 80, device: "mobile" })).toMatchObject({ parentId: "row00001", index: 1, indicator: { kind: "line", axis: "y" } });
    // In the row's empty right half the nearest child still decides.
    expect(hitTest({ state: s, elements: rects, slug: "home", x: 900, y: 50, device: "desktop" })).toMatchObject({ parentId: "row00001", index: 1, indicator: { axis: "x", rect: { x: 400 } } });
    // A reversed row: the pointer on the left (visually first) is after the last child by index.
    const left = hitTest({ state: s, elements: rects, slug: "home", x: 100, y: 150, device: "desktop" });
    expect(left).toMatchObject({ parentId: "rev00001", index: 2, indicator: { axis: "x", rect: { x: 0 } } });
    // A grid: the nearest cell edge; the top of cell 3 is a horizontal line before it.
    expect(hitTest({ state: s, elements: rects, slug: "home", x: 250, y: 410, device: "desktop" })).toMatchObject({ parentId: "grd00001", index: 2, indicator: { kind: "line", axis: "y", edge: "before" } });
    expect(hitTest({ state: s, elements: rects, slug: "home", x: 490, y: 300, device: "desktop" })).toMatchObject({ parentId: "grd00001", index: 1, indicator: { kind: "line", axis: "x", edge: "after" } });
    expect(dropLabel(s, hitTest({ state: s, elements: rects, slug: "home", x: 490, y: 300, device: "desktop" })!)).toBe("after Heading");
  });

  it("treats a container's outer few pixels as beside it, along its parent's flow", () => {
    const s = state();
    // con00002 sits in con00001 (both columns): over its first child, the child's own "before" wins.
    const top = hitTest({ state: s, elements, slug: "home", x: 500, y: 323 });
    expect(top).toMatchObject({ parentId: "con00002", index: 0, indicator: { kind: "line", axis: "y", edge: "before" }, beside: { id: "txt00001", edge: "before" } });
    // Well inside it: against its child.
    expect(hitTest({ state: s, elements, slug: "home", x: 500, y: 340 })).toMatchObject({ parentId: "con00002", index: 0 });
    // Its bottom band (its own padding, no child there): after it, among con00001's children.
    expect(hitTest({ state: s, elements, slug: "home", x: 500, y: 556 })).toMatchObject({ parentId: "con00001", index: 2, beside: { id: "con00002", edge: "after" } });
    // The root container's own top band: before it at the root.
    expect(hitTest({ state: s, elements, slug: "home", x: 500, y: 203 })).toMatchObject({ parentId: null, index: 1, indicator: { edge: "before" } });
    expect(dropLabel(s, hitTest({ state: s, elements, slug: "home", x: 500, y: 203 })!)).toBe("before Container");
    // An empty container reads "into".
    const empty = elements.map((element) => (element.id === "con00002" ? { ...element, empty: true } : element)).filter((element) => element.id !== "txt00001");
    expect(dropLabel(removeElement(s, "txt00001", "home")!, hitTest({ state: removeElement(s, "txt00001", "home")!, elements: empty, slug: "home", x: 500, y: 400 })!)).toBe("into Container");
  });

  it("builds structures with percentage columns that stack on phones", () => {
    const section = createStructure(STRUCTURES.find((structure) => structure.id === "33-66")!);
    const row = section.children![0]!;
    expect(row.children).toHaveLength(2);
    expect(row.children![0]!.advanced.customWidth).toEqual({ desktop: { value: 33.33, unit: "%" } });
    expect(row.props["direction"]).toEqual({ desktop: "row", mobile: "column" });
    expect(createStructure(STRUCTURES[0]!).children).toEqual([]);
  });
});
