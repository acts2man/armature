/**
 * Changing a section's structure keeps what was inside: content moves into the new
 * columns, column by column, and a one-column preset holds it directly.
 */
import { describe, expect, it } from "vitest";
import { defaultSiteKit, type Element, type LayoutDoc } from "@shared/builder/index.ts";
import { findElement, type BuilderState } from "./store.ts";
import { currentStructure } from "./controls/StructureControl.tsx";
import { applyStructure, columnContents } from "./structure.ts";
import { createStructure, STRUCTURES } from "./widgets/registry.ts";

const el = (type: string, id: string, children?: Element[]): Element => ({ id, type, props: {}, style: {}, advanced: {}, meta: { createdBy: "t", updatedAt: "t" }, ...(children ? { children } : {}) });
const structure = (id: string) => STRUCTURES.find((item) => item.id === id)!;
const ids = (elements: Element[] | undefined): string[] => (elements ?? []).map((element) => element.id);

/** A section from a preset with the given widgets dropped into its columns (or directly, for one column). */
function section(presetId: string, perColumn: Element[][]): Element {
  const built = { ...createStructure(structure(presetId)), id: "secxxxxx" };
  const columns = (built.children ?? []).flatMap((row) => row.children ?? []);
  if (columns.length === 0) return { ...built, children: perColumn.flat() };
  columns.forEach((column, index) => {
    column.children = perColumn[index] ?? [];
  });
  return built;
}

const state = (root: Element[]): BuilderState => ({ layouts: { home: { version: 1, pageSlug: "home", path: "/", root } as LayoutDoc }, deletedPages: [], kit: defaultSiteKit() });

describe("applyStructure", () => {
  it("moves each column's content into the matching new column, extra columns into the last", () => {
    const s = state([section("3", [[el("heading", "h0000001")], [el("text", "t0000001")], [el("button", "b0000001")]])]);
    const next = applyStructure(s, "secxxxxx", "home", structure("50-50"))!;
    const columns = findElement(next, "secxxxxx")!.element.children!.flatMap((row) => row.children ?? []);
    expect(columns).toHaveLength(2);
    expect(ids(columns[0]!.children)).toEqual(["h0000001"]);
    expect(ids(columns[1]!.children)).toEqual(["t0000001", "b0000001"]);
    expect(currentStructure(findElement(next, "secxxxxx")!.element.children)?.id).toBe("50-50");
  });

  it("puts loose content into the first column, and a one-column preset flattens everything", () => {
    const flat = state([section("1", [[el("heading", "h0000001"), el("text", "t0000001")]])]);
    expect(currentStructure(findElement(flat, "secxxxxx")!.element.children)?.id).toBe("1");
    const split = applyStructure(flat, "secxxxxx", "home", structure("33-66"))!;
    const columns = findElement(split, "secxxxxx")!.element.children!.flatMap((row) => row.children ?? []);
    expect(ids(columns[0]!.children)).toEqual(["h0000001", "t0000001"]);
    expect(ids(columns[1]!.children)).toEqual([]);
    const back = applyStructure(split, "secxxxxx", "home", structure("1"))!;
    expect(ids(findElement(back, "secxxxxx")!.element.children)).toEqual(["h0000001", "t0000001"]);
  });

  it("keeps two rows' columns in order and refuses widgets", () => {
    const s = state([section("2-rows", [[el("heading", "h0000001")], [el("text", "t0000001")]]), el("heading", "h0000009")]);
    expect(columnContents(findElement(s, "secxxxxx")!.element).map(ids)).toEqual([["h0000001"], ["t0000001"]]);
    const next = applyStructure(s, "secxxxxx", "home", structure("4"))!;
    const columns = findElement(next, "secxxxxx")!.element.children!.flatMap((row) => row.children ?? []);
    expect(columns.map((column) => ids(column.children))).toEqual([["h0000001"], ["t0000001"], [], []]);
    expect(applyStructure(s, "h0000009", "home", structure("4"))).toBeNull();
  });
});
