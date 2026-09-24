/**
 * CSS declarations to Tailwind classes and back into a className: the standard scale
 * when a value matches it exactly (p-4 for 16px), an arbitrary value otherwise
 * (p-[23px]), conflicting classes replaced (tailwind-merge), and the device the person is
 * editing turned into breakpoint variants.
 *
 * Tailwind is mobile-first: an unprefixed class applies everywhere, md: from the tablet
 * breakpoint up, lg: from the desktop breakpoint up. The editor's devices are the other
 * way round (desktop is the base view), so a write on one device must leave the others
 * as they were:
 *   desktop → lg:p-6
 *   tablet  → md:p-6, and when no lg: class covers the same property, md:max-lg:p-6
 *   phone   → p-6, and when no md:/lg: class covers it, max-md:p-6
 *   phone with an existing base class (p-4) → p-6 plus md:p-4, so tablet and desktop keep 16px
 */
import { extendTailwindMerge } from "tailwind-merge";
import type { Declarations, Device } from "../shared/types.ts";

export type TailwindOptions = {
  /** 3 or 4; decides the radius scale and the important syntax. */
  version: 3 | 4;
  /** Theme colours the site defines (Tailwind v4 @theme or a v3 config): name → value. */
  colors?: Record<string, string>;
  /** Add the important modifier so the class beats the site's own CSS for the same property. */
  important?: boolean;
};

const twMerge = extendTailwindMerge({});

const SPACING: Record<number, string> = {
  0: "0", 1: "px", 2: "0.5", 4: "1", 6: "1.5", 8: "2", 10: "2.5", 12: "3", 14: "3.5", 16: "4", 20: "5", 24: "6", 28: "7", 32: "8", 36: "9", 40: "10", 44: "11", 48: "12", 56: "14", 64: "16", 80: "20", 96: "24", 112: "28", 128: "32", 144: "36", 160: "40", 176: "44", 192: "48", 208: "52", 224: "56", 240: "60", 256: "64", 288: "72", 320: "80", 384: "96",
};
const FONT_SIZES: Record<number, string> = { 12: "xs", 14: "sm", 16: "base", 18: "lg", 20: "xl", 24: "2xl", 30: "3xl", 36: "4xl", 48: "5xl", 60: "6xl", 72: "7xl", 96: "8xl", 128: "9xl" };
const WEIGHTS: Record<number, string> = { 100: "thin", 200: "extralight", 300: "light", 400: "normal", 500: "medium", 600: "semibold", 700: "bold", 800: "extrabold", 900: "black" };
const LINE_HEIGHTS: Record<string, string> = { "1": "none", "1.25": "tight", "1.375": "snug", "1.5": "normal", "1.625": "relaxed", "2": "loose" };
const RADIUS_V4: Record<number, string> = { 0: "none", 2: "xs", 4: "sm", 6: "md", 8: "lg", 12: "xl", 16: "2xl", 24: "3xl", 32: "4xl", 9999: "full" };
const RADIUS_V3: Record<number, string> = { 0: "none", 2: "sm", 4: "", 6: "md", 8: "lg", 12: "xl", 16: "2xl", 24: "3xl", 9999: "full" };
const FRACTIONS: Record<string, string> = { "50%": "1/2", "33.333%": "1/3", "33.3333%": "1/3", "66.666%": "2/3", "66.6667%": "2/3", "25%": "1/4", "75%": "3/4", "20%": "1/5", "40%": "2/5", "60%": "3/5", "80%": "4/5", "100%": "full" };

const SIDE_SUFFIX: Record<string, string> = { top: "t", right: "r", bottom: "b", left: "l" };

/** "23px" → 23, "1.5rem" → 24, else null. */
export function toPx(value: string): number | null {
  const trimmed = value.trim();
  const match = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(trimmed);
  if (!match) return trimmed === "0" ? 0 : null;
  const number = Number(match[1]);
  if (match[2] === "rem" || match[2] === "em") return Math.round(number * 16 * 100) / 100;
  return number;
}

function arbitrary(value: string): string {
  return `[${value.trim().replace(/\s+/g, "_")}]`;
}

function spacingToken(value: string): { token: string; negative: boolean } {
  const px = toPx(value);
  if (px !== null && px >= 0 && SPACING[px] !== undefined) return { token: SPACING[px] as string, negative: false };
  if (px !== null && px < 0 && SPACING[-px] !== undefined) return { token: SPACING[-px] as string, negative: true };
  if (px !== null && px < 0) return { token: arbitrary(value.trim().slice(1)), negative: true };
  return { token: arbitrary(value), negative: false };
}

const spacing = (value: string): string => spacingToken(value).token;

