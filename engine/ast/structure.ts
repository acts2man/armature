/**
 * Moving, deleting, duplicating and inserting JSX elements, printed by recast so only
 * the touched lines change. Every operation returns where the affected element ended up
 * (its opening tag's new line and column) so the editor can keep it selected: the
 * element is marked with a temporary attribute before printing, found again in the
 * printed text, and the marker is removed from the text.
 */
import * as t from "@babel/types";
import type { InsertKind, Loc } from "../shared/types.ts";
import { locate } from "./locate.ts";
import { elementChildren, parseSource, printSource, type ParsedFile } from "./parse.ts";

const MARK = "data-ae-mark";

/** Print the file with `element` marked, find it, then strip the marker from the text. */
export function printWithLocation(parsed: ParsedFile, file: string, element: t.JSXElement | null): { code: string; loc: Loc | null } {
  if (!element) return { code: printSource(parsed.ast), loc: null };
  element.openingElement.attributes.push(t.jsxAttribute(t.jsxIdentifier(MARK), null));
  const printed = printSource(parsed.ast);
  element.openingElement.attributes.pop();
  const marker = ` ${MARK}`;
  const at = printed.indexOf(marker);
  const code = at === -1 ? printed : printed.slice(0, at) + printed.slice(at + marker.length);
  if (at === -1) return { code, loc: null };
  const reparsed = parseSource(code);
  let loc: Loc | null = null;
  // The marker was removed after the opening tag's name, so the tag's own start position is unchanged in `code`.
  const before = code.slice(0, at);
  const tagStart = before.lastIndexOf("<");
  const line = before.slice(0, tagStart).split("\n").length;
  const col = tagStart - (before.lastIndexOf("\n", tagStart - 1) + 1);
  const found = locate(reparsed, file, { file, line, col });
  if (found) loc = { file, line, col };
  return { code, loc };
}

function indentOf(parent: t.JSXElement | t.JSXFragment, code: string): { child: string; close: string } {
  const first = elementChildren(parent)[0];
  const opening = t.isJSXElement(parent) ? parent.openingElement : parent.openingFragment;
  const lineStart = (node: t.Node) => {
    const start = node.loc?.start;
    if (!start) return "";
    const lines = code.split("\n");
    const line = lines[start.line - 1] ?? "";
    return /^\s*/.exec(line)?.[0] ?? "";
  };
  const close = lineStart(opening);
  const child = first ? lineStart(first) : `${close}  `;
  return { child, close };
}

/** Remove whitespace-only text nodes that would leave blank lines around a removed child. */
function removeChild(parent: t.JSXElement | t.JSXFragment, element: t.JSXElement): void {
  const index = parent.children.indexOf(element);
  if (index === -1) return;
  const previous = parent.children[index - 1];
  const next = parent.children[index + 1];
  const remove = new Set<t.Node>([element]);
  if (next && t.isJSXText(next) && next.value.trim() === "") remove.add(next);
  else if (previous && t.isJSXText(previous) && previous.value.trim() === "") remove.add(previous);
  parent.children = parent.children.filter((child) => !remove.has(child));
}

/**
 * Insert `element` so it becomes the `index`-th element child of `parent`, on its own line.
 * Whitespace text is written relative to the parent: recast adds the parent's own
 * indentation when it prints a new text node, so "\n" plus the extra two spaces lands the
 * child exactly under its siblings.
 */
function insertChild(parent: t.JSXElement | t.JSXFragment, element: t.JSXElement, index: number, code: string): void {
  const elements = elementChildren(parent);
  const indent = indentOf(parent, code);
  const extra = " ".repeat(Math.max(0, indent.child.length - indent.close.length));
  const newline = () => t.jsxText(`\n${extra}`);
  if (elements.length === 0) {
    parent.children = [newline(), element, t.jsxText("\n")];
    return;
  }
  if (index >= elements.length) {
    const last = elements[elements.length - 1]!;
    const at = parent.children.indexOf(last) + 1;
    parent.children.splice(at, 0, newline(), element);
    return;
  }
  const target = elements[index]!;
  const at = parent.children.indexOf(target);
  parent.children.splice(at, 0, element, newline());
}

