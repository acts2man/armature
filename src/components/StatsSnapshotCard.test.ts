import { describe, expect, it } from "vitest";
import { summarize, type DailyRow } from "./statsSnapshot.ts";

const day = (offsetDays: number, now: Date) => new Date(now.getTime() - offsetDays * 86400_000).toISOString().slice(0, 10);

describe("summarize", () => {
  const now = new Date("2026-09-24T12:00:00Z");
  const site_id = "site";

  it("returns zeroes with no data", () => {
    const out = summarize([], now);
    expect(out.hasAny).toBe(false);
    expect(out.thisWeek.visitors).toBe(0);
    expect(out.thisWeek.pageViews).toBe(0);
    expect(out.thisWeek.topPath).toBeNull();
  });

  it("splits rows into the last 7 days and the 7 before", () => {
    const rows: DailyRow[] = [
      { site_id, day: day(1, now), visitors: 10, page_views: 30, top_pages: [{ path: "/", views: 20 }] },
      { site_id, day: day(3, now), visitors: 5, page_views: 12, top_pages: [{ path: "/about/", views: 8 }] },
      { site_id, day: day(9, now), visitors: 4, page_views: 8, top_pages: null },
      { site_id, day: day(13, now), visitors: 3, page_views: 5, top_pages: null },
    ];
    const out = summarize(rows, now);
    expect(out.hasAny).toBe(true);
    expect(out.thisWeek.visitors).toBe(15);
    expect(out.thisWeek.pageViews).toBe(42);
    expect(out.lastWeek.visitors).toBe(7);
    expect(out.lastWeek.pageViews).toBe(13);
    expect(out.thisWeek.topPath).toBe("/");
  });

  it("aggregates top_pages across the week", () => {
    const rows: DailyRow[] = [
      { site_id, day: day(1, now), visitors: 1, page_views: 4, top_pages: [{ path: "/", views: 2 }, { path: "/about/", views: 2 }] },
      { site_id, day: day(2, now), visitors: 1, page_views: 5, top_pages: [{ path: "/about/", views: 5 }] },
    ];
    const out = summarize(rows, now);
    expect(out.thisWeek.topPath).toBe("/about/");
  });
});
