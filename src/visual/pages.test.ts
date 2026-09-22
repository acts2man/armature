import { describe, expect, it } from "vitest";
import exampleSchema from "@shared/example/schema.json";
import type { SiteSchema } from "@shared/schema.ts";
import { editablePages, normalizePath, pageForRoute } from "./pages.ts";

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
