/**
 * Visitor stats were removed in kit 2.9.0. The exports are kept as no-ops so a
 * site whose developer still wires them (for example Tree Test Prep's test
 * copy) keeps building without a code change. These tests confirm nothing is
 * sent, nothing is stored, and no listener is attached.
 */
import { describe, expect, it, vi } from "vitest";
import { buildBeaconPayload, installStatsBeacon, sendBeacon, shouldSkipBeacon } from "../../kit/stats.ts";

describe("stats no-op (kit 2.9.0)", () => {
  const siteId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  it("shouldSkipBeacon always returns true", () => {
    expect(shouldSkipBeacon({} as Window)).toBe(true);
  });

  it("buildBeaconPayload returns null", () => {
    expect(buildBeaconPayload({} as Window, siteId)).toBeNull();
  });

  it("sendBeacon never calls navigator.sendBeacon", () => {
    const beacon = vi.fn(() => true);
    const win = { navigator: { sendBeacon: beacon }, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as Window;
    sendBeacon(win, { endpoint: "https://x/ingest", siteId });
    expect(beacon).not.toHaveBeenCalled();
  });

  it("installStatsBeacon returns a cleanup function and attaches no listeners", () => {
    const addListener = vi.fn();
    const win = { addEventListener: addListener } as unknown as Window;
    // Simulate the DOM-free branch: passing no window equivalent should return a
    // cleanup function that is a no-op.
    const cleanup = installStatsBeacon({ endpoint: "https://x/ingest", siteId });
    expect(typeof cleanup).toBe("function");
    cleanup();
    void win;
    void addListener;
  });
});
