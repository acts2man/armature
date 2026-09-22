/**
 * The site kit: schemas, the CSS generator (responsive inheritance, kit references,
 * hover), the rich-text renderer and serializer, sanitizers, and the protocol pins.
 */
// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import demoContact from "../examples/demo-site/content/layouts/contact.json";
import demoHome from "../examples/demo-site/content/layouts/home.json";
import demoKit from "../examples/demo-site/content/site-kit.json";
import demoContent from "../examples/demo-site/content/pages.json";
import demoSchema from "../examples/demo-site/content/schema.json";
import { LAYOUT_LIMITS, layoutDocSchema, validateElement, validateLayout, validateSiteKit } from "../shared/builder/schema.ts";
import { newElementId, withFreshIds } from "../shared/builder/ids.ts";
import { BRIDGE_MESSAGE_TYPES, BUILDER_PROTOCOL_VERSION, EDITOR_MESSAGE_TYPES } from "../shared/visualProtocol.ts";
import { PROTOCOL_VERSION, type SiteSchemaLike } from "./bridge.ts";
import { elementsCss, kitCss, pageCss } from "./css.ts";
import { defaultSiteKit } from "./defaults.ts";
import { KIT_VERSION, createArmatureKit, type ContentTree } from "./index.ts";
import { hasOverride, resolve, setAt } from "./responsive.ts";
import { RichText, plainDoc, richTextToPlain } from "./richText.tsx";
import { serializeRichText } from "./richTextDom.ts";
import { sanitizeCss, safeHref, safeMediaSrc } from "./sanitize.ts";
import type { Element, LayoutDoc, SiteKit } from "./types.ts";
import { fontFamilyCss, parseKitRef, parseSize, refToCss, sizeToCss } from "./values.ts";

const meta = { createdBy: "test", updatedAt: "2026-09-22T00:00:00.000Z" };
const element = (partial: Partial<Element> & { type: string }): Element => ({ id: newElementId(), props: {}, style: {}, advanced: {}, meta, ...partial });
const kit = defaultSiteKit();

describe("the demo site's builder files are valid", () => {
  it("validates both layouts and the kit with the shared schemas", () => {
    expect(validateLayout(demoHome, "home.json").errors).toEqual([]);
    expect(validateLayout(demoContact, "contact.json").errors).toEqual([]);
    expect(validateSiteKit(demoKit).errors).toEqual([]);
    expect(validateSiteKit(defaultSiteKit()).errors).toEqual([]);
  });
});

describe("schemas", () => {
  it("rejects unsafe links, bad ids, bad colours and children on a widget", () => {
    expect(validateElement(element({ type: "button", props: { text: "Go", link: { href: "javascript:alert(1)" } } })).errors.join()).toMatch(/props\.link\.href/);
    expect(validateElement(element({ id: "NOPE", type: "spacer" })).errors.join()).toMatch(/element id/);
    expect(validateElement(element({ type: "heading", props: { text: "x" }, style: { color: "red; background: url(x)" } })).errors.join()).toMatch(/colour/);
    expect(validateElement(element({ type: "heading", props: { text: "x" }, children: [element({ type: "spacer" })] })).errors.join()).toMatch(/cannot contain/);
    expect(validateElement(element({ type: "image", props: { src: "http://evil.example/x.png" } })).errors.join()).toMatch(/https/);
    expect(validateElement(element({ type: "heading", props: { text: "x" }, advanced: { attributes: [{ name: "onclick", value: "x" }] } })).errors.join()).toMatch(/attribute/);
  });

  it("accepts kit references and responsive values, and keeps unknown element types", () => {
    const ok = validateElement(element({ type: "heading", props: { text: "Hi", tag: "h1" }, style: { color: { desktop: "kit:color.primary", mobile: "#ff0000" }, typography: { preset: "kit:type.h1", fontSize: { desktop: { value: 3, unit: "rem" }, tablet: { value: 40, unit: "px" } } } } }));
    expect(ok.errors).toEqual([]);
    const unknown = validateElement(element({ type: "hologram", props: { anything: true } }));
    expect(unknown.errors).toEqual([]);
  });

  it("enforces depth, count and duplicate ids", () => {
    let deep: Element = element({ type: "spacer" });
    for (let i = 0; i < LAYOUT_LIMITS.depth; i++) deep = element({ type: "container", children: [deep] });
    const layout: LayoutDoc = { version: 1, pageSlug: "p", path: "/p", root: [deep] };
    expect(validateLayout(layout).errors.join()).toMatch(/nested/);
    const twin = element({ type: "spacer" });
    expect(validateLayout({ version: 1, pageSlug: "p", path: "/p", root: [twin, { ...twin }] }).errors.join()).toMatch(/appears twice/);
    expect(layoutDocSchema.safeParse({ version: 1, pageSlug: "Bad Slug", path: "/", root: [] }).success).toBe(false);
  });

  it("makes ids of eight safe characters and regenerates them on copies", () => {
    expect(newElementId()).toMatch(/^[a-z0-9]{8}$/);
    const tree = element({ type: "container", children: [element({ type: "spacer" })] });
    const copy = withFreshIds(tree);
    expect(copy.id).not.toBe(tree.id);
    expect(copy.children?.[0]?.id).not.toBe(tree.children?.[0]?.id);
  });
});

