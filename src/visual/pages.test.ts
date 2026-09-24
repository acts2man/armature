import { describe, expect, it } from "vitest";
import exampleSchema from "@shared/example/schema.json";
import type { SiteSchema } from "@shared/schema.ts";
import { chromeNote, chromePartOf, editablePages, normalizePath, pageForRoute } from "./pages.ts";

const schema = exampleSchema as SiteSchema;

describe("routes", () => {
  it("normalises paths", () => {
    expect(normalizePath("/about/")).toBe("/about");
    expect(normalizePath("/About?x=1#y")).toBe("/about");
    expect(normalizePath("")).toBe("/");
    expect(normalizePath("contact")).toBe("/contact");
  });
  it("prefers the real page when it shares a path with the shared page", () => {
    expect(pageForRoute(schema, "/")?.slug).toBe("home");
    expect(pageForRoute(schema, "/nope/")).toBeUndefined();
    expect(editablePages(schema).map((page) => page.slug)).toEqual(["home"]);
  });
});

describe("the note above a coded header or footer field tells the truth", () => {
  const none = { header: false, footer: false };
  it("neither part built: the note every site starts with", () => {
    expect(chromeNote("header", none, true)).toBe("The header and footer are still coded. They become fully editable once converted to builder parts.");
    expect(chromeNote("footer", none, false)).toBe("The header and footer are part of the site's code. Your agency can make them editable.");
    expect(chromeNote("chrome", none, true)).toMatch(/still coded/);
  });
  it("this part built in the editor: the coded one no longer shows, so the person is sent to Appearance", () => {
    expect(chromeNote("header", { header: true, footer: false }, true)).toBe("The header is built in the editor now, so this coded header no longer shows on the site; it stays as the fallback. Edit the live header under Appearance › Header.");
    expect(chromeNote("footer", { header: false, footer: true }, false)).toBe("The footer is built in the editor now, so this coded footer no longer shows on the site. Change the footer under Appearance › Footer.");
  });
  it("the other part built: this one is named as still coded", () => {
    expect(chromeNote("footer", { header: true, footer: false }, true)).toBe("The footer is still coded (the header is built in the editor). It becomes fully editable once converted to a builder part.");
    expect(chromeNote("header", { header: false, footer: true }, false)).toBe("The header is part of the site's code (the footer is built in the editor). Your agency can make it editable.");
  });
  it("names the part a field belongs to", () => {
    expect(chromePartOf(schema, "shared.header.brand")).toBe("header");
    expect(chromePartOf(schema, "shared.footer.copyright")).toBe("footer");
    expect(chromePartOf(schema, "home.hero.title")).toBeNull();
  });
});
