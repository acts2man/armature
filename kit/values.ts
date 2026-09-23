/**
 * Small pure helpers for sizes, colours and kit references, shared by the CSS generator,
 * the inspector and the validators. No dependencies.
 */
import type { Color, Corners, Sides, Size, SiteKit, Unit } from "./types.ts";

export const UNITS: readonly Unit[] = ["px", "%", "em", "rem", "vw", "vh", "vmin", "vmax", "ch", "ex", "svh", "dvh", "lvh", "svw", "dvw", "lvw", "pt", "auto", ""];

export const px = (value: number): Size => ({ value, unit: "px" });
export const pct = (value: number): Size => ({ value, unit: "%" });
export const auto = (): Size => ({ value: 0, unit: "auto" });

export function sizeToCss(size: Size | undefined): string | undefined {
  if (!size) return undefined;
  if (size.unit === "auto") return "auto";
  const value = Number.isFinite(size.value) ? +size.value.toFixed(3) : 0;
  return size.unit === "" ? String(value) : `${value}${size.unit}`;
}

/** "12px", "2rem", "50%", "auto", "1.4", "-0.02em", ".5rem", "0" → a Size, or null when it is not one. */
export function parseSize(text: string, fallbackUnit: Unit = "px"): Size | null {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === "auto") return auto();
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px|%|em|rem|vw|vh|vmin|vmax|ch|ex|svh|dvh|lvh|svw|dvw|lvw|pt)?$/.exec(trimmed);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  // A bare 0 needs no unit in CSS; any other bare number takes the control's unit ("" for line-height).
  return { value, unit: (match[2] as Unit | undefined) ?? (value === 0 && fallbackUnit !== "" ? "px" : fallbackUnit) };
}

export const sidesToCss = (sides: Sides<Size> | undefined): Partial<Record<"top" | "right" | "bottom" | "left", string>> => ({
  top: sizeToCss(sides?.top),
  right: sizeToCss(sides?.right),
  bottom: sizeToCss(sides?.bottom),
  left: sizeToCss(sides?.left),
});

export const cornersToCss = (corners: Corners<Size> | undefined): string | undefined => {
  if (!corners) return undefined;
  const parts = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft].map((corner) => sizeToCss(corner) ?? "0");
  if (parts.every((part) => part === "0")) return undefined;
  return parts.join(" ");
};

// --- kit references ------------------------------------------------------------------------

export const KIT_REF_PATTERN = /^kit:(color|font|type|button)\.([a-z0-9_-]+)(?:\.([a-z0-9_-]+))?$/i;

export type KitRef = { group: "color" | "font" | "type" | "button"; name: string; sub?: string };

export function parseKitRef(value: unknown): KitRef | null {
  if (typeof value !== "string") return null;
  const match = KIT_REF_PATTERN.exec(value);
  if (!match) return null;
  const group = match[1]?.toLowerCase() as KitRef["group"];
  const name = match[2] ?? "";
  const sub = match[3];
  return sub ? { group, name, sub } : { group, name };
}

export const isKitRef = (value: unknown): boolean => parseKitRef(value) !== null;

/** The CSS custom property name a reference maps to, e.g. --ae-color-primary. */
export function kitRefVar(ref: KitRef): string {
  if (ref.group === "color") return ref.name === "custom" && ref.sub ? `--ae-color-${ref.sub}` : `--ae-color-${ref.name}`;
  if (ref.group === "font") return ref.name === "custom" && ref.sub ? `--ae-font-${ref.sub}` : `--ae-font-${ref.name}`;
  return `--ae-${ref.group}-${ref.name}${ref.sub ? `-${ref.sub}` : ""}`;
}

/** A colour or font value as CSS: kit references become var(), literals pass through. */
export function refToCss(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  const ref = parseKitRef(value);
  return ref ? `var(${kitRefVar(ref)})` : value;
}

/** The literal value a colour reference points at in the kit, or null. */
export function resolveKitColor(kit: SiteKit, value: Color | undefined): string | null {
  if (value === undefined) return null;
  const ref = parseKitRef(value);
  if (!ref) return value;
  if (ref.group !== "color") return null;
  if (ref.name === "custom") return kit.colors.custom.find((color) => color.id === ref.sub)?.value ?? null;
  const named = kit.colors[ref.name as "primary" | "secondary" | "text" | "accent"];
  return typeof named === "string" ? named : null;
}

export function resolveKitFont(kit: SiteKit, value: string | undefined): string | null {
  if (value === undefined) return null;
  const ref = parseKitRef(value);
  if (!ref) return value;
  if (ref.group !== "font") return null;
  if (ref.name === "custom") return kit.fonts.custom.find((font) => font.id === ref.sub)?.family ?? null;
  const named = kit.fonts[ref.name as "heading" | "body"];
  return typeof named === "string" ? named : null;
}

// --- colours ---------------------------------------------------------------------------------

