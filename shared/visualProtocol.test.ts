import { describe, expect, it } from "vitest";
import { editUrl, fieldPath, fieldRoot, isBridgeMessage, parseFieldPath } from "./visualProtocol.ts";

describe("field paths", () => {
  it("parses page fields and list item fields", () => {
    expect(parseFieldPath("home.hero.title")).toEqual({ slug: "home", section: "hero", field: "title" });
    expect(parseFieldPath("home.faq.items[2].question")).toEqual({ slug: "home", section: "faq", field: "items", index: 2, itemKey: "question" });
    expect(parseFieldPath("about-us.team_1.name")).toEqual({ slug: "about-us", section: "team_1", field: "name" });
  });

  it("rejects anything else", () => {
    for (const bad of ["", "home", "home.hero", "Home.hero.title", "home.hero.title[a].x", "home.hero.title[1]", "../etc", "home.hero.title.extra"]) {
      expect(parseFieldPath(bad), bad).toBeNull();
    }
  });

  it("builds and roots paths", () => {
    expect(fieldPath("home", "faq", "items", 0, "answer")).toBe("home.faq.items[0].answer");
    expect(fieldRoot("home.faq.items[0].answer")).toBe("home.faq.items");
    expect(fieldRoot("home.hero.title")).toBe("home.hero.title");
  });
});

describe("editUrl", () => {
  it("adds the edit flag to the page path under the live URL", () => {
    expect(editUrl("https://example.com", "/about/")).toBe("https://example.com/about/?armature=edit");
    expect(editUrl("https://example.com/", "/")).toBe("https://example.com/?armature=edit");
    expect(editUrl("http://localhost:5174", "/contact")).toBe("http://localhost:5174/contact?armature=edit");
  });
});

describe("isBridgeMessage", () => {
  it("accepts known types with a nonce and nothing else", () => {
    expect(isBridgeMessage({ type: "armature:ready", nonce: "n" })).toBe(true);
    expect(isBridgeMessage({ type: "armature:ready" })).toBe(false);
    expect(isBridgeMessage({ type: "armature:hello", nonce: "n" })).toBe(false);
    expect(isBridgeMessage("armature:ready")).toBe(false);
  });
});
