import { describe, expect, it } from "vitest";
import { buildSetupPrompt, type SiteSetupContext } from "./kitSetupPrompt.ts";

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
  it("includes the repo, branch, kit path and site id", () => {
    const text = buildSetupPrompt(context());
    expect(text).toContain("acme/alder-stone");
    expect(text).toContain("branch main");
    expect(text).toContain("src/lib/armature-kit");
    expect(text).toContain("11111111-1111-4111-8111-111111111111");
  });

  it("shows the from/to versions and lists releases with steps", () => {
    const text = buildSetupPrompt(context());
    expect(text).toContain("Target version: 2.8.0 (site is currently on 2.5.0)");
    expect(text).toContain("2.6.0 (2026-09-22)");
    expect(text).toContain("1. SEO head (added in 2.6.0) — Render <ArmatureHead />.");
  });

  it("shows the stats endpoint and site id in the Netlify block, with the endpoint trimmed", () => {
    const text = buildSetupPrompt(context({ supabaseUrl: "https://project.supabase.co/" }));
    expect(text).toContain("VITE_ARMATURE_STATS_ENDPOINT = https://project.supabase.co/functions/v1/stats-ingest");
    expect(text).toContain("VITE_ARMATURE_STATS_SITE_ID  = 11111111-1111-4111-8111-111111111111");
  });

  it("says 'main' is the connected branch when it is, and warns off otherwise", () => {
    expect(buildSetupPrompt(context({ branch: "main" }))).toContain("main unless main is the connected branch (it is)");
    expect(buildSetupPrompt(context({ branch: "production" }))).toContain("main unless main is the connected branch (it is not — leave main alone)");
  });

  it("names 'fresh install' when the site has no current version", () => {
    const text = buildSetupPrompt(context({ fromVersion: null }));
    expect(text).toContain("(fresh install)");
  });

  it("says there is no site step when pendingSteps is empty", () => {
    const text = buildSetupPrompt(context({ pendingSteps: [] }));
    expect(text).toContain("Copy the entire kit folder");
    expect(text).not.toContain("Do these in order");
  });
});
