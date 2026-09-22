/**
 * The bridge is copied into sites, so it carries its own copy of the protocol. These
 * tests pin it to the editor's copy and to the @vercel/stega encoding the editor uses.
 */
// @vitest-environment jsdom
import { vercelStegaDecode, vercelStegaEncode } from "@vercel/stega";
import { describe, expect, it } from "vitest";
import { VISUAL_PROTOCOL_VERSION } from "../shared/visualProtocol.ts";
import exampleContent from "../shared/example/pages.json";
import exampleSchema from "../shared/example/schema.json";
import { BRIDGE_VERSION, PROTOCOL_VERSION, createArmatureBridge, decodeFieldPath, hasStega, stegaClean, stegaDecode, stegaEncode, type ContentTree, type SiteSchemaLike } from "./armature-bridge.ts";

const schema = exampleSchema as SiteSchemaLike;
const content = exampleContent as ContentTree;

describe("stega codec", () => {
  it("is byte-for-byte compatible with @vercel/stega", () => {
    const payload = { armature: "home.faq.items[2].question" };
    expect(stegaEncode(payload)).toBe(vercelStegaEncode(payload));
    expect(vercelStegaDecode(`Hello${stegaEncode(payload)}`)).toEqual(payload);
    expect(stegaDecode(`Hello${vercelStegaEncode(payload)}`)).toEqual(payload);
  });

  it("cleans, detects and decodes field paths, and survives non-ASCII text", () => {
    const marked = `Café — “quotes” ©${stegaEncode({ armature: "home.hero.title" })}`;
    expect(hasStega(marked)).toBe(true);
    expect(hasStega("plain")).toBe(false);
    expect(stegaClean(marked)).toBe("Café — “quotes” ©");
    expect(decodeFieldPath(marked)).toBe("home.hero.title");
    expect(decodeFieldPath("nothing here")).toBeNull();
    expect(decodeFieldPath(`x${stegaEncode({ other: 1 })}`)).toBeNull();
  });
});

describe("versions", () => {
  it("speak the same protocol as the editor", () => {
    expect(PROTOCOL_VERSION).toBe(VISUAL_PROTOCOL_VERSION);
    expect(BRIDGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("outside an iframe", () => {
  it("is inactive, adds nothing to the page and returns plain values", () => {
    window.history.replaceState(null, "", "/?armature=edit");
    const bridge = createArmatureBridge({ allowedOrigins: ["https://editor.example"], schema, content });
    expect(bridge.active).toBe(false);
    expect(document.documentElement.hasAttribute("data-armature-mode")).toBe(false);
    expect(bridge.text("home", "hero", "title")).toBe("Keep your site current");
    expect(hasStega(bridge.text("home", "hero", "title"))).toBe(false);
    expect(bridge.link("home", "hero", "cta")).toEqual({ href: "/contact/", label: "Talk to us" });
    expect(bridge.list("home", "faq", "items")[0]?.question).toBe("Can I try it first?");
    expect(bridge.image("home", "hero", "image")).toBe("/assets/hero.webp");
    expect(bridge.plain("home", "seo", "title")).toBe("Acme | Keep your site current");
    expect(bridge.getSnapshot()).toEqual(content);
  });

  it("returns safe empties for missing content", () => {
    const bridge = createArmatureBridge({ allowedOrigins: [], schema, content: {} });
    expect(bridge.text("home", "hero", "title")).toBe("");
    expect(bridge.link("home", "hero", "cta")).toEqual({ label: "", href: "" });
    expect(bridge.list("home", "faq", "items")).toEqual([]);
    expect(bridge.image("home", "hero", "image")).toBe("");
  });
});
