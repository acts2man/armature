import { describe, expect, it } from "vitest";
import { dispatchUpdateAll, type UpdateAllSite, type UpdateKitResponse } from "./updateAllKits.ts";

function siteList(count: number): UpdateAllSite[] {
  return Array.from({ length: count }, (_, index) => ({ id: `s${index}`, name: `Site ${index}` }));
}

function ok(from: string, to: string): UpdateKitResponse {
  return { ok: true, from, to, commit: { sha: "abc123abc", url: `https://example/commits/abc123abc-${to}` }, update_id: "u-1" };
}

describe("dispatchUpdateAll", () => {
  it("runs every site and returns a final progress with done states", async () => {
    const runner = dispatchUpdateAll(siteList(5), {
      runOne: () => Promise.resolve(ok("2.8.0", "2.9.0")),
    });
    const final = await runner.promise;
    expect(final.runs.every((r) => r.state === "done")).toBe(true);
    expect(final.paused).toBe(false);
  });

  it("captures per-site errors as state 'error' with the message", async () => {
    const runner = dispatchUpdateAll(siteList(3), {
      runOne: (site) => Promise.resolve(site.id === "s1" ? { code: "invalid", message: "boom" } : ok("2.8.0", "2.9.0")),
    });
    const final = await runner.promise;
    const s1 = final.runs.find((r) => r.siteId === "s1");
    expect(s1?.state).toBe("error");
    expect(s1?.message).toBe("boom");
  });

  it("pauses when two errors land in a row and resume continues", async () => {
    // Sites 0 and 1 error, site 2 succeeds. With concurrency=1 the run order matches queue order,
    // so we hit the two-in-a-row rule before running site 2.
    let paused = false;
    let sawPause: (() => void) | null = null;
    const pausePromise = new Promise<void>((resolve) => { sawPause = resolve; });
    const runner = dispatchUpdateAll(siteList(3), {
      concurrency: 1,
      onProgress: (progress) => {
        if (progress.paused && !paused) {
          paused = true;
          sawPause?.();
        }
      },
      runOne: (site) => (site.id === "s0" || site.id === "s1"
        ? Promise.resolve({ code: "invalid", message: "no" })
        : Promise.resolve(ok("2.8.0", "2.9.0"))),
    });

    await pausePromise;
    runner.resume();
    const final = await runner.promise;
    expect(final.runs.find((r) => r.siteId === "s2")?.state).toBe("done");
    expect(final.paused).toBe(false);
  });

  it("stop() marks remaining queued rows as skipped", async () => {
    const runner = dispatchUpdateAll(siteList(4), {
      concurrency: 1,
      runOne: (site) => new Promise((resolve) => setTimeout(() => resolve(ok("2.8.0", "2.9.0")), 20 * (site.id === "s0" ? 1 : 500))),
    });
    // Stop very early — only s0 should have finished by the time we resolve.
    await new Promise((resolve) => setTimeout(resolve, 5));
    runner.stop();
    const final = await runner.promise;
    const skipped = final.runs.filter((r) => r.state === "skipped");
    expect(skipped.length).toBeGreaterThan(0);
  });
});
