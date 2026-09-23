/**
 * The Text Editor's Code tab: the rich-text document as HTML and back. `docToHtml` writes
 * the whitelist only (every piece of text escaped); `htmlToDoc` parses what was typed,
 * keeps what the whitelist knows (paragraphs, headings, bold, italic, underline, strike,
 * code, links, lists, quotes, colours, highlights, alignment) and counts what it dropped
 * so the panel can say so. Site colours keep their kit reference through a data attribute.
 */
import { serializeRichText } from "@kit/richTextDom.ts";
import { newTabRel, safeHref } from "@kit/sanitize.ts";
import type { RichBlock, RichDoc, RichInline, RichMark, SiteKit, TextAlign } from "@shared/builder/index.ts";
import { isColorValue, parseKitRef, resolveKitColor } from "@kit/values.ts";

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const alignAttr = (align: TextAlign | undefined) => (align && align !== "left" ? ` style="text-align:${align}"` : "");

/** A colour as the browser will keep it: kit references resolve to their hex and remember the reference. */
const colorAttrs = (property: "color" | "background-color", value: string | undefined, kit: SiteKit | undefined): string => {
  if (!value || !isColorValue(value)) return "";
  const ref = parseKitRef(value);
  const literal = ref ? (kit ? resolveKitColor(kit, value) : undefined) : value;
  if (!literal) return "";
  return ` style="${property}:${escape(literal)}"${ref ? ` data-ae-color="${escape(value)}"` : ""}`;
};

function markHtml(inner: string, mark: RichMark, kit: SiteKit | undefined): string {
  switch (mark.type) {
    case "bold":
      return `<strong>${inner}</strong>`;
    case "italic":
      return `<em>${inner}</em>`;
    case "underline":
      return `<u>${inner}</u>`;
    case "strike":
      return `<s>${inner}</s>`;
    case "code":
      return `<code>${inner}</code>`;
    case "link": {
      const href = safeHref(mark.attrs?.href);
      if (!href) return inner;
      const blank = mark.attrs?.target === "_blank";
      return `<a href="${escape(href)}"${blank ? ` target="_blank" rel="${newTabRel}"` : ""}>${inner}</a>`;
    }
    case "textStyle":
      return `<span${colorAttrs("color", mark.attrs?.color, kit)}>${inner}</span>`;
    case "highlight":
      return `<mark${colorAttrs("background-color", mark.attrs?.color, kit)}>${inner}</mark>`;
    default:
      return inner;
  }
}

const inlineHtml = (nodes: RichInline[] | undefined, kit: SiteKit | undefined): string =>
  (nodes ?? [])
    .map((node) => {
      if (node.type === "hardBreak") return "<br>";
      if (node.type !== "text") return "";
      // The last mark wraps innermost, so reading the HTML back (outer mark first) keeps the order.
      return [...(node.marks ?? [])].reverse().reduce((out, mark) => markHtml(out, mark, kit), escape(node.text));
    })
    .join("");

function blockHtml(block: RichBlock, kit: SiteKit | undefined): string {
  switch (block.type) {
    case "paragraph":
      return `<p${alignAttr(block.attrs?.textAlign)}>${inlineHtml(block.content, kit)}</p>`;
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(block.attrs?.level) || 2));
      return `<h${level}${alignAttr(block.attrs?.textAlign)}>${inlineHtml(block.content, kit)}</h${level}>`;
    }
    case "bulletList":
      return `<ul>${(block.content ?? []).map((item) => `<li>${(item.content ?? []).map((child) => blockHtml(child, kit)).join("")}</li>`).join("")}</ul>`;
    case "orderedList":
      return `<ol${block.attrs?.start !== undefined ? ` start="${Math.max(0, Math.round(block.attrs.start))}"` : ""}>${(block.content ?? []).map((item) => `<li>${(item.content ?? []).map((child) => blockHtml(child, kit)).join("")}</li>`).join("")}</ol>`;
    case "blockquote":
      return `<blockquote>${(block.content ?? []).map((child) => blockHtml(child, kit)).join("")}</blockquote>`;
    default:
      return "";
  }
}

/** The document as HTML, one block per line. */
export function docToHtml(doc: RichDoc | undefined, kit?: SiteKit): string {
  if (!doc || !Array.isArray(doc.content)) return "";
  return doc.content.map((block) => blockHtml(block, kit)).join("\n");
}

const KNOWN_TAGS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "STRONG", "B", "EM", "I", "U", "S", "STRIKE", "DEL", "CODE", "A", "MARK", "SPAN", "FONT", "BR", "DIV"]);
/** Wrappers the parser adds on its own (a table's tbody): not the writer's, so not counted. */
const IMPLICIT_TAGS = new Set(["TBODY", "THEAD", "TFOOT"]);
const BLOCK_PARENTS = new Set(["BODY", "UL", "OL", "BLOCKQUOTE"]);
const isBlockTag = (tag: string) => /^(P|H[1-6]|UL|OL|LI|BLOCKQUOTE|DIV|SECTION|ARTICLE|PRE|TABLE)$/.test(tag);

/** Drop the whitespace between blocks (line breaks in the typed HTML), which is not text. */
function stripBlockWhitespace(root: Node): void {
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const remove: Node[] = [];
  let node: Node | null = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    if (parent && /^\s*$/.test(node.textContent ?? "") && (BLOCK_PARENTS.has(parent.tagName) || Array.from(parent.children).some((child) => isBlockTag(child.tagName)))) remove.push(node);
    node = walker.nextNode();
  }
  for (const item of remove) item.parentNode?.removeChild(item);
}

/**
 * Parse typed HTML into the whitelist. `dropped` counts the tags that were reduced to their
 * text (tables, images, scripts, iframes…) and the links whose address was refused.
 */
export function htmlToDoc(html: string): { doc: RichDoc; dropped: number } {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const body = parsed.body;
  let dropped = 0;
  for (const element of Array.from(body.querySelectorAll("*"))) {
    if (!KNOWN_TAGS.has(element.tagName)) dropped += IMPLICIT_TAGS.has(element.tagName) ? 0 : 1;
    else if (element.tagName === "A" && !safeHref(element.getAttribute("href"))) dropped += 1;
  }
  stripBlockWhitespace(body);
  return { doc: serializeRichText(body), dropped };
}
