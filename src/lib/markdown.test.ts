/**
 * The tiny markdown renderer used for the in-app Help guide. Only the features the
 * guide files use are tested — headings, lists, code fences, inline formatting,
 * links (with the site-relative / https allow-list) — plus the search snippet.
 */
import { describe, expect, it } from "vitest";
import { renderMarkdown, snippet } from "./markdown.ts";

describe("renderMarkdown", () => {
  it("turns ATX headings into <h1>–<h6>", () => {
    expect(renderMarkdown("# Hello")).toContain("<h1>Hello</h1>");
    expect(renderMarkdown("### Deep")).toContain("<h3>Deep</h3>");
  });
  it("makes paragraphs from consecutive lines and breaks on a blank line", () => {
    const html = renderMarkdown("First line.\nSecond line.\n\nAnother paragraph.");
    expect(html).toContain("<p>First line. Second line.</p>");
    expect(html).toContain("<p>Another paragraph.</p>");
  });
  it("renders bulleted and ordered lists", () => {
    const ul = renderMarkdown("- One\n- Two");
    expect(ul).toBe("<ul><li>One</li><li>Two</li></ul>");
    const ol = renderMarkdown("1. First\n2. Second");
    expect(ol).toBe("<ol><li>First</li><li>Second</li></ol>");
  });
  it("keeps code fences as <pre><code> and escapes the contents", () => {
    const html = renderMarkdown("```\nconst x = <div>hi</div>;\n```");
    expect(html).toContain("<pre><code>const x = &lt;div&gt;hi&lt;/div&gt;;</code></pre>");
  });
  it("bold / italic / inline code", () => {
    expect(renderMarkdown("**bold** *italic* `code`")).toContain("<strong>bold</strong> <em>italic</em> <code>code</code>");
  });
  it("only allows https and site-relative links; unsafe URLs become #", () => {
    expect(renderMarkdown("[safe](https://example.com)")).toContain('href="https://example.com"');
    expect(renderMarkdown("[same-site](/about)")).toContain('href="/about"');
    expect(renderMarkdown("[dangerous](javascript:alert(1))")).toContain('href="#"');
  });
  it("escapes HTML in prose so a guide file can't inject markup", () => {
    expect(renderMarkdown("A paragraph with <script>bad</script>.")).toContain("&lt;script&gt;bad&lt;/script&gt;");
  });
});

describe("snippet", () => {
  it("returns a fixed-length excerpt when the needle is empty", () => {
    expect(snippet("A short body of text with plenty of words.", "").length).toBeLessThanOrEqual(160);
  });
  it("centres on the needle and adds ellipses on either side", () => {
    const text = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen";
    const out = snippet(text, "twelve", 20);
    expect(out).toContain("twelve");
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
  });
});
