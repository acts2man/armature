/**
 * The schema-driven control library: a control is described by a small spec (what it
 * edits, at which path, how) and rendered by ControlRenderer. Widgets and the site kit
 * panel are lists of specs, so every control has the same look, the same per-device
 * behaviour and the same keyboard support.
 */
import type { Unit } from "@shared/builder/index.ts";

export type Path = readonly string[];

export type Option = { value: string; label: string };

export type ControlSpec =
  | { kind: "text"; label: string; path: Path; multiline?: boolean; placeholder?: string; hint?: string; max?: number }
  | { kind: "select"; label: string; path: Path; options: Option[]; responsive?: boolean; hint?: string }
  | { kind: "choice"; label: string; path: Path; options: (Option & { icon?: string })[]; responsive?: boolean; allowNone?: boolean }
  | { kind: "toggle"; label: string; path: Path; responsive?: boolean; hint?: string }
  | { kind: "number"; label: string; path: Path; min?: number; max?: number; step?: number; responsive?: boolean; hint?: string }
  | { kind: "size"; label: string; path: Path; units?: Unit[]; min?: number; max?: number; responsive?: boolean; hint?: string; allowScreen?: boolean }
  | { kind: "sides"; label: string; path: Path; units?: Unit[]; responsive?: boolean }
  | { kind: "corners"; label: string; path: Path; units?: Unit[]; responsive?: boolean }
  | { kind: "color"; label: string; path: Path; responsive?: boolean; hint?: string }
  | { kind: "font"; label: string; path: Path }
  | { kind: "link"; label: string; path: Path; hint?: string }
  | { kind: "image"; label: string; path: Path }
  | { kind: "icon"; label: string; path: Path }
  | { kind: "gap"; label: string; path: Path; responsive?: boolean }
  | { kind: "shadow"; label: string; path: Path; responsive?: boolean; text?: boolean }
  | { kind: "background"; label: string; path: Path; responsive?: boolean }
  | { kind: "typography"; path: Path }
  | { kind: "border"; path: Path }
  | { kind: "group"; label: string; controls: ControlSpec[]; open?: boolean; agencyOnly?: boolean }
  | { kind: "note"; text: string }
  | { kind: "attributes"; label: string; path: Path }
  | { kind: "css"; label: string; path: Path };

export const PX_UNITS: Unit[] = ["px", "em", "rem", "%", "vw", "vh"];
export const SPACING_UNITS: Unit[] = ["px", "em", "rem", "%", "vw"];
export const WIDTH_UNITS: Unit[] = ["px", "%", "em", "rem", "vw"];
export const HEIGHT_UNITS: Unit[] = ["px", "em", "rem", "vh"];
export const FONT_UNITS: Unit[] = ["px", "em", "rem"];
export const LINE_HEIGHT_UNITS: Unit[] = ["", "px", "em"];
export const LETTER_UNITS: Unit[] = ["px", "em"];
