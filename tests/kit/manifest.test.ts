import { describe, expect, it } from "vitest";
import { compareKitVersions, isKitVersion, KIT_RELEASES, parseKitVersionFromSource, releasesBetween, setupStepsSince } from "../../kit/manifest.ts";

describe("compareKitVersions", () => {
  it("compares major, minor, patch numerically", () => {
    expect(compareKitVersions("2.6.0", "2.5.0")).toBeGreaterThan(0);
    expect(compareKitVersions("2.5.0", "2.6.0")).toBeLessThan(0);
    expect(compareKitVersions("2.7.1", "2.7.0")).toBeGreaterThan(0);
    expect(compareKitVersions("2.7.0", "2.7.0")).toBe(0);
    expect(compareKitVersions("10.0.0", "9.9.9")).toBeGreaterThan(0);
  });
});

describe("isKitVersion", () => {
  it("accepts valid versions and refuses everything else", () => {
    expect(isKitVersion("2.7.0")).toBe(true);
    expect(isKitVersion("2.7.0-rc1")).toBe(true);
    expect(isKitVersion("2.7")).toBe(false);
    expect(isKitVersion("v2.7.0")).toBe(false);
    expect(isKitVersion(null)).toBe(false);
    expect(isKitVersion(2.7)).toBe(false);
  });
});

describe("releasesBetween", () => {
  it("returns only releases strictly newer than from, up to to, oldest first", () => {
    const versions = releasesBetween("2.5.0", "2.7.0").map((r) => r.version);
    expect(versions).toEqual(["2.6.0", "2.7.0"]);
  });
  it("returns [] when from and to are the same", () => {
    expect(releasesBetween("2.7.0", "2.7.0")).toEqual([]);
  });
});

describe("setupStepsSince", () => {
  it("lists every setup step from newer releases, tagged with their version", () => {
    const steps = setupStepsSince("2.5.0");
    const keys = steps.map((s) => s.key);
    expect(keys).toContain("seo-head");
    expect(keys).toContain("posts-routes");
    expect(steps.find((s) => s.key === "seo-head")?.version).toBe("2.6.0");
  });
  it("returns [] when there are no newer releases", () => {
    const steps = setupStepsSince("9.9.9");
    expect(steps).toEqual([]);
  });
});

describe("parseKitVersionFromSource", () => {
  it("finds a KIT_VERSION constant with double or single quotes", () => {
    expect(parseKitVersionFromSource('export const KIT_VERSION = "2.7.0";')).toBe("2.7.0");
    expect(parseKitVersionFromSource("export const KIT_VERSION = '2.6.5';")).toBe("2.6.5");
  });
  it("returns null when the constant is missing or the value is not a version", () => {
    expect(parseKitVersionFromSource("export const KIT = '2.7.0';")).toBeNull();
    expect(parseKitVersionFromSource('export const KIT_VERSION = "not-a-version";')).toBeNull();
  });
});

describe("KIT_RELEASES", () => {
  it("is sorted newest-first", () => {
    for (let i = 0; i < KIT_RELEASES.length - 1; i++) {
      expect(compareKitVersions(KIT_RELEASES[i]!.version, KIT_RELEASES[i + 1]!.version)).toBeGreaterThan(0);
    }
  });
});
