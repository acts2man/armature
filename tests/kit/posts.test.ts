/**
 * Blog helpers in the kit: post validation, filter by date/category/tag, RSS
 * generation. The publish function's write-a-post-index test lives in
 * supabase/functions/_shared/builderPublish.test.ts.
 */
import { describe, expect, it } from "vitest";
import { defaultSiteKit } from "../../kit/defaults.ts";
import { filterPosts } from "../../kit/posts.tsx";
import { rssXml } from "../../kit/rss.ts";
import type { PostIndexEntry, SiteKit } from "../../kit/types.ts";
import { checkPost } from "../../kit/validate.ts";

const meta = { createdBy: "t", updatedAt: "2026-01-01" };
const post = (over: Record<string, unknown> = {}) => ({
  version: 1,
  kind: "post",
  slug: "hello-world",
  path: "/blog/hello-world/",
  settings: { title: "Hello", excerpt: "Just saying hi.", author: "u1", authorName: "Sam", publishedAt: "2026-05-01T09:00:00Z", categories: ["news"], tags: [] },
  root: [{ id: "aaaaaaaa", type: "heading", props: { text: "Hi", tag: "h1" }, style: {}, advanced: {}, meta }],
  ...over,
});

describe("checkPost", () => {
  it("accepts a plain post", () => {
    const report = checkPost(post());
    expect(report.value).toBeTruthy();
    expect(report.problems).toEqual([]);
  });
  it("rejects a file whose kind is not post", () => {
    const report = checkPost(post({ kind: "page" }));
    expect(report.value).toBeNull();
    expect(report.problems[0]?.setting).toContain("Kind");
  });
  it("rejects a slug with invalid characters", () => {
    const report = checkPost(post({ slug: "Hello World" }));
    expect(report.value).toBeNull();
  });
  it("keeps categories and tags as arrays of slugs; drops bad ones", () => {
    const report = checkPost(post({ settings: { title: "T", categories: ["ok", "BAD SLUG", "also-ok"], tags: [] } }));
    expect(report.value?.settings.categories).toEqual(["ok", "also-ok"]);
  });
});

const entry = (over: Partial<PostIndexEntry> = {}): PostIndexEntry => ({
  slug: "a", path: "/blog/a/", title: "A", excerpt: "", coverImage: null, authorName: "", publishedAt: "2026-05-01T00:00:00Z", categories: [], tags: [], ...over,
});

describe("filterPosts", () => {
  const now = () => Date.parse("2026-06-01T00:00:00Z");
  it("hides drafts and scheduled posts", () => {
    const posts = [entry({ slug: "a", publishedAt: "" }), entry({ slug: "b", publishedAt: "2026-05-01T00:00:00Z" }), entry({ slug: "c", publishedAt: "2027-01-01T00:00:00Z" })];
    expect(filterPosts(posts, {}, now).map((p) => p.slug)).toEqual(["b"]);
  });
  it("filters by category and tag", () => {
    const posts = [entry({ slug: "a", categories: ["news"] }), entry({ slug: "b", categories: ["how-to"] }), entry({ slug: "c", tags: ["featured"] })];
    expect(filterPosts(posts, { category: "news" }, now).map((p) => p.slug)).toEqual(["a"]);
    expect(filterPosts(posts, { tag: "featured" }, now).map((p) => p.slug)).toEqual(["c"]);
  });
  it("caps the result at limit", () => {
    const posts = [entry({ slug: "a" }), entry({ slug: "b" }), entry({ slug: "c" })];
    expect(filterPosts(posts, { limit: 2 }, now).length).toBe(2);
  });
});

describe("rssXml", () => {
  const kit: SiteKit = { ...defaultSiteKit(), seo: { siteName: "Acme", siteUrl: "https://acme.example.com", defaultDescription: "News." } };
  it("emits a valid RSS 2.0 feed with items for published posts only", () => {
    const posts = [entry({ slug: "a", title: "First", publishedAt: "2026-05-01T00:00:00Z" }), entry({ slug: "b", title: "Draft", publishedAt: "" })];
    const xml = rssXml(kit, posts);
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain("<title>Acme</title>");
    expect(xml).toContain("<link>https://acme.example.com</link>");
    expect(xml).toContain("<title>First</title>");
    expect(xml).not.toContain("Draft");
    expect(xml).toContain("<link>https://acme.example.com/blog/a/</link>");
    expect(xml).toContain("<atom:link");
  });
  it("escapes ampersands and other XML characters in titles and excerpts", () => {
    const posts = [entry({ title: "A & B", excerpt: "Says <hi>." })];
    const xml = rssXml(kit, posts);
    expect(xml).toContain("A &amp; B");
    expect(xml).toContain("Says &lt;hi&gt;.");
  });
});
