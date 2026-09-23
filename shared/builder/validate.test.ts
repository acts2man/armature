/**
 * The validator against real files: the first converted site (tests/fixtures/treetestprep),
 * the demo site, and every way a hand-built site can stray from the model without a page
 * going dark. Also the preserve module: a publish never loses a value the editor could
 * not read.
 */
import { describe, expect, it } from "vitest";
import { defaultSiteKit } from "../../kit/defaults.ts";
import type { Element, LayoutDoc } from "../../kit/types.ts";
import { UNSUPPORTED_TYPE } from "../../kit/types.ts";
import { checkElement, checkLayout, checkSiteKit, describeProblem, settingLabel } from "../../kit/validate.ts";
import { isColorLiteral, parseSize } from "../../kit/values.ts";
import { restoreKitProblems, restoreLayoutProblems, unpreservedProblems } from "./preserve.ts";
import { validateElement, validateLayout, validateSiteKit } from "./schema.ts";

import realKit from "../../tests/fixtures/treetestprep/site-kit.json";

const layoutModules = import.meta.glob("../../tests/fixtures/treetestprep/layouts/*.json", { eager: true }) as Record<string, { default: unknown }>;
const realLayouts: [string, unknown][] = Object.entries(layoutModules).map(([file, module]) => [file.split("/").pop() ?? file, module.default]);

const meta = { createdBy: "test", updatedAt: "2026-09-22T00:00:00.000Z" };
let counter = 0;
/** An element as a file might hold it: any value goes, so the tests can feed the validator what real sites write. */
type Loose = { type: string; id?: string; label?: string; props?: Record<string, unknown>; style?: Record<string, unknown>; advanced?: Record<string, unknown>; children?: unknown[]; locked?: unknown };
const element = (partial: Loose): Element => ({ id: `el${String(++counter).padStart(6, "0")}`, props: {}, style: {}, advanced: {}, meta, ...partial }) as unknown as Element;
const layoutOf = (root: unknown[]): unknown => ({ version: 1, pageSlug: "home", path: "/", root });

describe("the first real converted site (treetestprep) loads cleanly", () => {
  it.each(realLayouts)("%s has no problems and is not rewritten", (_name: string, raw: unknown) => {
    const report = checkLayout(raw);
    expect(report.problems.map((problem) => describeProblem(problem))).toEqual([]);
    expect(report.value).toEqual(raw);
  });
  it("its site kit (font-weight 650) has no problems and is not rewritten", () => {
    const report = checkSiteKit(realKit);
    expect(report.problems).toEqual([]);
    expect(report.value).toEqual(realKit);
    expect(validateSiteKit(realKit).errors).toEqual([]);
  });
  it("the strict checks agree", () => {
    for (const [name, raw] of realLayouts) expect(validateLayout(raw, name).errors).toEqual([]);
  });
});

