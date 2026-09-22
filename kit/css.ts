/**
 * The CSS generator: one stylesheet per page from the layout tree and the site kit.
 *
 * Every element gets `.ae-root .ae-<id>`; responsive values become media queries using
 * the kit breakpoints (tablet and mobile rules only carry the values set at that
 * device, so inheritance falls out of the cascade); hover values become `:hover` rules;
 * kit values become custom properties on `.ae-root`. Everything is scoped under
 * `.ae-root` so builder CSS and the site's own CSS never fight. Pure module.
 */
import { own, perDevice, resolve } from "./responsive.ts";
import { sanitizeCss } from "./sanitize.ts";
import type {
  Advanced,
  Background,
  BackgroundOverlay,
  ButtonPreset,
  ButtonProps,
  ContainerProps,
  Device,
  DividerProps,
  Element,
  GridProps,
  ImageProps,
  LayoutDoc,
  MaybeResponsive,
  Shadow,
  SiteKit,
  Size,
  SpacerProps,
  StyleBase,
  Typography,
  TypographyPreset,
} from "./types.ts";
import { cornersToCss, cssIdent, cssString, fontFamilyCss, isKitRef, kitRefVar, parseKitRef, refToCss, sizeToCss } from "./values.ts";

export type CssOptions = {
  /** In the editor, hidden elements show at 40% instead of disappearing, and empty containers keep a height. */
  editMode?: boolean;
};

// --- a tiny stylesheet builder -------------------------------------------------------------------

type Decl = [property: string, value: string];
type Bucket = "base" | "tablet" | "mobile" | "desktopOnly" | "tabletOnly" | "reducedMotion";

class Sheet {
  private buckets: Record<Bucket, Map<string, Decl[]>> = { base: new Map(), tablet: new Map(), mobile: new Map(), desktopOnly: new Map(), tabletOnly: new Map(), reducedMotion: new Map() };
  raw: string[] = [];

  add(bucket: Bucket, selector: string, property: string, value: string | undefined): void {
    if (value === undefined || value === "") return;
    const rules = this.buckets[bucket];
    const list = rules.get(selector) ?? [];
    list.push([property, value]);
    rules.set(selector, list);
  }

  /** Add per-device declarations for a responsive value. */
  responsive<T>(selector: string, value: MaybeResponsive<T> | undefined, toDecls: (v: T) => Decl[]): void {
    for (const { device, value: v } of perDevice(value)) {
      for (const [property, css] of toDecls(v)) this.add(bucketFor(device), selector, property, css);
    }
  }

  render(kit: SiteKit): string {
    const out: string[] = [];
    const block = (rules: Map<string, Decl[]>, indent = "") => {
      for (const [selector, decls] of rules) {
        out.push(`${indent}${selector} { ${decls.map(([property, value]) => `${property}: ${value};`).join(" ")} }`);
      }
    };
    block(this.buckets.base);
    if (this.buckets.desktopOnly.size) {
      out.push(`@media (min-width: ${kit.breakpoints.tablet + 1}px) {`);
      block(this.buckets.desktopOnly, "  ");
      out.push("}");
    }
    if (this.buckets.tablet.size) {
      out.push(`@media (max-width: ${kit.breakpoints.tablet}px) {`);
      block(this.buckets.tablet, "  ");
      out.push("}");
    }
    if (this.buckets.tabletOnly.size) {
      out.push(`@media (max-width: ${kit.breakpoints.tablet}px) and (min-width: ${kit.breakpoints.mobile + 1}px) {`);
      block(this.buckets.tabletOnly, "  ");
      out.push("}");
    }
    if (this.buckets.mobile.size) {
      out.push(`@media (max-width: ${kit.breakpoints.mobile}px) {`);
      block(this.buckets.mobile, "  ");
      out.push("}");
    }
    if (this.buckets.reducedMotion.size) {
      out.push("@media (prefers-reduced-motion: reduce) {");
      block(this.buckets.reducedMotion, "  ");
      out.push("}");
    }
    out.push(...this.raw);
    return out.join("\n");
  }
}

const bucketFor = (device: Device): Bucket => (device === "desktop" ? "base" : device);

// --- value helpers -------------------------------------------------------------------------------

