/**
 * From a NodeRef (what the preview knows about a DOM element) to a ResolvedNode (what
 * the inspector shows and what edits may touch): the element's words, picture, link,
 * classes and place in the tree, each either editable with its source location or
 * explained in plain English.
 */
import * as t from "@babel/types";
import type { ClassSource, ImageSource, LinkSource, Loc, NodeKind, NodeRef, Reason, ResolvedNode, TextSource } from "../shared/types.ts";
import { componentOf, describeStructure, findUsages, locOf, locate, type Located } from "./locate.ts";
import { getAttribute, isIntrinsic, jsxName, literalString, type Node } from "./parse.ts";
import type { Project } from "./project.ts";
import { functionTouchesLiveData, mapSourceOf, resolveProp, trace, type TraceContext, type Traced } from "./trace.ts";
import { componentName, enclosingFunction, hasSpreadAttribute, resolveBinding } from "./parse.ts";

export const INLINE_TAGS = new Set(["strong", "b", "em", "i", "a", "br", "span", "u", "code", "small", "sup", "sub", "mark", "s", "del", "ins", "abbr"]);
const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const TEXT_TAGS = new Set(["p", "span", "li", "blockquote", "label", "small", "strong", "em", "td", "th", "dt", "dd", "figcaption", "legend", "summary", "cite", "q", "b", "i", "code", "pre", "address", "time"]);
const MEDIA_TAGS = new Set(["img", "picture", "video", "iframe", "source"]);
const CONTAINER_TAGS = new Set(["div", "section", "main", "header", "footer", "nav", "article", "aside", "form", "fieldset", "figure", "details", "dialog", "ul", "ol", "table", "tbody", "thead", "tr", "body"]);

export type ResolveOptions = { project: Project; ref: NodeRef; pageFile: string | null; tailwind: boolean };

export class ResolveError extends Error {}

export function kindOf(tag: string, hasText: boolean, className: string): NodeKind {
  if (HEADINGS.has(tag)) return "heading";
  if (MEDIA_TAGS.has(tag)) return "image";
  if (tag === "button" || tag === "input" && false) return "button";
  if (tag === "a") return /\b(button|btn|cta)\b/.test(className) ? "button" : "link";
  if (tag === "ul" || tag === "ol") return "list";
  if (tag === "li") return "item";
  if (TEXT_TAGS.has(tag)) return "text";
  if (CONTAINER_TAGS.has(tag)) return hasText ? "text" : "container";
  return hasText ? "text" : "other";
}

export function labelFor(kind: NodeKind, tag: string, component: string | null): string {
  switch (kind) {
    case "heading":
      return `Heading (${tag})`;
    case "text":
      return tag === "p" ? "Paragraph" : "Text";
    case "image":
      return tag === "img" ? "Image" : tag === "iframe" ? "Embed" : tag === "video" ? "Video" : "Media";
    case "button":
      return "Button";
    case "link":
      return "Link";
    case "list":
      return "List";
    case "item":
      return "List item";
    case "container":
      return tag === "section" ? "Section" : tag === "header" ? "Header" : tag === "footer" ? "Footer" : tag === "nav" ? "Navigation" : tag === "main" ? "Page" : component ? `${component} box` : "Box";
    default:
      return tag;
  }
}

function meaningfulChildren(element: t.JSXElement | t.JSXFragment): t.JSXElement["children"] {
  return element.children.filter((child) => !(t.isJSXText(child) && child.value.trim() === "") && !(t.isJSXExpressionContainer(child) && t.isJSXEmptyExpression(child.expression)));
}

/** JSX text as the browser shows it: whitespace collapsed, line breaks around tags removed. */
export function flattenJsxText(children: t.JSXElement["children"]): string {
  let out = "";
  for (const child of children) {
    if (t.isJSXText(child)) out += collapseJsxText(child.value);
    else if (t.isJSXExpressionContainer(child)) {
      const value = literalString(child.expression);
      out += value ?? "";
    } else if (t.isJSXElement(child)) {
      if (jsxName(child) === "br") out += "\n";
      else out += flattenJsxText(child.children);
    }
  }
  return out;
}

/** JSX whitespace rules: lines are trimmed, a line break with text on both sides becomes one space. */
export function collapseJsxText(raw: string): string {
  const lines = raw.split(/\r?\n/);
  if (lines.length === 1) return raw;
  const parts: string[] = [];
  lines.forEach((line, index) => {
    let piece = line;
    if (index > 0) piece = piece.replace(/^\s+/, "");
    if (index < lines.length - 1) piece = piece.replace(/\s+$/, "");
    if (piece) parts.push(piece);
  });
  return parts.join(" ");
}

