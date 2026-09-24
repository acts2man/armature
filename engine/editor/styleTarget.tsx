/**
 * The Style tab against real CSS: the control specs it shows, how a control's value is
 * read from the selected element's computed style (the bridge sends it on select), and
 * how a written value becomes CSS declarations for the engine's style op. Pure module.
 */
import { resolveKitColor, sizeToCss, type Sides, type SiteKit, type Size } from "../../shared/builder/index.ts";
import { FONT_UNITS, LINE_HEIGHT_UNITS, SPACING_UNITS, WIDTH_UNITS, type ControlSpec, type Path } from "../../src/builder/controls/types.ts";
import type { Declarations } from "../shared/types.ts";
import { colorToHex, pxOf } from "./nodes.ts";
import { EngineSidesField, EngineSizeField } from "./StyleFields.tsx";

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

export const STYLE_SPECS: ControlSpec[] = [
  {
    kind: "group",
    label: "Spacing",
    controls: [
      // Four boxes each, one CSS declaration per box: the engine writes only the side that changed.
      { kind: "custom", id: "padding", render: (context) => <EngineSidesField context={context} property="padding" label="Padding" units={SPACING_UNITS} /> },
      { kind: "custom", id: "margin", render: (context) => <EngineSidesField context={context} property="margin" label="Margin" units={SPACING_UNITS} /> },
    ],
  },
  {
    kind: "group",
    label: "Typography",
    controls: [
      { kind: "custom", id: "fontSize", render: (context) => <EngineSizeField context={context} path={["fontSize"]} label="Font size" units={FONT_UNITS} testId="engine-style-font-size" /> },
      { kind: "select", label: "Font weight", path: ["fontWeight"], options: WEIGHTS.map((weight) => ({ value: String(weight), label: weight === 400 ? "400 Regular" : weight === 700 ? "700 Bold" : String(weight) })), numeric: true },
      { kind: "size", label: "Line height", path: ["lineHeight"], units: LINE_HEIGHT_UNITS, min: 0 },
      {
        kind: "choice",
        label: "Align",
        path: ["textAlign"],
        options: [
          { value: "left", label: "Left", icon: "AlignLeft" },
          { value: "center", label: "Centre", icon: "AlignCenter" },
          { value: "right", label: "Right", icon: "AlignRight" },
          { value: "justify", label: "Justify", icon: "AlignJustify" },
        ],
      },
      { kind: "color", label: "Colour", path: ["color"] },
    ],
  },
  { kind: "group", label: "Background", controls: [{ kind: "color", label: "Background", path: ["backgroundColor"] }] },
  {
    kind: "group",
    label: "Border",
    open: false,
    controls: [
      { kind: "size", label: "Width", path: ["borderWidth"], units: ["px"], min: 0 },
      { kind: "color", label: "Colour", path: ["borderColor"] },
      { kind: "size", label: "Radius", path: ["borderRadius"], units: ["px", "%", "em", "rem"], min: 0 },
    ],
  },
  {
    kind: "group",
    label: "Layout",
    open: false,
    controls: [
      { kind: "size", label: "Width", path: ["width"], units: WIDTH_UNITS, min: 0 },
      { kind: "size", label: "Gap", path: ["gap"], units: SPACING_UNITS, min: 0 },
      {
        kind: "select",
        label: "Display",
        path: ["display"],
        options: [
          { value: "block", label: "Block" },
          { value: "flex", label: "Flex" },
          { value: "grid", label: "Grid" },
          { value: "inline-block", label: "Inline block" },
          { value: "inline", label: "Inline" },
          { value: "inline-flex", label: "Inline flex" },
          { value: "none", label: "None (hidden)" },
        ],
      },
    ],
  },
];

const px = (value: number | undefined): Size | undefined => (value === undefined ? undefined : { value, unit: "px" });

/** The four sides of padding or margin from the computed style, in pixels. */
function sidesOf(computed: Record<string, string>, property: "padding" | "margin"): Sides<Size> | undefined {
  const top = pxOf(computed[`${property}Top`]);
  const right = pxOf(computed[`${property}Right`]);
  const bottom = pxOf(computed[`${property}Bottom`]);
  const left = pxOf(computed[`${property}Left`]);
  if (top === undefined && right === undefined && bottom === undefined && left === undefined) return undefined;
  return { top: px(top ?? 0), right: px(right ?? 0), bottom: px(bottom ?? 0), left: px(left ?? 0) };
}

const SIDES = ["top", "right", "bottom", "left"] as const;
type Side = (typeof SIDES)[number];
const isSide = (value: string | undefined): value is Side => (SIDES as readonly string[]).includes(value ?? "");

/** The value a control shows, derived from the computed style of the selected element. */
export function readStyle(computed: Record<string, string> | null, path: Path): unknown {
  if (!computed) return undefined;
  const key = path[0] ?? "";
  switch (key) {
    case "padding":
    case "margin": {
      const side = path[1];
      if (isSide(side)) return px(pxOf(computed[`${key}${side[0]?.toUpperCase()}${side.slice(1)}`]));
      return sidesOf(computed, key);
    }
    case "fontSize":
    case "width":
      return px(pxOf(computed[key]));
    case "lineHeight":
    case "gap":
    case "borderWidth":
      return px(pxOf(computed[key]));
    case "borderRadius":
      return px(pxOf(computed.borderRadius?.split(" ")[0]));
    case "fontWeight": {
      const raw = computed.fontWeight ?? "";
      if (raw === "bold") return 700;
      if (raw === "normal") return 400;
      const number = Number.parseInt(raw, 10);
      return Number.isFinite(number) ? number : undefined;
    }
    case "textAlign": {
      const raw = computed.textAlign;
      return raw === "start" ? "left" : raw === "end" ? "right" : raw || undefined;
    }
    case "color":
    case "backgroundColor":
    case "borderColor":
      return colorToHex(computed[key]);
    case "display":
      return computed.display || undefined;
    default:
      return undefined;
  }
}

const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/**
 * CSS declarations for a value written by a control, or null when there is nothing to
 * write (a cleared control: the engine has no "remove this declaration" op yet).
 */
export function toDeclarations(path: Path, value: unknown, kit: SiteKit): Declarations | null {
  const key = path[0] ?? "";
  if (value === undefined || value === null) return null;
  switch (key) {
    case "padding":
    case "margin": {
      const side = path[1];
      if (isSide(side)) {
        const css = sizeToCss(value as Size);
        return css === undefined ? null : { [`${key}-${side}`]: css };
      }
      const sides = value as Sides<Size>;
      const out: Declarations = {};
      for (const side of ["top", "right", "bottom", "left"] as const) {
        const css = sizeToCss(sides[side]);
        if (css !== undefined) out[`${key}-${side}`] = css;
      }
      return Object.keys(out).length ? out : null;
    }
    case "fontSize":
    case "lineHeight":
    case "borderWidth":
    case "borderRadius":
    case "width":
    case "gap": {
      const css = sizeToCss(value as Size);
      return css === undefined ? null : { [kebab(key)]: css };
    }
    case "fontWeight":
      return { "font-weight": String(value) };
    case "textAlign":
    case "display":
      return typeof value === "string" && value ? { [kebab(key)]: value } : null;
    case "color":
    case "backgroundColor":
    case "borderColor": {
      const literal = typeof value === "string" ? (resolveKitColor(kit, value) ?? value) : "";
      return literal ? { [kebab(key)]: literal } : null;
    }
    default:
      return null;
  }
}
