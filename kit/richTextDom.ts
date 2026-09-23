/**
 * Edit mode only: turn the DOM of a contenteditable rich-text element back into the
 * whitelisted TipTap-compatible JSON. Anything outside the whitelist is reduced to its
 * text; links keep only safe destinations; colours must look like colours.
 */
import type { RichBlock, RichDoc, RichInline, RichMark, TextAlign } from "./types.ts";
import { isColorValue } from "./values.ts";

const ALIGN: Record<string, TextAlign> = { left: "left", center: "center", right: "right", justify: "justify" };

const alignOf = (element: Element): TextAlign | undefined => {
  const style = (element as HTMLElement).style?.textAlign || element.getAttribute("align") || "";
  const align = ALIGN[style.toLowerCase()];
  return align && align !== "left" ? align : undefined;
};

function safeHref(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith("//")) return null;
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return trimmed;
  return /^(https?:\/\/|mailto:|tel:)/i.test(trimmed) ? trimmed : null;
}

function rgbToHex(value: string): string | null {
  const match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/i.exec(value.trim());
  if (!match) return isColorValue(value) ? value : null;
  const hex = (part: string) => Number(part).toString(16).padStart(2, "0");
  const alpha = match[4] !== undefined ? Math.round(Number(match[4]) * 255) : 255;
  return `#${hex(match[1] ?? "0")}${hex(match[2] ?? "0")}${hex(match[3] ?? "0")}${alpha === 255 ? "" : hex(String(alpha))}`;
}

function marksFor(element: Element, inherited: RichMark[]): RichMark[] {
  const marks = [...inherited];
  const add = (mark: RichMark) => {
    if (!marks.some((existing) => existing.type === mark.type)) marks.push(mark);
  };
  const tag = element.tagName;
  const style = (element as HTMLElement).style;
  if (tag === "STRONG" || tag === "B" || (style && (style.fontWeight === "bold" || Number(style.fontWeight) >= 600))) add({ type: "bold" });
  if (tag === "EM" || tag === "I" || style?.fontStyle === "italic") add({ type: "italic" });
  if (tag === "U" || style?.textDecoration?.includes("underline") || style?.textDecorationLine?.includes("underline")) add({ type: "underline" });
  if (tag === "S" || tag === "STRIKE" || tag === "DEL" || style?.textDecoration?.includes("line-through") || style?.textDecorationLine?.includes("line-through")) add({ type: "strike" });
  if (tag === "CODE") add({ type: "code" });
  if (tag === "A") {
    const href = safeHref(element.getAttribute("href"));
    if (href) add({ type: "link", attrs: { href, target: element.getAttribute("target") === "_blank" ? "_blank" : null } });
  }
  if (tag === "MARK") {
    const color = style?.backgroundColor ? rgbToHex(style.backgroundColor) : null;
    add({ type: "highlight", attrs: color ? { color } : {} });
  }
  // A site colour keeps its kit reference (the editor's panel writes it as data-ae-color).
  const kitColor = element.getAttribute("data-ae-color");
  if (kitColor && kitColor.startsWith("kit:") && isColorValue(kitColor)) {
    add(tag === "MARK" ? { type: "highlight", attrs: { color: kitColor } } : { type: "textStyle", attrs: { color: kitColor } });
  }
  const color = tag === "FONT" ? element.getAttribute("color") : style?.color || null;
  if (color) {
    const hex = rgbToHex(color);
    if (hex) add({ type: "textStyle", attrs: { color: hex } });
  }
  return marks;
}

function inlineOf(node: Node, marks: RichMark[], out: RichInline[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? "").replace(/\u00a0/g, " ");
    if (text === "") return;
    out.push(marks.length ? { type: "text", text, marks } : { type: "text", text });
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const element = node as Element;
  if (element.tagName === "BR") {
    out.push({ type: "hardBreak" });
    return;
  }
  if (element.tagName === "SCRIPT" || element.tagName === "STYLE" || element.tagName === "TEMPLATE") return;
  const next = marksFor(element, marks);
  for (const child of Array.from(element.childNodes)) inlineOf(child, next, out);
}

const isBlockTag = (tag: string) => /^(P|H[1-6]|UL|OL|LI|BLOCKQUOTE|DIV|SECTION|ARTICLE|PRE|TABLE|TR|TD|TH)$/.test(tag);

function blocksOf(container: Node, out: RichBlock[]): void {
  let pending: RichInline[] = [];
  let pendingAlign: TextAlign | undefined;
  const flush = () => {
    if (pending.length > 0) {
      const paragraph: RichBlock = { type: "paragraph", content: pending };
      if (pendingAlign) paragraph.attrs = { textAlign: pendingAlign };
      out.push(paragraph);
    }
    pending = [];
    pendingAlign = undefined;
  };
  for (const child of Array.from(container.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE && isBlockTag((child as Element).tagName)) {
      flush();
      const element = child as Element;
      const tag = element.tagName;
      if (/^H[1-6]$/.test(tag)) {
        const inline: RichInline[] = [];
        for (const grandchild of Array.from(element.childNodes)) inlineOf(grandchild, [], inline);
        const attrs: { level: 1 | 2 | 3 | 4 | 5 | 6; textAlign?: TextAlign } = { level: Number(tag[1]) as 1 | 2 | 3 | 4 | 5 | 6 };
        const align = alignOf(element);
        if (align) attrs.textAlign = align;
        out.push({ type: "heading", attrs, content: inline });
      } else if (tag === "UL" || tag === "OL") {
        const items = Array.from(element.children)
          .filter((item) => item.tagName === "LI")
          .map((item) => {
            const content: RichBlock[] = [];
            blocksOf(item, content);
            return { type: "listItem" as const, content: content.length ? content : [{ type: "paragraph" as const, content: [] }] };
          });
        const start = Number.parseInt(element.getAttribute("start") ?? "", 10);
        if (items.length) out.push(tag === "UL" ? { type: "bulletList", content: items } : Number.isFinite(start) && start >= 0 ? { type: "orderedList", attrs: { start }, content: items } : { type: "orderedList", content: items });
      } else if (tag === "BLOCKQUOTE") {
        const content: RichBlock[] = [];
        blocksOf(element, content);
        out.push({ type: "blockquote", content });
      } else if (tag === "P" || tag === "DIV" || tag === "LI") {
        // A paragraph, or a wrapper the browser made; nested blocks inside it are lifted.
        const hasBlocks = Array.from(element.children).some((grandchild) => isBlockTag(grandchild.tagName));
        if (hasBlocks) {
          blocksOf(element, out);
        } else {
          const inline: RichInline[] = [];
          for (const grandchild of Array.from(element.childNodes)) inlineOf(grandchild, [], inline);
          const paragraph: RichBlock = { type: "paragraph", content: inline };
          const align = alignOf(element);
          if (align) paragraph.attrs = { textAlign: align };
          out.push(paragraph);
        }
      } else {
        const inline: RichInline[] = [];
        for (const grandchild of Array.from(element.childNodes)) inlineOf(grandchild, [], inline);
        if (inline.length) out.push({ type: "paragraph", content: inline });
      }
      continue;
    }
    inlineOf(child, [], pending);
  }
  flush();
}

/** The whitelisted document for a contenteditable host. */
export function serializeRichText(host: Element): RichDoc {
  const content: RichBlock[] = [];
  blocksOf(host, content);
  return { type: "doc", content: content.length ? content : [{ type: "paragraph", content: [] }] };
}