const shadowCss = (shadow: Shadow): string => `${shadow.inset ? "inset " : ""}${shadow.x}px ${shadow.y}px ${shadow.blur}px${shadow.spread !== undefined ? ` ${shadow.spread}px` : ""} ${refToCss(shadow.color) ?? "transparent"}`;

const fontCss = (family: string | undefined): string | undefined => {
  if (!family) return undefined;
  return isKitRef(family) ? refToCss(family) : fontFamilyCss(family);
};

export function backgroundDecls(background: Background | undefined): Decl[] {
  if (!background) return [];
  switch (background.kind) {
    case "none":
      return [["background", "none"]];
    case "color":
      return [["background-color", refToCss(background.color) ?? "transparent"], ["background-image", "none"]];
    case "gradient": {
      const stops = background.stops.map((stop) => `${refToCss(stop.color)} ${stop.position}%`).join(", ");
      const image = background.type === "radial" ? `radial-gradient(circle, ${stops})` : `linear-gradient(${background.angle ?? 180}deg, ${stops})`;
      return [["background-image", image]];
    }
    case "image": {
      const decls: Decl[] = [["background-image", `url(${cssString(background.src)})`]];
      const position = background.focal ? `${background.focal.x}% ${background.focal.y}%` : background.position;
      if (position) decls.push(["background-position", position]);
      if (background.attachment) decls.push(["background-attachment", background.attachment]);
      decls.push(["background-repeat", background.repeat ?? "no-repeat"]);
      decls.push(["background-size", background.size ?? "cover"]);
      return decls;
    }
    case "video":
      return background.poster ? [["background-image", `url(${cssString(background.poster)})`], ["background-size", "cover"], ["background-position", "center"]] : [];
  }
}

function typographyDecls(typography: Typography | undefined, device: Device): Decl[] {
  if (!typography) return [];
  const decls: Decl[] = [];
  if (device === "desktop" && typography.preset) {
    const ref = parseKitRef(typography.preset);
    if (ref && ref.group === "type") {
      const prefix = `--ae-type-${cssIdent(ref.name)}`;
      decls.push(["font-family", `var(${prefix}-family)`], ["font-size", `var(${prefix}-size)`], ["font-weight", `var(${prefix}-weight)`], ["line-height", `var(${prefix}-lh)`], ["letter-spacing", `var(${prefix}-ls)`], ["text-transform", `var(${prefix}-tt)`]);
    }
  }
  if (device === "desktop") {
    const family = fontCss(typography.fontFamily);
    if (family) decls.push(["font-family", family]);
  }
  const push = (property: string, value: string | undefined) => value !== undefined && decls.push([property, value]);
  push("font-size", sizeToCss(own(typography.fontSize, device)));
  const weight = own(typography.fontWeight, device);
  if (weight !== undefined) push("font-weight", String(weight));
  push("text-transform", own(typography.textTransform, device));
  push("font-style", own(typography.fontStyle, device));
  push("text-decoration", own(typography.textDecoration, device));
  push("line-height", sizeToCss(own(typography.lineHeight, device)));
  push("letter-spacing", sizeToCss(own(typography.letterSpacing, device)));
  push("word-spacing", sizeToCss(own(typography.wordSpacing, device)));
  push("text-align", own(typography.textAlign, device));
  return decls;
}

/** Style declarations per device (base + overrides), for a normal or hover state. */
function styleDecls(style: StyleBase | undefined): Record<Device, Decl[]> {
  const out: Record<Device, Decl[]> = { desktop: [], tablet: [], mobile: [] };
  if (!style) return out;
  for (const device of ["desktop", "tablet", "mobile"] as Device[]) {
    const decls = out[device];
    decls.push(...typographyDecls(style.typography, device));
    const color = own(style.color, device);
    if (color !== undefined) decls.push(["color", refToCss(color) ?? "inherit"]);
    const textShadow = own(style.textShadow, device);
    if (textShadow) decls.push(["text-shadow", shadowCss(textShadow)]);
    const boxShadow = own(style.boxShadow, device);
    if (boxShadow) decls.push(["box-shadow", shadowCss(boxShadow)]);
    if (style.border) {
      const borderStyle = own(style.border.style, device);
      if (borderStyle) decls.push(["border-style", borderStyle]);
      const width = own(style.border.width, device);
      if (width) {
        for (const side of ["top", "right", "bottom", "left"] as const) {
          const css = sizeToCss(width[side]);
          if (css) decls.push([`border-${side}-width`, css]);
        }
        if (device === "desktop" && !borderStyle && !own(style.border.style, "desktop")) decls.push(["border-style", "solid"]);
      }
      const borderColor = own(style.border.color, device);
      if (borderColor !== undefined) decls.push(["border-color", refToCss(borderColor) ?? "transparent"]);
      const radius = cornersToCss(own(style.border.radius, device));
      if (radius) decls.push(["border-radius", radius]);
    }
    decls.push(...backgroundDecls(own(style.background, device)));
    const opacity = own(style.opacity, device);
    if (opacity !== undefined) decls.push(["opacity", String(opacity)]);
  }
  if (style.transition !== undefined) out.desktop.push(["transition", `all ${style.transition}ms ease`]);
  return out;
}

