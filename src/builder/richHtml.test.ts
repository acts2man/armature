/**
 * The Text Editor's Code tab: the document as HTML and back, with unsupported HTML
 * reduced to its text and counted.
 */
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { defaultSiteKit, type RichDoc } from "@shared/builder/index.ts";
import { docToHtml, htmlToDoc } from "./richHtml.ts";

const doc: RichDoc = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2, textAlign: "center" }, content: [{ type: "text", text: "Title <b>" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Bold", marks: [{ type: "bold" }, { type: "italic" }] },
        { type: "hardBreak" },
        { type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://example.com", target: "_blank" } }] },
        { type: "text", text: "red", marks: [{ type: "textStyle", attrs: { color: "#ff0000" } }] },
        { type: "text", text: "site", marks: [{ type: "textStyle", attrs: { color: "kit:color.primary" } }] },
      ],
    },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] }] },
    { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "three" }] }] }] },
    { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "quote" }] }] },
  ],
};

describe("docToHtml", () => {
  it("writes the whitelist with escaped text and resolved site colours", () => {
    const html = docToHtml(doc, defaultSiteKit());
    expect(html).toContain('<h2 style="text-align:center">Title &lt;b&gt;</h2>');
    expect(html).toContain("<strong><em>Bold</em></strong><br>");
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">link</a>');
    expect(html).toContain('<span style="color:#ff0000">red</span>');
    expect(html).toMatch(/<span style="color:#[0-9a-f]{6}" data-ae-color="kit:color.primary">site<\/span>/);
    expect(html).toContain("<ul><li><p>one</p></li></ul>");
    expect(html).toContain('<ol start="3"><li><p>three</p></li></ol>');
    expect(html).toContain("<blockquote><p>quote</p></blockquote>");
  });

  it("round-trips through htmlToDoc, keeping the site colour reference", () => {
    const { doc: back, dropped } = htmlToDoc(docToHtml(doc, defaultSiteKit()));
    expect(dropped).toBe(0);
    expect(back).toEqual(doc);
  });
});

describe("htmlToDoc", () => {
  it("keeps the text of unsupported tags, refuses unsafe links, and counts what it dropped", () => {
    const { doc: parsed, dropped } = htmlToDoc('<p>Hi <img src="x.png"> there <a href="javascript:alert(1)">bad</a></p><table><tr><td>cell</td></tr></table><script>alert(1)</script>');
    expect(dropped).toBe(6);
    expect(parsed.content[0]).toEqual({ type: "paragraph", content: [{ type: "text", text: "Hi " }, { type: "text", text: " there " }, { type: "text", text: "bad" }] });
    expect(JSON.stringify(parsed)).toContain("cell");
    expect(JSON.stringify(parsed)).not.toContain("alert");
  });
});
