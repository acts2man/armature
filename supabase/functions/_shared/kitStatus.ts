/**
 * kit-status logic — extracted so it is testable without booting Deno.serve.
 *
 * For a site, resolve which kit version is:
 *   - `current`: what Armature ships with today (KIT_VERSION in the kit folder).
 *   - `inRepo`:  what the site's connected branch carries at <kitPath>/version.ts
 *     (or index.ts, if the site is still on a KIT_VERSION-in-index kit).
 *   - `live`:    what the site is actually rendering, read from
 *     data-armature-kit on the live URL's HTML.
 *
 * The status is derived from those three so the UI never has to duplicate the
 * rule:
 *   - "not_installed"   — no kit_path/version.ts and no KIT_VERSION in
 *                         kit_path/index.ts. Point at the setup screen.
 *   - "needs_setup"     — the site's KIT_VERSION is older than the current
 *                         kit's version AND one or more setup steps arrived
 *                         between the two.
 *   - "update_available"— repo version is older than current but no new setup
 *                         steps sit between. One click updates.
 *   - "up_to_date"      — the repo version matches current.
 */
import { parseKitVersionFromSource, releasesBetween, setupStepsSince } from "../../../kit/manifest.ts";
import { KIT_VERSION } from "../../../kit/version.ts";
import { ArmatureError } from "./errors.ts";
import { redact } from "./githubApp.ts";

export type KitStatusVerdict = "not_installed" | "needs_setup" | "update_available" | "up_to_date";

export type KitStatus = {
  current: string;
  inRepo: string | null;
  live: string | null;
  verdict: KitStatusVerdict;
  /** Files the kit_path helper tried, oldest-first, with the shape it found. */
  probed: { path: string; ok: boolean }[];
  /** Setup steps introduced strictly after the repo version. */
  pendingSteps: { key: string; label: string; detail: string; version: string }[];
  /** Human-readable, one-line reason for the verdict. */
  reason: string;
};

const LIVE_ATTR_RE = /data-armature-kit\s*=\s*["']([^"']+)["']/i;

export function parseLiveKitVersion(html: string): string | null {
  const match = html.match(LIVE_ATTR_RE);
  if (!match) return null;
  return match[1] ?? null;
}

/**
 * Fetch the live URL's HTML and return the kit version stamped on <html> by
 * ArmaturePage. Returns null if the site is unreachable, the header is
 * missing, or the HTML did not carry the attribute.
 */
export async function fetchLiveKitVersion(liveUrl: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const response = await fetchImpl(liveUrl, { redirect: "follow", headers: { "user-agent": "armature-kit-status" } });
    if (!response.ok) return null;
    const html = await response.text();
    return parseLiveKitVersion(html);
  } catch {
    return null;
  }
}

/**
 * Try `<kitPath>/version.ts` first (2.8.0+), then fall back to
 * `<kitPath>/index.ts` (pre-2.8.0 sites keep KIT_VERSION in index.ts).
 */
export async function readRepoKitVersion(
  read: (path: string) => Promise<string | null>,
  kitPath: string,
): Promise<{ version: string | null; probed: { path: string; ok: boolean }[] }> {
  const trimmed = kitPath.replace(/^\/+|\/+$/g, "");
  const probed: { path: string; ok: boolean }[] = [];
  for (const suffix of ["version.ts", "index.ts"] as const) {
    const path = `${trimmed}/${suffix}`;
    let source: string | null = null;
    try {
      source = await read(path);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new ArmatureError("github_error", `Could not read ${path}: ${redact(detail, "")}`);
    }
    probed.push({ path, ok: !!source });
    if (source) {
      const version = parseKitVersionFromSource(source);
      if (version) return { version, probed };
    }
  }
  return { version: null, probed };
}

/**
 * The full derivation. Given a repo reader and (optionally) a live-URL fetcher,
 * returns the KitStatus for a single site.
 */
export async function resolveKitStatus(options: {
  kitPath: string;
  liveUrl?: string | null;
  read: (path: string) => Promise<string | null>;
  fetchImpl?: typeof fetch;
}): Promise<KitStatus> {
  const { version: inRepo, probed } = await readRepoKitVersion(options.read, options.kitPath);
  const live = options.liveUrl ? await fetchLiveKitVersion(options.liveUrl, options.fetchImpl ?? fetch) : null;

  if (!inRepo) {
    return {
      current: KIT_VERSION,
      inRepo: null,
      live,
      verdict: "not_installed",
      probed,
      pendingSteps: [],
      reason: `The kit folder is not at ${options.kitPath}. If the site's developer put it somewhere else, correct the kit path below; otherwise open Set up this site.`,
    };
  }

  if (inRepo === KIT_VERSION) {
    return { current: KIT_VERSION, inRepo, live, verdict: "up_to_date", probed, pendingSteps: [], reason: "The site's kit matches the current release." };
  }

  const between = releasesBetween(inRepo, KIT_VERSION);
  const pendingSteps = setupStepsSince(inRepo);
  const hasSteps = pendingSteps.length > 0;
  return {
    current: KIT_VERSION,
    inRepo,
    live,
    verdict: hasSteps ? "needs_setup" : "update_available",
    probed,
    pendingSteps,
    reason: hasSteps
      ? `Update from ${inRepo} to ${KIT_VERSION} covers ${between.length === 1 ? "one release" : `${between.length} releases`} and introduces ${pendingSteps.length === 1 ? "one setup step" : `${pendingSteps.length} setup steps`}.`
      : `Update available: ${inRepo} → ${KIT_VERSION}. No new setup step; the update is a one-click job.`,
  };
}
