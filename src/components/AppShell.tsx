/**
 * The frame around every signed-in screen, as in docs/4-agency-fleet.html and
 * docs/2-client-dashboard.html: a dark ink sidebar on the left, the screen on the
 * right. Agency staff see the Armature wordmark and their agency; clients see only
 * the agency's portal name and logo. Below 900px the sidebar becomes a top bar
 * with a menu drawer.
 */
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { useState, type ReactNode } from "react";
import { NavLink, useLocation, useMatch, useNavigate, Outlet } from "react-router";
import { useAuth, type SiteMembership } from "@/auth/AuthProvider.tsx";
import { supabase } from "@/lib/supabase.ts";
import { OPEN_CHANGE_REQUEST_STATUSES, SITE_ROLE_LABELS, type Agency } from "@/lib/types.ts";
import type { IconProps } from "./icons.tsx";
import {
  IconBranch,
  IconChevronDown,
  IconGlobe,
  IconGrid,
  IconHistory,
  IconLogout,
  IconMenu,
  IconPage,
  IconPencil,
  IconSettings,
  IconTeam,
  WireA,
} from "./icons.tsx";
import { CountBadge, Drawer, Monogram, Notice, Select } from "./ui.tsx";

type NavItem = {
  to: string;
  label: string;
  icon: (props: IconProps) => ReactNode;
  end?: boolean;
  badge?: number;
};

/** The person's display name: their profile name if they gave one, else the part of the email before the @. */
function displayName(user: { email?: string; user_metadata?: Record<string, unknown> } | null): string {
  const name = user?.user_metadata?.["full_name"];
  if (typeof name === "string" && name.trim()) return name.trim();
  const email = user?.email ?? "";
  return email.split("@")[0] || "You";
}

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <div className="flex flex-col gap-0.5">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            clsx(
              "flex h-11 items-center justify-between gap-2 rounded-control px-3 text-[14px]",
              isActive ? "bg-ink-2 font-semibold text-white" : "font-medium text-ink-text hover:bg-ink-2/60 hover:text-white",
            )
          }
        >
          <span className="flex items-center gap-3">
            <item.icon size={18} />
            <span>{item.label}</span>
          </span>
          {item.badge !== undefined && <CountBadge count={item.badge} />}
        </NavLink>
      ))}
    </div>
  );
}

function UserBlock({ name, line, onSignOut }: { name: string; line: string; onSignOut: () => void }) {
  return (
    <div className="flex items-center gap-2.5 p-2">
      <Monogram name={name} size="md" tone="dark" round />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-white">{name}</div>
        <div className="truncate text-[12px] text-ink-text">{line}</div>
      </div>
      <button
        type="button"
        onClick={onSignOut}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink-text hover:bg-ink-2 hover:text-white"
        aria-label="Sign out"
        title="Sign out"
      >
        <IconLogout size={18} />
      </button>
    </div>
  );
}

// --- agency -----------------------------------------------------------------------------

function useOpenRequestCount(enabled: boolean): number | undefined {
  const query = useQuery({
    queryKey: ["open-request-count"],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("change_requests")
        .select("id", { count: "exact", head: true })
        .in("status", OPEN_CHANGE_REQUEST_STATUSES);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  });
  return query.data;
}

function useSiteCount(enabled: boolean): number | undefined {
  const query = useQuery({
    queryKey: ["site-count"],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { count, error } = await supabase.from("sites").select("id", { count: "exact", head: true });
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  });
  return query.data;
}

function AgencySidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, agencies, agency, agencyRole, signOut } = useAuth();
  const navigate = useNavigate();
  const openCount = useOpenRequestCount(true);
  const siteCount = useSiteCount(true);
  const name = displayName(user);
  const current = agency ?? agencies[0]?.agency ?? null;

  const items: NavItem[] = [
    { to: "/fleet", label: "Fleet", icon: IconGlobe },
    { to: "/agency/requests", label: "Change requests", icon: IconBranch, badge: openCount },
    { to: "/agency/team", label: "Team", icon: IconTeam },
    { to: "/agency/settings", label: "Settings", icon: IconSettings },
  ];

  return (
    <div className="flex h-full flex-col justify-between gap-6 p-4 pt-4 sm:px-3">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 px-2 py-1">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-white text-ink">
            <WireA size={22} />
          </span>
          <div className="min-w-0">
            <div className="font-display text-[18px] font-semibold leading-tight text-white">Armature</div>
            <div className="text-[12px] text-ink-text">Agency workspace</div>
          </div>
        </div>

        {current && (
          <div className="flex h-11 items-center justify-between gap-2 rounded-control border border-ink-2 px-3 text-[14px] font-semibold text-white">
            <span className="flex min-w-0 items-center gap-2.5">
              {current.logo_url ? (
                <img src={current.logo_url} alt="" className="h-6 w-6 shrink-0 rounded-sm object-contain" />
              ) : (
                <Monogram name={current.name} size="sm" tone="white" className="font-display" />
              )}
              <span className="truncate">{current.name}</span>
            </span>
            {agencies.length > 1 && <IconChevronDown size={16} className="text-ink-text" />}
          </div>
        )}

        <NavList items={items} onNavigate={onNavigate} />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1 rounded-[10px] bg-ink-2 p-3">
          <div className="text-[13px] font-semibold text-white">Agency plan</div>
          <div className="text-[12px] leading-relaxed text-ink-text">
            {siteCount === undefined ? "Every client portal carries your brand, not ours." : `${siteCount} ${siteCount === 1 ? "site" : "sites"} connected. Every client portal carries your brand, not ours.`}
          </div>
        </div>
        <UserBlock
          name={name}
          line={agencyRole === "owner" ? "Agency owner" : "Agency staff"}
          onSignOut={() => {
            void signOut().then(() => navigate("/signin", { replace: true }));
          }}
        />
      </div>
    </div>
  );
}

