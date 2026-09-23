/**
 * The single switching panel on the left of the builder (Elementor-style): about 340px
 * wide, holding exactly one mode at a time — Elements (widgets + globals), Edit (the
 * selected element or field), Page settings or History. Each mode brings its own header;
 * this shell only draws the panel and the collapse tab on its right edge. Collapsing
 * hides the panel so the canvas fills the window; the state is remembered per user.
 */
import { clsx } from "clsx";
import type { ReactNode } from "react";
import { IconChevronRight } from "@/components/icons.tsx";

export function BuilderPanel({ collapsed, onToggle, children }: { collapsed: boolean; onToggle: (collapsed: boolean) => void; children: ReactNode }) {
  return (
    <div className="relative flex shrink-0" data-testid="builder-panel" data-collapsed={collapsed ? "1" : undefined}>
      <aside aria-label="Editor panel" className={clsx("flex flex-col overflow-hidden border-r border-line bg-panel transition-[width] duration-200 ease-[var(--ease-standard)]", collapsed ? "w-0" : "w-[340px]")}>
        {!collapsed && <div className="flex min-h-0 flex-1 flex-col">{children}</div>}
      </aside>
      <button
        type="button"
        aria-label={collapsed ? "Show the panel" : "Hide the panel"}
        aria-expanded={!collapsed}
        title={collapsed ? "Show the panel" : "Hide the panel"}
        onClick={() => onToggle(!collapsed)}
        data-testid="panel-collapse"
        className="absolute top-1/2 z-20 flex h-14 w-[18px] -translate-y-1/2 items-center justify-center rounded-r-md border border-l-0 border-line bg-panel text-muted shadow-segment hover:text-text"
        style={{ left: collapsed ? 0 : 340 }}
      >
        <IconChevronRight size={14} className={collapsed ? undefined : "rotate-180"} />
      </button>
    </div>
  );
}