function overlayDecls(overlay: BackgroundOverlay): Decl[] {
  const decls: Decl[] = [["content", '""'], ["position", "absolute"], ["inset", "0"], ["pointer-events", "none"], ["z-index", "0"], ["border-radius", "inherit"], ["opacity", String(overlay.opacity)]];
  if (overlay.blend) decls.push(["mix-blend-mode", overlay.blend]);
  decls.push(...backgroundDecls(overlay.background));
  return decls;
}

// --- advanced ----------------------------------------------------------------------------------------

function advancedRules(sheet: Sheet, selector: string, advanced: Advanced, kit: SiteKit, options: CssOptions): void {
  const spacing = (property: "margin" | "padding") =>
    sheet.responsive(selector, advanced[property], (sides) => {
      const decls: Decl[] = [];
      for (const side of ["top", "right", "bottom", "left"] as const) {
        const css = sizeToCss(sides[side]);
        if (css) decls.push([`${property}-${side}`, css]);
      }
      return decls;
    });
  spacing("margin");
  spacing("padding");
  sheet.responsive(selector, advanced.width, (mode) => (mode === "full" ? [["width", "100%"]] : mode === "inline" ? [["width", "auto"]] : []));
  sheet.responsive(selector, advanced.customWidth, (size) => [["width", sizeToCss(size) ?? "auto"], ["max-width", "100%"]]);
  sheet.responsive(selector, advanced.maxWidth, (size) => [["max-width", sizeToCss(size) ?? "none"]]);
  sheet.responsive(selector, advanced.alignSelf, (value) => [["align-self", value]]);
  sheet.responsive(selector, advanced.order, (value) => [["order", String(value)]]);
  sheet.responsive(selector, advanced.flexGrow, (value) => [["flex-grow", String(value)]]);
  sheet.responsive(selector, advanced.flexShrink, (value) => [["flex-shrink", String(value)]]);
  if (advanced.position && advanced.position.type !== "default") {
    sheet.add("base", selector, "position", advanced.position.type);
    for (const side of ["top", "right", "bottom", "left"] as const) sheet.responsive(selector, advanced.position[side], (size) => [[side, sizeToCss(size) ?? "auto"]]);
    if (advanced.position.zIndex !== undefined) sheet.add("base", selector, "z-index", String(advanced.position.zIndex));
  }
  if (advanced.animation && advanced.animation.type !== "none") {
    sheet.add("base", `${selector}[data-ae-anim]`, "opacity", "0");
    sheet.add("base", `${selector}.ae-in`, "animation", `ae-${advanced.animation.type} ${advanced.animation.duration ?? 800}ms ${advanced.animation.delay ?? 0}ms both`);
    sheet.add("reducedMotion", `${selector}[data-ae-anim]`, "opacity", "1");
    sheet.add("reducedMotion", `${selector}.ae-in`, "animation", "none");
  }
  if (advanced.hidden) {
    const hide = (bucket: Bucket) => {
      if (options.editMode) {
        sheet.add(bucket, selector, "opacity", "0.4");
        sheet.add(bucket, selector, "outline", "1px dashed rgba(74, 88, 102, 0.6)");
      } else {
        sheet.add(bucket, selector, "display", "none");
      }
    };
    if (advanced.hidden.desktop) hide("desktopOnly");
    if (advanced.hidden.tablet) hide("tabletOnly");
    if (advanced.hidden.mobile) hide("mobile");
  }
  if (advanced.customCss) {
    const css = sanitizeCss(advanced.customCss.replace(/\bselector\b/g, selector));
    if (css) sheet.raw.push(css);
  }
  void kit;
}