// --- client ------------------------------------------------------------------------------

function BrandMark({ agency, size = 36 }: { agency: Agency | null; size?: number }) {
  const name = agency?.portal_name?.trim() || "Client portal";
  if (agency?.logo_url) {
    return <img src={agency.logo_url} alt="" style={{ width: size, height: size }} className="shrink-0 rounded-control bg-white object-contain" />;
  }
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="inline-flex shrink-0 items-center justify-center rounded-control bg-white font-display text-[15px] font-bold text-ink"
    >
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function ClientSidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, sites, agency, signOut } = useAuth();
  const navigate = useNavigate();
  const match = useMatch("/sites/:siteId/*");
  const name = displayName(user);

  const inUrl = match?.params.siteId;
  const current: SiteMembership | undefined = sites.find((membership) => membership.site.id === inUrl) ?? sites[0];
  const root = current ? `/sites/${current.site.id}` : "/";
  const portalName = agency?.portal_name?.trim() || "Client portal";

  const items: NavItem[] = current
    ? [
        { to: root, label: "Dashboard", icon: IconGrid, end: true },
        { to: `${root}/pages`, label: "Pages", icon: IconPage },
        { to: `${root}/requests`, label: "Change requests", icon: IconBranch },
        { to: `${root}/history`, label: "Publish history", icon: IconHistory },
        { to: "/account", label: "Settings", icon: IconSettings },
      ]
    : [{ to: "/account", label: "Settings", icon: IconSettings }];

  return (
    <div className="flex h-full flex-col justify-between gap-6 p-4 pt-4 sm:px-3">
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3 px-2 py-1">
          <BrandMark agency={agency} />
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold leading-tight text-white">{portalName}</div>
            <div className="text-[12px] text-ink-text">Client portal</div>
          </div>
        </div>

        {sites.length > 1 && current && (
          <div>
            <label htmlFor="site-switcher" className="sr-only">
              Site
            </label>
            <Select
              id="site-switcher"
              value={current.site.id}
              onChange={(event) => {
                onNavigate?.();
                navigate(`/sites/${event.target.value}`);
              }}
              className="border-ink-2 bg-ink text-white hover:border-ink-line"
            >
              {sites.map((membership) => (
                <option key={membership.site.id} value={membership.site.id}>
                  {membership.site.name}
                </option>
              ))}
            </Select>
          </div>
        )}

        <NavList items={items} onNavigate={onNavigate} />
      </div>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          disabled
          title="Coming soon"
          className="flex h-11 w-full items-center justify-center gap-2 rounded-control bg-accent text-[14px] font-semibold text-accent-fg opacity-60"
        >
          <IconPencil size={16} />
          <span>Edit site visually</span>
          <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold">Soon</span>
        </button>
        <UserBlock
          name={name}
          line={current ? `${current.role === "client_owner" ? "Owner" : SITE_ROLE_LABELS[current.role].replace("Client ", "")}, ${current.site.name}` : "Client"}
          onSignOut={() => {
            void signOut().then(() => navigate("/signin", { replace: true }));
          }}
        />
      </div>
    </div>
  );
}

// --- the shell ---------------------------------------------------------------------------

export function AppShell() {
  const { isStaff, agency, membershipsError, refresh } = useAuth();
  const location = useLocation();
  // The drawer remembers which route it was opened on, so any route change (back
  // button included) closes it without an effect.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const menuOpen = openedOn === location.pathname;
  const closeMenu = () => setOpenedOn(null);

  const sidebar = isStaff ? <AgencySidebarContent onNavigate={closeMenu} /> : <ClientSidebarContent onNavigate={closeMenu} />;
  const brandTitle = isStaff ? "Armature" : agency?.portal_name?.trim() || "Client portal";

  return (
    <div className="min-h-dvh bg-ground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-panel focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      {/* Top bar, below 900px only */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 bg-ink px-3 text-white shell:hidden">
        <span className="flex min-w-0 items-center gap-2.5">
          {isStaff ? (
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-white text-ink">
              <WireA size={20} />
            </span>
          ) : (
            <BrandMark agency={agency} size={32} />
          )}
          <span className="truncate font-display text-[16px] font-semibold">{brandTitle}</span>
        </span>
        <button
          type="button"
          onClick={() => setOpenedOn(location.pathname)}
          aria-label="Open menu"
          aria-expanded={menuOpen}
          className="inline-flex h-11 w-11 items-center justify-center rounded-control text-ink-text hover:bg-ink-2 hover:text-white"
        >
          <IconMenu size={20} />
        </button>
      </header>

      <Drawer open={menuOpen} onClose={closeMenu} title={<span className="sr-only">Menu</span>} side="left" dark>
        {sidebar}
      </Drawer>

      <div className="flex min-h-dvh">
        <nav aria-label={isStaff ? "Agency" : "Main"} className="sticky top-0 hidden h-dvh w-[var(--sidebar-width)] shrink-0 bg-ink text-ink-text shell:block">
          {sidebar}
        </nav>
        <main id="main" className="min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-6 shell:px-8 shell:py-7">
          <div className="mx-auto flex max-w-[1180px] flex-col gap-5">
            {membershipsError && (
              <Notice
                kind="danger"
                title="Your account's access could not be loaded"
                action={
                  <button type="button" className="font-semibold underline underline-offset-2" onClick={() => void refresh()}>
                    Try again
                  </button>
                }
              >
                {membershipsError}
              </Notice>
            )}
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
