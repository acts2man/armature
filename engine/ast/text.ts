/**
 * Writing words back: a string literal keeps its quotes; literal JSX children are
 * replaced by clean JSX (plain text, <strong>, <em>, <a>, <br />). Nothing else in the
 * file is reprinted: recast keeps every untouched node's original text.
 */
import * as t from "@babel/types";
import type { Loc, RichRun } from "../shared/types.ts";
import { locate } from "./locate.ts";
import { literalString, walk, type Node, type ParsedFile } from "./parse.ts";

function escapeForQuote(value: string, quote: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(new RegExp(quote, "g"), `\\${quote}`)
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** The string literal (or expression-free template) starting at `loc`. */
export function findStringAt(parsed: ParsedFile, loc: Loc): t.StringLiteral | t.TemplateLiteral | null {
  let found: t.StringLiteral | t.TemplateLiteral | null = null;
  walk(parsed.ast, (node) => {
    if (found) return false;
    if ((t.isStringLiteral(node) || (t.isTemplateLiteral(node) && node.expressions.length === 0)) && node.loc && node.loc.start.line === loc.line && node.loc.start.column === loc.col) {
      found = node;
      return false;
    }
    if (node.loc && node.loc.end.line < loc.line) return false;
    return true;
  });
  return found;
}

/** Whether a string literal sits in a JSX attribute (where quotes are HTML-escaped, not backslashed). */
function inJsxAttribute(parsed: ParsedFile, literal: Node): boolean {
  let result = false;
  walk(parsed.ast, (node, ancestors) => {
    if (node === literal) {
      const parent = ancestors[ancestors.length - 1];
      result = !!parent && t.isJSXAttribute(parent);
      return false;
    }
    return true;
  });
  return result;
}

/** Replace the value of a string literal in place, keeping its quote style. */
export function setStringLiteral(parsed: ParsedFile, literal: t.StringLiteral | t.TemplateLiteral, value: string): void {
  if (t.isTemplateLiteral(literal)) {
    const quasi = literal.quasis[0];
    if (quasi) {
      quasi.value = { raw: value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${"), cooked: value };
      (quasi as unknown as { original?: unknown }).original = undefined;
    }
    (literal as unknown as { original?: unknown }).original = undefined;
    return;
  }
  const raw = (literal.extra?.raw as string | undefined) ?? '"';
  const quote = raw.startsWith("'") ? "'" : raw.startsWith("`") ? "`" : '"';
  literal.value = value;
  if (inJsxAttribute(parsed, literal)) {
    const escaped = value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    literal.extra = { rawValue: value, raw: `"${escaped}"` };
  } else {
    literal.extra = { rawValue: value, raw: `${quote}${escapeForQuote(value, quote)}${quote}` };
  }
  (literal as unknown as { original?: unknown }).original = undefined;
}

export function currentStringValue(parsed: ParsedFile, loc: Loc): string | null {
  const literal = findStringAt(parsed, loc);
  return literal ? literalString(literal) : null;
}

/** Text that is safe as JSX text; anything with braces or angle brackets goes into an expression. */
function jsxTextNode(text: string): t.JSXText | t.JSXExpressionContainer {
  if (/[{}<>]/.test(text)) return t.jsxExpressionContainer(t.stringLiteral(text));
  return t.jsxText(text.replace(/&/g, "&amp;"));
}

function runToNodes(run: RichRun): t.JSXElement["children"] {
  if (run.br) return [t.jsxElement(t.jsxOpeningElement(t.jsxIdentifier("br"), [], true), null, [], true)];
  let nodes: t.JSXElement["children"] = [jsxTextNode(run.text)];
  const wrap = (tag: string, attributes: t.JSXAttribute[] = []) => {
    nodes = [t.jsxElement(t.jsxOpeningElement(t.jsxIdentifier(tag), attributes, false), t.jsxClosingElement(t.jsxIdentifier(tag)), nodes, false)];
  };
  if (run.italic) wrap("em");
  if (run.bold) wrap("strong");
  if (run.href) wrap("a", [t.jsxAttribute(t.jsxIdentifier("href"), t.stringLiteral(run.href))]);
  return nodes;
}

/** Replace an element's children with the runs. A single plain run keeps the original text's surrounding whitespace. */
export function setJsxChildren(parsed: ParsedFile, loc: Loc, runs: RichRun[]): boolean {
  const located = locate(parsed, loc.file, loc);
  if (!located) return false;
  const element = located.element;
  const plain = runs.length === 1 && runs[0] && !runs[0].bold && !runs[0].italic && !runs[0].href && !runs[0].br;
  const only = element.children.length === 1 ? element.children[0] : undefined;
  if (plain && only && t.isJSXText(only) && !/[{}<>]/.test(runs[0]!.text)) {
    const leading = /^\s*/.exec(only.value)?.[0] ?? "";
    const trailing = /\s*$/.exec(only.value)?.[0] ?? "";
    const text = runs[0]!.text.replace(/&/g, "&amp;");
    only.value = `${leading.includes("\n") ? leading : ""}${text}${trailing.includes("\n") ? trailing : ""}`;
    only.extra = { raw: only.value, rawValue: only.value };
    (only as unknown as { original?: unknown }).original = undefined;
    return true;
  }
  const children: t.JSXElement["children"] = [];
  for (const run of runs) children.push(...runToNodes(run));
  // Merge adjacent text nodes so the printer does not split words.
  const merged: t.JSXElement["children"] = [];
  for (const child of children) {
    const last = merged[merged.length - 1];
    if (last && t.isJSXText(last) && t.isJSXText(child)) last.value += child.value;
    else merged.push(child);
  }
  element.children = merged;
  if (element.selfClosing) {
    element.selfClosing = false;
    element.openingElement.selfClosing = false;
    element.closingElement = t.jsxClosingElement(element.openingElement.name);
  }
  return true;
}

/** The runs a set of literal JSX children represent, for round trips in tests and the bridge. */
export function runsOfChildren(children: t.JSXElement["children"], inherited: { bold?: boolean; italic?: boolean; href?: string } = {}): RichRun[] {
  const out: RichRun[] = [];
  for (const child of children) {
    if (t.isJSXText(child)) {
      const text = child.value;
      if (text.trim() === "" && !text.includes(" ")) continue;
      out.push({ ...inherited, text });
    } else if (t.isJSXExpressionContainer(child)) {
      const value = literalString(child.expression);
      if (value !== null) out.push({ ...inherited, text: value });
    } else if (t.isJSXElement(child)) {
      const name = t.isJSXIdentifier(child.openingElement.name) ? child.openingElement.name.name : "";
      if (name === "br") {
        out.push({ text: "", br: true });
        continue;
      }
      const next = { ...inherited };
      if (name === "strong" || name === "b") next.bold = true;
      if (name === "em" || name === "i") next.italic = true;
      if (name === "a") {
        const href = child.openingElement.attributes.find((attribute): attribute is t.JSXAttribute => t.isJSXAttribute(attribute) && t.isJSXIdentifier(attribute.name) && attribute.name.name === "href");
        const value = href?.value ? literalString(href.value) : null;
        if (value) next.href = value;
      }
      out.push(...runsOfChildren(child.children, next));
    }
  }
  return out;
}
