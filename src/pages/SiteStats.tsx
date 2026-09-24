/**
 * /sites/:siteId/stats — cookie-free visitor numbers. The full Stats implementation
 * (beacon, edge function, nightly rollup, chart) lands in Part 2 of Job D. This screen
 * reads whatever is already in site_stats_daily and shows it plainly; the empty state
 * says how to turn the beacon on.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useSite } from "@/components/SiteLayout.tsx";
import { EmptyState, Notice, PageHeader, Panel, Select, Skeleton, StatCard } from "@/components/ui.tsx";
import { supabase } from "@/lib/supabase.ts";

type DailyRow = {
  site_id: string;
  day: string;
  visitors: number;
  page_views: number;
  top_pages: { path: string; views: number }[] | null;
  top_referrers: { referrer: string; views: number }[] | null;
  top_devices: { device: string; views: number }[] | null;
};

type Range = "7" | "30" | "90" | "365";

async function loadDaily(siteId: string, range: Range): Promise<DailyRow[]> {
  const days = Number(range);
  const from = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase.from("site_stats_daily").select("*").eq("site_id", siteId).gte("day", from).order("day", { ascending: true });
  if (error) return [];
  return (data ?? []) as DailyRow[];
}

function sum<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

export function SiteStats() {
  const { site } = useSite();
  const [range, setRange] = useState<Range>("30");
  const query = useQuery({ queryKey: ["site-stats", site.id, range], queryFn: () => loadDaily(site.id, range) });
  const rows = useMemo(() => query.data ?? [], [query.data]);

  const totals = useMemo(() => ({
    visitors: sum(rows, (row) => row.visitors),
    pageViews: sum(rows, (row) => row.page_views),
  }), [rows]);

  const topPages = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) for (const item of row.top_pages ?? []) map.set(item.path, (map.get(item.path) ?? 0) + item.views);
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [rows]);
  const topReferrers = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) for (const item of row.top_referrers ?? []) map.set(item.referrer, (map.get(item.referrer) ?? 0) + item.views);
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [rows]);
  const topDevices = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) for (const item of row.top_devices ?? []) map.set(item.device, (map.get(item.device) ?? 0) + item.views);
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  return (
    <div className="flex flex-col gap-5" data-testid="site-stats">
      <PageHeader
        title="Stats"
        description="Cookie-free visitor numbers for this site. The beacon runs no third-party trackers and stores no IP addresses; the numbers are estimates because some visitors block trackers."
        action={
          <Select value={range} onChange={(event) => setRange(event.target.value as Range)} className="h-10 w-32" data-testid="stats-range">
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last 12 months</option>
          </Select>
        }
      />
      {query.isPending ? (
        <div className="rounded-card border border-line bg-panel p-4"><Skeleton lines={3} /></div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col gap-3">
          <EmptyState title="No stats yet">Turn on the beacon in the site's kit config to start collecting visitor numbers. No cookies are set; nothing personal is stored.</EmptyState>
          <pre className="max-w-full overflow-x-auto rounded-card border border-line bg-panel p-3 text-[12px] font-mono"><code>{`createArmatureKit({
  stats: {
    endpoint: "https://<project>.supabase.co/functions/v1/stats-ingest",
    siteId: "<site id>",
  },
})`}</code></pre>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
            <StatCard label="Visitors" value={totals.visitors.toLocaleString()} />
            <StatCard label="Page views" value={totals.pageViews.toLocaleString()} />
            <StatCard label="Pages" value={topPages.length} />
            <StatCard label="Referrers" value={topReferrers.length} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Panel title="Top pages">
              {topPages.length === 0 ? <p className="text-[13px] text-muted">Nothing yet.</p> : (
                <ul className="flex flex-col gap-1 text-[13px]" data-testid="stats-top-pages">
                  {topPages.map(([path, views]) => (
                    <li key={path} className="flex items-center justify-between border-b border-line py-1 last:border-b-0">
                      <span className="truncate font-mono">{path}</span>
                      <span className="ml-2 text-muted">{views.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Top referrers">
              {topReferrers.length === 0 ? <p className="text-[13px] text-muted">Nothing yet.</p> : (
                <ul className="flex flex-col gap-1 text-[13px]" data-testid="stats-top-referrers">
                  {topReferrers.map(([referrer, views]) => (
                    <li key={referrer} className="flex items-center justify-between border-b border-line py-1 last:border-b-0">
                      <span className="truncate">{referrer}</span>
                      <span className="ml-2 text-muted">{views.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
          <Panel title="Devices">
            {topDevices.length === 0 ? <p className="text-[13px] text-muted">Nothing yet.</p> : (
              <ul className="flex gap-3 text-[13px]" data-testid="stats-devices">
                {topDevices.map(([device, views]) => (
                  <li key={device} className="rounded-control border border-line px-3 py-2">
                    <span className="font-semibold capitalize">{device}</span> <span className="text-muted">{views.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Notice kind="info" title="How the numbers are counted">
            The beacon sends the path, the referrer's domain, device type and a screen-size bucket. Bots, the editor preview and Do Not Track / Global Privacy Control visitors are skipped. Unique visitors are counted with a salted hash of the IP and user-agent that rotates every day; the IP itself is never stored.
          </Notice>
        </>
      )}
    </div>
  );
}
