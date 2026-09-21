import { describe, expect, it } from "vitest";
import {
  LIMITS,
  changedFieldsForPage,
  fieldLabel,
  isAllowedImagePath,
  isAllowedLinkTarget,
  validateContentTree,
  validateFieldUpdate,
} from "./contentValidation.ts";
import { cloneContent } from "./contentFile.ts";
import type { SiteSchema } from "./schema.ts";
import exampleSchema from "./example/schema.json";
import exampleContent from "./example/pages.json";

const pages = (exampleSchema as unknown as SiteSchema).pages;
type Tree = Record<string, Record<string, Record<string, unknown>>>;
const content = () => cloneContent(exampleContent) as unknown as Tree;

describe("validateContentTree — the whole-file rules", () => {
  it("accepts the documented example with no errors and no warnings", () => {
    const report = validateContentTree(exampleContent, pages);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.checked).toBe(17);
  });

  it("reports a missing field", () => {
    const tree = content();
    delete tree["home"]!["hero"]!["title"];
    const report = validateContentTree(tree, pages);
    expect(report.errors).toContain("home.hero.title: missing from the content file");
  });

  it("reports a missing page and a missing section", () => {
    const tree = content();
    delete tree["shared"];
    delete tree["home"]!["faq"];
    const report = validateContentTree(tree, pages);
    expect(report.errors).toContain("shared: missing from the content file (or not an object)");
    expect(report.errors).toContain("home.faq: missing section (or not an object)");
  });

  it("reports a link field holding a bare string", () => {
    const tree = content();
    tree["home"]!["hero"]!["cta"] = "/contact/";
    const report = validateContentTree(tree, pages);
    expect(report.errors.join("\n")).toContain(
      'home.hero.cta: expected { label, href } for type "link", got string',
    );
  });

  it("reports a list item missing a declared key, and warns on an undeclared one", () => {
    const tree = content();
    const nav = tree["shared"]!["header"]!["nav"] as Record<string, string>[];
    delete nav[1]!["href"];
    nav[0]!["extra"] = "x";
    const report = validateContentTree(tree, pages);
    expect(report.errors).toContain('shared.header.nav[1]: missing "href"');
    expect(report.warnings).toContain('shared.header.nav[0]: "extra" is not declared in the schema');
  });

  it("reports a text field holding a number", () => {
    const tree = content();
    tree["home"]!["hero"]!["title"] = 42;
    const report = validateContentTree(tree, pages);
    expect(report.errors.join("\n")).toContain(
      'home.hero.title: expected a string for type "text", got number',
    );
  });

  it("warns about content the schema does not declare", () => {
    const tree = content();
    tree["home"]!["hero"]!["legacy"] = "old";
    const report = validateContentTree(tree, pages);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toContain(
      "home.hero.legacy: present in the content file but not declared in the schema",
    );
  });

  it("rejects a non-object content file", () => {
    expect(validateContentTree("nope", pages).errors.length).toBeGreaterThan(0);
    expect(validateContentTree(null, pages).errors.length).toBeGreaterThan(0);
  });
});

describe("link targets", () => {
  it("allows the safe schemes, site paths and empty", () => {
    for (const value of [
      "",
      "/",
      "/contact/",
      "https://example.com/x",
      "http://example.com",
      "mailto:someone@example.com",
      "tel:+15551234567",
      "MAILTO:Someone@Example.com",
    ]) {
      expect(isAllowedLinkTarget(value)).toBe(true);
    }
  });

  it("rejects javascript:, data:, protocol-relative and bare words", () => {
    for (const value of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "//evil.example.com",
      "ftp://example.com",
      "example.com",
    ]) {
      expect(isAllowedLinkTarget(value)).toBe(false);
    }
  });
});

describe("image paths", () => {
  it("allows /assets/ paths and empty", () => {
    expect(isAllowedImagePath("")).toBe(true);
    expect(isAllowedImagePath("/assets/tree.webp")).toBe(true);
    expect(isAllowedImagePath("/assets/uploads/home-1-x.webp")).toBe(true);
  });

  it("rejects remote URLs and traversal", () => {
    expect(isAllowedImagePath("https://cdn.example.com/x.png")).toBe(false);
    expect(isAllowedImagePath("/uploads/x.png")).toBe(false);
    expect(isAllowedImagePath("/assets/../../etc/passwd")).toBe(false);
  });
});