describe("responsive values", () => {
  it("inherits desktop → tablet → mobile and sets per device immutably", () => {
    expect(resolve({ desktop: 1, mobile: 3 }, "tablet")).toBe(1);
    expect(resolve({ desktop: 1, tablet: 2 }, "mobile")).toBe(2);
    expect(resolve(5, "mobile")).toBe(5);
    const plain = 10;
    const withTablet = setAt(plain, "tablet", 20);
    expect(withTablet).toEqual({ desktop: 10, tablet: 20 });
    expect(hasOverride(withTablet, "tablet")).toBe(true);
    expect(hasOverride(withTablet, "mobile")).toBe(false);
    expect(setAt(withTablet, "tablet", undefined)).toBe(10);
    expect(setAt(withTablet, "desktop", 11)).toEqual({ desktop: 11, tablet: 20 });
  });
});

describe("values", () => {
  it("formats and parses sizes, resolves kit references, quotes fonts", () => {
    expect(sizeToCss({ value: 12, unit: "px" })).toBe("12px");
    expect(sizeToCss({ value: 1.4, unit: "" })).toBe("1.4");
    expect(sizeToCss({ value: 0, unit: "auto" })).toBe("auto");
    expect(parseSize("2rem")).toEqual({ value: 2, unit: "rem" });
    expect(parseSize("50 %")).toEqual({ value: 50, unit: "%" });
    expect(parseSize("auto")).toEqual({ value: 0, unit: "auto" });
    expect(parseSize("abc")).toBeNull();
    expect(parseKitRef("kit:color.custom.bone")).toEqual({ group: "color", name: "custom", sub: "bone" });
    expect(refToCss("kit:color.primary")).toBe("var(--ae-color-primary)");
    expect(refToCss("#123456")).toBe("#123456");
    expect(fontFamilyCss("DM Serif Display")).toBe('"DM Serif Display", sans-serif');
  });
});