function colorToken(value: string, colors: Record<string, string> | undefined): string {
  const trimmed = value.trim();
  if (trimmed === "transparent") return "transparent";
  if (trimmed === "currentColor" || trimmed === "currentcolor") return "current";
  if (trimmed === "inherit") return "inherit";
  if (colors) {
    for (const [name, themeValue] of Object.entries(colors)) {
      if (themeValue.trim().toLowerCase() === trimmed.toLowerCase()) return name;
    }
    // A theme colour name passed straight through ("primary").
    if (Object.prototype.hasOwnProperty.call(colors, trimmed)) return trimmed;
  }
  if (/^(#|rgb|hsl|oklch|oklab|lab|lch|color\()/.test(trimmed)) return arbitrary(trimmed);
  return arbitrary(trimmed);
}

/** One CSS declaration to one Tailwind class, without variants. Null when the property is not supported. */
export function declarationToClass(property: string, rawValue: string, options: TailwindOptions): string | null {
  const value = rawValue.trim();
  const sides = /^(padding|margin)(?:-(top|right|bottom|left|x|y))?$/.exec(property);
  if (sides) {
    const base = sides[1] === "padding" ? "p" : "m";
    const suffix = sides[2] ? (SIDE_SUFFIX[sides[2]] ?? sides[2]) : "";
    if (value === "auto" && base === "m") return `m${suffix}-auto`;
    const { token, negative } = spacingToken(value);
    return `${negative ? "-" : ""}${base}${suffix}-${token}`;
  }
  switch (property) {
    case "font-size": {
      const px = toPx(value);
      if (px !== null && FONT_SIZES[px]) return `text-${FONT_SIZES[px]}`;
      return `text-${arbitrary(value)}`;
    }
    case "font-weight": {
      const number = Number(value);
      if (WEIGHTS[number]) return `font-${WEIGHTS[number]}`;
      if (value === "bold") return "font-bold";
      if (value === "normal") return "font-normal";
      return `font-${arbitrary(value)}`;
    }
    case "line-height": {
      if (LINE_HEIGHTS[value]) return `leading-${LINE_HEIGHTS[value]}`;
      const px = toPx(value);
      if (px !== null && /px|rem|em/.test(value) && SPACING[px] !== undefined && px >= 12) return `leading-${SPACING[px]}`;
      return `leading-${arbitrary(value)}`;
    }
    case "color":
      return `text-${colorToken(value, options.colors)}`;
    case "background-color":
    case "background":
      return `bg-${colorToken(value, options.colors)}`;
    case "border-color":
      return `border-${colorToken(value, options.colors)}`;
    case "border-width": {
      const px = toPx(value);
      if (px === 1) return "border";
      if (px === 0) return "border-0";
      if (px !== null && [2, 4, 8].includes(px)) return `border-${px}`;
      return `border-${arbitrary(value)}`;
    }
    case "border-style":
      return ["solid", "dashed", "dotted", "double", "none", "hidden"].includes(value) ? `border-${value}` : null;
    case "border-radius": {
      const px = toPx(value);
      const table = options.version === 3 ? RADIUS_V3 : RADIUS_V4;
      if (value === "50%") return "rounded-full";
      if (px !== null && table[px] !== undefined) return table[px] === "" ? "rounded" : `rounded-${table[px]}`;
      return `rounded-${arbitrary(value)}`;
    }
    case "width": {
      if (value === "auto") return "w-auto";
      if (value === "100vw") return "w-screen";
      if (value === "fit-content") return "w-fit";
      if (value === "max-content") return "w-max";
      if (value === "min-content") return "w-min";
      if (FRACTIONS[value]) return `w-${FRACTIONS[value]}`;
      return `w-${spacing(value)}`;
    }
    case "max-width": {
      if (value === "none") return "max-w-none";
      if (FRACTIONS[value] === "full") return "max-w-full";
      return `max-w-${arbitrary(value)}`;
    }
    case "height": {
      if (value === "auto") return "h-auto";
      if (value === "100vh") return "h-screen";
      if (FRACTIONS[value]) return `h-${FRACTIONS[value]}`;
      return `h-${spacing(value)}`;
    }
    case "min-height": {
      if (value === "100vh") return "min-h-screen";
      if (value === "100%") return "min-h-full";
      return `min-h-${spacing(value)}`;
    }
    case "text-align":
      return ["left", "center", "right", "justify", "start", "end"].includes(value) ? `text-${value}` : null;
    case "gap":
      return `gap-${spacing(value)}`;
    case "column-gap":
      return `gap-x-${spacing(value)}`;
    case "row-gap":
      return `gap-y-${spacing(value)}`;
    case "display": {
      const map: Record<string, string> = { block: "block", flex: "flex", grid: "grid", inline: "inline", "inline-block": "inline-block", "inline-flex": "inline-flex", none: "hidden", contents: "contents" };
      return map[value] ?? null;
    }
    case "flex-direction": {
      const map: Record<string, string> = { row: "flex-row", column: "flex-col", "row-reverse": "flex-row-reverse", "column-reverse": "flex-col-reverse" };
      return map[value] ?? null;
    }
    case "justify-content": {
      const map: Record<string, string> = { "flex-start": "justify-start", start: "justify-start", center: "justify-center", "flex-end": "justify-end", end: "justify-end", "space-between": "justify-between", "space-around": "justify-around", "space-evenly": "justify-evenly" };
      return map[value] ?? null;
    }
    case "align-items": {
      const map: Record<string, string> = { "flex-start": "items-start", start: "items-start", center: "items-center", "flex-end": "items-end", end: "items-end", stretch: "items-stretch", baseline: "items-baseline" };
      return map[value] ?? null;
    }
    case "font-style":
      return value === "italic" ? "italic" : value === "normal" ? "not-italic" : null;
    case "text-decoration-line":
    case "text-decoration":
      return value === "underline" ? "underline" : value === "line-through" ? "line-through" : value === "none" ? "no-underline" : null;
    case "text-transform":
      return value === "uppercase" ? "uppercase" : value === "lowercase" ? "lowercase" : value === "capitalize" ? "capitalize" : value === "none" ? "normal-case" : null;
    case "letter-spacing":
      return `tracking-${arbitrary(value)}`;
    case "opacity": {
      const number = Number(value);
      if (Number.isFinite(number)) return `opacity-${Math.round(number <= 1 ? number * 100 : number)}`;
      return null;
    }
    case "font-family":
      return `font-${arbitrary(value.replace(/,/g, ",").replace(/"/g, "'"))}`;
    default:
      return null;
  }
}

/** The property group a class sets, for "does a class already cover this property at this breakpoint". */
export function groupOf(className: string): string | null {
  const bare = className.replace(/^!/, "").replace(/!$/, "");
  const utility = bare.includes(":") ? bare.slice(bare.lastIndexOf(":") + 1) : bare;
  const tests: [RegExp, string][] = [
    [/^-?p[trblxy]?-/, "padding"],
    [/^-?m[trblxy]?-/, "margin"],
    [/^text-(xs|sm|base|lg|xl|\dxl|\[[^\]]*(px|rem|em)\])$/, "font-size"],
    [/^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\[\d+\])$/, "font-weight"],
    [/^leading-/, "line-height"],
    [/^text-(left|center|right|justify|start|end)$/, "text-align"],
    [/^text-/, "color"],
    [/^bg-/, "background-color"],
    [/^border-(\[[^\]]*px\]|\d)$|^border$/, "border-width"],
    [/^border-(solid|dashed|dotted|double|none|hidden)$/, "border-style"],
    [/^border-/, "border-color"],
    [/^rounded/, "border-radius"],
    [/^w-/, "width"],
    [/^max-w-/, "max-width"],
    [/^h-/, "height"],
    [/^min-h-/, "min-height"],
    [/^gap-x-/, "column-gap"],
    [/^gap-y-/, "row-gap"],
    [/^gap-/, "gap"],
    [/^(block|flex|grid|inline|inline-block|inline-flex|hidden|contents)$/, "display"],
    [/^flex-(row|col)/, "flex-direction"],
    [/^justify-/, "justify-content"],
    [/^items-/, "align-items"],
    [/^(italic|not-italic)$/, "font-style"],
    [/^(underline|line-through|no-underline)$/, "text-decoration"],
    [/^(uppercase|lowercase|capitalize|normal-case)$/, "text-transform"],
    [/^tracking-/, "letter-spacing"],
    [/^opacity-/, "opacity"],
  ];
  for (const [pattern, group] of tests) if (pattern.test(utility)) return group;
  return null;
}

