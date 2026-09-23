/**
 * The inspector's specs against the shared schema: every control, for every core widget,
 * in the normal and hover states and on each device, writes a value the publish step
 * accepts. Also the kit font list and the Google Fonts stylesheet it produces.
 */
import { describe, expect, it } from "vitest";
import { defaultSiteKit, setAt, validateElement, validateSiteKit, type Element, type SiteKit } from "@shared/builder/index.ts";
import { googleFontsHref } from "@kit/values.ts";
import { withKitFont } from "../fonts.ts";
import { setPath } from "../store.ts";
import { widgetDefinition, widgetDefinitions } from "../widgets/registry.ts";
import "../widgets/library.ts";
import { advancedSpecs, contentSpecsFor, styleSpecs } from "./specs.ts";
import type { ControlSpec, Path } from "./types.ts";
import { readAt } from "./path.ts";

const ALL = widgetDefinitions().map((definition) => definition.type);

/** Every leaf control, with groups and conditional blocks opened up. */
function leaves(specs: ControlSpec[]): ControlSpec[] {
  return specs.flatMap((spec) => (spec.kind === "group" || spec.kind === "if" ? leaves(spec.controls) : [spec]));
}

const size = (units: string[] | undefined) => ({ value: 12, unit: (units?.[0] ?? "px") as "px" });
const sides = (units: string[] | undefined) => ({ top: size(units), right: size(units), bottom: size(units), left: size(units) });

/** A plausible value for a control, and the extra writes a composite control makes. */
function sample(spec: ControlSpec): [Path, unknown][] {
  switch (spec.kind) {
    case "text": {
      const last = spec.path[spec.path.length - 1] ?? "";
      const value = last === "href" || last === "redirect" ? "/contact/" : last === "url" ? "https://www.youtube.com/watch?v=dQw4w9WgXcQ" : last === "date" ? "2030-01-01T10:00" : last === "poster" ? "/assets/cover.webp" : last === "name" ? "full_name" : "Words";
      return [[spec.path, value]];
    }
    case "items": {
      // One row, built from the row's own controls.
      let row: Record<string, unknown> = { id: "row00001", ...spec.create() };
      for (const field of leaves(spec.fields)) for (const [path, value] of sample(field)) row = setPath(row, path, value);
      return [[spec.path, [row]]];
    }
    case "lines":
      return [[spec.path, ["One", "Two"]]];
    case "select":
      return [[spec.path, spec.numeric ? Number(spec.options[0]?.value) : spec.options[0]?.value]];
    case "choice":
      return [[spec.path, spec.numeric ? Number(spec.options[0]?.value) : spec.options[0]?.value]];
    case "toggle":
      return [[spec.path, true]];
    case "number":
      return [[spec.path, spec.min !== undefined && spec.min > 0 ? spec.min : 1]];
    case "size":
      return [[spec.path, size(spec.units)]];
    case "sides":
      return [[spec.path, sides(spec.units)]];
    case "corners":
      return [[spec.path, { topLeft: size(spec.units), topRight: size(spec.units), bottomRight: size(spec.units), bottomLeft: size(spec.units) }]];
    case "gap":
      return [[spec.path, { column: size(["px"]), row: size(["px"]) }]];
    case "color":
      return [[spec.path, "kit:color.primary"]];
    case "font":
      return [[spec.path, "Fraunces"]];
    case "link":
      return [[spec.path, { href: "https://example.com", newTab: true }]];
    case "image":
      return [[[...spec.path, "src"], "/assets/photo.webp"], [[...spec.path, "alt"], "A photo"]];
    case "icon":
      return [[spec.path, { name: "star", nodes: [["path", { d: "M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" }]] }]];
    case "shadow":
      return [[spec.path, { x: 0, y: 4, blur: 12, color: "#00000033" }]];
    case "stroke":
      return [[spec.path, { width: 1, color: "kit:color.text" }]];
    case "background":
      return [[spec.path, { kind: "gradient", type: "linear", angle: 90, stops: [{ color: "kit:color.primary", position: 0 }, { color: "#ffffff", position: 100 }] }]];
    case "overlay":
      return [[spec.path, { background: { kind: "color", color: "#000000" }, opacity: 0.4, blend: "multiply" }]];
    case "typography":
      return [
        [[...spec.path, "preset"], "kit:type.h3"],
        [[...spec.path, "fontFamily"], "kit:font.heading"],
        [[...spec.path, "fontSize"], { value: 30, unit: "px" }],
        [[...spec.path, "fontWeight"], 700],
        [[...spec.path, "lineHeight"], { value: 1.2, unit: "" }],
        [[...spec.path, "textAlign"], "center"],
      ];
    case "border":
      return [
        [[...spec.path, "style"], "dashed"],
        [[...spec.path, "width"], sides(["px"])],
        [[...spec.path, "color"], "#cccccc"],
        [[...spec.path, "radius"], { topLeft: size(["px"]), topRight: size(["px"]), bottomRight: size(["px"]), bottomLeft: size(["px"]) }],
      ];
    case "attributes":
      return [[spec.path, [{ name: "data-track", value: "hero" }]]];
    case "css":
      return [[spec.path, "selector { color: red }"]];
    default:
      return [];
  }
}

const RESPONSIVE_KINDS = new Set(["select", "choice", "toggle", "number", "size", "sides", "corners", "gap", "color", "shadow", "stroke", "background"]);
const isResponsive = (spec: ControlSpec) => RESPONSIVE_KINDS.has(spec.kind) && "responsive" in spec && !!spec.responsive;

