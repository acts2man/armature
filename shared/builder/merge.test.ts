import { describe, expect, it } from "vitest";
import type { Element, LayoutDoc } from "../../kit/types.ts";
import { mergeLayouts, mergeValues } from "./merge.ts";

const meta = { createdBy: "t", updatedAt: "2026-09-22" };
const el = (id: string, text: string, children?: Element[]): Element => ({ id, type: children ? "container" : "heading", props: children ? {} : { text }, style: {}, advanced: {}, meta, ...(children ? { children } : {}) });
const page = (root: Element[]): LayoutDoc => ({ version: 1, pageSlug: "home", path: "/", root });
const ids = (layout: LayoutDoc): unknown => layout.root.map((element) => (element.children ? { [element.id]: element.children.map((child) => child.id) } : element.id));
const textOf = (layout: LayoutDoc, id: string): unknown => {
  const walk = (elements: Element[]): unknown => {
    for (const element of elements) {
      if (element.id === id) return element.props["text"];
      const inner = element.children ? walk(element.children) : undefined;
      if (inner !== undefined) return inner;
    }
    return undefined;
  };
  return walk(layout.root);
};

const base = page([el("aaaaaaaa", "Hello"), el("secsecse", "", [el("bbbbbbbb", "Two"), el("cccccccc", "Three")]), el("dddddddd", "Four")]);

