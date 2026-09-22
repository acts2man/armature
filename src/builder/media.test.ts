import { describe, expect, it } from "vitest";
import type { LayoutDoc } from "@shared/builder/index.ts";
import { dataUrlBytes, mediaEntries, mediaUsage, thumbnailUrl } from "./media.ts";

const meta = { createdBy: "t", updatedAt: "2026-09-22" };
const image = (id: string, src: string) => ({ id, type: "image", props: { src, alt: "" }, style: {}, advanced: {}, meta });
const layout = (slug: string, srcs: string[], ogImage?: string): LayoutDoc => ({ version: 1, pageSlug: slug, path: `/${slug}/`, root: srcs.map((src, index) => image(`img0000${index}`, src)), ...(ogImage ? { seo: { ogImage } } : {}) }) as LayoutDoc;
const PIC = "data:image/webp;base64,UklGRg==";

describe("media library bookkeeping", () => {
  it("lists the site's files, then each picture added in the draft once", () => {
    const entries = mediaEntries([{ path: "/assets/a.webp", bytes: 2048, kind: "image", alt: "" }], { home: layout("home", [PIC, PIC, "/assets/a.webp"]), about: layout("about", ["data:text/html;base64,PGI+"]) });
    expect(entries.map((entry) => [entry.name, entry.draft])).toEqual([["a.webp", false], ["New picture 1", true]]);
  });
  it("finds usage in content fields, layouts and sharing pictures", () => {
    const usage = mediaUsage({ about: { intro: { photo: "/assets/a.webp" } } }, { home: layout("home", ["/assets/a.webp?v=2"]), contact: layout("contact", [], "/assets/b.webp") }, (slug) => slug.toUpperCase());
    expect(usage.get("/assets/a.webp")).toEqual(["ABOUT", "HOME"]);
    expect(usage.get("/assets/b.webp")).toEqual(["CONTACT"]);
  });
  it("only makes thumbnails from the site or from picture data", () => {
    expect(thumbnailUrl("/assets/a.webp", "https://example.com/x/")).toBe("https://example.com/assets/a.webp");
    expect(thumbnailUrl("//evil.example/a.png", "https://example.com")).toBeNull();
    expect(thumbnailUrl("/assets/a.webp", null)).toBeNull();
    expect(thumbnailUrl("data:text/html;base64,PGI+", null)).toBeNull();
    expect(thumbnailUrl(PIC, null)).toBe(PIC);
    expect(dataUrlBytes("data:image/png;base64,AAAA")).toBe(3);
  });
});
