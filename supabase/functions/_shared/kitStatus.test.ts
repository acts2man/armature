import { assertEquals } from "jsr:@std/assert@1";
import { KIT_VERSION } from "../../../kit/version.ts";
import { fetchLiveKitVersion, parseLiveKitVersion, readRepoKitVersion, resolveKitStatus } from "./kitStatus.ts";

const versionSource = (version: string) => `export const KIT_VERSION = "${version}";\n`;

function fakeRead(files: Record<string, string>) {
  return (path: string) => Promise.resolve(files[path] ?? null);
}

function fakeFetch(html: string, ok = true): typeof fetch {
  return () => Promise.resolve(new Response(html, { status: ok ? 200 : 500 })) as unknown as ReturnType<typeof fetch>;
}

Deno.test("parseLiveKitVersion reads the attribute out of raw HTML", () => {
  assertEquals(parseLiveKitVersion('<html data-armature-kit="2.7.0" data-x="y">hi</html>'), "2.7.0");
  assertEquals(parseLiveKitVersion("<html data-armature-kit='2.6.3'>hi</html>"), "2.6.3");
  assertEquals(parseLiveKitVersion("<html>hi</html>"), null);
});

Deno.test("fetchLiveKitVersion returns null when the site is unreachable or the attribute is missing", async () => {
  assertEquals(await fetchLiveKitVersion("https://x/", fakeFetch("<html></html>")), null);
  assertEquals(await fetchLiveKitVersion("https://x/", fakeFetch("no", false)), null);
  assertEquals(await fetchLiveKitVersion("https://x/", fakeFetch('<html data-armature-kit="2.5.0"></html>')), "2.5.0");
});

Deno.test("readRepoKitVersion prefers version.ts, falls back to index.ts", async () => {
  const withVersion = await readRepoKitVersion(fakeRead({ "src/lib/armature-kit/version.ts": versionSource("2.7.0") }), "src/lib/armature-kit");
  assertEquals(withVersion.version, "2.7.0");
  assertEquals(withVersion.probed[0]?.path, "src/lib/armature-kit/version.ts");

  const indexOnly = await readRepoKitVersion(fakeRead({ "src/lib/armature-kit/index.ts": versionSource("2.6.0") }), "src/lib/armature-kit");
  assertEquals(indexOnly.version, "2.6.0");
  assertEquals(indexOnly.probed.map((p) => p.ok), [false, true]);

  const nothing = await readRepoKitVersion(fakeRead({}), "src/lib/armature-kit");
  assertEquals(nothing.version, null);
});

Deno.test("resolveKitStatus: up_to_date when repo matches current", async () => {
  const status = await resolveKitStatus({
    kitPath: "src/lib/armature-kit",
    liveUrl: null,
    read: fakeRead({ "src/lib/armature-kit/version.ts": versionSource(KIT_VERSION) }),
  });
  assertEquals(status.verdict, "up_to_date");
  assertEquals(status.pendingSteps, []);
});

Deno.test("resolveKitStatus: update_available when older but no new setup step (2.7.0 → 2.8.0 in current manifest)", async () => {
  const status = await resolveKitStatus({
    kitPath: "src/lib/armature-kit",
    liveUrl: null,
    read: fakeRead({ "src/lib/armature-kit/version.ts": versionSource("2.7.0") }),
  });
  // 2.8.0's step is a no-op ("No site step needed"), so the verdict is update_available.
  assertEquals(status.verdict, "update_available");
});

Deno.test("resolveKitStatus: needs_setup when new setup steps sit between the repo version and current", async () => {
  const status = await resolveKitStatus({
    kitPath: "src/lib/armature-kit",
    liveUrl: null,
    read: fakeRead({ "src/lib/armature-kit/version.ts": versionSource("2.4.0") }),
  });
  assertEquals(status.verdict, "needs_setup");
  const stepKeys = status.pendingSteps.map((s) => s.key);
  // Everything from 2.5.0 onward should show up.
  assertEquals(stepKeys.includes("stats-config"), true);
  assertEquals(stepKeys.includes("seo-head"), true);
});

Deno.test("resolveKitStatus: not_installed when no KIT_VERSION is found in the repo", async () => {
  const status = await resolveKitStatus({
    kitPath: "src/lib/armature-kit",
    liveUrl: null,
    read: fakeRead({}),
  });
  assertEquals(status.verdict, "not_installed");
  assertEquals(status.inRepo, null);
});

Deno.test("resolveKitStatus honours a custom kit_path", async () => {
  const status = await resolveKitStatus({
    kitPath: "packages/kit",
    liveUrl: null,
    read: fakeRead({ "packages/kit/version.ts": versionSource("2.7.0") }),
  });
  assertEquals(status.inRepo, "2.7.0");
});

Deno.test("resolveKitStatus reads the live version when live_url is set", async () => {
  const status = await resolveKitStatus({
    kitPath: "src/lib/armature-kit",
    liveUrl: "https://example.com/",
    read: fakeRead({ "src/lib/armature-kit/version.ts": versionSource("2.7.0") }),
    fetchImpl: fakeFetch('<html data-armature-kit="2.6.0"></html>'),
  });
  assertEquals(status.live, "2.6.0");
});
