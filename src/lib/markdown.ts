/**
 * A very small Markdown renderer for the in-app Help section. Handles headings,
 * paragraphs, bulleted and ordered lists, inline code, code fences, bold, italic,
 * links, and horizontal rules. Enough for the guide files; not a general renderer.
 *
 * Pure and dependency-free. All rendered HTML is escaped first, so no user-supplied
 * content could get through unescaped even if the guide files ever included any.
 */

const escapeHtml = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Inline formatting: **bold**, *italic*, `code`, [text](href) with same-site or https links. */
function renderInline(text: string): string {
  let out = escapeHtml(text);
  // Inline code first, so its content isn't re-processed.
  out = out.replace(/`([^`]+)`/g, (_match, code) => `<code>${code}</code>`);
  // Links: [label](href) — only https:// and site-relative paths are allowed.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label, href) => {
    const safe = /^https?:\/\//i.test(href) || href.startsWith("/") || href.startsWith("#") ? href : "#";
    const external = /^https?:\/\//i.test(safe);
    return `<a href="${safe}"${external ? ' target="_blank" rel="noreferrer"' : ""}>${label}</a>`;
  });
  // Bold and italic (both markers are HTML-escaped already, so match the escaped text).
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return out;
}

/** Turn a whole markdown document into HTML. */
export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  while (i < lines.length) {
    const line = lines[i]!;
    // Code fence
    if (line.startsWith("```")) {
      flushParagraph();
      i += 1;
      const code: string[] = [];
      while (i < lines.length && !lines[i]!.startsWith("```")) {
        code.push(lines[i]!);
        i += 1;
      }
      out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      i += 1; // skip closing fence
      continue;
    }
    // Heading
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      const level = heading[1]!.length;
      out.push(`<h${level}>${renderInline(heading[2]!.trim())}</h${level}>`);
      i += 1;
      continue;
    }
    // Horizontal rule
    if (/^-{3,}\s*$/.test(line)) {
      flushParagraph();
      out.push("<hr />");
      i += 1;
      continue;
    }
    // Bulleted list
    if (/^[-*]\s+/.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i]!)) {
        items.push(`<li>${renderInline(lines[i]!.replace(/^[-*]\s+/, ""))}</li>`);
        i += 1;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i]!)) {
        items.push(`<li>${renderInline(lines[i]!.replace(/^\d+\.\s+/, ""))}</li>`);
        i += 1;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    // Blank line ends a paragraph
    if (line.trim() === "") {
      flushParagraph();
      i += 1;
      continue;
    }
    // Otherwise, part of a paragraph
    paragraph.push(line);
    i += 1;
  }
  flushParagraph();
  return out.join("\n");
}

/** For a search snippet: strip HTML and truncate to a short excerpt around the term. */
export function snippet(source: string, needle: string, radius = 80): string {
  const clean = source.replace(/[#*`>_[\]()-]/g, "").replace(/\s+/g, " ").trim();
  if (!needle) return clean.slice(0, 160);
  const at = clean.toLowerCase().indexOf(needle.toLowerCase());
  if (at === -1) return clean.slice(0, 160);
  const start = Math.max(0, at - radius);
  const end = Math.min(clean.length, at + needle.length + radius);
  return `${start > 0 ? "…" : ""}${clean.slice(start, end)}${end < clean.length ? "…" : ""}`;
}
