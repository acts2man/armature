/**
 * Every widget in the catalogue, created with its defaults, validates against the shared
 * schema and renders through the kit (no widget is skipped as unknown, nothing throws),
 * plus the widget library's own rules: the video facade never contacts the host before
 * a click, embeds are sandboxed, and the countdown and TOC helpers behave.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { validateElement, validateLayout, type LayoutDoc } from "@shared/builder/index.ts";
import { BUILT_IN_WIDGET_TYPES, createArmatureKit, ArmaturePage } from "@kit/index.ts";
import { embedUrl, videoId } from "@kit/library/basic.tsx";
import { countdownParts, countdownTarget, evergreenStart, mapUrl, slugify } from "@kit/library/interactive.tsx";
import { createElement as createBuilderElement } from "../store.ts";
import "./library.ts";
import { widgetDefinitions } from "./registry.ts";

describe("the widget catalogue", () => {
  const definitions = widgetDefinitions();
  const elements = definitions.map((definition) => definition.create());
  const layout: LayoutDoc = { version: 1, pageSlug: "all", path: "/all/", label: "All", root: [createBuilderElement("container", { layout: "boxed" }, { children: elements.filter((element) => element.type !== "container" && element.type !== "grid") })] };

  it("offers exactly the widgets the kit ships", () => {
    expect(elements.map((element) => element.type).sort()).toEqual([...BUILT_IN_WIDGET_TYPES].sort());
  });

  it("starts every widget with content the schema accepts", () => {
    for (const element of elements) expect(validateElement(element, element.type).errors, element.type).toEqual([]);
    expect(validateLayout(layout).errors).toEqual([]);
  });

  it("renders every widget through the kit, none skipped", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    createArmatureKit({ allowedOrigins: [], schema: { armatureContract: "1.1", pages: [] } as never, content: {}, layouts: [layout] });
    const html = renderToStaticMarkup(createElement(ArmaturePage, { slug: "all", layout }));
    for (const element of elements) {
      if (element.type === "container" || element.type === "grid") continue;
      expect(html, element.type).toContain(`data-ae-id="${element.id}"`);
    }
    expect(warn).not.toHaveBeenCalled();
    // The CSS for the library travels with the page.
    expect(html).toContain(".ae-root .ae-panel-toggle");
    // No third-party request before a click: the video is a facade, the map is lazy.
    expect(html).not.toMatch(/youtube|vimeo/);
    expect(html).toMatch(/<iframe[^>]+sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms"/);
    expect(html).not.toMatch(/sandbox="[^"]*allow-same-origin/);
    warn.mockRestore();
  });
});

describe("widget helpers", () => {
  it("reads YouTube and Vimeo ids and builds privacy-friendly player addresses", () => {
    expect(videoId("youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3")).toBe("dQw4w9WgXcQ");
    expect(videoId("youtube", "https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(videoId("youtube", "https://www.youtube.com/shorts/abcdefghijk")).toBe("abcdefghijk");
    expect(videoId("vimeo", "https://vimeo.com/76979871")).toBe("76979871");
    expect(videoId("youtube", "https://example.com/watch?v=x")).toBeNull();
    const url = embedUrl({ source: "youtube", url: "", loop: true, start: 30 }, "dQw4w9WgXcQ", true);
    expect(url).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/);
    expect(url).toContain("autoplay=1");
    expect(url).toContain("playlist=dQw4w9WgXcQ");
    expect(url).toContain("start=30");
    expect(embedUrl({ source: "vimeo", url: "" }, "76979871", true)).toContain("dnt=1");
  });

  it("reads Wistia ids and takes a generic embed address as-is", () => {
    expect(videoId("wistia", "https://home.wistia.com/medias/abc12345xy")).toBe("abc12345xy");
    expect(videoId("wistia", "https://fast.wistia.net/embed/iframe/abc12345xy?seo=false")).toBe("abc12345xy");
    expect(videoId("wistia", "https://example.com/medias/abc12345xy")).toBeNull();
    const wistia = embedUrl({ source: "wistia", url: "" }, "abc12345xy", true);
    expect(wistia).toMatch(/^https:\/\/fast\.wistia\.net\/embed\/iframe\/abc12345xy\?/);
    expect(wistia).toContain("autoPlay=true");
    // A generic embed keeps its own address (query string intact) and is gated behind the facade.
    const embed = "https://player.example.com/v/xyz?controls=1";
    expect(videoId("embed", embed)).toBe(embed);
    expect(videoId("embed", "http://insecure.example.com/v")).toBeNull();
    expect(embedUrl({ source: "embed", url: embed }, embed, true)).toBe(embed);
  });

  it("counts down to a date or from a visitor's first visit, remembered in their browser", () => {
    expect(countdownTarget({ mode: "date", date: "2030-01-01T00:00:00Z" }, 0)).toBe(Date.parse("2030-01-01T00:00:00Z"));
    expect(countdownTarget({ mode: "date" }, 0)).toBeNull();
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
    expect(evergreenStart("abc", 1000, storage)).toBe(1000);
    expect(evergreenStart("abc", 5000, storage)).toBe(1000);
    expect(countdownTarget({ mode: "evergreen", minutes: 2 }, 1000)).toBe(121_000);
    expect(evergreenStart("x", 7, { getItem: () => { throw new Error("blocked"); }, setItem: () => undefined })).toBe(7);
    expect(countdownParts(90_061_000)).toEqual({ days: 1, hours: 1, minutes: 1, seconds: 1 });
    expect(countdownParts(-5)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  });

  it("makes anchors from headings and map addresses from places", () => {
    expect(slugify("Our Process & Pricing")).toBe("our-process-pricing");
    expect(slugify("Café déjà vu")).toBe("cafe-deja-vu");
    expect(slugify("!!!")).toBe("section");
    expect(mapUrl("1 Main St, Auburn", 40)).toBe("https://maps.google.com/maps?q=1%20Main%20St%2C%20Auburn&z=20&output=embed");
  });
});
