/**
 * The Stats snapshot card on a site's Dashboard: visitors and page views in the last
 * seven days, compared to the seven before, the top page from that week, and a link
 * to the full Stats screen. Reads site_stats_daily directly, so it needs no beacon
 * connectivity to work — an empty state welcomes clients whose beacon has not been
 * wired up yet (with a friendly nudge for agency staff pointing at Site settings).
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link } from "react-router";
import { IconChart, IconArrowRight } from "@/components/icons.tsx";
import { EmptyState, Panel, Skeleton } from "@/components/ui.tsx";
import { supabase } from "@/lib/supabase.ts";
import { summarize, type DailyRow } from "./statsSnapshot.ts";

async function loadTwoWeeks(siteId: string): Promise<DailyRow[]> {
  const from = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase.from("site_stats_daily").select("day, visitors, page_views, top_pages, site_id").eq("site_id", siteId).gte("day", from).order("day", { ascending: true });
  if (error) return [];
  return (data ?? []) as DailyRow[];
}

function Delta({ current, previous }: { current: number; previous: number }) {
  if (previous === 0 && current === 0) return <span className="text-muted">No change</span>;
  if (previous === 0) return <span className="text-green" data-testid="stats-delta">New</span>;
  const change = ((current - previous) / previous) * 100;
  const rounded = Math.round(change);
  const tone = rounded > 0 ? "text-green" : rounded < 0 ? "text-danger" : "text-muted";
  const sign = rounded > 0 ? "+" : "";
  return <span className={tone} data-testid="stats-delta">{sign}{rounded}% vs the 7 days before</span>;
}

export function StatsSnapshotCard({ siteId, siteRoot, isStaff, hostingOnly }: { siteId: string; siteRoot: string; isStaff: boolean; hostingOnly: boolean }) {
  const query = useQuery({ queryKey: ["site-stats-snapshot", siteId], queryFn: () => loadTwoWeeks(siteId) });
  const summary = useMemo(() => summarize(query.data ?? []), [query.data]);

  const link = (
    <Link to={`${siteRoot}/stats`} className="inline-flex h-9 items-center gap-1 rounded-control px-3 text-[13px] font-semibold text-text hover:bg-ground">
      Full stats <IconArrowRight size={14} />
    </Link>
  );

  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-2">
          <IconChart size={16} /> Stats · last 7 days
        </span>
      }
      aside={link}
    >
      <div className="p-5" data-testid="stats-snapshot">
        {query.isPending ? (
          <Skeleton lines={3} />
        ) : !summary.hasAny ? (
          <EmptyState title="No visitors counted yet" icon={<IconChart size={18} />}>
            {hostingOnly
              ? "This site is looked after by the agency, so nothing is published from here yet."
              : isStaff
                ? "Turn on the beacon in the site's kit config (Site settings → Stats has the snippet) and numbers appear within a day."
                : "Once the site's been up for a day or two, the numbers land here. Nothing personal is stored."}
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2" data-testid="stats-snapshot-metrics">
              <div className="rounded-card border border-line bg-panel px-4 py-3">
                <div className="text-[12px] font-semibold uppercase tracking-wide text-muted">Visitors</div>
                <div className="mt-0.5 text-[24px] font-bold text-text" data-testid="stats-snapshot-visitors">{summary.thisWeek.visitors.toLocaleString()}</div>
                <div className="text-[12px]"><Delta current={summary.thisWeek.visitors} previous={summary.lastWeek.visitors} /></div>
              </div>
              <div className="rounded-card border border-line bg-panel px-4 py-3">
                <div className="text-[12px] font-semibold uppercase tracking-wide text-muted">Page views</div>
                <div className="mt-0.5 text-[24px] font-bold text-text" data-testid="stats-snapshot-views">{summary.thisWeek.pageViews.toLocaleString()}</div>
                <div className="text-[12px]"><Delta current={summary.thisWeek.pageViews} previous={summary.lastWeek.pageViews} /></div>
              </div>
            </div>
            {summary.thisWeek.topPath && (
              <div className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-muted">
                <span>Top page:</span>
                <span className="font-mono text-text" data-testid="stats-snapshot-top">{summary.thisWeek.topPath}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
