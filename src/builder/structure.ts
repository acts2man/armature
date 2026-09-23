/**
 * Changing a section's structure from the Layout tab: the rows and columns are rebuilt
 * from the preset and what was inside moves into the new columns, column by column
 * (extra columns' content lands in the last new column; a one-column preset holds
 * everything directly).
 */
import type { Element } from "@shared/builder/index.ts";
import { findElement, updateElement, type BuilderState } from "./store.ts";
import { createStructure, type Structure } from "./widgets/registry.ts";

const isContainer = (element: Element) => element.type === "container" || element.type === "grid";
/** A row made by a structure preset: a container holding only containers (its columns). */
const isRow = (element: Element) => isContainer(element) && (element.children ?? []).length > 0 && (element.children ?? []).every(isContainer);

/** What a section holds, grouped by the column it sits in (loose children count as the first group). */
export function columnContents(section: Element): Element[][] {
  const loose: Element[] = [];
  const groups: Element[][] = [];
  for (const child of section.children ?? []) {
    if (isRow(child)) for (const column of child.children ?? []) groups.push([...(column.children ?? [])]);
    else loose.push(child);
  }
  return loose.length ? [loose, ...groups] : groups;
}

export function applyStructure(state: BuilderState, id: string, slug: string, structure: Structure): BuilderState | null {
  const entry = findElement(state, id, slug);
  if (!entry || !isContainer(entry.element)) return null;
  const groups = columnContents(entry.element);
  const fresh = createStructure(structure);
  const columns = (fresh.children ?? []).flatMap((row) => row.children ?? []);
  if (columns.length === 0) {
    return updateElement(state, id, slug, (element) => ({ ...element, children: groups.flat() }));
  }
  const filled = columns.map((column) => ({ ...column, children: [...(column.children ?? [])] }));
  groups.forEach((group, index) => {
    const column = filled[Math.min(index, filled.length - 1)];
    if (column) column.children = [...(column.children ?? []), ...group];
  });
  let cursor = 0;
  const rows = (fresh.children ?? []).map((row) => {
    const count = (row.children ?? []).length;
    const next = { ...row, children: filled.slice(cursor, cursor + count) };
    cursor += count;
    return next;
  });
  return updateElement(state, id, slug, (element) => ({ ...element, children: rows }));
}