// --- widgets ------------------------------------------------------------------------------------------

const gapDecls = (gap: { column?: Size; row?: Size }): Decl[] => {
  const decls: Decl[] = [];
  const column = sizeToCss(gap.column);
  const row = sizeToCss(gap.row);
  if (column) decls.push(["column-gap", column]);
  if (row) decls.push(["row-gap", row]);
  return decls;
};

const minHeightDecls = (value: Size | "screen"): Decl[] => [["min-height", value === "screen" ? "100vh" : (sizeToCss(value) ?? "0")]];

function containerRules(sheet: Sheet, selector: string, props: ContainerProps): void {
  const inner = `${selector} > .ae-con-inner`;
  sheet.responsive(selector, props.minHeight, minHeightDecls);
  if (props.overflow) sheet.add("base", selector, "overflow", props.overflow);
  if ((props.layout ?? "boxed") === "boxed") {
    sheet.add("base", inner, "max-width", "var(--ae-content-width)");
    sheet.responsive(inner, props.contentWidth, (size) => [["max-width", sizeToCss(size) ?? "none"]]);
  } else {
    sheet.add("base", inner, "max-width", "none");
  }
  sheet.responsive(inner, props.direction, (value) => [["flex-direction", value]]);
  sheet.responsive(inner, props.justify, (value) => [["justify-content", value]]);
  sheet.responsive(inner, props.align, (value) => [["align-items", value]]);
  sheet.responsive(inner, props.gap, gapDecls);
  sheet.responsive(inner, props.wrap, (value) => [["flex-wrap", value ? "wrap" : "nowrap"]]);
}

const track = (value: number | string): string => (typeof value === "number" ? `repeat(${value}, minmax(0, 1fr))` : value);

function gridRules(sheet: Sheet, selector: string, props: GridProps): void {
  const inner = `${selector} > .ae-con-inner`;
  sheet.add("base", inner, "display", "grid");
  sheet.responsive(selector, props.minHeight, minHeightDecls);
  if (props.overflow) sheet.add("base", selector, "overflow", props.overflow);
  if ((props.layout ?? "boxed") === "boxed") {
    sheet.add("base", inner, "max-width", "var(--ae-content-width)");
    sheet.responsive(inner, props.contentWidth, (size) => [["max-width", sizeToCss(size) ?? "none"]]);
  } else {
    sheet.add("base", inner, "max-width", "none");
  }
  sheet.responsive(inner, props.columns, (value) => [["grid-template-columns", track(value)]]);
  sheet.responsive(inner, props.rows, (value) => [["grid-template-rows", track(value)]]);
  sheet.responsive(inner, props.gap, gapDecls);
  if (props.autoFlow) sheet.add("base", inner, "grid-auto-flow", props.autoFlow);
  sheet.responsive(inner, props.justifyItems, (value) => [["justify-items", value]]);
  sheet.responsive(inner, props.alignItems, (value) => [["align-items", value]]);
}

function imageRules(sheet: Sheet, selector: string, props: ImageProps): void {
  sheet.responsive(selector, props.align, (value) => [["text-align", value]]);
  const img = `${selector} img`;
  sheet.responsive(img, props.width, (size) => [["width", sizeToCss(size) ?? "auto"], ["max-width", "100%"]]);
  sheet.responsive(img, props.height, (size) => [["height", sizeToCss(size) ?? "auto"]]);
  if (props.fit) sheet.add("base", img, "object-fit", props.fit);
  if (props.focal) sheet.add("base", img, "object-position", `${props.focal.x}% ${props.focal.y}%`);
}

const BUTTON_SCALE: Record<NonNullable<ButtonProps["size"]>, number> = { sm: 0.8, md: 1, lg: 1.2, xl: 1.4 };

