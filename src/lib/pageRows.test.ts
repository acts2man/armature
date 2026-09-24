import { describe, expect, it } from "vitest";
import type { LayoutDoc } from "../../kit/types.ts";
import { checkLayout } from "../../kit/validate.ts";
import type { SiteSchema } from "../../shared/schema.ts";
import { isBuilderLayout, pageRows, publisherName } from "./pageRows.ts";

import demoSchema from "../../examples/demo-site/content/schema.json";
import demoHome from "../../examples/demo-site/content/layouts/home.json";
import demoContact from "../../examples/demo-site/content/layouts/contact.json";
import realSchema from "../../tests/fixtures/treetestprep/schema.json";

const realLayoutModules = import.meta.glob("../../tests/fixtures/treetestprep/layouts/*.json", { eager: true }) as Record<string, { default: unknown }>;
const clean = (raw: unknown): LayoutDoc => {
  const report = checkLayout(raw);
  if (!report.value) throw new Error("fixture does not load");
  return report.value;
};
const realLayouts: Record<string, LayoutDoc> = Object.fromEntries(Object.values(realLayoutModules).map((module) => clean(module.default)).map((layout) => [layout.pageSlug, layout]));

const meta = { createdBy: "test", updatedAt: "" };
const section = (key: string, children?: LayoutDoc["root"]): LayoutDoc["root"][number] => ({ id: `sec${key}`.padEnd(8, "0").slice(0, 8), type: "site-section", props: { key }, style: {}, advanced: {}, meta, ...(children ? { children } : {}) });
const heading = (id: string): LayoutDoc["root"][number] => ({ id, type: "heading", props: { text: "Hi" }, style: {}, advanced: {}, meta });
const layout = (pageSlug: string, root: LayoutDoc["root"]): LayoutDoc => ({ version: 1, pageSlug, path: `/${pageSlug}/`, root });

describe("the type of a page", () => {
  it("a layout of bare site sections mirrors the coded page: Coded", () => {
    expect(isBuilderLayout(layout("about", [section("intro"), section("team")]))).toBe(false);
  });
  it("any builder content at the root, an empty page, or a section with inner elements: Builder", () => {
    expect(isBuilderLayout(layout("about", [section("intro"), heading("hdabcdef")]))).toBe(true);
    expect(isBuilderLayout(layout("new", []))).toBe(true);
    expect(isBuilderLayout(layout("about", [section("intro", [heading("hdabcdef")])]))).toBe(true);
  });
  it("the demo site: Home (a builder container between its coded sections) and Contact are Builder, About is Coded", () => {
    const rows = pageRows((demoSchema as SiteSchema).pages, { home: clean(demoHome), contact: clean(demoContact) });
    expect(rows.map((row) => [row.slug, row.builder, row.layoutOnly])).toEqual([
      ["home", true, false],
      ["about", false, false],
      ["contact", true, true],
    ]);
    expect(rows.find((row) => row.slug === "home")?.hasFields).toBe(true);
    expect(rows.find((row) => row.slug === "contact")?.hasFields).toBe(false);
  });
  it("the first real converted site: every page is Builder, none is layout-only, and the header part is not a page", () => {
    const rows = pageRows((realSchema as SiteSchema).pages, { ...realLayouts, _header: layout("_header", [heading("hdheader")]) });
    expect(rows.length).toBe((realSchema as SiteSchema).pages.length - 1);
    expect(rows.every((row) => row.builder && !row.layoutOnly)).toBe(true);
    expect(rows.some((row) => row.slug === "_header")).toBe(false);
  });
  it("a page with no layout file at all is Coded", () => {
    const rows = pageRows((demoSchema as SiteSchema).pages, {});
    expect(rows.map((row) => row.builder)).toEqual([false, false]);
  });
});

describe("who published", () => {
  it("prefers the profile name, then the email's local part, never an id", () => {
    expect(publisherName({ full_name: "Dana Whitfield", email: "dana@agency.example" })).toBe("Dana Whitfield");
    expect(publisherName({ full_name: "  ", email: "dana@agency.example" })).toBe("dana");
    expect(publisherName({ full_name: null, email: null })).toBeNull();
    expect(publisherName(undefined)).toBeNull();
  });
});