describe("rules as wide as CSS", () => {
  it("font weight takes any whole number 1–1000 and the keywords", () => {
    for (const weight of [1, 100, 450, 650, 1000, "normal", "bold", "lighter", "bolder", "650"]) {
      const report = checkElement(element({ type: "heading", props: { text: "x" }, style: { typography: { fontWeight: weight } } }));
      expect(report.problems, String(weight)).toEqual([]);
    }
    for (const weight of [0, 1001, 6.5, "heavy", "", null]) {
      const report = checkElement(element({ type: "heading", props: { text: "x" }, style: { typography: { fontWeight: weight } } }));
      expect(report.problems.length, String(weight)).toBe(1);
      expect(report.problems[0]?.allowed).toMatch(/1 to 1000/);
    }
  });
  it("sizes: unitless, negative, decimals, bare zero, vw/vh/rem/ch/dvh, and CSS strings", () => {
    const sizes = [
      { value: 1.4, unit: "" },
      { value: -0.02, unit: "em" },
      { value: 0, unit: "" },
      { value: 0.5, unit: "rem" },
      { value: 100, unit: "vw" },
      { value: 50, unit: "dvh" },
      { value: 2, unit: "ch" },
      { value: 0, unit: "auto" },
      "12px",
      "1.4",
      "-0.02em",
      "auto",
      "0",
      ".5rem",
      0,
    ];
    for (const size of sizes) {
      const report = checkElement(element({ type: "spacer", advanced: { margin: { top: size } } }));
      expect(report.problems, JSON.stringify(size)).toEqual([]);
    }
    expect(parseSize("12px")).toEqual({ value: 12, unit: "px" });
    expect(parseSize("1.4", "")).toEqual({ value: 1.4, unit: "" });
    expect(parseSize("-0.02em")).toEqual({ value: -0.02, unit: "em" });
    expect(parseSize("50vmin")).toEqual({ value: 50, unit: "vmin" });
    expect(parseSize("twelve")).toBeNull();
    const bad = checkElement(element({ type: "spacer", advanced: { margin: { top: { value: 10, unit: "parsecs" } } } }));
    expect(bad.problems[0]?.allowed).toMatch(/12px, 1.25rem/);
  });
  it("colours: every hex length, rgb/rgba/hsl/hsla/hwb/oklch/lab, named, transparent, currentColor, var()", () => {
    const good = ["#fff", "#ffff", "#1f3a2e", "#1f3a2e80", "rgb(0 0 0)", "rgba(0,0,0,0.48)", "hsl(210 40% 50%)", "hsla(210, 40%, 50%, .5)", "hwb(90 10% 10%)", "oklch(62% 0.2 250)", "lab(50% 40 60)", "color-mix(in srgb, #fff 50%, #000)", "white", "RebeccaPurple", "transparent", "currentColor", "inherit", "var(--brand)", "var(--brand, #fff)", "rgb(from var(--x) r g b)"];
    for (const value of good) expect(isColorLiteral(value), value).toBe(true);
    const bad = ["red; background: url(x)", "url(x)", "expression(1)", "rgb(0,0,0", "#12345", "blue}", "rgb(<b>)", ""];
    for (const value of bad) expect(isColorLiteral(value), value).toBe(false);
  });
  it("border styles, alignment keywords, background sizes, container tags and grid templates", () => {
    const ok = [
      element({ type: "container", props: { tag: "main", justify: "start", align: "end" }, style: { border: { style: "groove" }, background: { kind: "image", src: "/assets/x.webp", size: "100% auto", position: "center 37%" } } }),
      element({ type: "grid", props: { columns: "[full-start] minmax(0, 2fr) minmax(315px, 0.96fr) [full-end]" } }),
      element({ type: "heading", props: { text: "x" }, style: { typography: { textAlign: "start" } }, advanced: { cssClasses: "md:grid-cols-2 w-1/2 hover:bg-[#fff] course wrap", order: 500, position: { type: "sticky", top: 0 } } }),
      element({ type: "image", props: { src: "/assets/x.webp", fit: "scale-down" } }),
    ];
    for (const item of ok) expect(checkElement(item).problems.map((problem) => describeProblem(problem)), item.type).toEqual([]);
  });
  it("keeps every rule that protects the page", () => {
    const cases: [Element, RegExp][] = [
      [element({ type: "button", props: { text: "Go", link: { href: "javascript:alert(1)" } } }), /https:\/\//],
      [element({ type: "image", props: { src: "http://evil.example/x.png" } }), /https:\/\//],
      [element({ type: "heading", props: { text: "x" }, style: { color: "red; background: url(x)" } }), /colour/],
      [element({ type: "heading", props: { text: "x" }, advanced: { attributes: [{ name: "onclick", value: "x" }] } }), /attribute/],
      [element({ type: "heading", props: { text: "x" }, advanced: { attributes: [{ name: "href", value: "x" }] } }), /attribute/],
      [element({ type: "heading", props: { text: "x" }, advanced: { cssClasses: "a<b>" } }), /class names/],
      [element({ type: "heading", props: { text: "x" }, advanced: { cssId: "1bad" } }), /CSS id/],
      [element({ type: "text", props: { doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "data:text/html,x" } }] }] }] } } }), /https:\/\//],
      [element({ type: "video", props: { source: "youtube", url: "https://evil.example/embed" } }), /YouTube/],
    ];
    for (const [item, pattern] of cases) {
      const report = checkElement(item);
      expect(report.problems.length, item.type).toBeGreaterThan(0);
      expect(report.problems.map((problem) => problem.allowed).join(" "), item.type).toMatch(pattern);
    }
  });
});