function variantsOf(className: string): string[] {
  const bare = className.replace(/^!/, "");
  const index = bare.lastIndexOf(":");
  return index === -1 ? [] : bare.slice(0, index).split(":");
}

const SIDES_OF: Record<string, string[]> = { "": ["top", "right", "bottom", "left"], x: ["left", "right"], y: ["top", "bottom"], t: ["top"], r: ["right"], b: ["bottom"], l: ["left"] };

/** The sides a padding/margin utility sets (p-4 → all four, px-4 → left and right). */
function sidesOfUtility(className: string): string[] | null {
  const bare = className.replace(/^!/, "").replace(/!$/, "");
  const utility = bare.includes(":") ? bare.slice(bare.lastIndexOf(":") + 1) : bare;
  const match = /^-?[pm]([trblxy]?)-/.exec(utility);
  return match ? (SIDES_OF[match[1] ?? ""] ?? null) : null;
}

const REQUIRED_SIDES: Record<string, string[]> = { "": ["top", "right", "bottom", "left"], x: ["left", "right"], y: ["top", "bottom"], top: ["top"], right: ["right"], bottom: ["bottom"], left: ["left"] };

/** Whether a class covers a property (p-4 covers padding-top; py-4 does not cover padding-left). */
function covers(className: string, property: string): boolean {
  const group = groupOf(className);
  if (!group) return false;
  const spacingMatch = /^(padding|margin)(?:-(top|right|bottom|left|x|y))?$/.exec(property);
  if (spacingMatch) {
    if (group !== spacingMatch[1]) return false;
    const have = sidesOfUtility(className) ?? [];
    return (REQUIRED_SIDES[spacingMatch[2] ?? ""] ?? []).every((side) => have.includes(side));
  }
  if (group === property) return true;
  if (group === "gap" && (property === "column-gap" || property === "row-gap")) return true;
  return false;
}