describe("the CSS generator", () => {
  it("scopes every rule under .ae-root and emits kit custom properties", () => {
    const css = kitCss(demoKit as SiteKit);
    expect(css).toContain("--ae-color-primary: #1f3a2e");
    expect(css).toContain("--ae-color-bone: #f3efe6");
    expect(css).toContain('--ae-font-heading: "DM Serif Display", sans-serif');
    expect(css).toContain(".ae-root .ae-btn-primary { background-color: var(--ae-color-primary)");
    expect(css).toContain("--ae-type-h1-size: 42px");
    expect(css).toMatch(/@media \(max-width: 767px\) \{\n\s+\.ae-root \{ --ae-type-h1-size: 32px;/);
    for (const line of css.split("\n")) {
      if (line.startsWith(".") || line.startsWith("[")) expect(line.startsWith(".ae-root") || line.startsWith("[data-armature-mode] .ae-root")).toBe(true);
    }
  });

  it("puts only each device's own values in its media query, so inheritance is the cascade", () => {
    const heading = element({
      id: "abcdefgh",
      type: "heading",
      props: { text: "x" },
      style: { color: { desktop: "kit:color.primary", mobile: "#ff0000" }, typography: { fontSize: { desktop: { value: 40, unit: "px" }, tablet: { value: 32, unit: "px" } } } },
      advanced: { padding: { desktop: { top: { value: 10, unit: "px" } }, mobile: { top: { value: 4, unit: "px" } } } },
    });
    const css = elementsCss([heading], kit);
    expect(css).toContain(".ae-root .ae-abcdefgh { font-size: 40px; color: var(--ae-color-primary); padding-top: 10px; }");
    expect(css).toMatch(/@media \(max-width: 1024px\) \{\n\s+\.ae-root \.ae-abcdefgh \{ font-size: 32px; \}/);
    expect(css).toMatch(/@media \(max-width: 767px\) \{\n\s+\.ae-root \.ae-abcdefgh \{ color: #ff0000; padding-top: 4px; \}/);
    expect(css.indexOf("max-width: 1024px")).toBeLessThan(css.indexOf("max-width: 767px"));
  });

  it("generates hover rules, hidden rules per device and the editor's 40% variant", () => {
    const button = element({ id: "hoverbtn", type: "button", props: { text: "Go" }, style: { background: { kind: "color", color: "#000000" }, hover: { background: { kind: "color", color: "kit:color.accent" }, opacity: 0.8 }, transition: 300 }, advanced: { hidden: { mobile: true, desktop: true } } });
    const css = elementsCss([button], kit);
    expect(css).toContain(".ae-root .ae-hoverbtn:hover .ae-btn { background-color: var(--ae-color-accent); background-image: none; opacity: 0.8; }");
    expect(css).toContain("transition: all 300ms ease");
    expect(css).toMatch(/@media \(min-width: 1025px\) \{\n\s+\.ae-root \.ae-hoverbtn \{ display: none; \}/);
    expect(css).toMatch(/@media \(max-width: 767px\) \{\n\s+\.ae-root \.ae-hoverbtn \{ display: none; \}/);
    const editing = elementsCss([button], kit, { editMode: true });
    expect(editing).toContain("opacity: 0.4");
    expect(editing).not.toContain("display: none");
  });

  it("handles containers, grids, images, spacers, dividers and typography presets", () => {
    const layout = demoHome as LayoutDoc;
    const css = pageCss(layout, demoKit as SiteKit);
    expect(css).toContain(".ae-root .ae-rowbuild > .ae-con-inner { max-width: none; flex-direction: row; align-items: center; column-gap: 32px; row-gap: 24px; }");
    expect(css).toMatch(/@media \(max-width: 767px\) \{[^}]*\.ae-root \.ae-rowbuild > \.ae-con-inner \{ flex-direction: column; \}/);
    expect(css).toContain(".ae-root .ae-colleft1 { width: 50%; max-width: 100%; }");
    expect(css).toContain(".ae-root .ae-hdbuilds { font-family: var(--ae-type-h2-family); font-size: var(--ae-type-h2-size);");
    expect(css).toContain(".ae-root .ae-secbuild { background-color: #ffffff; background-image: none; }");
    const grid = element({ id: "gridabcd", type: "grid", props: { columns: { desktop: 3, mobile: 1 }, gap: { column: { value: 16, unit: "px" } } } });
    expect(elementsCss([grid], kit)).toContain("grid-template-columns: repeat(3, minmax(0, 1fr))");
    const spacer = element({ id: "spacerab", type: "spacer", props: { height: { desktop: { value: 80, unit: "px" }, mobile: { value: 40, unit: "px" } } } });
    expect(elementsCss([spacer], kit)).toContain(".ae-root .ae-spacerab { height: 80px; }");
  });

  it("sanitizes custom CSS and rewrites 'selector'", () => {
    const styled = element({ id: "customcs", type: "spacer", advanced: { customCss: "selector { color: red } @import url(evil.css); selector:hover { background: url(javascript:alert(1)); behavior: url(x.htc) }" } });
    const css = elementsCss([styled], kit);
    expect(css).toContain(".ae-root .ae-customcs { color: red }");
    expect(css).not.toContain("@import");
    expect(css).not.toContain("javascript:");
    expect(css).not.toMatch(/\bbehavior:/);
  });
});

describe("the rich-text renderer", () => {
  const html = (doc: Parameters<typeof RichText>[0]["doc"]) => renderToStaticMarkup(createElement(RichText, { doc }));

  it("renders the whitelist and drops unsafe links and unknown marks", () => {
    const out = html({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2, textAlign: "center" }, content: [{ type: "text", text: "Title" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Bold", marks: [{ type: "bold" }, { type: "italic" }] },
            { type: "hardBreak" },
            { type: "text", text: "safe", marks: [{ type: "link", attrs: { href: "https://example.com", target: "_blank" } }] },
            { type: "text", text: "unsafe", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
            { type: "text", text: "red", marks: [{ type: "textStyle", attrs: { color: "kit:color.primary" } }] },
            { type: "text", text: "hidden", marks: [{ type: "sparkle" } as never] },
          ],
        },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] }] },
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "quote" }] }] },
      ],
    });
    expect(out).toContain('<h2 style="text-align:center">Title</h2>');
    expect(out).toContain("<em><strong>Bold</strong></em><br/>");
    expect(out).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">safe</a>');
    expect(out).not.toContain("javascript:");
    expect(out).toContain("unsafe");
    expect(out).toContain('<span style="color:var(--ae-color-primary)">red</span>');
    expect(out).toContain("hidden");
    expect(out).toContain("<ul><li><p>one</p></li></ul>");
    expect(out).toContain("<blockquote><p>quote</p></blockquote>");
  });

  it("round-trips plain text and converts to plain text", () => {
    const doc = plainDoc("First paragraph\n\nSecond");
    expect(doc.content).toHaveLength(2);
    expect(richTextToPlain(doc)).toBe("First paragraph\nSecond");
  });

  it("serialises a contenteditable DOM back to the whitelist", () => {
    const host = document.createElement("div");
    const p = document.createElement("p");
    p.append("Hello ");
    const strong = document.createElement("strong");
    strong.textContent = "world";
    p.append(strong);
    const link = document.createElement("a");
    link.setAttribute("href", "javascript:alert(1)");
    link.textContent = "bad";
    p.append(link);
    const font = document.createElement("font");
    font.setAttribute("color", "#ff0000");
    font.textContent = "red";
    p.append(font);
    host.append(p);
    const ul = document.createElement("ul");
    const li = document.createElement("li");
    li.textContent = "item";
    ul.append(li);
    host.append(ul);
    const script = document.createElement("script");
    script.textContent = "alert(1)";
    host.append(script);
    const doc = serializeRichText(host);
    expect(doc).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello " }, { type: "text", text: "world", marks: [{ type: "bold" }] }, { type: "text", text: "bad" }, { type: "text", text: "red", marks: [{ type: "textStyle", attrs: { color: "#ff0000" } }] }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "item" }] }] }] },
      ],
    });
  });
});

