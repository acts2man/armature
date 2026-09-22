import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase.ts", () => ({ supabase: {} }));
import { defaultSiteKit, type LayoutDoc } from "@shared/builder/index.ts";
import type { Publish } from "@/lib/types.ts";
import { emptyDraft } from "@/visual/draftStore.ts";
import { groupRevisions, restoreRevision } from "./revisions.ts";
import { newerDraft } from "./serverDrafts.ts";
import type { StoredEditorDraft } from "./persistence.ts";

const row = (id: string, sha: string | null, page: string, at: string, status: Publish["status"] = "committed"): Publish => ({ id, site_id: "s", user_id: "u", page_slug: page, fields_changed: [], commit_sha: sha, commit_url: null, status, error: null, created_at: at });
const layout = (slug: string, text: string): LayoutDoc => ({ version: 1, pageSlug: slug, path: slug === "home" ? "/" : `/${slug}/`, root: [{ id: "hdhdhdhd", type: "heading", props: { text, tag: "h2" }, style: {}, advanced: {}, meta: { createdBy: "t", updatedAt: "x" } }] }) as LayoutDoc;

describe("revisions", () => {
  it("groups a batch publish into one version, newest first, and skips failures", () => {
    const versions = groupRevisions([row("1", "aaa1111", "home", "2026-09-01T00:00:00Z"), row("2", "aaa1111", "about", "2026-09-01T00:00:00Z"), row("3", "bbb2222", "home", "2026-09-05T00:00:00Z"), row("4", null, "home", "2026-09-06T00:00:00Z", "failed")]);
    expect(versions.map((version) => [version.sha, version.pages])).toEqual([["bbb2222", ["home"]], ["aaa1111", ["home", "about"]]]);
  });

  it("restores a version as a draft relative to what is published", () => {
    const published = { home: { hero: { title: "Now", intro: "Same" } } };
    const baseline = { layouts: { home: layout("home", "Now"), added: layout("added", "Since then") }, kit: defaultSiteKit() };
    const current = { content: emptyDraft(), builder: { layouts: baseline.layouts, deletedPages: [], kit: baseline.kit, media: { "/a.webp": { alt: "A" } } } };
    const restored = restoreRevision({ sha: "aaa1111", content: { home: { hero: { title: "Then", intro: "Same" } } }, layouts: { home: layout("home", "Then") }, kit: null }, current, published, baseline);
    expect(restored.content.fields).toEqual({ "home.hero.title": "Then" });
    expect(restored.builder.layouts["home"]?.root[0]?.props["text"]).toBe("Then");
    expect(restored.builder.deletedPages).toEqual(["added"]);
    expect(restored.builder.media).toEqual({ "/a.webp": { alt: "A" } });
  });
});

describe("drafts saved to the account", () => {
  const draft = (savedAt: string): StoredEditorDraft => ({ version: 2, savedAt, content: emptyDraft(), layouts: {} });
  it("offers the newer of the browser's and the account's draft", () => {
    expect(newerDraft(null, null)).toBeNull();
    expect(newerDraft(draft("2026-09-01T00:00:00Z"), null)?.source).toBe("browser");
    expect(newerDraft(null, draft("2026-09-01T00:00:00Z"))?.source).toBe("account");
    expect(newerDraft(draft("2026-09-01T00:00:00Z"), draft("2026-09-02T00:00:00Z"))?.source).toBe("account");
    expect(newerDraft(draft("2026-09-03T00:00:00Z"), draft("2026-09-02T00:00:00Z"))?.source).toBe("browser");
  });
});
