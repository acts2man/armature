/**
 * Small pure helpers for sizes, colours and kit references, shared by the CSS generator,
 * the inspector and the validators. No dependencies.
 */
import type { Color, Corners, Sides, Size, SiteKit, Unit } from "./types.ts";

export const UNITS: readonly Unit[] = ["px", "%", "em", "rem", "vw", "vh", "auto", ""];

export const px = (value: number): Size => ({ value, unit: "px" });
export const pct = (value: number): Size => ({ value, unit: "%" });
export const auto = (): Size => ({ value: 0, unit: "auto" });

export function sizeToCss(size: Size | undefined): string | undefined {
  if (!size) return undefined;
  if (size.unit === "auto") return "auto";
  const value = Number.isFinite(size.value) ? +size.value.toFixed(3) : 0;
  return size.unit === "" ? String(value) : `${value}${size.unit}`;
}

/** "12px", "2rem", "50%", "auto", "1.4" → a Size, or null when it is not one. */
export function parseSize(text: string, fallbackUnit: Unit = "px"): Size | null {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === "auto") return auto();
  const match = /^(-?\d*\.?\d+)\s*(px|%|em|rem|vw|vh)?$/.exec(trimmed);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return { value, unit: (match[2] as Unit | undefined) ?? fallbackUnit };
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

const COLOR_PATTERN = /^(#[0-9a-f]{3}|#[0-9a-f]{4}|#[0-9a-f]{6}|#[0-9a-f]{8}|rgba?\([\d\s.,%/]+\)|hsla?\([\d\s.,%/deg]+\)|transparent|currentcolor|inherit)$/i;

export const isColorLiteral = (value: unknown): boolean => typeof value === "string" && COLOR_PATTERN.test(value.trim());

export const isColorValue = (value: unknown): boolean => isColorLiteral(value) || parseKitRef(value)?.group === "color";

/** A CSS font-family list for a family name, quoting names with spaces. */
export function fontFamilyCss(family: string): string {
  const trimmed = family.trim();
  if (!trimmed) return "inherit";
  const generic = ["serif", "sans-serif", "monospace", "system-ui", "cursive", "fantasy", "inherit"];
  if (generic.includes(trimmed.toLowerCase())) return trimmed;
  return /[\s'"]/.test(trimmed) ? `"${trimmed.replace(/"/g, "")}", sans-serif` : `${trimmed}, sans-serif`;
}

/** A CSS identifier (id, class, custom property piece) with anything unsafe removed. */
export const cssIdent = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);

/** A CSS string value with quotes and newlines escaped, for url() and content. */
export const cssString = (value: string): string => `"${value.replace(/["\\\n\r]/g, "")}"`;