function applyAll(element: Element, specs: ControlSpec[], device: "desktop" | "tablet" | "mobile"): Element {
  let next = element;
  for (const spec of leaves(specs)) {
    for (const [path, value] of sample(spec)) {
      // A responsive control writes the device's own value into the { desktop, tablet?, mobile? } wrapper.
      const stored = isResponsive(spec) ? setAt(readAt(next, path) as never, device, value as never) : value;
      next = setPath(next, path, stored);
    }
  }
  return next;
}

describe("inspector specs write values the schema accepts", () => {
  it("covers the whole library", () => {
    expect(ALL.length).toBeGreaterThanOrEqual(32);
    for (const type of ALL) expect(contentSpecsFor(type), `${type} has a Content tab`).toBeTruthy();
  });
  for (const type of ALL) {
    it(`${type}: content, style (normal and hover), advanced, on every device`, () => {
      const created = widgetDefinition(type)?.create();
      expect(created, `${type} is registered`).toBeTruthy();
      let element = created as Element;
      for (const device of ["desktop", "tablet", "mobile"] as const) {
        element = applyAll(element, contentSpecsFor(type) ?? [], device);
        element = applyAll(element, styleSpecs(type, "normal"), device);
        element = applyAll(element, styleSpecs(type, "hover"), device);
        element = applyAll(element, advancedSpecs("container"), device);
        element = applyAll(element, advancedSpecs("grid"), device);
      }
      const report = validateElement(element, type);
      expect(report.errors).toEqual([]);
      // Responsive values landed per device, not flattened.
      expect(element.advanced.margin).toMatchObject({ desktop: expect.any(Object), tablet: expect.any(Object), mobile: expect.any(Object) });
    });
  }

  it("the Style tab offers typography only to widgets that show text", () => {
    const kinds = (type: string) => leaves(styleSpecs(type, "normal")).map((spec) => spec.kind);
    expect(kinds("heading")).toContain("typography");
    expect(kinds("button")).toContain("typography");
    expect(kinds("container")).not.toContain("typography");
    expect(kinds("container")).toContain("overlay");
    expect(kinds("image")).not.toContain("typography");
    expect(leaves(styleSpecs("heading", "hover")).map((spec) => spec.kind)).not.toContain("overlay");
    expect(leaves(styleSpecs("heading", "hover")).some((spec) => "path" in spec && spec.path.join(".") === "style.transition")).toBe(true);
  });

  it("agency-only groups are marked, and the flex and grid groups appear only inside their parent", () => {
    const groups = advancedSpecs(undefined).filter((spec): spec is Extract<ControlSpec, { kind: "group" }> => spec.kind === "group");
    expect(groups.filter((group) => group.agencyOnly).map((group) => group.label)).toEqual(["Attributes", "Custom CSS"]);
    expect(groups.map((group) => group.label)).not.toContain("In its container");
    expect(groups.map((group) => group.label)).not.toContain("In its grid");
    expect(advancedSpecs("container").map((spec) => (spec.kind === "group" ? spec.label : ""))).toContain("In its container");
    const grid = advancedSpecs("grid").map((spec) => (spec.kind === "group" ? spec.label : ""));
    expect(grid).toContain("In its grid");
    expect(grid).not.toContain("In its container");
    expect(leaves(advancedSpecs("grid")).some((spec) => "path" in spec && spec.path.join(".") === "advanced.gridColumnSpan")).toBe(true);
  });

  it("the text widgets get alignment, text stroke and blend mode; the container gets a Structure group", () => {
    const heading = leaves(styleSpecs("heading", "normal"));
    expect(heading.some((spec) => spec.kind === "stroke")).toBe(true);
    expect(heading.some((spec) => spec.kind === "choice" && spec.path.join(".") === "style.typography.textAlign")).toBe(true);
    expect(heading.some((spec) => "path" in spec && spec.path.join(".") === "style.mixBlendMode")).toBe(true);
    expect((contentSpecsFor("container") ?? []).map((spec) => (spec.kind === "group" ? spec.label : ""))).toEqual(["Container", "Items", "Structure", "Additional options"]);
  });
});

describe("kit fonts", () => {
  it("adds a Google font once, ignores system fonts, and builds one stylesheet URL", () => {
    const kit = defaultSiteKit();
    const once = withKitFont(kit, "Fraunces");
    expect(once.fonts.custom).toEqual([{ id: "fraunces", family: "Fraunces", source: "google" }]);
    expect(withKitFont(once, "Fraunces")).toBe(once);
    expect(withKitFont(once, "Georgia")).toBe(once);
    expect(withKitFont(once, "kit:font.heading")).toBe(once);
    const twice = withKitFont(once, "Space Grotesk");
    expect(validateSiteKit(twice).errors).toEqual([]);
    expect(googleFontsHref(twice)).toBe("https://fonts.googleapis.com/css2?family=Fraunces:wght@300;400;500;600;700;800&family=Space+Grotesk:wght@300;400;500;600;700;800&display=swap");
    expect(googleFontsHref(kit)).toBeNull();
  });

  it("never requests a family name with characters outside letters, digits and spaces", () => {
    const kit: SiteKit = { ...defaultSiteKit(), fonts: { heading: "a", body: "b", custom: [{ id: "x", family: 'Evil"&x=<script>', source: "google" }] } };
    expect(googleFontsHref(kit)).toBeNull();
  });
});
