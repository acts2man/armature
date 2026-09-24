/**
 * Widget registration is explicit. Importing the kit registers nothing; `createArmatureKit`
 * registers every built-in widget, the widget library's base CSS, its per-widget CSS and
 * (with the widgets that draw them) its glyphs. That is what keeps them in a production
 * build of a site whose package.json says `"sideEffects": false`: a bundler drops a module
 * imported only for its side effects, but never a table the kit's own code reads.
 *
 * The demo site's every-widget page (examples/demo-site/src/every-widget.json) must carry
 * one valid element of every built-in type, so tests/e2e/production-build.spec.ts can prove
 * in a browser that each one renders from a production build.
 *
 * The first test relies on running first in this file (vitest runs a file's tests in order
 * and gives each file its own module registry).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import everyWidget from "../../examples/demo-site/src/every-widget.json";
import { pageCss } from "../../kit/css.ts";
import { defaultSiteKit } from "../../kit/defaults.ts";
import { ArmaturePage, BUILT_IN_WIDGET_TYPES, createArmatureKit, registerBuiltInWidgets, registeredWidgetTypes } from "../../kit/index.ts";
import type { Element, LayoutDoc } from "../../kit/types.ts";
import { PROPS_CHECKS, checkLayout } from "../../kit/validate.ts";
import { getWidget, registerWidget, registerWidgets } from "../../kit/widgets.tsx";

const layout = everyWidget as unknown as LayoutDoc;
const flatten = (elements: Element[]): Element[] => elements.flatMap((element) => [element, ...flatten(element.children ?? [])]);
const elements = flatten(layout.root);
const sorted = (types: readonly string[]) => [...types].sort();
const kit = () => createArmatureKit({ allowedOrigins: [], schema: { armatureContract: "1.1", pages: [] } as never, content: {}, layouts: [layout] });

describe("widget registration is explicit", () => {
  it("registers nothing at import and everything when the kit is created", () => {
    expect(registeredWidgetTypes()).toEqual([]);
    expect(pageCss(layout, defaultSiteKit())).not.toContain(".ae-panel-toggle");
    kit();
    expect(sorted(registeredWidgetTypes())).toEqual(sorted(BUILT_IN_WIDGET_TYPES));
    const css = pageCss(layout, defaultSiteKit());
    // The library's base CSS and a per-widget CSS hook (the icon's size) are in.
    expect(css).toContain(".ae-panel-toggle");
    expect(css).toMatch(/ae-ewicon01[^}]*font-size:\s*48px/);
  });

  it("registers once: a second kit adds no CSS twice and a widget the site registered stays", () => {
    const before = pageCss(layout, defaultSiteKit());
    const heading = getWidget("heading");
    registerWidget("hologram", () => null);
    kit();
    registerBuiltInWidgets();
    expect(pageCss(layout, defaultSiteKit())).toBe(before);
    expect(getWidget("heading")).toBe(heading);
    expect(registeredWidgetTypes()).toContain("hologram");
    // A table never overwrites a renderer already in place; registerWidget does.
    registerWidgets({ heading: () => null });
    expect(getWidget("heading")).toBe(heading);
  });

  it("ships exactly the widgets the validator knows", () => {
    const known = Object.keys(PROPS_CHECKS).filter((type) => type !== "site-section");
    expect(sorted(BUILT_IN_WIDGET_TYPES)).toEqual(sorted(known));
  });
});

describe("the demo site's every-widget page", () => {
  it("carries one valid element of every built-in widget, each with its own id", () => {
    expect(sorted(elements.map((element) => element.type))).toEqual(sorted(BUILT_IN_WIDGET_TYPES));
    expect(new Set(elements.map((element) => element.id)).size).toBe(elements.length);
    const report = checkLayout(everyWidget);
    expect(report.problems).toEqual([]);
    expect(report.value?.pageSlug).toBe("every-widget");
  });

  it("renders every element through the kit, none skipped, glyphs included", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    kit();
    const html = renderToStaticMarkup(createElement(ArmaturePage, { slug: "every-widget", layout }));
    for (const element of elements) expect(html, element.type).toContain(`data-ae-id="${element.id}"`);
    expect(html).not.toContain("ae-unsupported");
    // The accordion draws its plus/minus glyph and the icon list its check: both from library/glyphs.ts.
    expect(html).toContain('d="M5 12h14"');
    expect(html).toContain('d="M20 6 9 17l-5-5"');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