describe("one bad value never takes a page down", () => {
  it("drops an invalid property, keeps the element, and names it in plain English", () => {
    const raw = element({ id: "hmheroh1", type: "heading", label: "Hero title", props: { text: "Pass the exam", tag: "h1" }, style: { color: "kit:color.primary", typography: { fontWeight: "heavy", fontSize: { value: 39, unit: "px" } } }, advanced: { margin: { top: { value: 8, unit: "px" } } } });
    const report = checkLayout(layoutOf([raw]));
    expect(report.value?.root[0]?.style).toEqual({ color: "kit:color.primary", typography: { fontSize: { value: 39, unit: "px" } } });
    expect(report.value?.root[0]?.advanced).toEqual(raw.advanced);
    expect(report.problems).toHaveLength(1);
    const problem = report.problems[0]!;
    expect(problem).toMatchObject({ effect: "ignored", elementId: "hmheroh1", elementLabel: "Hero title", elementType: "heading", relativePath: ["style", "typography", "fontWeight"], value: "heavy", found: '"heavy"', setting: "Style › Typography › Font weight" });
    expect(describeProblem(problem, "Home")).toBe('Home: the "Hero title" heading\'s Style › Typography › Font weight is "heavy", which is not a whole number from 1 to 1000 (100 thin … 400 regular … 650 … 700 bold … 900 black), or normal, bold, lighter or bolder. It is ignored until it is changed, and kept as it is in the file.');
  });
  it("names the deepest setting when a compound value fails, and drops only that value", () => {
    const report = checkElement(element({ type: "container", style: { boxShadow: { x: 0, y: 12, blur: 30, color: "shadowy" }, background: { kind: "color", color: "#f4f5f7" } } }));
    expect(report.value?.style).toEqual({ background: { kind: "color", color: "#f4f5f7" } });
    expect(report.problems[0]).toMatchObject({ setting: "Style › Box shadow › Color", found: '"shadowy"', relativePath: ["style", "boxShadow"] });
    expect(report.problems[0]?.value).toEqual({ x: 0, y: 12, blur: 30, color: "shadowy" });
  });
  it("drops a bad phone override and keeps the desktop value", () => {
    const report = checkElement(element({ type: "heading", props: { text: "x" }, style: { typography: { fontSize: { desktop: { value: 39, unit: "px" }, mobile: "big" } } } }));
    expect(report.value?.style.typography?.fontSize).toEqual({ desktop: { value: 39, unit: "px" } });
    expect(report.problems[0]?.setting).toBe("Style › Typography › Font size › on phone");
  });
  it("drops a bad list item and keeps the rest", () => {
    const report = checkElement(element({ type: "accordion", props: { items: [{ id: "a", title: "A", content: "a" }, { id: "b", title: 5, content: "b" }, { id: "c", title: "C", content: "c" }] } }));
    expect((report.value?.props["items"] as unknown[]).length).toBe(2);
    expect(report.problems[0]).toMatchObject({ relativePath: ["props", "items", 1], setting: "Content › Items › row 2 › Title" });
  });
  it("turns an element it cannot read into an Unsupported placeholder and keeps the raw element", () => {
    const broken = { id: "not an id", type: "heading", props: { text: "Hi" }, style: {}, advanced: {}, meta };
    const noText = element({ id: "abcdefgh", type: "heading", props: { tag: "h1" } });
    const withChildren = element({ id: "hasakids", type: "heading", props: { text: "x" }, children: [element({ type: "spacer" })] });
    const report = checkLayout(layoutOf([broken, noText, withChildren, element({ id: "finefine", type: "spacer" })]));
    expect(report.value?.root.map((item) => item.type)).toEqual([UNSUPPORTED_TYPE, UNSUPPORTED_TYPE, UNSUPPORTED_TYPE, "spacer"]);
    expect(report.value?.root[0]?.id).toMatch(/^[a-z0-9]{8}$/);
    expect(report.value?.root[1]?.id).toBe("abcdefgh");
    expect(report.problems).toHaveLength(3);
    expect(report.problems[0]).toMatchObject({ effect: "element", elementType: "heading", value: broken });
    expect(report.problems[1]?.found).toBe('Content › Text is nothing');
    expect(report.problems[2]?.found).toMatch(/cannot contain/);
    expect(describeProblem(report.problems[0]!, "Home")).toMatch(/could not be read: its element id "not an id".*Unsupported element/);
  });
  it("a duplicate id becomes a placeholder (the first keeps its id)", () => {
    const twin = element({ id: "twintwin", type: "spacer" });
    const report = checkLayout(layoutOf([twin, { ...twin }]));
    expect(report.value?.root[0]?.type).toBe("spacer");
    expect(report.value?.root[1]?.type).toBe(UNSUPPORTED_TYPE);
    expect(report.problems[0]?.found).toMatch(/appears twice/);
  });
  it("only a file that is not a layout at all fails to load", () => {
    expect(checkLayout({ version: 2, pageSlug: "x", path: "/", root: [] }).value).toBeNull();
    expect(checkLayout({ version: 1, pageSlug: "Bad Slug", path: "/", root: [] }).value).toBeNull();
    expect(checkLayout({ version: 1, pageSlug: "x", path: "/", root: "nope" }).value).toBeNull();
    expect(checkLayout("text").problems[0]).toMatchObject({ effect: "file" });
    const seo = checkLayout({ version: 1, pageSlug: "x", path: "/x/", label: 42, seo: { title: "ok", noindex: "yes" }, root: [] });
    expect(seo.value).toMatchObject({ pageSlug: "x", seo: { title: "ok" } });
    expect(seo.value?.label).toBeUndefined();
    expect(seo.problems.map((problem) => problem.setting)).toEqual(["Label", "SEO › Noindex"]);
  });
  it("keeps unknown element types and unknown keys as they are", () => {
    const raw = element({ type: "hologram", props: { anything: true }, style: { future: 1 }, advanced: {} });
    const report = checkElement(raw);
    expect(report.problems).toEqual([]);
    expect(report.value).toEqual(raw);
  });
  it("the site kit always loads: unreadable values fall back to the defaults and are reported", () => {
    const raw = JSON.parse(JSON.stringify(realKit)) as { typography: Record<string, Record<string, unknown>>; colors: Record<string, unknown> };
    raw.typography["h1"]!["fontWeight"] = "heavy";
    raw.colors["primary"] = "navy-ish";
    const report = checkSiteKit(raw);
    expect(report.value?.typography.h1.fontWeight).toBeUndefined();
    expect(report.value?.typography.h1.fontSize).toEqual(raw.typography["h1"]!["fontSize"]);
    expect(report.value?.colors.primary).toBe(defaultSiteKit().colors.primary);
    expect(report.value?.colors.secondary).toBe("#349e49");
    expect(report.problems.map((problem) => problem.setting)).toEqual(["Colors › Primary", "Typography › Heading 1 › Font weight"]);
    expect(report.problems[0]?.filled).toBe(defaultSiteKit().colors.primary);
    expect(checkSiteKit("garbage").value).toEqual(defaultSiteKit());
    expect(checkSiteKit(null).problems[0]?.effect).toBe("file");
    expect(validateSiteKit(raw).errors.length).toBe(2);
  });
  it("the strict checks turn every problem into an error", () => {
    expect(validateElement(element({ type: "heading", props: { text: "x" }, style: { color: "nope" } })).errors.join()).toMatch(/Style › Color/);
    expect(validateLayout(layoutOf([{ id: "bad" }])).errors.join()).toMatch(/element id/);
  });
  it("labels settings for people", () => {
    expect(settingLabel(["style", "typography", "fontWeight", "mobile"])).toBe("Style › Typography › Font weight › on phone");
    expect(settingLabel(["props", "items", 2, "title"])).toBe("Content › Items › row 3 › Title");
    expect(settingLabel(["advanced", "customCss"])).toBe("Advanced › Custom CSS");
    expect(settingLabel(["root", 0, "children", 1, "props", "src"])).toBe("Content › Source");
  });
});

