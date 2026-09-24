/**
 * Pure calculator behind the Dashboard's Stats snapshot card. Given a list of
 * daily rollup rows, returns the two 7-day totals (this week vs. the 7 days
 * before), the top page across this week, and whether any data exists yet.
 */
export type DailyRow = {
  site_id: string;
  day: string;
  visitors: number;
  page_views: number;
  top_pages: { path: string; views: number }[] | null;
};

export type Summary = {
  thisWeek: { visitors: number; pageViews: number; topPath: string | null };
  lastWeek: { visitors: number; pageViews: number };
  hasAny: boolean;
};

export function summarize(rows: DailyRow[], now = new Date()): Summary {
  const today = now.toISOString().slice(0, 10);
  const cutoffThis = new Date(now.getTime() - 7 * 86400_000).toISOString().slice(0, 10);
  const cutoffLast = new Date(now.getTime() - 14 * 86400_000).toISOString().slice(0, 10);
  const inThisWeek = (row: DailyRow) => row.day > cutoffThis && row.day <= today;
  const inLastWeek = (row: DailyRow) => row.day > cutoffLast && row.day <= cutoffThis;

  const thisWeekRows = rows.filter(inThisWeek);
  const lastWeekRows = rows.filter(inLastWeek);

  const paths = new Map<string, number>();
  for (const row of thisWeekRows) for (const item of row.top_pages ?? []) paths.set(item.path, (paths.get(item.path) ?? 0) + item.views);
  const topEntry = [...paths.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    thisWeek: {
      visitors: thisWeekRows.reduce((total, row) => total + row.visitors, 0),
      pageViews: thisWeekRows.reduce((total, row) => total + row.page_views, 0),
      topPath: topEntry?.[0] ?? null,
    },
    lastWeek: {
      visitors: lastWeekRows.reduce((total, row) => total + row.visitors, 0),
      pageViews: lastWeekRows.reduce((total, row) => total + row.page_views, 0),
    },
    hasAny: rows.length > 0,
  };
}