/** All children are text, `{"string"}` or inline formatting elements holding the same. */
export function isLiteralRichContent(children: t.JSXElement["children"]): boolean {
  const meaningful = children.filter((child) => !(t.isJSXExpressionContainer(child) && t.isJSXEmptyExpression(child.expression)));
  if (meaningful.length === 0) return false;
  return meaningful.every((child) => {
    if (t.isJSXText(child)) return true;
    if (t.isJSXExpressionContainer(child)) return literalString(child.expression) !== null;
    if (t.isJSXElement(child)) {
      const name = jsxName(child);
      return !!name && INLINE_TAGS.has(name) && isIntrinsic(name) && (name === "br" || isLiteralRichContent(child.children) || child.children.length === 0);
    }
    return false;
  });
}

function stringLoc(file: string, node: Node): Loc {
  return { file, line: node.loc?.start.line ?? 0, col: node.loc?.start.column ?? 0 };
}

const NO_OWN_TEXT: TextSource = { editable: false, reason: { kind: "code", message: "This element has no text of its own." } };

export function textFromTraced(result: Traced, ctx: TraceContext, depth = 0): TextSource {
  if (depth > 5) return { editable: false, reason: { kind: "code", message: "This text is passed through too many layers of code to edit here." } };
  switch (result.kind) {
    case "string": {
      const value = literalString(result.node) ?? "";
      const source: TextSource = { editable: true, value, where: stringLoc(result.file, result.node), kind: "literal", rich: false };
      if (result.inData) source.inData = result.inData;
      if (result.dbNote) source.dbNote = result.dbNote;
      return source;
    }
    case "children":
      return textOfElement(result.element, result.ancestors, result.file, ctx, depth + 1) ?? NO_OWN_TEXT;
    case "jsx":
      return t.isJSXElement(result.node) ? (textOfElement(result.node, result.ancestors, result.file, ctx, depth + 1) ?? NO_OWN_TEXT) : { editable: false, reason: { kind: "code", message: "This is a group of elements built by code." } };
    case "blocked":
      return { editable: false, reason: result.reason };
    case "object":
      return { editable: false, reason: { kind: "code", message: "This is a whole record of data, not one text." } };
    case "array":
      return { editable: false, reason: { kind: "code", message: "This is a list of data, not one text." } };
    case "props":
      return { editable: false, reason: { kind: "prop", message: "This is everything passed into the component, not one text." } };
    case "call":
      return { editable: false, reason: { kind: "code", message: "This is the result of code that runs when the page opens." } };
  }
}

/** The words an element shows and where they come from. Null when the element holds no text of its own. */
export function textOfElement(element: t.JSXElement, ancestors: t.Node[], file: string, ctx: TraceContext, depth = 0): TextSource | null {
  const meaningful = meaningfulChildren(element);
  if (meaningful.length === 0) {
    // <button {...props} />: the words arrive through the props of the component this element renders.
    const spreadComponent = spreadPropsComponent(element, ancestors);
    if (spreadComponent && depth < 5) {
      const traced = resolveProp(spreadComponent, "children", file, ctx);
      if (traced.kind === "blocked" && traced.reason.kind === "prop") return null;
      return textFromTraced(traced, ctx, depth + 1);
    }
    return null;
  }
  if (meaningful.length === 1 && t.isJSXExpressionContainer(meaningful[0]!) && !t.isJSXEmptyExpression(meaningful[0]!.expression) && mapSourceOf(meaningful[0]!.expression, [...ancestors, element, meaningful[0]!], file, ctx)) return null;
  if (isLiteralRichContent(element.children)) {
    return { editable: true, value: flattenJsxText(element.children), where: locOf(file, element), kind: "jsx", rich: true };
  }
  if (meaningful.length === 1 && t.isJSXExpressionContainer(meaningful[0]!)) {
    const traced = trace(meaningful[0]!, [...ancestors, element], file, ctx);
    if (traced.kind === "array") return { editable: false, reason: { kind: "code", message: "The items inside are drawn from a list in the code; click one of them to edit its words." } };
    return textFromTraced(traced, ctx, depth);
  }
  if (meaningful.length === 1 && t.isJSXElement(meaningful[0]!)) return null;
  const hasText = meaningful.some((child) => t.isJSXText(child) || t.isJSXExpressionContainer(child));
  if (!hasText) return null;
  const staticParts = flattenJsxText(element.children).trim();
  return { editable: false, reason: { kind: "code", message: "This text is put together from several pieces by code, so it cannot be typed over as one block." }, value: staticParts };
}

