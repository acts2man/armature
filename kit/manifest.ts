/**
 * The kit's release manifest. Every entry names a kit version, the plain-English
 * notes that go in the "Update kit" dialog, and any one-time site-side setup
 * steps the version introduces (a step turned on in version X does nothing on a
 * site until the site does that step; that guarantees updating never breaks a
 * site with older wiring).
 *
 * The order is newest-first. Every entry from the earliest release forward is
 * kept so the Update dialog can show every note between the site's version and
 * the current one.
 */

export type KitSetupStep = {
  key: string;
  label: string;
  /** What the site's developer does to turn the step on. */
  detail: string;
};

export type KitReleaseNote = {
  version: string;
  /** ISO date. */
  date: string;
  notes: string[];
  /** Setup steps this version introduced. Absent on releases that only touch runtime code. */
  steps?: KitSetupStep[];
};

export const KIT_RELEASES: KitReleaseNote[] = [
  {
    version: "2.8.0",
    date: "2026-09-24",
    notes: [
      "Every rendered page carries data-armature-kit on <html>, so Armature can tell what version is actually live.",
      "One-click kit updates from the dashboard land in a single commit; old versions can be restored the same way.",
    ],
    // No site step: the runtime picks up the new kit code with no change to the site.
  },
  {
    version: "2.7.0",
    date: "2026-09-23",
    notes: ["Posts (blog): content/posts/*.json, ArmaturePostList and ArmaturePost, RSS, scheduled posts."],
    steps: [
      {
        key: "posts-routes",
        label: "Blog routes",
        detail: "Add /blog/ and /blog/<slug> routes that render <ArmaturePostList /> and <ArmaturePost slug={slug} />.",
      },
      {
        key: "posts-glob",
        label: "Post glob",
        detail: "Pass posts: import.meta.glob('../../content/posts/*.json', { eager: true }) and postIndex to createArmatureKit.",
      },
    ],
  },
  {
    version: "2.6.0",
    date: "2026-09-22",
    notes: ["SEO that reaches Google: per-page head tags, sitemap, robots, structured data."],
    steps: [
      {
        key: "seo-head",
        label: "SEO head",
        detail: "Render <ArmatureHead /> inside <ArmaturePage /> (SPA) or return computePageHead()'s tags from route.head() / generateMetadata() (SSR).",
      },
    ],
  },
  {
    version: "2.5.0",
    date: "2026-09-19",
    notes: ["Stats beacon: cookie-free visitor counts sent to stats-ingest."],
    steps: [
      {
        key: "stats-config",
        label: "Stats endpoint",
        detail: "Pass stats: { endpoint: '<VITE_ARMATURE_STATS_ENDPOINT>', siteId: '<VITE_ARMATURE_STATS_SITE_ID>' } to createArmatureKit and add the two envs to Netlify.",
      },
    ],
  },
  {
    version: "2.4.0",
    date: "2026-09-16",
    notes: ["Builder header/footer: kit renders <ArmatureChrome part='header'|'footer'> from the shared chrome layouts."],
    steps: [
      {
        key: "builder-chrome",
        label: "Builder header/footer",
        detail: "Replace the site's hard-coded header/footer with <ArmatureChrome part='header'/> and <ArmatureChrome part='footer'/>, keeping the site's own components as their fallback.",
      },
    ],
  },
];

export const CURRENT_KIT_VERSION = KIT_RELEASES[0]!.version;

/** True when candidate is a version string of the form X.Y.Z (with optional pre-release). */
export function isKitVersion(candidate: unknown): candidate is string {
  return typeof candidate === "string" && /^\d+\.\d+\.\d+([.-][A-Za-z0-9]+)?$/.test(candidate);
}

/**
 * Sort as a semantic version. Returns >0 when a is newer than b, <0 when older,
 * 0 when equal. Non-version strings sort as if 0.0.0.
 */
export function compareKitVersions(a: string, b: string): number {
  const parse = (v: string) => v.split(/[.-]/).map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  const partsA = parse(a);
  const partsB = parse(b);
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const aVal = partsA[i] ?? 0;
    const bVal = partsB[i] ?? 0;
    if (typeof aVal === "number" && typeof bVal === "number") {
      if (aVal !== bVal) return aVal - bVal;
    } else {
      if (String(aVal) < String(bVal)) return -1;
      if (String(aVal) > String(bVal)) return 1;
    }
  }
  return 0;
}

/** The releases strictly newer than `from`, oldest first (so the Update dialog reads top-to-bottom). */
export function releasesBetween(from: string, to: string): KitReleaseNote[] {
  return KIT_RELEASES
    .filter((entry) => compareKitVersions(entry.version, from) > 0 && compareKitVersions(entry.version, to) <= 0)
    .sort((a, b) => compareKitVersions(a.version, b.version));
}

/** Every setup step introduced in the releases strictly newer than `from`. */
export function setupStepsSince(from: string): (KitSetupStep & { version: string })[] {
  const shown: (KitSetupStep & { version: string })[] = [];
  for (const release of KIT_RELEASES) {
    if (compareKitVersions(release.version, from) <= 0) continue;
    for (const step of release.steps ?? []) shown.push({ ...step, version: release.version });
  }
  return shown;
}

/**
 * Read a KIT_VERSION line out of a raw index.ts (or version.ts) file, so
 * Armature can tell what version a site's repository currently ships.
 */
export function parseKitVersionFromSource(source: string): string | null {
  const match = source.match(/KIT_VERSION\s*=\s*["']([^"']+)["']/);
  if (!match) return null;
  return isKitVersion(match[1]) ? match[1]! : null;
}