function hasClassFor(classes: string[], property: string, variant: string | null): boolean {
  return classes.some((item) => {
    const variants = variantsOf(item);
    const matches = variant === null ? variants.length === 0 : variants.includes(variant);
    return matches && covers(item, property);
  });
}

/** padding-left + padding-right with the same value become padding-x, and all four sides become padding. */
export function combineSides(declarations: Declarations): Declarations {
  const out: Declarations = { ...declarations };
  for (const base of ["padding", "margin"]) {
    const get = (side: string) => out[`${base}-${side}`];
    if (get("top") !== undefined && get("top") === get("bottom") && get("top") === get("left") && get("top") === get("right")) {
      out[base] = get("top") as string;
      for (const side of ["top", "right", "bottom", "left"]) delete out[`${base}-${side}`];
      continue;
    }
    if (get("left") !== undefined && get("left") === get("right")) {
      out[`${base}-x`] = get("left") as string;
      delete out[`${base}-left`];
      delete out[`${base}-right`];
    }
    if (get("top") !== undefined && get("top") === get("bottom")) {
      out[`${base}-y`] = get("top") as string;
      delete out[`${base}-top`];
      delete out[`${base}-bottom`];
    }
  }
  return out;
}

function withVariants(className: string, variants: string[], options: TailwindOptions): string {
  const prefix = variants.length > 0 ? `${variants.join(":")}:` : "";
  if (options.important) return options.version === 3 ? `${prefix}!${className}` : `${prefix}${className}!`;
  return `${prefix}${className}`;
}

export type ClassWrite = { className: string; added: string[]; removed: string[]; unsupported: string[] };

/**
 * Apply declarations for one device to an existing className. Returns the merged
 * className and what changed.
 */
export function applyDeclarations(existing: string, declarations: Declarations, device: Device, options: TailwindOptions): ClassWrite {
  const classes = existing.split(/\s+/).filter(Boolean);
  const additions: string[] = [];
  const unsupported: string[] = [];
  for (const [property, value] of Object.entries(combineSides(declarations))) {
    const utility = declarationToClass(property, value, options);
    if (!utility) {
      unsupported.push(property);
      continue;
    }
    if (device === "desktop") {
      additions.push(withVariants(utility, ["lg"], options));
    } else if (device === "tablet") {
      const desktopCovered = hasClassFor(classes, property, "lg");
      additions.push(withVariants(utility, desktopCovered ? ["md"] : ["md", "max-lg"], options));
    } else {
      const baseClass = classes.find((item) => variantsOf(item).length === 0 && covers(item, property));
      const covered = hasClassFor(classes, property, "md") || hasClassFor(classes, property, "lg");
      if (covered) {
        additions.push(withVariants(utility, [], options));
      } else if (baseClass) {
        // Keep tablet and desktop on the old value.
        additions.push(withVariants(utility, [], options));
        additions.push(`md:${baseClass}`);
      } else {
        additions.push(withVariants(utility, ["max-md"], options));
      }
    }
  }
  const merged = twMerge(classes.join(" "), additions.join(" "));
  const result = merged.split(/\s+/).filter(Boolean);
  const removed = classes.filter((item) => !result.includes(item));
  const added = result.filter((item) => !classes.includes(item));
  return { className: result.join(" "), added, removed, unsupported };
}

/** Add classes to a className without merging away anything (used for the fallback marker class). */
export function addClasses(existing: string, classes: string[]): string {
  const list = existing.split(/\s+/).filter(Boolean);
  for (const item of classes) if (!list.includes(item)) list.push(item);
  return list.join(" ");
}
