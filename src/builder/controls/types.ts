/**
 * The schema-driven control library: a control is described by a small spec (what it
 * edits, at which path, how) and rendered by ControlRenderer. Widgets and the site kit
 * panel are lists of specs, so every control has the same look, the same per-device
 * behaviour and the same keyboard support.
 */
import type { ReactNode } from "react";
import type { Size, SiteKit, Unit } from "@shared/builder/index.ts";

export type Path = readonly string[];

export type Option = { value: string; label: string };

export type ControlSpec =
  | { kind: "text"; label: string; path: Path; multiline?: boolean; placeholder?: string; hint?: string; max?: number; /** A browser input type for dates and numbers typed as text. */ inputType?: "datetime-local" | "url" | "email" }
  /** A list of rows (accordion items, pictures, form fields): add, reorder, duplicate, remove, each row's own controls. */
  | { kind: "items"; label: string; path: Path; itemLabel: string; titleKey: string; fields: ControlSpec[]; create: () => Record<string, unknown>; max?: number; min?: number }
  /** A list of short strings, one per line (a dropdown's options). */
  | { kind: "lines"; label: string; path: Path; hint?: string; max?: number }
  | { kind: "select"; label: string; path: Path; options: Option[]; responsive?: boolean; hint?: string; /** Shown greyed when nothing is set (e.g. the text preset's value). */ fallback?: string | number; /** What desktop shows when nothing is set: a first value on a phone or tablet keeps desktop at this instead of copying the new value up. */ desktopFallback?: string | number; /** Values are stored as numbers. */ numeric?: boolean; /** Choosing "Default" removes this whole path (e.g. the position object with its offsets). */ clearPath?: Path; /** Omit the automatic "Default" option. */ required?: boolean; /** A "Custom…" entry that takes any number in this range (font weight 650, say). */ custom?: { min: number; max: number; step?: number } }
  | { kind: "choice"; label: string; path: Path; options: (Option & { icon?: string })[]; responsive?: boolean; allowNone?: boolean; /** Values are stored as numbers. */ numeric?: boolean }
  | { kind: "toggle"; label: string; path: Path; responsive?: boolean; hint?: string }
  | { kind: "number"; label: string; path: Path; min?: number; max?: number; step?: number; responsive?: boolean; hint?: string }
  | { kind: "size"; label: string; path: Path; units?: Unit[]; min?: number; max?: number; responsive?: boolean; hint?: string; allowScreen?: boolean; /** Shown greyed when nothing is set (e.g. the text preset's value). */ fallback?: Size; /** What desktop shows when nothing is set: a first value on a phone or tablet keeps desktop at this instead of copying the new value up. */ desktopFallback?: Size }
  | { kind: "sides"; label: string; path: Path; units?: Unit[]; responsive?: boolean }
  | { kind: "corners"; label: string; path: Path; units?: Unit[]; responsive?: boolean }
  | { kind: "color"; label: string; path: Path; responsive?: boolean; hint?: string; /** No kit swatches (the kit's own base colours). */ noKit?: boolean; required?: boolean }
  | { kind: "font"; label: string; path: Path; /** No kit fonts (the kit's own heading and body fonts). */ noKit?: boolean; required?: boolean }
  | { kind: "link"; label: string; path: Path; hint?: string }
  | { kind: "image"; label: string; path: Path }
  | { kind: "icon"; label: string; path: Path }
  | { kind: "gap"; label: string; path: Path; responsive?: boolean }
  | { kind: "shadow"; label: string; path: Path; responsive?: boolean; text?: boolean }
  /** An outline around the letters: width and colour. */
  | { kind: "stroke"; label: string; path: Path; responsive?: boolean }
  | { kind: "background"; label: string; path: Path; responsive?: boolean }
  | { kind: "typography"; path: Path; label?: string }
  | { kind: "overlay"; path: Path }
  | { kind: "border"; path: Path; label?: string }
  | { kind: "group"; label: string; controls: ControlSpec[]; open?: boolean; agencyOnly?: boolean }
  | { kind: "note"; text: string }
  /** Controls shown only while `when` holds (e.g. offsets once a position is chosen). */
  | { kind: "if"; id: string; when: (read: (path: Path) => unknown) => boolean; controls: ControlSpec[] }
  /** An escape hatch for one-off panels (the plain-text editor of a text block). */
  | { kind: "custom"; id: string; render: (context: CustomContext) => ReactNode }
  | { kind: "attributes"; label: string; path: Path }
  | { kind: "css"; label: string; path: Path };

export const PX_UNITS: Unit[] = ["px", "em", "rem", "%", "vw", "vh"];
export const SPACING_UNITS: Unit[] = ["px", "em", "rem", "%", "vw"];
export const WIDTH_UNITS: Unit[] = ["px", "%", "em", "rem", "vw"];
export const HEIGHT_UNITS: Unit[] = ["px", "em", "rem", "vh"];
export const FONT_UNITS: Unit[] = ["px", "em", "rem"];
export const LINE_HEIGHT_UNITS: Unit[] = ["", "px", "em"];
export const LETTER_UNITS: Unit[] = ["px", "em"];

/** What a custom control receives. The concrete target type lives in ControlRenderer. */
export type CustomContext = {
  read: (path: Path) => unknown;
  write: (path: Path, value: unknown, label: string, group?: string) => void;
  editOnPage?: () => void;
  kit: SiteKit;
  /** Replace a section's columns with a structure preset (its content moves into the new columns). */
  applyStructure?: (structureId: string) => void;
};