/** The component whose props are spread onto this element (`<button {...props}>` inside Button), if any. */
function spreadPropsComponent(element: t.JSXElement, ancestors: t.Node[]): string | null {
  if (!hasSpreadAttribute(element)) return null;
  const fn = enclosingFunction(ancestors);
  if (!fn) return null;
  const component = componentName(ancestors);
  if (!component || !/^[A-Z]/.test(component)) return null;
  for (const attribute of element.openingElement.attributes) {
    if (!t.isJSXSpreadAttribute(attribute) || !t.isIdentifier(attribute.argument)) continue;
    const binding = resolveBinding(attribute.argument.name, [...ancestors, element, element.openingElement]);
    if (binding?.kind === "param" && binding.index === 0) return component;
  }
  return null;
}

function attributeSource(element: t.JSXElement, ancestors: t.Node[], file: string, name: string, ctx: TraceContext): { traced: Traced | null; attribute: t.JSXAttribute | null } {
  const attribute = getAttribute(element, name);
  if (!attribute) return { traced: null, attribute: null };
  if (!attribute.value) return { traced: { kind: "blocked", reason: { kind: "code", message: `${name} is switched on without a value.` } }, attribute };
  return { traced: trace(attribute.value, [...ancestors, element, element.openingElement, attribute], file, ctx), attribute };
}

function imageOf(element: t.JSXElement, ancestors: t.Node[], file: string, ctx: TraceContext): ImageSource | null {
  const name = jsxName(element);
  if (!name) return null;
  const isImage = name === "img" || name === "Image" || name === "Img" || name === "video" || name === "iframe";
  if (!isImage) return null;
  const { traced, attribute } = attributeSource(element, ancestors, file, "src", ctx);
  const altResult = attributeSource(element, ancestors, file, "alt", ctx);
  const alt = altResult.traced?.kind === "string" ? (literalString(altResult.traced.node) ?? "") : null;
  if (!traced || !attribute) return { editable: false, reason: { kind: "code", message: "This picture has no src of its own in the code." } };
  if (traced.kind === "string") {
    const value = literalString(traced.node) ?? "";
    const isImport = t.isImportDeclaration(traced.node) || (attribute.value && t.isJSXExpressionContainer(attribute.value) && t.isIdentifier(attribute.value.expression));
    const source: ImageSource = {
      editable: true,
      src: value,
      alt,
      where: stringLoc(traced.file, traced.node),
      pattern: isImport ? "import" : "public",
      altEditable: altResult.traced?.kind === "string" || altResult.attribute === null,
      altWhere: altResult.traced?.kind === "string" ? stringLoc(altResult.traced.file, altResult.traced.node) : null,
    };
    if (traced.dbNote) source.dbNote = traced.dbNote;
    return source;
  }
  if (traced.kind === "blocked") return { editable: false, reason: traced.reason, alt };
  return { editable: false, reason: { kind: "code", message: "This picture's address is worked out by code." }, alt };
}

function linkOf(element: t.JSXElement, ancestors: t.Node[], file: string, ctx: TraceContext): LinkSource | null {
  const name = jsxName(element);
  if (name !== "a" && name !== "Link" && name !== "NavLink") return null;
  const attributeName = name === "a" ? "href" : getAttribute(element, "to") ? "to" : "href";
  const { traced, attribute } = attributeSource(element, ancestors, file, attributeName, ctx);
  if (!traced || !attribute) return { editable: false, reason: { kind: "code", message: "This link has no address set in the code." } };
  if (traced.kind === "string") return { editable: true, href: literalString(traced.node) ?? "", where: stringLoc(traced.file, traced.node) };
  if (traced.kind === "blocked") return { editable: false, reason: traced.reason };
  return { editable: false, reason: { kind: "code", message: "This link's address is worked out by code." } };
}

export function classesOf(element: t.JSXElement, file: string): ClassSource {
  const attribute = getAttribute(element, "className") ?? getAttribute(element, "class");
  const where = locOf(file, element);
  if (!attribute) return { editable: true, className: "", where, literal: true };
  const value = attribute.value;
  if (!value) return { editable: true, className: "", where, literal: true };
  const literal = literalString(value);
  if (literal !== null) return { editable: true, className: literal, where, literal: true };
  if (t.isJSXExpressionContainer(value)) {
    const expression = value.expression;
    if (t.isTemplateLiteral(expression)) return { editable: true, className: expression.quasis.map((quasi) => quasi.value.cooked ?? "").join(" "), where, literal: false };
    if (t.isCallExpression(expression)) return { editable: true, className: expression.arguments.map((argument) => literalString(argument as Node) ?? "").join(" "), where, literal: false };
    if (t.isIdentifier(expression) || t.isMemberExpression(expression) || t.isConditionalExpression(expression) || t.isLogicalExpression(expression)) return { editable: true, className: "", where, literal: false };
  }
  return { editable: false, reason: { kind: "code", message: "This element's classes are computed by code." } };
}

