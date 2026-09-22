/** The 56px dark rail on the left of the visual editor. */
import { clsx } from "clsx";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { IconBranch, IconGlobe, IconGrid, IconHistory, IconPage, IconPencil, IconSettings } from "@/components/icons.tsx";

function RailLink({ to, label, active, children }: { to: string; label: string; active?: boolean; children: ReactNode }) {
  return (
    <Link
      to={to}
      aria-label={label}
      title={label}
      aria-current={active ? "page" : undefined}
      className={clsx("flex h-11 w-11 items-center justify-center rounded-control", active ? "bg-ink-2 text-white" : "text-ink-text hover:bg-ink-2/60 hover:text-white")}
    >
      {children}
    </Link>
  );
}

export function IconRail({ siteId, isStaff }: { siteId: string; isStaff: boolean }) {
  const root = `/sites/${siteId}`;
  return (
    <nav aria-label="Studio" className="flex w-14 shrink-0 flex-col items-center justify-between bg-ink py-2.5">
      <div className="flex flex-col gap-1">
        <RailLink to={root} label="Dashboard">
          <IconGrid size={20} />
        </RailLink>
        <RailLink to={`${root}/visual`} label="Visual editor" active>
          <IconPencil size={20} />
        </RailLink>
        <RailLink to={`${root}/pages`} label="Pages (form editor)">
          <IconPage size={20} />
        </RailLink>
        <RailLink to={`${root}/requests`} label="Change requests">
          <IconBranch size={20} />
        </RailLink>
        <RailLink to={`${root}/history`} label="Publish history">
          <IconHistory size={20} />
        </RailLink>
      </div>
      <div className="flex flex-col gap-1">
        {isStaff && (
          <RailLink to="/fleet" label="All sites">
            <IconGlobe size={20} />
          </RailLink>
        )}
        <RailLink to={isStaff ? "/agency/settings" : "/account"} label="Settings">
          <IconSettings size={20} />
        </RailLink>
      </div>
    </nav>
  );
}
