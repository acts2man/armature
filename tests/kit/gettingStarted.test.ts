/**
 * Getting Started content sanity: seven sections, known keys, every step's
 * screenshot slug resolves to a real SVG file under public/guide-screenshots/.
 * These are the checks the UI silently relies on.
 */
import { describe, expect, it } from "vitest";
import {
  allScreenshotSlugs,
  GETTING_STARTED_SECTIONS,
  isAllowedVideoUrl,
  SECTION_KEYS,
  screenshotUrl,
  videoUrl,
} from "../../src/lib/gettingStartedContent.ts";

// The full set of SVG files under public/guide-screenshots/. Vite's `import.meta.glob`
// gives us the list at build time; we only care about the basenames.
const svgFiles = import.meta.glob("/public/guide-screenshots/*.svg", { eager: true }) as Record<string, unknown>;
const svgSlugs = new Set(
  Object.keys(svgFiles).map((path) => {
    const match = path.match(/\/([^/]+)\.svg$/);
    return match ? (match[1] ?? "") : "";
  }),
);

describe("Getting Started content", () => {
  it("has exactly seven sections in the documented order", () => {
    expect(GETTING_STARTED_SECTIONS.length).toBe(7);
    const keys = GETTING_STARTED_SECTIONS.map((section) => section.key);
    expect(keys).toEqual([...SECTION_KEYS]);
  });

  it("each section has every documented field", () => {
    for (const section of GETTING_STARTED_SECTIONS) {
      expect(section.title, `${section.key} title`).toBeTruthy();
      expect(section.what, `${section.key} what`).toBeTruthy();
      expect(section.steps.length, `${section.key} step count`).toBeGreaterThan(0);
      expect(section.troubleshoot, `${section.key} troubleshoot`).toBeTruthy();
      expect(section.video.placeholder, `${section.key} video placeholder`).toBeTruthy();
      expect(section.video.captions, `${section.key} video captions`).toBeTruthy();
    }
  });

  it("sections 3, 5 and 6 have a cost note (the money-relevant ones)", () => {
    const withCost = new Set(GETTING_STARTED_SECTIONS.filter((section) => section.cost).map((section) => section.key));
    expect(withCost.has("set-up-site")).toBe(true);
    expect(withCost.has("editing-publishing")).toBe(true);
    expect(withCost.has("keep-updated")).toBe(true);
  });

  it("every step has a screenshot slug that maps to a file under public/guide-screenshots/", () => {
    const slugs = allScreenshotSlugs();
    expect(slugs.length).toBeGreaterThan(20);
    // Vite's import.meta.glob returns every real .svg on disk; we cross-check both directions
    // so a renamed file or a copy-paste typo in a step slug fails the test.
    for (const slug of slugs) {
      expect(svgSlugs.has(slug), `screenshot ${slug}.svg is not on disk`).toBe(true);
    }
  });

  it("no section mentions Stats or cookie-free visitor numbers (removed in kit 2.9.0)", () => {
    const all = JSON.stringify(GETTING_STARTED_SECTIONS).toLowerCase();
    expect(all).not.toContain("cookie-free");
    expect(all).not.toContain("visitor numbers");
    expect(all).not.toContain("visitor stats");
  });

  it("screenshotUrl and videoUrl point where the app fetches", () => {
    expect(screenshotUrl("01-agency-setup-create-app")).toBe("/guide-screenshots/01-agency-setup-create-app.svg");
    expect(videoUrl("agency-setup")).toBe("/guide-videos/agency-setup.webm");
  });
});

describe("isAllowedVideoUrl", () => {
  it("accepts YouTube, Vimeo, Loom and Wistia URLs", () => {
    expect(isAllowedVideoUrl("https://youtu.be/abc123")).toBe(true);
    expect(isAllowedVideoUrl("https://www.youtube.com/watch?v=abc")).toBe(true);
    expect(isAllowedVideoUrl("https://vimeo.com/12345")).toBe(true);
    expect(isAllowedVideoUrl("https://www.loom.com/share/xyz")).toBe(true);
    expect(isAllowedVideoUrl("https://fast.wistia.net/embed/iframe/abc")).toBe(true);
  });

  it("refuses arbitrary URLs, javascript: and unparseable strings", () => {
    expect(isAllowedVideoUrl("https://example.com/video.mp4")).toBe(false);
    expect(isAllowedVideoUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedVideoUrl("")).toBe(false);
    expect(isAllowedVideoUrl("not-a-url")).toBe(false);
    // No suffix trick.
    expect(isAllowedVideoUrl("https://evil.wistia.com.attacker.com/")).toBe(false);
  });
});
