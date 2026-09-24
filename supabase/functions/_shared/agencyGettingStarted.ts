/**
 * agency-getting-started — shared logic. Kept out of index.ts so it can be
 * tested with plain Deno without booting an HTTP server or Supabase.
 *
 * The seven known section keys are duplicated here rather than imported from
 * src/lib/gettingStartedContent.ts because the browser-side file uses TypeScript
 * paths that Deno cannot resolve. Both sides list the same keys and a compile-
 * time sanity check on the frontend catches any drift.
 */
import { ArmatureError } from "./errors.ts";

/** The seven known section keys. Any other key is rejected by the edge function. */
export const SECTION_KEYS = [
  "agency-setup",
  "add-site",
  "set-up-site",
  "give-access",
  "editing-publishing",
  "keep-updated",
  "troubleshoot",
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

/**
 * Hosts allowed for a "Use my own video" URL. The frontend uses the same list;
 * a mismatch would let a URL save on one side and load nowhere on the other.
 */
export const VIDEO_ALLOW_HOSTS: readonly string[] = [
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "vimeo.com",
  "player.vimeo.com",
  "www.vimeo.com",
  "loom.com",
  "www.loom.com",
  "wistia.com",
  "www.wistia.com",
  "wistia.net",
  "fast.wistia.net",
  "fast.wistia.com",
];

/** Longest URL we will store — a generous cap that still fits every real hosted-video link. */
const MAX_VIDEO_URL_LENGTH = 1024;

export function isKnownSectionKey(candidate: unknown): candidate is SectionKey {
  return typeof candidate === "string" && (SECTION_KEYS as readonly string[]).includes(candidate);
}

/**
 * A URL is allowed when it parses, uses http(s) and its host is on the allow-list.
 * Anything else — a bare word, an ftp:// link, a random domain — is refused so we
 * never render arbitrary content back to another agency member.
 */
export function isAllowedVideoUrl(candidate: string): boolean {
  const trimmed = candidate.trim();
  if (!trimmed || trimmed.length > MAX_VIDEO_URL_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.host.toLowerCase();
  return VIDEO_ALLOW_HOSTS.includes(host);
}

export type ProgressPatch = Partial<Record<SectionKey, boolean>>;
export type VideoOverridePatch = Partial<Record<SectionKey, string>>;

/**
 * Validate a payload's shape. `progress` must map known section keys to booleans;
 * `video_overrides` must map known keys to strings, each an allowed URL (or empty
 * string to clear). Anything else throws an ArmatureError with a plain-English message
 * the browser can render as-is.
 */
export function parsePatch(input: Record<string, unknown>): {
  progress?: ProgressPatch;
  video_overrides?: VideoOverridePatch;
} {
  const out: { progress?: ProgressPatch; video_overrides?: VideoOverridePatch } = {};

  if (input["progress"] !== undefined) {
    const raw = input["progress"];
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new ArmatureError("invalid", "'progress' must be an object.");
    }
    const parsed: ProgressPatch = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!isKnownSectionKey(key)) {
        throw new ArmatureError(
          "invalid",
          `Unknown Getting Started section "${key}". The seven known sections are: ${SECTION_KEYS.join(", ")}.`,
        );
      }
      if (typeof value !== "boolean") {
        throw new ArmatureError("invalid", `progress.${key} must be true or false.`);
      }
      parsed[key] = value;
    }
    out.progress = parsed;
  }

  if (input["video_overrides"] !== undefined) {
    const raw = input["video_overrides"];
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new ArmatureError("invalid", "'video_overrides' must be an object.");
    }
    const parsed: VideoOverridePatch = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!isKnownSectionKey(key)) {
        throw new ArmatureError(
          "invalid",
          `Unknown Getting Started section "${key}". The seven known sections are: ${SECTION_KEYS.join(", ")}.`,
        );
      }
      if (typeof value !== "string") {
        throw new ArmatureError("invalid", `video_overrides.${key} must be a URL or the empty string.`);
      }
      const trimmed = value.trim();
      if (trimmed !== "" && !isAllowedVideoUrl(trimmed)) {
        throw new ArmatureError(
          "invalid",
          `That video link is not on our allow-list. Paste a YouTube, Vimeo, Loom or Wistia URL — for example https://youtu.be/…, https://vimeo.com/…, https://www.loom.com/share/… or https://fast.wistia.net/embed/….`,
        );
      }
      parsed[key] = trimmed;
    }
    out.video_overrides = parsed;
  }

  return out;
}

export type Row = {
  agency_id: string;
  progress: ProgressPatch;
  video_overrides: VideoOverridePatch;
  created_at: string;
  updated_at: string;
};

/**
 * Merge a patch into an existing row's progress / video_overrides. An entry with the
 * value `false` (or, for videos, `""`) clears that section; everything else is set.
 */
export function mergePatch(
  existing: { progress?: ProgressPatch; video_overrides?: VideoOverridePatch } | null,
  patch: { progress?: ProgressPatch; video_overrides?: VideoOverridePatch },
): { progress: ProgressPatch; video_overrides: VideoOverridePatch } {
  const progress: ProgressPatch = { ...(existing?.progress ?? {}) };
  if (patch.progress) {
    for (const [key, value] of Object.entries(patch.progress)) {
      if (value) progress[key as SectionKey] = true;
      else delete progress[key as SectionKey];
    }
  }
  const video_overrides: VideoOverridePatch = { ...(existing?.video_overrides ?? {}) };
  if (patch.video_overrides) {
    for (const [key, value] of Object.entries(patch.video_overrides)) {
      if (value && value.length > 0) video_overrides[key as SectionKey] = value;
      else delete video_overrides[key as SectionKey];
    }
  }
  return { progress, video_overrides };
}

/** A blank row for an agency with nothing stored yet. */
export function emptyRow(agencyId: string): Row {
  const now = new Date().toISOString();
  return { agency_id: agencyId, progress: {}, video_overrides: {}, created_at: now, updated_at: now };
}
