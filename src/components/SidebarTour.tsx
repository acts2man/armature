/**
 * The first-run note on a site's Dashboard: one card that names what the menu on the
 * left holds, built from the same list the sidebar draws (src/components/siteNav.ts),
 * so it never mentions something that is not there yet. Inline, never an overlay, so it
 * cannot block anything; "Got it" hides it for good in this browser.
 */
import { useState } from "react";
import type { SiteNavEntry } from "./siteNav.ts";
import { Button } from "./ui.tsx";
import { IconMenu } from "./icons.tsx";

export const SIDEBAR_TOUR_KEY = "armature:dashboard:tour:v1";

function readDone(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_TOUR_KEY) === "done";
  } catch {
    return true;
  }
}

export function SidebarTour({ siteName, isStaff, items }: { siteName: string; isStaff: boolean; items: SiteNavEntry[] }) {
  const [done, setDone] = useState(readDone);
  if (done) return null;
  const listed = items.filter((item) => item.key !== "dashboard");
  const finish = () => {
    try {
      window.localStorage.setItem(SIDEBAR_TOUR_KEY, "done");
    } catch {
      // A private window: the note comes back next visit, which is fine.
    }
    setDone(true);
  };
  return (
    <section aria-label="Getting around" data-testid="sidebar-tour" className="flex flex-col gap-3 rounded-card border border-line bg-panel p-5 sm:flex-row sm:items-start sm:gap-5">
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-ground text-muted">
        <IconMenu size={18} />
      </span>
      <div className="min-w-0 flex-1 text-[14px] leading-relaxed text-text">
        <h2 className="font-sans text-[15px] font-bold tracking-normal">Everything for {siteName} is in the menu on the left</h2>
        <ul className="mt-1.5 flex flex-col gap-0.5 text-muted">
          {listed.map((item) => (
            <li key={item.key} className="flex items-center gap-2">
              <item.icon size={14} />
              <span>
                <span className="font-semibold text-text">{item.label}</span>: {item.blurb}.
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-muted">
          {isStaff ? "Back to Projects takes you to all your sites, and the site's name at the top switches between them. " : "Anything bigger than that, ask for it under Requests: Request a change goes straight to the agency. "}
          On a phone the menu sits behind the button at the top; on a desktop you can collapse it to icons.
        </p>
      </div>
      <Button variant="secondary" size="sm" onClick={finish} className="shrink-0 self-start">
        Got it
      </Button>
    </section>
  );
}