/** Every CSS named colour, plus the keywords a stylesheet may use where a colour goes. */
export const NAMED_COLORS: readonly string[] = [
  "aliceblue", "antiquewhite", "aqua", "aquamarine", "azure", "beige", "bisque", "black", "blanchedalmond", "blue", "blueviolet", "brown", "burlywood", "cadetblue", "chartreuse", "chocolate", "coral", "cornflowerblue", "cornsilk", "crimson", "cyan", "darkblue", "darkcyan", "darkgoldenrod", "darkgray", "darkgreen", "darkgrey", "darkkhaki", "darkmagenta", "darkolivegreen", "darkorange", "darkorchid", "darkred", "darksalmon", "darkseagreen", "darkslateblue", "darkslategray", "darkslategrey", "darkturquoise", "darkviolet", "deeppink", "deepskyblue", "dimgray", "dimgrey", "dodgerblue", "firebrick", "floralwhite", "forestgreen", "fuchsia", "gainsboro", "ghostwhite", "gold", "goldenrod", "gray", "green", "greenyellow", "grey", "honeydew", "hotpink", "indianred", "indigo", "ivory", "khaki", "lavender", "lavenderblush", "lawngreen", "lemonchiffon", "lightblue", "lightcoral", "lightcyan", "lightgoldenrodyellow", "lightgray", "lightgreen", "lightgrey", "lightpink", "lightsalmon", "lightseagreen", "lightskyblue", "lightslategray", "lightslategrey", "lightsteelblue", "lightyellow", "lime", "limegreen", "linen", "magenta", "maroon", "mediumaquamarine", "mediumblue", "mediumorchid", "mediumpurple", "mediumseagreen", "mediumslateblue", "mediumspringgreen", "mediumturquoise", "mediumvioletred", "midnightblue", "mintcream", "mistyrose", "moccasin", "navajowhite", "navy", "oldlace", "olive", "olivedrab", "orange", "orangered", "orchid", "palegoldenrod", "palegreen", "paleturquoise", "palevioletred", "papayawhip", "peachpuff", "peru", "pink", "plum", "powderblue", "purple", "rebeccapurple", "red", "rosybrown", "royalblue", "saddlebrown", "salmon", "sandybrown", "seagreen", "seashell", "sienna", "silver", "skyblue", "slateblue", "slategray", "slategrey", "snow", "springgreen", "steelblue", "tan", "teal", "thistle", "tomato", "turquoise", "violet", "wheat", "white", "whitesmoke", "yellow", "yellowgreen",
  "transparent", "currentcolor", "inherit", "initial", "unset", "revert",
];
const NAMED_COLOR_SET = new Set(NAMED_COLORS);

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
/**
 * rgb()/rgba()/hsl()/hsla()/hwb()/lab()/lch()/oklab()/oklch()/color()/color-mix()/
 * light-dark() with any argument syntax CSS allows (commas, spaces, slashes, percentages,
 * nested colours), and var(--name[, fallback]). The character set is what keeps this safe:
 * no quotes, semicolons, braces, angle brackets or backslashes, so a value can never
 * escape its declaration, and url()/expression() are refused by name.
 */
const FUNCTIONAL_COLOR = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark|var)\([a-z0-9\s.,%/+*()#-]*\)$/i;
const UNSAFE_CSS = /url\s*\(|expression\s*\(|@import|javascript:/i;

/** A CSS colour: 3/4/6/8-digit hex, a named colour, transparent/currentColor, any colour function, or var(). */
export const isColorLiteral = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return false;
  if (HEX_COLOR.test(trimmed) || NAMED_COLOR_SET.has(trimmed.toLowerCase())) return true;
  if (UNSAFE_CSS.test(trimmed) || !FUNCTIONAL_COLOR.test(trimmed)) return false;
  // Parentheses must balance, so a value cannot open a function it never closes.
  let depth = 0;
  for (const char of trimmed) {
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
};

export const isColorValue = (value: unknown): boolean => isColorLiteral(value) || parseKitRef(value)?.group === "color";

/** A CSS font-family list for a family name, quoting names with spaces. */
export function fontFamilyCss(family: string): string {
  const trimmed = family.trim();
  if (!trimmed) return "inherit";
  const generic = ["serif", "sans-serif", "monospace", "system-ui", "cursive", "fantasy", "inherit"];
  if (generic.includes(trimmed.toLowerCase())) return trimmed;
  return /[\s'"]/.test(trimmed) ? `"${trimmed.replace(/"/g, "")}", sans-serif` : `${trimmed}, sans-serif`;
}

/** A Google Fonts family name the kit will request: letters, digits and spaces only. */
export const isSafeFontFamily = (family: string): boolean => /^[A-Za-z0-9 ]{1,60}$/.test(family.trim());

/**
 * One Google Fonts stylesheet for every kit font marked "google" (the only fonts the kit
 * ever loads from elsewhere), or null when there are none.
 */
export function googleFontsHref(kit: SiteKit): string | null {
  const families = Array.from(new Set(kit.fonts.custom.filter((font) => font.source === "google" && isSafeFontFamily(font.family)).map((font) => font.family.trim())));
  if (families.length === 0) return null;
  const query = families.map((family) => `family=${family.replace(/ /g, "+")}:wght@300;400;500;600;700;800`).join("&");
  return `https://fonts.googleapis.com/css2?${query}&display=swap`;
}

/** A CSS identifier (id, class, custom property piece) with anything unsafe removed. */
export const cssIdent = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);

/** A CSS string value with quotes and newlines escaped, for url() and content. */
export const cssString = (value: string): string => `"${value.replace(/["\\\n\r]/g, "")}"`;
