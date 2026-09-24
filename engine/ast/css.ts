/**
 * The plain-CSS fallback for sites that do not run Tailwind: the element gets a
 * generated class (ae-xxxxxx) and the site's stylesheet gets one marked block at its
 * end holding the rules for that class, per device. The selector is repeated three
 * times so it beats the site's own descendant rules (`.hero h1`) without !important.
 */
import { createHash } from "node:crypto";
import type { Declarations, Device, Loc } from "../shared/types.ts";

export const BLOCK_START = "/* armature:start — rules written by the Armature editor; edit freely */";
export const BLOCK_END = "/* armature:end */";

export type Breakpoints = { tablet: number; desktop: number };

export function fallbackClassFor(loc: Loc): string {
  const hash = createHash("sha1").update(`${loc.file}:${loc.line}:${loc.col}`).digest("hex").slice(0, 6);
  return `ae-${hash}`;
}

export function mediaFor(device: Device, breakpoints: Breakpoints): string | null {
  if (device === "desktop") return `@media (min-width: ${breakpoints.desktop}px)`;
  if (device === "tablet") return `@media (min-width: ${breakpoints.tablet}px) and (max-width: ${breakpoints.desktop - 1}px)`;
  return `@media (max-width: ${breakpoints.tablet - 1}px)`;
}

type Rule = { media: string | null; selector: string; declarations: Declarations };

function parseBlock(block: string): Rule[] {
  const rules: Rule[] = [];
  const pattern = /^(?:(@media[^{]+)\{\s*)?(\.[^{]+?)\s*\{([^}]*)\}\s*\}?\s*$/;
  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("/*")) continue;
    const match = pattern.exec(trimmed);
    if (!match) continue;
    const declarations: Declarations = {};
    for (const part of (match[3] ?? "").split(";")) {
      const index = part.indexOf(":");
      if (index === -1) continue;
      declarations[part.slice(0, index).trim()] = part.slice(index + 1).trim();
    }
    rules.push({ media: match[1] ? match[1].trim() : null, selector: (match[2] ?? "").trim(), declarations });
  }
  return rules;
}

function printBlock(rules: Rule[]): string {
  const lines = rules.map((rule) => {
    const body = Object.entries(rule.declarations)
      .map(([property, value]) => `${property}: ${value};`)
      .join(" ");
    const inner = `${rule.selector} { ${body} }`;
    return rule.media ? `${rule.media} { ${inner} }` : inner;
  });
  return `${BLOCK_START}\n${lines.join("\n")}\n${BLOCK_END}\n`;
}

/** The stylesheet text with the declarations merged into the rule for this class and device. */
export function applyCssRule(stylesheet: string, className: string, device: Device, declarations: Declarations, breakpoints: Breakpoints): string {
  const start = stylesheet.indexOf(BLOCK_START);
  const end = stylesheet.indexOf(BLOCK_END);
  let before = stylesheet;
  let rules: Rule[] = [];
  if (start !== -1 && end !== -1 && end > start) {
    rules = parseBlock(stylesheet.slice(start + BLOCK_START.length, end));
    before = stylesheet.slice(0, start).replace(/\s*$/, "\n") + stylesheet.slice(end + BLOCK_END.length).replace(/^\s*\n/, "");
  }
  const media = mediaFor(device, breakpoints);
  const selector = `.${className}.${className}.${className}`;
  let rule = rules.find((item) => item.media === media && item.selector === selector);
  if (!rule) {
    rule = { media, selector, declarations: {} };
    rules.push(rule);
  }
  Object.assign(rule.declarations, declarations);
  const trimmedBefore = before.replace(/\s*$/, "");
  return `${trimmedBefore}\n\n${printBlock(rules)}`;
}

/**
 * Breakpoints from the site's own CSS: in each band, the max-width query closest to the
 * conventional value (767px for phones, 1023px for tablets), else Tailwind's defaults.
 * Sites scatter one-off queries (560px, 1250px) around their main layout switch, so
 * "closest to convention" picks the layout switch far more often than "most used".
 */
export function detectBreakpoints(css: string): Breakpoints {
  const values = new Set<number>();
  for (const match of css.matchAll(/max-width:\s*(\d+)px/g)) values.add(Number(match[1]));
  const closest = (low: number, high: number, target: number): number | undefined => {
    let best: number | undefined;
    for (const value of values) {
      if (value < low || value > high) continue;
      if (best === undefined || Math.abs(value - target) < Math.abs(best - target)) best = value;
    }
    return best;
  };
  const phoneMax = closest(480, 900, 767);
  const tabletMax = closest(Math.max(901, (phoneMax ?? 0) + 1), 1300, 1023);
  return { tablet: phoneMax ? phoneMax + 1 : 768, desktop: tabletMax ? tabletMax + 1 : 1024 };
}
