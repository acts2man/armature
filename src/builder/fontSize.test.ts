/** The font size the A− / A+ stepper shows and how it steps: by the element's own value, its site text style, or the page. */
import { describe, expect, it } from "vitest";
import { defaultSiteKit, type Element } from "@shared/builder/index.ts";
import { fontSizeOf, stepFontSize } from "./fontSize.ts";

const kit = { ...defaultSiteKit(), typography: { ...defaultSiteKit().typography, h2: { fontSize: { desktop: { value: 28, unit: "px" as const }, mobile: { value: 24, unit: "px" as const } } } } };
const heading = (style: Element["style"]): Element => ({ id: "hed00001", type: "heading", props: { text: "Hi" }, style, advanced: {}, meta: { createdBy: "t", updatedAt: "t" } });

describe("fontSizeOf", () => {
  it("prefers the element's own size for the device, then its site text style, then the page's computed size", () => {
    expect(fontSizeOf(heading({ typography: { preset: "kit:type.h2", fontSize: { desktop: { value: 40, unit: "px" }, mobile: { value: 30, unit: "px" } } } }), kit, "mobile", 12)).toEqual({ size: { value: 30, unit: "px" }, source: "own" });
    expect(fontSizeOf(heading({ typography: { preset: "kit:type.h2", fontSize: { value: 2, unit: "rem" } } }), kit, "tablet", 12)).toEqual({ size: { value: 2, unit: "rem" }, source: "own" });
    expect(fontSizeOf(heading({ typography: { preset: "kit:type.h2" } }), kit, "mobile", 12)).toEqual({ size: { value: 24, unit: "px" }, source: "preset" });
    expect(fontSizeOf(heading({ typography: { preset: "kit:type.h2" } }), kit, "tablet", 12)).toEqual({ size: { value: 28, unit: "px" }, source: "preset" });
    expect(fontSizeOf(heading({}), kit, "desktop", 17.6)).toEqual({ size: { value: 17.6, unit: "px" }, source: "page" });
    expect(fontSizeOf(heading({}), kit, "desktop")).toEqual({ size: { value: 16, unit: "px" }, source: "page" });
  });
});

describe("stepFontSize", () => {
  it("steps whole pixels and percents, tenths of an em or rem, ten at a time with Shift, never below one step", () => {
    expect(stepFontSize({ value: 24, unit: "px" }, 1, false)).toEqual({ value: 25, unit: "px" });
    expect(stepFontSize({ value: 24, unit: "px" }, 1, true)).toEqual({ value: 34, unit: "px" });
    expect(stepFontSize({ value: 1.5, unit: "rem" }, -1, false)).toEqual({ value: 1.4, unit: "rem" });
    expect(stepFontSize({ value: 1.5, unit: "em" }, 1, true)).toEqual({ value: 2.5, unit: "em" });
    expect(stepFontSize({ value: 1, unit: "px" }, -1, true)).toEqual({ value: 1, unit: "px" });
    expect(stepFontSize({ value: 0.1, unit: "rem" }, -1, false)).toEqual({ value: 0.1, unit: "rem" });
  });
});