describe("validateFieldUpdate", () => {
  it("accepts a normal headline change", () => {
    const { errors } = validateFieldUpdate(pages, "home", "hero", "title", "A New Headline");
    expect(errors).toEqual([]);
  });

  it("rejects an unknown field, section and page", () => {
    expect(validateFieldUpdate(pages, "home", "hero", "nope", "x").errors.join()).toContain(
      "not a field declared in the site's schema",
    );
    expect(validateFieldUpdate(pages, "home", "nope", "title", "x").errors.join()).toContain(
      'is not a section of "home"',
    );
    expect(validateFieldUpdate(pages, "nope", "hero", "title", "x").errors.join()).toContain(
      "is not a known page",
    );
  });

  it("rejects the wrong type for a field", () => {
    expect(validateFieldUpdate(pages, "home", "hero", "title", 42).errors.length).toBeGreaterThan(0);
    expect(validateFieldUpdate(pages, "home", "hero", "cta", "/x").errors.length).toBeGreaterThan(0);
    expect(
      validateFieldUpdate(pages, "shared", "header", "nav", "not-a-list").errors.length,
    ).toBeGreaterThan(0);
  });

  it("rejects an unsafe link destination", () => {
    const { errors } = validateFieldUpdate(pages, "home", "hero", "cta", {
      label: "Click",
      href: "javascript:alert(1)",
    });
    expect(errors.join()).toContain("must start with https://");
  });

  it("rejects an unsafe url and video field", () => {
    expect(
      validateFieldUpdate(pages, "home", "seo", "image", "javascript:alert(1)").errors.join(),
    ).toContain("must start with https://");
    expect(
      validateFieldUpdate(pages, "home", "hero", "video", "data:text/html,x").errors.join(),
    ).toContain("must start with https://");
  });

  it("rejects an image that is not under /assets/", () => {
    const { errors } = validateFieldUpdate(
      pages,
      "home",
      "hero",
      "image",
      "https://cdn.example.com/x.png",
    );
    expect(errors.join()).toContain("images must be a path under /assets/");
  });

  it("enforces length limits", () => {
    expect(
      validateFieldUpdate(pages, "home", "hero", "title", "x".repeat(LIMITS.text + 1)).errors.join(),
    ).toContain("too long");
    expect(
      validateFieldUpdate(pages, "home", "hero", "title", "x".repeat(LIMITS.text)).errors,
    ).toEqual([]);
    expect(
      validateFieldUpdate(pages, "home", "hero", "body", "x".repeat(LIMITS.textarea + 1)).errors.join(),
    ).toContain("too long");
  });

  it("rejects an undeclared key inside a list item", () => {
    const { errors } = validateFieldUpdate(pages, "shared", "header", "nav", [
      { label: "Home", href: "/", sneaky: "x" },
    ]);
    expect(errors.join()).toContain("unknown fields are not accepted");
  });

  it("validates item field types inside a list", () => {
    const { errors } = validateFieldUpdate(pages, "shared", "header", "nav", [
      { label: "Home", href: "javascript:alert(1)" },
    ]);
    expect(errors.join()).toContain("must start with https://");
  });

  it("rejects too many list items", () => {
    const many = Array.from({ length: LIMITS.listItems + 1 }, () => ({ label: "a", href: "/" }));
    expect(validateFieldUpdate(pages, "shared", "header", "nav", many).errors.join()).toContain(
      "too many items",
    );
  });

  it("accepts every field of the example content unchanged", () => {
    const tree = exampleContent as unknown as Tree;
    const problems: string[] = [];
    for (const [slug, sections] of Object.entries(tree)) {
      for (const [sectionKey, fields] of Object.entries(sections)) {
        for (const [fieldKey, value] of Object.entries(fields)) {
          const { errors } = validateFieldUpdate(pages, slug, sectionKey, fieldKey, value);
          problems.push(...errors);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("changedFieldsForPage / fieldLabel", () => {
  it("finds nothing when the trees match", () => {
    expect([...changedFieldsForPage(pages, "home", exampleContent, cloneContent(exampleContent))]).toEqual([]);
  });

  it("finds the one field that differs", () => {
    const after = content();
    after["home"]!["hero"]!["title"] = "Different";
    expect([...changedFieldsForPage(pages, "home", exampleContent, after)]).toEqual(["hero.title"]);
  });

  it("ignores changes on other pages", () => {
    const after = content();
    after["shared"]!["footer"]!["copyright"] = "Different";
    expect([...changedFieldsForPage(pages, "home", exampleContent, after)]).toEqual([]);
  });

  it("labels a field for humans, and falls back to the key", () => {
    expect(fieldLabel(pages, "home", "hero", "title")).toBe("Hero → Headline");
    expect(fieldLabel(pages, "home", "hero", "nope")).toBe("hero.nope");
  });
});
