import { describe, expect, it } from "vitest";
import { buildSetupPrompt, MAX_PIXEL_DIFF, type SiteSetupContext } from "./kitSetupPrompt.ts";

const context = (overrides: Partial<SiteSetupContext> = {}): SiteSetupContext => ({
  repo: "acme/alder-stone",
  branch: "main",
  kitPath: "src/lib/armature-kit",
  siteId: "11111111-1111-4111-8111-111111111111",
  liveUrl: "https://alderandstone.example.com",
  supabaseUrl: "https://project.supabase.co",
  currentVersion: "2.8.0",
  fromVersion: "2.5.0",
  releases: [
    { version: "2.6.0", date: "2026-09-22", notes: ["SEO tags on every page."], steps: [{ key: "seo", label: "SEO head", detail: "Render <ArmatureHead />." }] },
    { version: "2.8.0", date: "2026-09-24", notes: ["data-armature-kit on <html>."] },
  ],
  pendingSteps: [{ key: "seo", label: "SEO head", detail: "Render <ArmatureHead />.", version: "2.6.0" }],
  ...overrides,
});

describe("buildSetupPrompt", () => {
  it("names the connected branch and works directly on it (no test branch)", () => {
    const text = buildSetupPrompt(context({ branch: "main" }));
    expect(text).toContain("directly on main");
    // No test-branch language survives from the previous flow.
    expect(text).not.toContain("armature/setup");
    expect(text).not.toContain("test-copy");
    expect(text).not.toContain("test copy");
    expect(text).not.toContain("Go live");
    expect(text).not.toContain("Preview");
  });

  it("uses the site's connected branch when it is not main", () => {
    const text = buildSetupPrompt(context({ branch: "production" }));
    expect(text).toContain("directly on production");
    expect(text).toContain("git checkout production");
  });

  it("spells out BEFORE / AFTER verification and the 0.5% pixel budget", () => {
    const text = buildSetupPrompt(context());
    expect(text).toContain(".armature-verify/before/");
    expect(text).toContain(".armature-verify/after/");
    expect(text).toContain("BEFORE / AFTER VERIFICATION");
    expect(text).toContain(`${(MAX_PIXEL_DIFF * 100).toFixed(1)}%`);
    expect(text).toContain("visible-text list matches exactly");
    expect(text).toContain("link list matches exactly");
    expect(text).toContain("image alt attribute is identical");
    expect(text).toContain("head tag matches exactly");
  });

  it("says do-not-push on mismatch and no force-push", () => {
    const text = buildSetupPrompt(context());
    expect(text).toContain("DO NOT PUSH");
    expect(text).toContain("Never force-push");
    expect(text).toContain("normal commit");
  });

  it("mentions Undo setup for the safety net, but no branch merge", () => {
    const text = buildSetupPrompt(context());
    expect(text).toContain("Undo setup");
    expect(text).not.toContain("branch preview");
    expect(text).not.toContain("through the GitHub API");
  });

  it("shows the target version and pending steps in order", () => {
    const text = buildSetupPrompt(context());
    expect(text).toContain("Target version: 2.8.0 (site is currently on 2.5.0)");
    expect(text).toContain("1. SEO head (added in 2.6.0) — Render <ArmatureHead />.");
  });

  it("shows the form-submit endpoint and trims trailing slash on supabaseUrl", () => {
    const text = buildSetupPrompt(context({ supabaseUrl: "https://project.supabase.co/" }));
    expect(text).toContain("form-submit endpoint:  https://project.supabase.co/functions/v1/form-submit");
    expect(text).not.toContain("STATS_ENDPOINT");
  });

  it("says 'fresh install' when the site has no current version", () => {
    const text = buildSetupPrompt(context({ fromVersion: null }));
    expect(text).toContain("(fresh install)");
  });

  it("uses fresh-install language when pendingSteps is empty", () => {
    const text = buildSetupPrompt(context({ pendingSteps: [] }));
    expect(text).toContain("Copy the kit folder from Armature");
    expect(text).not.toContain("Do the pending setup steps");
  });
});
