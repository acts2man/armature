import { assertEquals } from "jsr:@std/assert@1";
import { classify, KIT_LIVE_WINDOW_MS, parseLiveKitVersion, pollPendingKitUpdates, tokenFromRequest, type PendingRow } from "./kitLive.ts";

const iso = (ms: number) => new Date(ms).toISOString();
const now = 1_700_000_000_000;

Deno.test("parseLiveKitVersion: pulls the attribute out of <html>", () => {
  assertEquals(parseLiveKitVersion(`<html lang="en" data-armature-kit="2.9.0"><body/></html>`), "2.9.0");
  assertEquals(parseLiveKitVersion(`<html data-armature-kit='2.10.0-rc.1' lang='x'>`), "2.10.0-rc.1");
  assertEquals(parseLiveKitVersion(`<html><body/></html>`), null);
});

Deno.test("tokenFromRequest: accepts either casing of the header", () => {
  const req = new Request("http://x", { method: "POST", headers: { "X-Armature-Token": "abc" } });
  assertEquals(tokenFromRequest(req), "abc");
});

Deno.test("classify: matching live version flips a commit_pushed row to live_confirmed", () => {
  const row: PendingRow = { id: "r1", site_id: "s1", to_version: "2.9.0", status: "commit_pushed", created_at: iso(now - 30_000), attempts: 0 };
  const outcome = classify(row, "2.9.0", now);
  assertEquals(outcome.verdict, "confirmed");
  assertEquals(outcome.nextStatus, "live_confirmed");
  assertEquals(outcome.reason, null);
});

Deno.test("classify: matching live version flips an undo_pushed row to undo_confirmed", () => {
  const row: PendingRow = { id: "r2", site_id: "s2", to_version: "2.8.0", status: "undo_pushed", created_at: iso(now - 60_000), attempts: 1 };
  const outcome = classify(row, "2.8.0", now);
  assertEquals(outcome.verdict, "confirmed");
  assertEquals(outcome.nextStatus, "undo_confirmed");
});

Deno.test("classify: too old and still not seen flips to needs_attention", () => {
  const row: PendingRow = { id: "r3", site_id: "s3", to_version: "2.9.0", status: "commit_pushed", created_at: iso(now - KIT_LIVE_WINDOW_MS - 1_000), attempts: 5 };
  const outcome = classify(row, "2.8.0", now);
  assertEquals(outcome.verdict, "attention");
  assertEquals(outcome.nextStatus, "needs_attention");
  assertEquals(outcome.reason?.includes("didn't rebuild"), true);
});

Deno.test("classify: within the window and no match stays waiting", () => {
  const row: PendingRow = { id: "r4", site_id: "s4", to_version: "2.9.0", status: "commit_pushed", created_at: iso(now - 60_000), attempts: 0 };
  const outcome = classify(row, null, now);
  assertEquals(outcome.verdict, "still_waiting");
  assertEquals(outcome.nextStatus, "commit_pushed");
});

// Minimal builder for a mock SupabaseClient — only the two chains kitLive uses.
type UpdateArgs = { table: string; match: Record<string, unknown>; values: Record<string, unknown> };

function buildMockDb(options: {
  pending: PendingRow[];
  sites: Record<string, { live_url: string | null }>;
  liveHtml: Record<string, string | null>;
}) {
  const updates: UpdateArgs[] = [];
  const impl = {
    from(table: string) {
      const chain: Record<string, unknown> = {
        select(_columns: string) {
          if (table === "sites") {
            return {
              eq(_column: string, siteId: string) {
                return { maybeSingle: () => Promise.resolve({ data: options.sites[siteId] ?? null, error: null }) };
              },
            };
          }
          return {
            in(_column: string, _values: string[]) {
              return {
                gte(_column: string, _value: string) {
                  return {
                    order() {
                      return { limit: () => Promise.resolve({ data: options.pending, error: null }) };
                    },
                  };
                },
              };
            },
          };
        },
        update(values: Record<string, unknown>) {
          return {
            eq(column: string, value: string) {
              updates.push({ table, match: { [column]: value }, values });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
      return chain;
    },
  };
  return { db: impl as unknown as Parameters<typeof pollPendingKitUpdates>[0], updates };
}

Deno.test("pollPendingKitUpdates: confirms a matching live version and updates sites.kit_version_live", async () => {
  const pending: PendingRow[] = [{ id: "r-conf", site_id: "s-conf", to_version: "2.9.0", status: "commit_pushed", created_at: iso(now - 60_000), attempts: 0 }];
  const { db, updates } = buildMockDb({
    pending,
    sites: { "s-conf": { live_url: "https://demo.example.com/" } },
    liveHtml: { "https://demo.example.com/": `<html data-armature-kit="2.9.0"><body/></html>` },
  });
  const fetchImpl: typeof fetch = ((input: RequestInfo | URL) =>
    Promise.resolve(new Response((({ "https://demo.example.com/": `<html data-armature-kit="2.9.0"><body/></html>` })[String(input)] ?? "<html/>"), { status: 200 }))) as typeof fetch;

  const outcomes = await pollPendingKitUpdates(db, { now: () => now, fetchImpl });
  assertEquals(outcomes[0]?.verdict, "confirmed");
  assertEquals(outcomes[0]?.live, "2.9.0");
  const rowUpdate = updates.find((u) => u.table === "kit_updates");
  assertEquals(rowUpdate?.values.status, "live_confirmed");
  const siteUpdate = updates.find((u) => u.table === "sites");
  assertEquals(siteUpdate?.values.kit_version_live, "2.9.0");
});

Deno.test("pollPendingKitUpdates: marks needs_attention when a site has no live URL", async () => {
  const pending: PendingRow[] = [{ id: "r-nurl", site_id: "s-nurl", to_version: "2.9.0", status: "commit_pushed", created_at: iso(now - 60_000), attempts: 0 }];
  const { db, updates } = buildMockDb({
    pending,
    sites: { "s-nurl": { live_url: null } },
    liveHtml: {},
  });
  const fetchImpl: typeof fetch = (() => { throw new Error("fetch should not run"); }) as typeof fetch;
  const outcomes = await pollPendingKitUpdates(db, { now: () => now, fetchImpl });
  assertEquals(outcomes[0]?.verdict, "attention");
  const rowUpdate = updates.find((u) => u.table === "kit_updates");
  assertEquals(rowUpdate?.values.status, "needs_attention");
});

Deno.test("pollPendingKitUpdates: increments attempts and stores the last live value seen while waiting", async () => {
  const pending: PendingRow[] = [{ id: "r-wait", site_id: "s-wait", to_version: "2.9.0", status: "commit_pushed", created_at: iso(now - 60_000), attempts: 2 }];
  const { db, updates } = buildMockDb({
    pending,
    sites: { "s-wait": { live_url: "https://demo.example.com/" } },
    liveHtml: { "https://demo.example.com/": `<html data-armature-kit="2.8.0"><body/></html>` },
  });
  const fetchImpl: typeof fetch = ((_input: RequestInfo | URL) =>
    Promise.resolve(new Response(`<html data-armature-kit="2.8.0"><body/></html>`, { status: 200 }))) as typeof fetch;
  const outcomes = await pollPendingKitUpdates(db, { now: () => now, fetchImpl });
  assertEquals(outcomes[0]?.verdict, "still_waiting");
  const rowUpdate = updates.find((u) => u.table === "kit_updates");
  assertEquals(rowUpdate?.values.attempts, 3);
  assertEquals(rowUpdate?.values.live_version_seen, "2.8.0");
  assertEquals(rowUpdate?.values.status, "commit_pushed");
});