describe("mergeLayouts", () => {
  it("replays my edits onto theirs when we touched different elements", () => {
    const mine = page([el("aaaaaaaa", "Hello there"), el("secsecse", "", [el("bbbbbbbb", "Two"), el("cccccccc", "Three")]), el("dddddddd", "Four")]);
    const theirs = page([el("aaaaaaaa", "Hello"), el("secsecse", "", [el("bbbbbbbb", "Two!"), el("cccccccc", "Three")]), el("dddddddd", "Four")]);
    const result = mergeLayouts(base, mine, theirs);
    expect(result.conflicts).toEqual([]);
    expect(textOf(result.layout, "aaaaaaaa")).toBe("Hello there");
    expect(textOf(result.layout, "bbbbbbbb")).toBe("Two!");
  });

  it("keeps additions from both sides in place, and removals", () => {
    const mine = page([el("aaaaaaaa", "Hello"), el("newmine1", "Mine"), el("secsecse", "", [el("bbbbbbbb", "Two"), el("cccccccc", "Three")])]);
    const theirs = page([el("aaaaaaaa", "Hello"), el("secsecse", "", [el("bbbbbbbb", "Two"), el("newthem1", "Theirs"), el("cccccccc", "Three")]), el("dddddddd", "Four")]);
    const result = mergeLayouts(base, mine, theirs);
    expect(result.conflicts).toEqual([]);
    // Mine removed dddddddd; theirs added newthem1 inside the section.
    expect(ids(result.layout)).toEqual(["aaaaaaaa", "newmine1", { secsecse: ["bbbbbbbb", "newthem1", "cccccccc"] }]);
  });

  it("moves an element to where I put it when they did not move it", () => {
    const mine = page([el("aaaaaaaa", "Hello"), el("secsecse", "", [el("cccccccc", "Three"), el("dddddddd", "Four"), el("bbbbbbbb", "Two")])]);
    const theirs = page([el("aaaaaaaa", "Hi"), el("secsecse", "", [el("bbbbbbbb", "Two"), el("cccccccc", "Three")]), el("dddddddd", "Four")]);
    const result = mergeLayouts(base, mine, theirs);
    expect(result.conflicts).toEqual([]);
    expect(ids(result.layout)).toEqual(["aaaaaaaa", { secsecse: ["cccccccc", "dddddddd", "bbbbbbbb"] }]);
    expect(textOf(result.layout, "aaaaaaaa")).toBe("Hi");
  });

  it("names the element when both changed it, and follows the choice", () => {
    const mine = page([el("aaaaaaaa", "Mine"), el("secsecse", "", [el("bbbbbbbb", "Two"), el("cccccccc", "Three")]), el("dddddddd", "Four")]);
    const theirs = page([el("aaaaaaaa", "Theirs"), el("secsecse", "", [el("bbbbbbbb", "Two"), el("cccccccc", "Three")]), el("dddddddd", "Four")]);
    const result = mergeLayouts(base, mine, theirs);
    expect(result.conflicts).toEqual([{ key: "layout:home:aaaaaaaa", page: "home", elementId: "aaaaaaaa", label: 'Both you and someone else changed heading "Mine"' }]);
    expect(textOf(result.layout, "aaaaaaaa")).toBe("Theirs");
    expect(textOf(mergeLayouts(base, mine, theirs, { "layout:home:aaaaaaaa": "mine" }).layout, "aaaaaaaa")).toBe("Mine");
    const kept = mergeLayouts(base, mine, theirs, { "layout:home:aaaaaaaa": "theirs" });
    expect(kept.conflicts).toEqual([]);
    expect(textOf(kept.layout, "aaaaaaaa")).toBe("Theirs");
  });

  it("the same edit on both sides is not a conflict", () => {
    const same = page([el("aaaaaaaa", "Same"), el("secsecse", "", [el("bbbbbbbb", "Two"), el("cccccccc", "Three")]), el("dddddddd", "Four")]);
    expect(mergeLayouts(base, same, same).conflicts).toEqual([]);
  });

  it("an edit against a deletion is a conflict either way round", () => {
    const edited = page([el("aaaaaaaa", "Hello"), el("secsecse", "", [el("bbbbbbbb", "Two edited"), el("cccccccc", "Three")]), el("dddddddd", "Four")]);
    const removed = page([el("aaaaaaaa", "Hello"), el("secsecse", "", [el("cccccccc", "Three")]), el("dddddddd", "Four")]);
    expect(mergeLayouts(base, edited, removed).conflicts.map((c) => c.elementId)).toEqual(["bbbbbbbb"]);
    expect(mergeLayouts(base, removed, edited).conflicts.map((c) => c.elementId)).toEqual(["bbbbbbbb"]);
    // Choosing mine restores my edit / applies my deletion.
    expect(textOf(mergeLayouts(base, edited, removed, { "layout:home:bbbbbbbb": "mine" }).layout, "bbbbbbbb")).toBe("Two edited");
    expect(textOf(mergeLayouts(base, removed, edited, { "layout:home:bbbbbbbb": "mine" }).layout, "bbbbbbbb")).toBeUndefined();
  });

  it("an element added into a container they removed is a conflict", () => {
    const mine = page([el("aaaaaaaa", "Hello"), el("secsecse", "", [el("bbbbbbbb", "Two"), el("cccccccc", "Three"), el("newmine1", "New")]), el("dddddddd", "Four")]);
    const theirs = page([el("aaaaaaaa", "Hello"), el("dddddddd", "Four")]);
    const result = mergeLayouts(base, mine, theirs);
    expect(result.conflicts.map((c) => c.elementId)).toEqual(["newmine1"]);
  });

  it("pages: new on both sides, and deleted while I edited", () => {
    const mine = page([el("aaaaaaaa", "Mine")]);
    expect(mergeLayouts(null, mine, page([el("zzzzzzzz", "Theirs")])).conflicts[0]?.key).toBe("layout:home");
    expect(mergeLayouts(null, mine, null).conflicts).toEqual([]);
    expect(mergeLayouts(base, mine, null).conflicts[0]?.key).toBe("layout:home");
    expect(mergeLayouts(base, mine, null, { "layout:home": "mine" }).layout).toBe(mine);
  });

  it("page settings I changed win; theirs stay otherwise", () => {
    const mine = { ...base, seo: { title: "Mine" } };
    const theirs = { ...base, label: "Their label" };
    const result = mergeLayouts(base, mine, theirs).layout;
    expect(result.seo).toEqual({ title: "Mine" });
    expect(result.label).toBe("Their label");
  });
});

describe("mergeValues", () => {
  const kit = { colors: { primary: "#111111", secondary: "#222222", custom: [] as unknown[] }, fonts: { heading: "Inter" } };
  it("merges different values and names the same value changed twice", () => {
    const mine = { ...kit, colors: { ...kit.colors, primary: "#aa0000" } };
    const theirs = { ...kit, fonts: { heading: "Lora" } };
    expect(mergeValues("kit", kit, mine, theirs).value).toEqual({ colors: { primary: "#aa0000", secondary: "#222222", custom: [] }, fonts: { heading: "Lora" } });
    const clash = { ...kit, colors: { ...kit.colors, primary: "#00aa00" } };
    const result = mergeValues("kit", kit, mine, clash);
    expect(result.conflicts.map((c) => c.key)).toEqual(["kit:colors.primary"]);
    expect(result.value.colors.primary).toBe("#00aa00");
    expect(mergeValues("kit", kit, mine, clash, { "kit:colors.primary": "mine" }).value.colors.primary).toBe("#aa0000");
  });
});