function buttonRules(sheet: Sheet, selector: string, props: ButtonProps, kit: SiteKit): void {
  sheet.responsive(selector, props.align, (value) => (value === "justify" ? [["text-align", "left"]] : [["text-align", value]]));
  if (resolve(props.align, "desktop") === "justify") sheet.add("base", `${selector} .ae-btn`, "width", "100%");
  const scale = BUTTON_SCALE[props.size ?? "md"];
  if (scale !== 1) {
    const ref = parseKitRef(props.preset ?? "kit:button.primary");
    const preset = ref && ref.group === "button" ? kit.buttons[ref.name as keyof SiteKit["buttons"]] : undefined;
    const padding = preset?.padding;
    sheet.add("base", `${selector} .ae-btn`, "font-size", `${(1 * scale).toFixed(2)}em`);
    if (padding) {
      sheet.add(
        "base",
        `${selector} .ae-btn`,
        "padding",
        (["top", "right", "bottom", "left"] as const).map((side) => `${Math.round((padding[side]?.value ?? 0) * scale)}px`).join(" "),
      );
    }
  }
}

function spacerRules(sheet: Sheet, selector: string, props: SpacerProps): void {
  sheet.responsive(selector, props.height, (size) => [["height", sizeToCss(size) ?? "0"]]);
}

function dividerRules(sheet: Sheet, selector: string, props: DividerProps): void {
  sheet.responsive(selector, props.width, (size) => [["width", sizeToCss(size) ?? "100%"], ["max-width", "100%"]]);
  const align = props.align ?? "center";
  sheet.add("base", selector, "margin-left", align === "left" ? "0" : "auto");
  sheet.add("base", selector, "margin-right", align === "right" ? "0" : "auto");
  const line = `${selector} .ae-divider-line`;
  sheet.add("base", line, "border-top-style", props.style ?? "solid");
  sheet.add("base", line, "border-top-width", sizeToCss(props.weight) ?? "1px");
  sheet.add("base", line, "border-top-color", refToCss(props.color) ?? "currentColor");
}

// --- elements ------------------------------------------------------------------------------------------

export function elementRules(sheet: Sheet, element: Element, kit: SiteKit, options: CssOptions): void {
  const selector = `.ae-root .ae-${cssIdent(element.id)}`;
  const normal = styleDecls(element.style);
  for (const device of ["desktop", "tablet", "mobile"] as Device[]) {
    for (const [property, value] of normal[device]) sheet.add(bucketFor(device), selector, property, value);
  }
  if (element.style.hover) {
    const hover = styleDecls(element.style.hover);
    for (const device of ["desktop", "tablet", "mobile"] as Device[]) {
      for (const [property, value] of hover[device]) sheet.add(bucketFor(device), `${selector}:hover`, property, value);
    }
  }
  sheet.responsive(`${selector}::before`, element.style.backgroundOverlay, overlayDecls);
  if (element.style.backgroundOverlay) {
    sheet.add("base", selector, "position", "relative");
    sheet.add("base", `${selector} > *`, "position", "relative");
    sheet.add("base", `${selector} > *`, "z-index", "1");
  }
  advancedRules(sheet, selector, element.advanced, kit, options);

  switch (element.type) {
    case "container":
      containerRules(sheet, selector, element.props as ContainerProps);
      break;
    case "grid":
      gridRules(sheet, selector, element.props as GridProps);
      break;
    case "image":
      imageRules(sheet, selector, element.props as ImageProps);
      break;
    case "button":
      buttonRules(sheet, selector, element.props as ButtonProps, kit);
      break;
    case "spacer":
      spacerRules(sheet, selector, element.props as SpacerProps);
      break;
    case "divider":
      dividerRules(sheet, selector, element.props as DividerProps);
      break;
    default:
      widgetCssHooks.get(element.type)?.(sheet, selector, element.props, kit);
  }
  for (const child of element.children ?? []) elementRules(sheet, child, kit, options);
}

/** Widgets added later (M5) register their own CSS here. */
export type WidgetCssHook = (sheet: { add: Sheet["add"]; responsive: Sheet["responsive"] }, selector: string, props: Record<string, unknown>, kit: SiteKit) => void;
const widgetCssHooks = new Map<string, WidgetCssHook>();
export function registerWidgetCss(type: string, hook: WidgetCssHook): void {
  widgetCssHooks.set(type, hook);
}

// --- the kit: custom properties, presets and base widget styles -----------------------------------------

