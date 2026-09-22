/**
 * The 264px panel on the left for a v2 site: Elements, Navigator, Pages and History
 * tabs (Site settings and Media join in later milestones). The Pages tab is the same
 * list the Stage 1 panel shows.
 */
import { clsx } from "clsx";
import type { ReactNode } from "react";

export type BuilderTab = "elements" | "navigator" | "pages" | "history" | "site" | "media";

const LABELS: Record<BuilderTab, string> = { elements: "Elements", navigator: "Navigator", pages: "Pages", history: "History", site: "Site", media: "Media" };

export function BuilderPanel({ tab, tabs, onTab, children }: { tab: BuilderTab; tabs: BuilderTab[]; onTab: (tab: BuilderTab) => void; children: ReactNode }) {
  return (
    <aside aria-label="Page structure" className="flex w-[264px] shrink-0 flex-col border-r border-line bg-panel" data-testid="builder-panel">
      <div className="px-3 pb-2.5 pt-3.5">
        <div role="tablist" aria-label="Panel" className="flex gap-0.5 rounded-control bg-ground p-0.5">
          {tabs.map((item) => (
            <button key={item} type="button" role="tab" aria-selected={tab === item} data-testid={`tab-${item}`} onClick={() => onTab(item)} className={clsx("h-8 flex-1 rounded-sm px-1 text-[12px] font-semibold", tab === item ? "bg-panel text-text shadow-segment" : "text-muted hover:text-text")}>
              {LABELS[item]}
            </button>
          ))}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col" role="tabpanel">
        {children}
      </div>
    </aside>
  );
}
