/**
 * Finding JSX elements again from the locations the preview reports, and describing
 * their place in the tree (parent, index among siblings, whether they can take children).
 */
import * as t from "@babel/types";
import type { Loc, StructureInfo } from "../shared/types.ts";
import { col, componentName, elementChildren, enclosingFunction, isIntrinsic, jsxName, line, mapCallOf, walk, type ParsedFile, type Path } from "./parse.ts";

export type Located = { element: t.JSXElement; ancestors: Path; file: string };

/** The JSX element whose opening tag starts at the given line and column. */
export function locate(parsed: ParsedFile, file: string, loc: Loc): Located | null {
  let found: Located | null = null;
  walk(parsed.ast, (node, ancestors) => {
    if (found) return false;
    if (t.isJSXElement(node) && line(node.openingElement) === loc.line && col(node.openingElement) === loc.col) {
      found = { element: node, ancestors, file };
      return false;
    }
    // Skip subtrees that end before the wanted line.
    if (node.loc && node.loc.end.line < loc.line) return false;
    return true;
  });
  return found;
}

export function locOf(file: string, element: t.JSXElement): Loc {
  return { file, line: line(element.openingElement), col: col(element.openingElement) };
}

/** Whether the element is a plain child of a JSX parent (not inside a callback, a ternary or an expression). */
export function directParent(ancestors: Path): (t.JSXElement | t.JSXFragment) | null {
  const parent = ancestors[ancestors.length - 1];
  if (parent && (t.isJSXElement(parent) || t.isJSXFragment(parent))) return parent;
  return null;
}

export function describeStructure(located: Located): StructureInfo {
  const { element, ancestors, file } = located;
  const parent = directParent(ancestors);
  const fn = enclosingFunction(ancestors);
  const inMap = fn ? mapCallOf(fn, ancestors.slice(0, ancestors.indexOf(fn))) !== null : false;
  const canReceiveChildren = isIntrinsic(jsxName(element)) && !element.selfClosing && (element.children.length === 0 || element.children.some((child) => t.isJSXElement(child) || (t.isJSXText(child) && child.value.trim() !== "")));
  if (!parent) {
    const reason = inMap
      ? { kind: "code" as const, message: "This is one item of a list drawn by code. Its words can be changed; to add or remove items, edit the list itself." }
      : { kind: "code" as const, message: "This element is the root of its component or sits inside code, so it cannot be moved, deleted or duplicated here." };
    return { editable: false, reason, parent: null, index: 0, siblingCount: 1, canReceiveChildren };
  }
  const siblings = elementChildren(parent);
  const index = siblings.indexOf(element);
  if (inMap) {
    return {
      editable: false,
      reason: { kind: "code", message: "This is one item of a list drawn by code. Its words can be changed; to add or remove items, edit the list itself." },
      parent: t.isJSXElement(parent) ? locOf(file, parent) : null,
      index,
      siblingCount: siblings.length,
      canReceiveChildren,
    };
  }
  return { editable: true, parent: t.isJSXElement(parent) ? locOf(file, parent) : null, index, siblingCount: siblings.length, canReceiveChildren };
}

export function componentOf(located: Located): string | null {
  return componentName(located.ancestors);
}

/** Every JSX element in a file with the given component name (usages of the component). */
export function findUsages(parsed: ParsedFile, name: string): { element: t.JSXElement; ancestors: Path }[] {
  const out: { element: t.JSXElement; ancestors: Path }[] = [];
  walk(parsed.ast, (node, ancestors) => {
    if (t.isJSXElement(node) && jsxName(node) === name) out.push({ element: node, ancestors });
  });
  return out;
}

/** Whether `inner` sits lexically inside `outer`. */
export function contains(outer: t.Node, inner: t.Node): boolean {
  if (!outer.loc || !inner.loc) return false;
  const a = outer.loc;
  const b = inner.loc;
  const startsBefore = a.start.line < b.start.line || (a.start.line === b.start.line && a.start.column <= b.start.column);
  const endsAfter = a.end.line > b.end.line || (a.end.line === b.end.line && a.end.column >= b.end.column);
  return startsBefore && endsAfter;
}