function typographyPresetVars(sheet: Sheet, name: string, preset: TypographyPreset): void {
  const prefix = `--ae-type-${cssIdent(name)}`;
  sheet.add("base", ".ae-root", `${prefix}-family`, fontCss(preset.fontFamily) ?? "inherit");
  sheet.responsive(".ae-root", preset.fontSize, (size) => [[`${prefix}-size`, sizeToCss(size) ?? "1rem"]]);
  sheet.add("base", ".ae-root", `${prefix}-weight`, String(preset.fontWeight ?? "normal"));
  sheet.add("base", ".ae-root", `${prefix}-lh`, sizeToCss(preset.lineHeight) ?? "normal");
  sheet.add("base", ".ae-root", `${prefix}-ls`, sizeToCss(preset.letterSpacing) ?? "normal");
  sheet.add("base", ".ae-root", `${prefix}-tt`, preset.textTransform ?? "none");
}

function buttonPresetRules(sheet: Sheet, name: string, preset: ButtonPreset): void {
  const selector = `.ae-root .ae-btn-${cssIdent(name)}`;
  sheet.add("base", selector, "background-color", refToCss(preset.background) ?? "transparent");
  sheet.add("base", selector, "color", refToCss(preset.color) ?? "inherit");
  sheet.add("base", selector, "border-width", sizeToCss(preset.borderWidth) ?? "0");
  sheet.add("base", selector, "border-color", refToCss(preset.borderColor) ?? "transparent");
  sheet.add("base", selector, "border-radius", sizeToCss(preset.radius) ?? "0");
  if (preset.padding) {
    sheet.add("base", selector, "padding", (["top", "right", "bottom", "left"] as const).map((side) => sizeToCss(preset.padding?.[side]) ?? "0").join(" "));
  }
  if (preset.hover) {
    sheet.add("base", `${selector}:hover`, "background-color", refToCss(preset.hover.background));
    sheet.add("base", `${selector}:hover`, "color", refToCss(preset.hover.color));
    sheet.add("base", `${selector}:hover`, "border-color", refToCss(preset.hover.borderColor));
  }
}

const BASE_CSS = `
.ae-root { box-sizing: border-box; }
.ae-root *, .ae-root *::before, .ae-root *::after { box-sizing: border-box; }
.ae-root .ae-el { min-width: 0; }
.ae-root .ae-con { position: relative; display: flex; flex-direction: column; width: 100%; }
.ae-root .ae-con > .ae-con-inner { display: flex; flex-direction: column; flex: 1 1 auto; width: 100%; margin: 0 auto; gap: var(--ae-con-gap); min-width: 0; }
.ae-root > .ae-con { padding: var(--ae-con-padding-top) var(--ae-con-padding-right) var(--ae-con-padding-bottom) var(--ae-con-padding-left); }
.ae-root .ae-con-link { display: block; color: inherit; text-decoration: none; }
.ae-root .ae-heading { margin: 0; }
.ae-root .ae-heading a { color: inherit; text-decoration: none; }
.ae-root .ae-text > :first-child { margin-top: 0; }
.ae-root .ae-text > :last-child { margin-bottom: 0; }
.ae-root .ae-text p { margin: 0 0 1em; }
.ae-root .ae-text a { color: var(--ae-link-color); }
.ae-root .ae-text a:hover { color: var(--ae-link-hover); }
.ae-root .ae-image { margin: 0; }
.ae-root .ae-image img { display: inline-block; max-width: 100%; height: auto; vertical-align: middle; border-radius: var(--ae-image-radius); }
.ae-root .ae-image figcaption { font-size: 0.875em; opacity: 0.8; margin-top: 0.5em; }
.ae-root .ae-btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.5em; border-style: solid; border-width: 0; text-decoration: none; cursor: pointer; line-height: 1; font-family: var(--ae-type-button-family); font-size: var(--ae-type-button-size); font-weight: var(--ae-type-button-weight); letter-spacing: var(--ae-type-button-ls); text-transform: var(--ae-type-button-tt); transition: background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease; }
.ae-root .ae-btn svg { width: 1.15em; height: 1.15em; }
.ae-root .ae-spacer { width: 100%; }
.ae-root .ae-divider { display: flex; align-items: center; gap: 12px; width: 100%; }
.ae-root .ae-divider .ae-divider-line { flex: 1 1 auto; border-top: 1px solid currentColor; }
.ae-root .ae-divider .ae-divider-text { display: inline-flex; align-items: center; gap: 6px; font-size: 0.9em; }
.ae-root .ae-divider .ae-divider-text svg { width: 1.2em; height: 1.2em; }
.ae-root .ae-icon-svg { display: inline-block; width: 1em; height: 1em; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; vertical-align: middle; }
.ae-root .ae-site-section { position: relative; }
[data-armature-mode] .ae-root .ae-con.ae-empty > .ae-con-inner { min-height: 96px; }
@keyframes ae-fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes ae-fadeInUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }
@keyframes ae-fadeInDown { from { opacity: 0; transform: translateY(-24px); } to { opacity: 1; transform: none; } }
@keyframes ae-fadeInLeft { from { opacity: 0; transform: translateX(-24px); } to { opacity: 1; transform: none; } }
@keyframes ae-fadeInRight { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: none; } }
@keyframes ae-zoomIn { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: none; } }
@keyframes ae-slideInUp { from { transform: translateY(100%); } to { transform: none; } }
@keyframes ae-bounceIn { 0% { opacity: 0; transform: scale(0.8); } 60% { opacity: 1; transform: scale(1.04); } 100% { transform: none; } }
`.trim();

