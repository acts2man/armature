import { describe, expect, it, vi } from "vitest";
import { CURRENT_KIT_VERSION } from "@kit/manifest.ts";
import { KIT_VERDICT_ORDER, kitColumnFor } from "./kitColumn.ts";
import type { Site } from "./types.ts";

function baseSite(overrides: Partial<Site> = {}): Site {
  return {
    id: "site-1",
    agency_id: "agency-1",
    name: "A site",
    repo_owner: "acts2man",
    repo_name: "example",
    branch: "main",
    live_url: "https://example.com/",
    github_installation_id: 1,
    status: "connected",
    last_published_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("kitColumnFor", () => {
  it("returns n/a for hosting-only sites", () => {
    const kit = kitColumnFor({ status: "hosting_only", kit_version_in_repo: null, kit_version_live: null, kit_verdict: null, kit_probed_at: null });
    expect(kit.verdict).toBeNull();
    expect(kit.version).toBeNull();
  });

  it("prefers the stored verdict when present", () => {
    const site = baseSite({ kit_version_in_repo: "2.8.0", kit_verdict: "update_available", kit_probed_at: new Date().toISOString() });
    const kit = kitColumnFor(site);
    expect(kit.verdict).toBe("update_available");
    expect(kit.version).toBe("2.8.0");
    expect(kit.stale).toBe(false);
  });

  it("falls back to KIT_VERSION comparison when the snapshot is empty", () => {
    const kit = kitColumnFor(baseSite({ kit_version_in_repo: CURRENT_KIT_VERSION, kit_verdict: null }));
    expect(kit.verdict).toBe("up_to_date");
  });

  it("says not_installed when no version has ever been seen", () => {
    const kit = kitColumnFor(baseSite({ kit_version_in_repo: null, kit_version_live: null, kit_verdict: null }));
    expect(kit.verdict).toBe("not_installed");
  });

  it("marks stale after twenty-four hours", () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 3600_000).toISOString();
    const kit = kitColumnFor(baseSite({ kit_version_in_repo: "2.8.0", kit_verdict: "update_available", kit_probed_at: twoDaysAgo }));
    expect(kit.stale).toBe(true);
  });

  it("uses the live version when in_repo is empty", () => {
    const kit = kitColumnFor(baseSite({ kit_version_in_repo: null, kit_version_live: "2.7.0", kit_verdict: "update_available", kit_probed_at: new Date().toISOString() }));
    expect(kit.version).toBe("2.7.0");
    expect(kit.verdict).toBe("update_available");
  });
});

describe("KIT_VERDICT_ORDER", () => {
  it("puts the most urgent verdicts first when sorted descending", () => {
    const spy = vi.fn();
    expect(KIT_VERDICT_ORDER.not_installed).toBeGreaterThan(KIT_VERDICT_ORDER.needs_setup);
    expect(KIT_VERDICT_ORDER.needs_setup).toBeGreaterThan(KIT_VERDICT_ORDER.update_available);
    expect(KIT_VERDICT_ORDER.update_available).toBeGreaterThan(KIT_VERDICT_ORDER.up_to_date);
    void spy;
  });
});
