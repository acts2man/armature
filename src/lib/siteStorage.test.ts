/**
 * Pure helpers around the site-files Supabase Storage bucket.
 */
import { describe, expect, it } from "vitest";
import { safeFileName, storagePath } from "./siteStorage.ts";

describe("safeFileName", () => {
  it("keeps the extension, lowercases the stem and replaces junk with dashes", () => {
    expect(safeFileName("My Vacation Photo.PNG")).toBe("my-vacation-photo.png");
    expect(safeFileName(" Über cool!!.WebP")).toBe("u-ber-cool-.webp");
  });
  it("falls back when a file has no useful characters", () => {
    expect(safeFileName("   ")).toMatch(/^file-\d+$/);
  });
});

describe("storagePath", () => {
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const S = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  it("puts the file under <agency>/<site>/<folder>/<file>", () => {
    expect(storagePath(A, S, "images", "hero.png")).toBe(`${A}/${S}/images/hero.png`);
  });
  it("falls back to the default folder when one is empty", () => {
    expect(storagePath(A, S, "", "hero.png")).toBe(`${A}/${S}/uploads/hero.png`);
  });
  it("keeps only safe folder characters", () => {
    expect(storagePath(A, S, "../evil", "x.png")).toBe(`${A}/${S}/evil/x.png`);
  });
});
