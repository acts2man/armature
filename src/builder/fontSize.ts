/**
 * The font size an element shows and how the A− / A+ stepper moves it. Pure module: the
 * toolbar and the canvas overlay render it, the tests exercise it directly.
 */
import { resolve, type Device, type Element, type Size, type SiteKit } from "@shared/builder/index.ts";
import { parseKitRef } from "@kit/values.ts";
import { stepForUnit } from "./controls/inputs.tsx";

export type FontSizeInfo = { size: Size; /** Where the size comes from: this element (for this device), its site text style, or the page as rendered. */ source: "own" | "preset" | "page" };

/**
 * The font size an element shows on a device: its own value for that device (or an
 * inherited one), else its linked site text style's, else the size the page computed
 * (reported by the kit), else 16px. Stepping always starts from this.
 */
export function fontSizeOf(element: Element, kit: SiteKit, device: Device, computedPx?: number): FontSizeInfo {
  const own = resolve<Size>(element.style.typography?.fontSize, device);
  if (own && own.unit !== "auto") return { size: own, source: "own" };
  const ref = parseKitRef(element.style.typography?.preset);
  const preset = ref && ref.group === "type" ? kit.typography[ref.name as keyof SiteKit["typography"]] : undefined;
  const fromPreset = preset ? resolve<Size>(preset.fontSize, device) : undefined;
  if (fromPreset && fromPreset.unit !== "auto") return { size: fromPreset, source: "preset" };
  return { size: { value: computedPx && computedPx > 0 ? Math.round(computedPx * 10) / 10 : 16, unit: "px" }, source: "page" };
}

const roundTo = (value: number, step: number) => Number(value.toFixed(step >= 1 ? 0 : 1));

/** One step up or down from a size, by its unit (1px, 0.1em), Shift for 10; never below one step. */
export function stepFontSize(size: Size, direction: 1 | -1, shift: boolean): Size {
  const step = stepForUnit(size.unit);
  return { value: Math.max(step, roundTo(size.value + direction * step * (shift ? 10 : 1), step)), unit: size.unit };
}
