import { describe, expect, it } from "vitest";
import { cloneContent } from "./contentFile.ts";
import { validateSiteSchema, type SiteSchema } from "./schema.ts";
import exampleSchema from "./example/schema.json";

const schema = () => cloneContent(exampleSchema) as unknown as Record<string, unknown>;

describe("validateSiteSchema — the site contract", () => {
  it("accepts the documented example with no errors and no warnings", () => {
    const report = validateSiteSchema(exampleSchema);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.schema?.pages.map((page) => page.slug)).toEqual(["shared", "home"]);
  });

  it("requires armatureContract to be the number 1", () => {
    const raw = schema();
    raw["armatureContract"] = "1";
    const report = validateSiteSchema(raw);
    expect(report.errors.join("\n")).toContain('"armatureContract" must be the number 1');
    expect(report.schema).toBeUndefined();
  });

  it("rejects a missing or empty pages array", () => {
    expect(validateSiteSchema({ armatureContract: 1 }).errors.join()).toContain(
      '"pages" must be an array',
    );
    expect(validateSiteSchema({ armatureContract: 1, pages: [] }).errors.join()).toContain(
      "is empty",
    );
  });

  it("rejects duplicate slugs, bad slugs and bad paths", () => {
    const raw = schema();
    const pages = raw["pages"] as Record<string, unknown>[];
    pages[1]!["slug"] = "shared";
    pages.push({ slug: "Bad Slug", label: "x", path: "no-slash", sections: [] });
    const report = validateSiteSchema(raw);
    const text = report.errors.join("\n");
    expect(text).toContain('duplicate slug "shared"');
    expect(text).toContain('"slug" must be lowercase letters, digits and hyphens');
    expect(text).toContain('"path" must be a string starting with "/"');
  });

  it("requires itemFields on lists and forbids them elsewhere", () => {
    const raw = schema();
    const home = (raw["pages"] as Record<string, unknown>[])[1]!;
    const sections = home["sections"] as Record<string, unknown>[];
    const faqFields = sections[1]!["fields"] as Record<string, unknown>[];
    delete faqFields[1]!["itemFields"];
    const heroFields = sections[0]!["fields"] as Record<string, unknown>[];
    heroFields[0]!["itemFields"] = [{ key: "x", label: "X", type: "text" }];
    const report = validateSiteSchema(raw);
    const text = report.errors.join("\n");
    expect(text).toContain('home.faq.items: a list field needs a non-empty "itemFields" array');
    expect(text).toContain('home.hero.title: only list fields may declare "itemFields"');
  });

  it("rejects unknown field and item field types", () => {
    const raw = schema();
    const home = (raw["pages"] as Record<string, unknown>[])[1]!;
    const sections = home["sections"] as Record<string, unknown>[];
    const heroFields = sections[0]!["fields"] as Record<string, unknown>[];
    heroFields[0]!["type"] = "richtext";
    const faqFields = sections[1]!["fields"] as Record<string, unknown>[];
    const itemFields = faqFields[1]!["itemFields"] as Record<string, unknown>[];
    itemFields[0]!["type"] = "link";
    const report = validateSiteSchema(raw);
    const text = report.errors.join("\n");
    expect(text).toContain('home.hero.title: "type" must be one of');
    expect(text).toContain('home.faq.items.itemFields[0]: "type" must be one of');
  });

  it("warns, but does not fail, when there is no shared page", () => {
    const raw = schema();
    raw["pages"] = (raw["pages"] as unknown[]).slice(1);
    const report = validateSiteSchema(raw);
    expect(report.errors).toEqual([]);
    expect(report.warnings.join()).toContain('no "shared" page');
    expect(report.schema).toBeDefined();
  });

  it("rejects duplicate section and field keys", () => {
    const raw = schema();
    const home = (raw["pages"] as Record<string, unknown>[])[1]!;
    const sections = home["sections"] as Record<string, unknown>[];
    sections[1]!["key"] = "hero";
    const heroFields = sections[0]!["fields"] as Record<string, unknown>[];
    heroFields[1]!["key"] = "title";
    const text = validateSiteSchema(raw).errors.join("\n");
    expect(text).toContain('duplicate section key "hero"');
    expect(text).toContain('duplicate field key "title"');
  });

  it("rejects non-object input", () => {
    expect(validateSiteSchema(null).errors.length).toBeGreaterThan(0);
    expect(validateSiteSchema("x").errors.length).toBeGreaterThan(0);
    expect(validateSiteSchema([]).errors.length).toBeGreaterThan(0);
  });

  it("returns a typed schema on success", () => {
    const report = validateSiteSchema(exampleSchema);
    const typed: SiteSchema | undefined = report.schema;
    expect(typed?.armatureContract).toBe(1);
  });
});
