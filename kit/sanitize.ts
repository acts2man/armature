/**
 * Sanitizers used by the renderer and the CSS generator. Everything that reaches the
 * page from a layout file passes through one of these. No dependencies.
 */

/** Links may only use https, http, mailto, tel, a site path (/...) or a fragment (#...). */
export function safeHref(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.startsWith("//")) return undefined;
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return trimmed;
  return /^(https?:\/\/|mailto:|tel:)/i.test(trimmed) ? trimmed : undefined;
}

/** Media may come from the site itself, from https, or be an inline image preview in the editor. */
export function safeMediaSrc(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.startsWith("/") && !trimmed.startsWith("//") && !trimmed.includes("..")) return trimmed;
  if (/^https:\/\//i.test(trimmed)) return trimmed;
  if (/^data:image\/(png|jpeg|webp|gif);base64,/i.test(trimmed)) return trimmed;
  return undefined;
}

/** A `rel` for a link that opens a new tab. */
export const newTabRel = "noopener noreferrer";

const CSS_MAX = 20_000;

/**
 * Custom CSS for one element: no @import, no javascript:, no expression(), no
 * behavior:, no url() to another origin, no closing tags. Returns "" when nothing
 * safe is left.
 */
export function sanitizeCss(input: string): string {
  let css = input.slice(0, CSS_MAX);
  css = css.replace(/<\/?\s*style[^>]*>/gi, "");
  css = css.replace(/@import[^;]*;?/gi, "");
  css = css.replace(/@charset[^;]*;?/gi, "");
  css = css.replace(/expression\s*\(/gi, "-blocked(");
  css = css.replace(/behavior\s*:/gi, "-blocked:");
  css = css.replace(/-moz-binding\s*:/gi, "-blocked:");
  css = css.replace(/javascript\s*:/gi, "blocked:");
  css = css.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (_match, _quote: string, target: string) => {
    const trimmed = target.trim();
    const ok = (trimmed.startsWith("/") && !trimmed.startsWith("//")) || /^https:\/\//i.test(trimmed) || /^data:image\/(png|jpeg|webp|gif);base64,/i.test(trimmed);
    return ok ? `url("${trimmed.replace(/"/g, "")}")` : "none";
  });
  return css.trim();
}

/** HTML attribute names an element may carry from `advanced.attributes`. */
export function safeAttributeName(name: string): boolean {
  if (!/^[a-z][a-z0-9-]{0,40}$/i.test(name)) return false;
  const lowered = name.toLowerCase();
  if (lowered.startsWith("on")) return false;
  return !["href", "src", "style", "srcdoc", "action", "formaction", "class", "id", "xlink:href"].includes(lowered);
}
