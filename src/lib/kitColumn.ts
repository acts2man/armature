/**
 * Kit column helpers for the Projects list. Everything here derives from the
 * snapshot columns on `public.sites` (kit_version_in_repo, kit_version_live,
 * kit_verdict, kit_probed_at) plus the compiled KIT_VERSION so no per-render
 * HTTP call to GitHub or the live URL is needed. Kept in its own file so both
 * the Projects table and the Kit filter chip share one truth table.
 */
import { CURRENT_KIT_VERSION } from "@kit/manifest.ts";
import type { KitVerdict, Site } from "./types.ts";

/** Ordering used to sort the Kit column (highest number = most urgent). */
export const KIT_VERDICT_ORDER: Record<KitVerdict, number> = {
  not_installed: 3,
  needs_setup: 2,
  update_available: 1,
  up_to_date: 0,
};

export const KIT_VERDICT_LABEL: Record<KitVerdict, string> = {
  not_installed: "Not installed",
  needs_setup: "Needs setup",
  update_available: "Update available",
  up_to_date: "Up to date",
};

export const KIT_VERDICT_TONE: Record<KitVerdict, "danger" | "amber" | "blue" | "green"> = {
  not_installed: "danger",
  needs_setup: "amber",
  update_available: "blue",
  up_to_date: "green",
};

export type KitColumnData = {
  /** The verdict to render as a Pill. Null when the site is hosting-only (no repo). */
  verdict: KitVerdict | null;
  /** The version to show alongside — the in-repo version if known, else the live version, else null. */
  version: string | null;
  /** True when the snapshot on `sites` is older than 24 hours or missing — the UI can suggest a re-check. */
  stale: boolean;
};

/** Derive the Kit column state for a site row. */
export function kitColumnFor(site: Pick<Site, "status" | "kit_version_in_repo" | "kit_version_live" | "kit_verdict" | "kit_probed_at">): KitColumnData {
  if (site.status === "hosting_only") return { verdict: null, version: null, stale: false };
  const version = site.kit_version_in_repo ?? site.kit_version_live ?? null;

  // Prefer the stored verdict when it's present — it was computed by kit-status against a live
  // read of both the repo and the site's URL. Fall back to a stored version + KIT_VERSION
  // comparison when there is no stored verdict yet (a site connected before this snapshot
  // migration ran, before its first kit-status probe).
  let verdict: KitVerdict | null = site.kit_verdict ?? null;
  if (verdict === null) {
    if (!version) verdict = "not_installed";
    else if (version === CURRENT_KIT_VERSION) verdict = "up_to_date";
    else verdict = "update_available";
  }

  // Stale after 24 hours — the snapshot is a best-effort mirror, not a live probe.
  const stale = !site.kit_probed_at || (Date.now() - new Date(site.kit_probed_at).getTime()) > 24 * 60 * 60 * 1000;
  return { verdict, version, stale };
}