function childrenNoteOf(element: t.JSXElement, ancestors: t.Node[], file: string, ctx: TraceContext): Reason | null {
  for (const child of element.children) {
    if (!t.isJSXExpressionContainer(child) || t.isJSXEmptyExpression(child.expression)) continue;
    const source = mapSourceOf(child.expression, [...ancestors, element, child], file, ctx);
    if (!source) continue;
    if (source.kind === "blocked") {
      return source.reason.kind === "live-data" ? { kind: "live-data", message: "The items inside come from live data: the site loads them from its database when the page opens. Their words are not written in the code, so they cannot be edited here." } : source.reason;
    }
    if (source.kind === "array") return { kind: "code", message: `The items inside are drawn from a list in the code${source.inData ? ` (${source.inData})` : ""}. Click one to edit its words.` };
    if (source.kind === "call") {
      return functionTouchesLiveData(source.fn, source.ancestors)
        ? { kind: "live-data", message: "The items inside come from live data: the site loads them when the page opens. Their words are not written in the code, so they cannot be edited here." }
        : { kind: "code", message: "The items inside are built by code when the page opens." };
    }
  }
  return null;
}

/** Files that import `file` (through a relative path or an alias). */
function importersOf(project: Project, file: string): string[] {
  const out: string[] = [];
  for (const other of project.listSourceFiles()) {
    if (other === file) continue;
    const parsed = project.parsed(other);
    if (!parsed) continue;
    for (const statement of parsed.ast.program.body) {
      if (t.isImportDeclaration(statement) && project.resolveImport(other, statement.source.value) === file) {
        out.push(other);
        break;
      }
    }
  }
  return out;
}

/**
 * An element is shared when it lives in a component file used from somewhere other than
 * the page being edited: the header, the footer, a card used on every page.
 */
function sharedOf(project: Project, component: string | null, file: string, pageFile: string | null): ResolvedNode["shared"] {
  if (!component) return null;
  const importers = importersOf(project, file);
  const ownUsages = ((project.read(file) ?? "").match(new RegExp(`<${component}(?=[\\s/>])`, "g")) ?? []).length;
  if (pageFile && file !== pageFile) return { component, usedIn: importers.length > 0 ? importers : [file] };
  if (importers.length > 1 || ownUsages > 1) return { component, usedIn: importers.length > 0 ? importers : [file] };
  return null;
}

export function resolveNode({ project, ref, pageFile, tailwind }: ResolveOptions): ResolvedNode {
  const ctx: TraceContext = { project, indices: [...ref.indices], usage: ref.usage, ancestorLocs: ref.ancestors, depth: 0 };
  const originLoc = ref.loc ?? ref.usage;
  if (!originLoc) throw new ResolveError("This element has no source location.");
  const parsedOrigin = project.parsed(originLoc.file);
  if (!parsedOrigin) throw new ResolveError(`${originLoc.file} could not be read.`);
  const origin = locate(parsedOrigin, originLoc.file, originLoc);
  if (!origin) throw new ResolveError("The code moved since the page was drawn. Click the element again.");

  // The usage element (when the DOM element came through a component that forwards props) owns classes and structure.
  let primary: Located = origin;
  if (ref.loc && ref.usage) {
    const parsedUsage = project.parsed(ref.usage.file);
    const usage = parsedUsage ? locate(parsedUsage, ref.usage.file, ref.usage) : null;
    if (usage) primary = usage;
  }

  const text = textOfElement(origin.element, origin.ancestors, origin.file, { ...ctx, indices: [...ref.indices] });
  const image = imageOf(origin.element, origin.ancestors, origin.file, { ...ctx, indices: [...ref.indices] }) ?? (primary !== origin ? imageOf(primary.element, primary.ancestors, primary.file, { ...ctx, indices: [...ref.indices] }) : null);
  const link = linkOf(primary.element, primary.ancestors, primary.file, { ...ctx, indices: [...ref.indices] }) ?? (primary !== origin ? linkOf(origin.element, origin.ancestors, origin.file, { ...ctx, indices: [...ref.indices] }) : null);
  const classes = classesOf(primary.element, primary.file);
  const structure = describeStructure(primary);
  const childrenNote = text === null ? childrenNoteOf(origin.element, origin.ancestors, origin.file, { ...ctx, indices: [...ref.indices] }) : null;
  const component = componentOf(origin);
  const hasText = text !== null;
  const kind = kindOf(ref.tag, hasText, classes.editable ? classes.className : "");
  const primaryName = jsxName(primary.element);
  const label = primary !== origin && primaryName && !isIntrinsic(primaryName) ? primaryName : labelFor(kind, ref.tag, component);

  return {
    ref,
    label,
    kind,
    component,
    file: origin.file,
    shared: sharedOf(project, component, origin.file, pageFile),
    text,
    image,
    link,
    classes,
    structure,
    childrenNote,
    tailwind,
  };
}

export { findUsages };
