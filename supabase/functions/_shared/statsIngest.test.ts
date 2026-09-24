import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { ArmatureError } from "./errors.ts";
import { checkOrigin, handleStatsIngest, makeRateLimiter, parseIngestBody, visitorHash, type IngestSiteRow } from "./statsIngest.ts";

const validPayload = {
  siteId: "aaaaaaaa-1111-4111-8111-111111111111",
  path: "/",
  referrerHost: null,
  device: "desktop" as const,
  screenBucket: "lg" as const,
};

Deno.test("parseIngestBody accepts a well-formed payload", () => {
  const out = parseIngestBody(validPayload);
  assertEquals(out.siteId, validPayload.siteId);
  assertEquals(out.path, "/");
  assertEquals(out.device, "desktop");
  assertEquals(out.screenBucket, "lg");
});

Deno.test("parseIngestBody rejects a missing or bad siteId", () => {
  let threw = false;
  try {
    parseIngestBody({ ...validPayload, siteId: "not-a-uuid" });
  } catch (error) {
    threw = error instanceof ArmatureError && error.code === "invalid";
  }
  assertEquals(threw, true);
});

Deno.test("parseIngestBody rejects a path that does not start with /", () => {
  let threw = false;
  try {
    parseIngestBody({ ...validPayload, path: "no-slash" });
  } catch (error) {
    threw = error instanceof ArmatureError && error.code === "invalid";
  }
  assertEquals(threw, true);
});

Deno.test("parseIngestBody clamps overlong strings and unknown enum values", () => {
  const long = "/" + "a".repeat(1000);
  const out = parseIngestBody({ ...validPayload, path: long, device: "phone" as never, screenBucket: "huge" as never });
  assertEquals(out.path.length, 512);
  assertEquals(out.device, "unknown");
  assertEquals(out.screenBucket, "md");
});

Deno.test("checkOrigin passes when the origin matches the site's live_url", () => {
  const req = new Request("https://x/", { headers: { origin: "https://example.com" } });
  checkOrigin({ id: "1", live_url: "https://example.com/" }, req);
});

Deno.test("checkOrigin refuses when the origin is a different host", () => {
  const req = new Request("https://x/", { headers: { origin: "https://intruder.example.com" } });
  let threw = false;
  try {
    checkOrigin({ id: "1", live_url: "https://example.com/" }, req);
  } catch (error) {
    threw = error instanceof ArmatureError && error.code === "forbidden";
  }
  assertEquals(threw, true);
});

Deno.test("checkOrigin lets a site with no live_url through (still being wired up)", () => {
  const req = new Request("https://x/", { headers: { origin: "https://wherever.example.com" } });
  checkOrigin({ id: "1", live_url: null }, req);
});

Deno.test("makeRateLimiter fires 120 times then returns false", () => {
  const rate = makeRateLimiter(120);
  const start = 1_000_000;
  for (let i = 0; i < 120; i++) assertEquals(rate("key", start), true);
  assertEquals(rate("key", start), false);
  // A minute later the bucket resets.
  assertEquals(rate("key", start + 60_001), true);
});

Deno.test("visitorHash hashes to a 32-char hex string that changes across days", async () => {
  const day1 = await visitorHash("1.2.3.4", "UA", "salt", "2026-09-24");
  const day2 = await visitorHash("1.2.3.4", "UA", "salt", "2026-09-25");
  assertEquals(day1.length, 32);
  if (day1 === day2) throw new Error("expected different hashes on different days");
});

// -- handleStatsIngest: end-to-end with mocks --------------------------------

function fakeSite(): IngestSiteRow {
  return { id: validPayload.siteId, live_url: "https://demo.example.com/" };
}

function stubHooks(overrides: {
  site?: IngestSiteRow | null;
  insertEvent?: (row: Record<string, unknown>) => Promise<void>;
  rateLimiter?: (key: string, now?: number) => boolean;
} = {}) {
  const inserted: Record<string, unknown>[] = [];
  return {
    inserted,
    hooks: {
      loadSite: () => Promise.resolve(overrides.site === undefined ? fakeSite() : overrides.site),
      insertEvent: overrides.insertEvent ?? ((row) => {
        inserted.push(row);
        return Promise.resolve();
      }),
      ...(overrides.rateLimiter ? { rateLimiter: overrides.rateLimiter } : {}),
    },
  };
}

Deno.test("handleStatsIngest accepts an anonymous beacon with a matching origin, no JWT required", async () => {
  const { inserted, hooks } = stubHooks();
  const req = new Request("https://x/", { method: "POST", headers: { origin: "https://demo.example.com", "user-agent": "Mozilla/5.0" } });
  const result = await handleStatsIngest({ STATS_IP_SALT: "salt" }, req, validPayload, hooks);
  assertEquals(result, { ok: true });
  assertEquals(inserted.length, 1);
  assertEquals(inserted[0]?.site_id, validPayload.siteId);
  assertEquals(inserted[0]?.path, "/");
  const hash = inserted[0]?.visitor_hash;
  assertEquals(typeof hash, "string");
  assertEquals((hash as string).length, 32);
});

Deno.test("handleStatsIngest rejects a beacon whose Origin does not match live_url", async () => {
  const { hooks } = stubHooks();
  const req = new Request("https://x/", { method: "POST", headers: { origin: "https://intruder.example.com" } });
  await assertRejects(() => handleStatsIngest({}, req, validPayload, hooks), ArmatureError, "not allowed");
});

Deno.test("handleStatsIngest rejects a beacon for an unknown site", async () => {
  const { hooks } = stubHooks({ site: null });
  const req = new Request("https://x/", { method: "POST", headers: { origin: "https://demo.example.com" } });
  await assertRejects(() => handleStatsIngest({}, req, validPayload, hooks), ArmatureError, "Unknown site");
});

Deno.test("handleStatsIngest rejects a beacon whose body has no siteId", async () => {
  const { hooks } = stubHooks();
  const req = new Request("https://x/", { method: "POST" });
  await assertRejects(() => handleStatsIngest({}, req, { path: "/", device: "desktop", screenBucket: "lg", referrerHost: null }, hooks), ArmatureError, "siteId");
});

Deno.test("handleStatsIngest silently drops a rate-limited beacon", async () => {
  const { inserted, hooks } = stubHooks({ rateLimiter: () => false });
  const req = new Request("https://x/", { method: "POST", headers: { origin: "https://demo.example.com" } });
  const result = await handleStatsIngest({}, req, validPayload, hooks);
  assertEquals(result, { ok: true });
  assertEquals(inserted.length, 0);
});
