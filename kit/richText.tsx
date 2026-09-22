/**
 * The rich-text renderer: TipTap-compatible JSON in, React elements out. A small
 * whitelist (paragraph, headings, bold, italic, underline, strike, code, link, bullet
 * and ordered lists, blockquote, hard break, text colour and highlight, alignment).
 * Unknown nodes render their text; unknown marks are dropped; links are validated.
 * Never touches innerHTML.
 */
import { Fragment, createElement, type ReactNode } from "react";
import { newTabRel, safeHref } from "./sanitize.ts";
import type { RichBlock, RichDoc, RichInline, RichMark, TextAlign } from "./types.ts";
import { isColorValue, refToCss } from "./values.ts";

const styleForAlign = (align: TextAlign | undefined) => (align && align !== "left" ? { textAlign: align } : undefined);

function applyMarks(text: ReactNode, marks: RichMark[] | undefined, key: number): ReactNode {
  let out: ReactNode = text;
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case "bold":
        out = <strong key={key}>{out}</strong>;
        break;
      case "italic":
        out = <em key={key}>{out}</em>;
        break;
      case "underline":
        out = <u key={key}>{out}</u>;
        break;
      case "strike":
        out = <s key={key}>{out}</s>;
        break;
      case "code":
        out = <code key={key}>{out}</code>;
        break;
      case "link": {
        const href = safeHref(mark.attrs?.href);
        if (!href) break;
        const blank = mark.attrs?.target === "_blank";
        out = (
          <a key={key} href={href} target={blank ? "_blank" : undefined} rel={blank ? newTabRel : undefined}>
            {out}
          </a>
        );
        break;
      }
      case "textStyle": {
        const color = mark.attrs?.color;
        if (color && isColorValue(color)) out = <span key={key} style={{ color: refToCss(color) }}>{out}</span>;
        break;
      }
      case "highlight": {
        const color = mark.attrs?.color;
        out = <mark key={key} style={color && isColorValue(color) ? { backgroundColor: refToCss(color) } : undefined}>{out}</mark>;
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function renderInline(nodes: RichInline[] | undefined): ReactNode[] {
  return (nodes ?? []).map((node, index) => {
    if (node.type === "hardBreak") return <br key={index} />;
    if (node.type === "text") return <Fragment key={index}>{applyMarks(node.text, node.marks, index)}</Fragment>;
    return null;
  });
}

function renderBlock(block: RichBlock, key: number): ReactNode {
  switch (block.type) {
    case "paragraph":
      return (
        <p key={key} style={styleForAlign(block.attrs?.textAlign)}>
          {renderInline(block.content)}
        </p>
      );
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(block.attrs?.level) || 2));
      return createElement(`h${level}`, { key, style: styleForAlign(block.attrs?.textAlign) }, ...renderInline(block.content));
    }
    case "bulletList":
      return <ul key={key}>{(block.content ?? []).map((item, index) => <li key={index}>{(item.content ?? []).map(renderBlock)}</li>)}</ul>;
    case "orderedList":
      return (
        <ol key={key} start={block.attrs?.start}>
          {(block.content ?? []).map((item, index) => (
            <li key={index}>{(item.content ?? []).map(renderBlock)}</li>
          ))}
        </ol>
      );
    case "blockquote":
      return <blockquote key={key}>{(block.content ?? []).map(renderBlock)}</blockquote>;
    default: {
      // An unknown block: keep its text so nothing silently disappears.
      const unknown = block as { content?: unknown };
      const text = Array.isArray(unknown.content) ? richTextToPlain({ type: "doc", content: unknown.content as RichBlock[] }) : "";
      return text ? <p key={key}>{text}</p> : null;
    }
  }
}

export function RichText({ doc }: { doc: RichDoc | undefined }) {
  if (!doc || !Array.isArray(doc.content)) return null;
  return <>{doc.content.map(renderBlock)}</>;
}

/** The plain text of a document, paragraphs joined by newlines. */
export function richTextToPlain(doc: RichDoc | undefined): string {
  if (!doc || !Array.isArray(doc.content)) return "";
  const inline = (nodes: RichInline[] | undefined): string => (nodes ?? []).map((node) => (node.type === "text" ? node.text : node.type === "hardBreak" ? "\n" : "")).join("");
  const block = (node: RichBlock): string => {
    switch (node.type) {
      case "paragraph":
      case "heading":
        return inline(node.content);
      case "bulletList":
      case "orderedList":
        return (node.content ?? []).map((item) => (item.content ?? []).map(block).join("\n")).join("\n");
      case "blockquote":
        return (node.content ?? []).map(block).join("\n");
      default:
        return "";
    }
  };
  return doc.content.map(block).join("\n");
}

/** A document holding one paragraph of plain text. */
export const plainDoc = (text: string): RichDoc => ({
  type: "doc",
  content: text.split(/\n{2,}/).map((paragraph) => ({ type: "paragraph", content: paragraph ? [{ type: "text", text: paragraph }] : [] })),
});