export type StructureResult = { code: string; loc: Loc | null };

export function deleteElement(parsed: ParsedFile, file: string, target: Loc): StructureResult | null {
  const located = locate(parsed, file, target);
  const parent = located?.ancestors[located.ancestors.length - 1];
  if (!located || !parent || !(t.isJSXElement(parent) || t.isJSXFragment(parent))) return null;
  removeChild(parent, located.element);
  return { code: printSource(parsed.ast), loc: null };
}

export function duplicateElement(parsed: ParsedFile, file: string, target: Loc): StructureResult | null {
  const located = locate(parsed, file, target);
  const parent = located?.ancestors[located.ancestors.length - 1];
  if (!located || !parent || !(t.isJSXElement(parent) || t.isJSXFragment(parent))) return null;
  const copy = t.cloneNode(located.element, true, true);
  const index = elementChildren(parent).indexOf(located.element);
  insertChild(parent, copy, index + 1, parsed.code);
  return printWithLocation(parsed, file, copy);
}

export function moveElement(parsed: ParsedFile, file: string, target: Loc, parentLoc: Loc, index: number): StructureResult | null {
  const located = locate(parsed, file, target);
  const newParent = locate(parsed, file, parentLoc);
  const oldParent = located?.ancestors[located.ancestors.length - 1];
  if (!located || !newParent || !oldParent || !(t.isJSXElement(oldParent) || t.isJSXFragment(oldParent))) return null;
  if (located.element === newParent.element || located.ancestors.includes(newParent.element) === false && newParent.ancestors.includes(located.element)) return null;
  const siblings = elementChildren(oldParent);
  const oldIndex = siblings.indexOf(located.element);
  let targetIndex = index;
  if (oldParent === newParent.element && oldIndex < targetIndex) targetIndex -= 1;
  removeChild(oldParent, located.element);
  // A fresh copy (no memory of its original text) is printed at the new indentation.
  const moved = t.cloneNode(located.element, true, false);
  insertChild(newParent.element, moved, targetIndex, parsed.code);
  return printWithLocation(parsed, file, moved);
}

/** Clean JSX for a new element. Tailwind classes only when the site runs Tailwind. */
export function snippetFor(kind: InsertKind, tailwind: boolean): string {
  const cls = (classes: string) => (tailwind ? ` className="${classes}"` : "");
  switch (kind) {
    case "heading":
      return `<h2${cls("text-3xl font-bold")}>New heading</h2>`;
    case "text":
      return `<p${cls("text-base")}>New paragraph. Click to edit this text.</p>`;
    case "image":
      return `<img${cls("w-full h-auto")} src="https://placehold.co/800x450" alt="" />`;
    case "button":
      return `<a${cls("inline-block rounded-md bg-black px-5 py-3 font-semibold text-white")} href="#">New button</a>`;
    case "container":
      return `<div${cls("flex flex-col gap-4 p-6")}>\n  <p>New box. Drop elements here.</p>\n</div>`;
    case "row":
      return `<div${cls("flex flex-row flex-wrap gap-6")}>\n  <div${cls("flex-1")}>\n    <p>First column</p>\n  </div>\n  <div${cls("flex-1")}>\n    <p>Second column</p>\n  </div>\n</div>`;
  }
}

export function insertElement(parsed: ParsedFile, file: string, parentLoc: Loc, index: number, kind: InsertKind, tailwind: boolean): StructureResult | null {
  const parent = locate(parsed, file, parentLoc);
  if (!parent) return null;
  const snippet = parseSource(`<>${snippetFor(kind, tailwind)}</>`);
  const fragment = (snippet.ast.program.body[0] as t.ExpressionStatement).expression as t.JSXFragment;
  const element = elementChildren(fragment)[0];
  if (!element) return null;
  const fresh = t.cloneNode(element, true, false);
  if (parent.element.selfClosing) {
    parent.element.selfClosing = false;
    parent.element.openingElement.selfClosing = false;
    parent.element.closingElement = t.jsxClosingElement(parent.element.openingElement.name);
    parent.element.children = [];
  }
  insertChild(parent.element, fresh, index, parsed.code);
  return printWithLocation(parsed, file, fresh);
}