describe("sanitizers", () => {
  it("allow only safe hrefs and media", () => {
    expect(safeHref("https://a.b/c")).toBe("https://a.b/c");
    expect(safeHref("/about/")).toBe("/about/");
    expect(safeHref("#top")).toBe("#top");
    expect(safeHref("//evil")).toBeUndefined();
    expect(safeHref("javascript:x")).toBeUndefined();
    expect(safeMediaSrc("/assets/a.webp")).toBe("/assets/a.webp");
    expect(safeMediaSrc("/assets/../secret")).toBeUndefined();
    expect(safeMediaSrc("http://a.b/x.png")).toBeUndefined();
    expect(sanitizeCss("a { background: url('https://ok.example/x.png') } b { background: url(http://no.example/x.png) }")).toBe('a { background: url("https://ok.example/x.png") } b { background: none }');
  });
});

describe("the kit outside an iframe", () => {
  it("is inactive, keeps the v1.1 content API and exposes builder pages", () => {
    window.history.replaceState(null, "", "/?armature=edit");
    const armature = createArmatureKit({ allowedOrigins: ["https://editor.example"], schema: demoSchema as SiteSchemaLike, content: demoContent as ContentTree, siteKit: demoKit as SiteKit, layouts: [demoHome as LayoutDoc, demoContact as LayoutDoc] });
    expect(armature.active).toBe(false);
    expect(armature.version).toBe(KIT_VERSION);
    expect(armature.text("home", "hero", "title")).toBe("Homes built around the way you live");
    expect(armature.link("home", "hero", "cta").href).toBe("/about/");
    expect(armature.list("shared", "header", "nav").map((item) => item.href)).toContain("/contact/");
    expect(document.documentElement.hasAttribute("data-armature-mode")).toBe(false);
  });
});

describe("protocol pins", () => {
  it("speak the same builder protocol as the editor and list every message type", () => {
    expect(PROTOCOL_VERSION).toBe(BUILDER_PROTOCOL_VERSION);
    expect(KIT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    for (const type of ["armature:layout:apply", "armature:element:select", "armature:element:edit:start", "armature:richtext:command", "armature:scroll"]) expect(EDITOR_MESSAGE_TYPES).toContain(type);
    for (const type of ["armature:elements:map", "armature:element:hover", "armature:element:select", "armature:slot", "armature:element:edit:commit", "armature:richtext:state"]) expect(BRIDGE_MESSAGE_TYPES).toContain(type);
  });
});

describe("the kit store while an element is typed into", () => {
  it("marks the element, patches its prop into the draft, and bumps its epoch when the edit ends", async () => {
    const { createKitStore } = await import("./store.ts");
    const layout = { version: 1, pageSlug: "home", path: "/", root: [{ id: "hd000001", type: "heading", props: { text: "Old" }, style: {}, advanced: {}, meta: { createdBy: "t", updatedAt: "2026-09-22T00:00:00.000Z" } }] };
    const store = createKitStore({ layouts: [layout as never] });
    store.setEditing("hd000001");
    expect(store.getSnapshot().editing).toBe("hd000001");
    expect(store.getSnapshot().editEpoch["hd000001"]).toBeUndefined();
    store.patchElementProp("hd000001", "text", "New");
    store.setEditing(null);
    const snapshot = store.getSnapshot();
    expect(snapshot.editing).toBeNull();
    expect(snapshot.editEpoch["hd000001"]).toBe(1);
    expect((snapshot.layouts["home"]?.root[0]?.props as { text: string }).text).toBe("New");
    // The built layouts are untouched; only the draft carries the edit.
    expect((store.baseLayouts["home"]?.root[0]?.props as { text: string }).text).toBe("Old");
    store.patchElementProp("missing1", "text", "x");
    expect(store.getSnapshot()).toBe(snapshot);
  });
});