/** The kit's custom properties, presets and base widget styles. Same for every page. */
export function kitCss(kit: SiteKit): string {
  const sheet = new Sheet();
  const root = ".ae-root";
  sheet.add("base", root, "--ae-color-primary", refToCss(kit.colors.primary));
  sheet.add("base", root, "--ae-color-secondary", refToCss(kit.colors.secondary));
  sheet.add("base", root, "--ae-color-text", refToCss(kit.colors.text));
  sheet.add("base", root, "--ae-color-accent", refToCss(kit.colors.accent));
  for (const color of kit.colors.custom) sheet.add("base", root, `--ae-color-${cssIdent(color.id)}`, refToCss(color.value));
  sheet.add("base", root, "--ae-font-heading", fontFamilyCss(kit.fonts.heading));
  sheet.add("base", root, "--ae-font-body", fontFamilyCss(kit.fonts.body));
  for (const font of kit.fonts.custom) sheet.add("base", root, `--ae-font-${cssIdent(font.id)}`, fontFamilyCss(font.family));
  sheet.add("base", root, "--ae-content-width", sizeToCss(kit.container.contentWidth) ?? "1140px");
  sheet.add("base", root, "--ae-con-gap", sizeToCss(kit.container.gap) ?? "20px");
  for (const side of ["top", "right", "bottom", "left"] as const) sheet.add("base", root, `--ae-con-padding-${side}`, sizeToCss(kit.container.padding[side]) ?? "0");
  sheet.add("base", root, "--ae-image-radius", sizeToCss(kit.imageRadius) ?? "0");
  sheet.add("base", root, "--ae-link-color", refToCss(kit.links.color));
  sheet.add("base", root, "--ae-link-hover", refToCss(kit.links.hover));
  sheet.add("base", root, "--ae-page-background", refToCss(kit.pageBackground));
  sheet.add("base", root, "--ae-field-bg", refToCss(kit.forms.fieldBackground));
  sheet.add("base", root, "--ae-field-border", refToCss(kit.forms.fieldBorder));
  sheet.add("base", root, "--ae-field-radius", sizeToCss(kit.forms.fieldRadius));
  sheet.add("base", root, "--ae-field-text", refToCss(kit.forms.fieldText));
  for (const [name, preset] of Object.entries(kit.typography)) typographyPresetVars(sheet, name, preset);
  for (const [name, preset] of Object.entries(kit.buttons)) buttonPresetRules(sheet, name, preset);
  return `${BASE_CSS}\n${sheet.render(kit)}`;
}

/** The whole stylesheet for one page: kit, then every element. */
export function pageCss(layout: LayoutDoc, kit: SiteKit, options: CssOptions = {}): string {
  const sheet = new Sheet();
  for (const element of layout.root) elementRules(sheet, element, kit, options);
  const body: string[] = [];
  if (layout.pageSettings?.bodyBackground) body.push(`body { background: ${refToCss(layout.pageSettings.bodyBackground)}; }`);
  return [kitCss(kit), sheet.render(kit), ...body].filter(Boolean).join("\n");
}

/** Only the element rules (for tests and for re-rendering a subtree). */
export function elementsCss(elements: Element[], kit: SiteKit, options: CssOptions = {}): string {
  const sheet = new Sheet();
  for (const element of elements) elementRules(sheet, element, kit, options);
  return sheet.render(kit);
}

export { kitRefVar };
