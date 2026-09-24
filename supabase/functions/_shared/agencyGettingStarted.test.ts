import { assertEquals, assertStringIncludes, assertThrows } from "jsr:@std/assert@1";
import { ArmatureError } from "./errors.ts";
import {
  emptyRow,
  isAllowedVideoUrl,
  isKnownSectionKey,
  mergePatch,
  parsePatch,
  SECTION_KEYS,
} from "./agencyGettingStarted.ts";

Deno.test("SECTION_KEYS has exactly the seven documented keys", () => {
  assertEquals(SECTION_KEYS.length, 7);
  assertEquals([...SECTION_KEYS], [
    "agency-setup",
    "add-site",
    "set-up-site",
    "give-access",
    "editing-publishing",
    "keep-updated",
    "troubleshoot",
  ]);
});

Deno.test("isKnownSectionKey accepts the seven keys and refuses everything else", () => {
  for (const key of SECTION_KEYS) assertEquals(isKnownSectionKey(key), true);
  assertEquals(isKnownSectionKey("something-else"), false);
  assertEquals(isKnownSectionKey(""), false);
  assertEquals(isKnownSectionKey(null), false);
  assertEquals(isKnownSectionKey(42), false);
});

Deno.test("isAllowedVideoUrl accepts YouTube, Vimeo, Loom, Wistia and refuses everything else", () => {
  assertEquals(isAllowedVideoUrl("https://youtu.be/abc123"), true);
  assertEquals(isAllowedVideoUrl("https://www.youtube.com/watch?v=abc"), true);
  assertEquals(isAllowedVideoUrl("https://vimeo.com/12345"), true);
  assertEquals(isAllowedVideoUrl("https://www.loom.com/share/xyz"), true);
  assertEquals(isAllowedVideoUrl("https://fast.wistia.net/embed/iframe/abc"), true);
  // http is fine (in case a local server serves one), but not other schemes.
  assertEquals(isAllowedVideoUrl("http://vimeo.com/12345"), true);
  assertEquals(isAllowedVideoUrl("ftp://vimeo.com/12345"), false);
  assertEquals(isAllowedVideoUrl("javascript:alert(1)"), false);
  // Not on the allow-list.
  assertEquals(isAllowedVideoUrl("https://example.com/video.mp4"), false);
  assertEquals(isAllowedVideoUrl("https://evil.wistia.com.attacker.com/"), false);
  // Empty and garbage.
  assertEquals(isAllowedVideoUrl(""), false);
  assertEquals(isAllowedVideoUrl("   "), false);
  assertEquals(isAllowedVideoUrl("not-a-url"), false);
});

Deno.test("parsePatch validates progress: booleans keyed by known section keys", () => {
  assertEquals(
    parsePatch({ progress: { "agency-setup": true, "add-site": false } }),
    { progress: { "agency-setup": true, "add-site": false } },
  );

  const unknown = assertThrows(
    () => parsePatch({ progress: { "made-up": true } }),
    ArmatureError,
  );
  assertEquals(unknown.code, "invalid");
  assertStringIncludes(unknown.message, "Unknown Getting Started section");

  const wrongValue = assertThrows(
    () => parsePatch({ progress: { "agency-setup": "yes" } }),
    ArmatureError,
  );
  assertEquals(wrongValue.code, "invalid");

  const wrongShape = assertThrows(
    () => parsePatch({ progress: [1, 2, 3] }),
    ArmatureError,
  );
  assertEquals(wrongShape.code, "invalid");
});

Deno.test("parsePatch validates video_overrides: allow-listed URLs or empty string to clear", () => {
  assertEquals(
    parsePatch({ video_overrides: { "agency-setup": "https://youtu.be/abc" } }),
    { video_overrides: { "agency-setup": "https://youtu.be/abc" } },
  );

  // Empty string clears.
  assertEquals(
    parsePatch({ video_overrides: { "agency-setup": "" } }),
    { video_overrides: { "agency-setup": "" } },
  );

  const badHost = assertThrows(
    () => parsePatch({ video_overrides: { "agency-setup": "https://example.com/video.mp4" } }),
    ArmatureError,
  );
  assertEquals(badHost.code, "invalid");
  assertStringIncludes(badHost.message, "not on our allow-list");

  const unknownKey = assertThrows(
    () => parsePatch({ video_overrides: { "made-up": "https://youtu.be/abc" } }),
    ArmatureError,
  );
  assertEquals(unknownKey.code, "invalid");
});

Deno.test("parsePatch returns an empty object when both fields are absent", () => {
  assertEquals(parsePatch({}), {});
});

Deno.test("mergePatch layers progress and video overrides onto the existing row", () => {
  const before = {
    progress: { "agency-setup": true } as Record<string, boolean>,
    video_overrides: { "agency-setup": "https://youtu.be/old" } as Record<string, string>,
  };
  const merged = mergePatch(before, {
    progress: { "add-site": true, "agency-setup": false },
    video_overrides: { "agency-setup": "https://youtu.be/new", "add-site": "" },
  });
  assertEquals(merged.progress, { "add-site": true });
  assertEquals(merged.video_overrides, { "agency-setup": "https://youtu.be/new" });
});

Deno.test("mergePatch onto null gives an object with only the patched keys", () => {
  const merged = mergePatch(null, {
    progress: { "agency-setup": true, "add-site": false },
    video_overrides: { "give-access": "https://vimeo.com/1" },
  });
  assertEquals(merged.progress, { "agency-setup": true });
  assertEquals(merged.video_overrides, { "give-access": "https://vimeo.com/1" });
});

Deno.test("emptyRow gives an all-defaults record with the given agency id", () => {
  const row = emptyRow("11111111-1111-4111-8111-111111111111");
  assertEquals(row.agency_id, "11111111-1111-4111-8111-111111111111");
  assertEquals(row.progress, {});
  assertEquals(row.video_overrides, {});
});