describe("a publish never erases a value the editor could not read", () => {
  const rawHeading = element({ id: "hmheroh1", type: "heading", props: { text: "Hi" }, style: { color: "navy-ish", typography: { fontWeight: 650 } } });
  const rawBroken = { id: "NOPE", type: "heading", props: { text: "Broken" } };
  const rawAccordion = element({ id: "acc00001", type: "accordion", props: { items: [{ id: "a", title: "A", content: "a" }, { id: "b", title: 5, content: "b" }] } });
  const rawLayout = layoutOf([rawHeading, rawBroken, rawAccordion]) as LayoutDoc;

  it("puts dropped settings and unsupported elements back when nothing was touched", () => {
    const report = checkLayout(rawLayout);
    const cleaned = report.value!;
    const restored = restoreLayoutProblems(cleaned, cleaned, report.problems);
    expect(restored).toEqual(rawLayout);
  });
  it("keeps the person's value when they changed that setting, and restores the rest", () => {
    const report = checkLayout(rawLayout);
    const cleaned = report.value!;
    const edited: LayoutDoc = { ...cleaned, root: cleaned.root.map((item) => (item.id === "hmheroh1" ? { ...item, style: { ...item.style, color: "#000000" } } : item)) };
    const restored = restoreLayoutProblems(edited, cleaned, report.problems);
    expect(restored.root[0]?.style.color).toBe("#000000");
    expect(restored.root[1]).toEqual(rawBroken);
    expect((restored.root[2]?.props["items"] as unknown[]).length).toBe(2);
  });
  it("a moved placeholder carries the original element to its new place; a deleted one stays deleted", () => {
    const report = checkLayout(rawLayout);
    const cleaned = report.value!;
    const moved: LayoutDoc = { ...cleaned, root: [cleaned.root[1]!, cleaned.root[0]!] };
    const restored = restoreLayoutProblems(moved, cleaned, report.problems);
    expect(restored.root[0]).toEqual(rawBroken);
    expect(restored.root).toHaveLength(2);
  });
  it("leaves an edited list alone (the dropped item is not put back into a changed list)", () => {
    const report = checkLayout(rawLayout);
    const cleaned = report.value!;
    const edited: LayoutDoc = { ...cleaned, root: cleaned.root.map((item) => (item.id === "acc00001" ? { ...item, props: { items: [{ id: "a", title: "A changed", content: "a" }] } } : item)) };
    const restored = restoreLayoutProblems(edited, cleaned, report.problems);
    expect((restored.root[2]?.props["items"] as unknown[]).length).toBe(1);
  });
  it("restores kit values unless the default that filled them was changed", () => {
    const raw = JSON.parse(JSON.stringify(realKit)) as { typography: Record<string, Record<string, unknown>>; colors: Record<string, unknown> };
    raw.colors["primary"] = "navy-ish";
    raw.typography["h1"]!["fontWeight"] = "heavy";
    const report = checkSiteKit(raw);
    expect(restoreKitProblems(report.value!, report.value!, report.problems)).toEqual(raw);
    const edited = { ...report.value!, colors: { ...report.value!.colors, primary: "#123456" } };
    const restored = restoreKitProblems(edited, report.value!, report.problems);
    expect(restored.colors.primary).toBe("#123456");
    expect((restored.typography.h1 as { fontWeight: unknown }).fontWeight).toBe("heavy");
  });
  it("the publish function tells preserved values from new ones", () => {
    const report = checkLayout(rawLayout);
    expect(unpreservedProblems(report.problems, rawLayout)).toEqual([]);
    const fresh = checkLayout(layoutOf([element({ id: "newnewne", type: "heading", props: { text: "x" }, style: { color: "nope" } })]));
    expect(unpreservedProblems(fresh.problems, rawLayout)).toHaveLength(1);
    expect(unpreservedProblems(report.problems, null)).toHaveLength(3);
  });
});
