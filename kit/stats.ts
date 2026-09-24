/**
 * Visitor stats were removed in kit 2.9.0. The `stats` option on
 * `createArmatureKit` and the two helpers exported here (`installStatsBeacon`,
 * `sendBeacon`) are kept as no-ops so a site whose developer wired the old
 * beacon in (for example Tree Test Prep's test copy) keeps building without
 * a single code change. Nothing is sent, nothing is stored, no network call
 * is made.
 *
 * A later kit release may reintroduce visitor stats. If it does, updating the
 * kit will restore the beacon on any site that still has this config wired,
 * without a site-side setup step.
 */

export type StatsConfig = { endpoint: string; siteId: string };

export type BeaconPayload = {
  siteId: string;
  path: string;
  referrerHost: string | null;
  device: "mobile" | "tablet" | "desktop" | "unknown";
  screenBucket: "xs" | "sm" | "md" | "lg" | "xl";
  userAgent: string;
};

/** No-op. Retained so existing calls keep type-checking; always returns true. */
export function shouldSkipBeacon(_win: Window): boolean {
  return true;
}

/** No-op. Retained so existing calls keep type-checking; always returns null. */
export function buildBeaconPayload(_win: Window, _siteId: string): BeaconPayload | null {
  return null;
}

/** No-op. Retained so existing calls keep type-checking. */
export function sendBeacon(_win: Window, _config: StatsConfig): void {
  /* stats removed in kit 2.9.0 */
}

/** No-op. Retained so existing calls keep type-checking; the returned cleanup is a no-op too. */
export function installStatsBeacon(_config: StatsConfig): () => void {
  return () => undefined;
}
