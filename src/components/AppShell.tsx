/**
 * The frame around every signed-in screen: a dark ink sidebar on the left, the screen on
 * the right, WordPress-admin style.
 *
 *   - Outside a site, agency staff get the agency menu (Projects, Change requests, Team,
 *     Settings) under the Armature wordmark.
 *   - Inside a site (/sites/:id/*) everyone gets that site's menu (src/components/siteNav.ts)
 *     with the site's name and a site switcher (src/components/SiteSwitcher.tsx) at the
 *     top; staff also get "Back to Projects" above them. Agency-only things live under
 *     "Site settings" at the bottom. Pages is the one way into the editor.
 *   - Clients never see the agency menu or the word Armature: their sidebar carries the
 *     agency's portal name and always shows a site (the one in the URL, else their first).
 *
 * The sidebar collapses to icons (remembered per browser) and, below 900px, becomes a top
 * bar with a slide-out drawer.
 */
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate } from "react-router";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { isHostingOnly } from "@/lib/services.ts";
import { supabase } from "@/lib/supabase.ts";
import { OPEN_CHANGE_REQUEST_STATUSES, SITE_ROLE_LABELS, type Agency } from "@/lib/types.ts";
import type { IconProps } from "./icons.tsx";
import { IconArrowLeft, IconBranch, IconChevronDown, IconGlobe, IconLogout, IconMenu, IconSettings, IconTeam, WireA } from "./icons.tsx";
import { useIsStaffFor, useSiteQuery } from "./SiteLayout.tsx";
import { siteNavItems } from "./siteNav.ts";
import { SiteSwitcher } from "./SiteSwitcher.tsx";
import type { SiteOption } from "./siteSwitch.ts";
import { useUnreadCount } from "@/hooks/useMessages.ts";
import { CountBadge, Drawer, Monogram, Notice, Skeleton } from "./ui.tsx";

type NavItem = {
  key: string;
  to: string;
  label: string;
  icon: (props: IconProps) => ReactNode;
  end?: boolean;
  badge?: number;
};

const COLLAPSE_KEY = "armature:sidebar:collapsed";
const COLLAPSED_WIDTH = 64;

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "yes";
  } catch {
    return false;
  }
}

/** The person's display name: their profile name if they gave one, else the part of the email before the @. */
function displayName(user: { email?: string; user_metadata?: Record<string, unknown> } | null): string {
  const name = user?.user_metadata?.["full_name"];
  if (typeof name === "string" && name.trim()) return name.trim();
  const email = user?.email ?? "";
  return email.split("@")[0] || "You";
}

type SidebarProps = { collapsed: boolean; onNavigate?: () => void };

function NavList({ items, collapsed, onNavigate, label }: SidebarProps & { items: NavItem[]; label: string }) {
  return (
    <ul aria-label={label} className="flex flex-col gap-0.5">
      {items.map((item) => (
        <li key={item.key}>
          <NavLink
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            data-testid={`nav-${item.key}`}
            className={({ isActive }) =>
              clsx(
                "relative flex h-11 items-center gap-3 rounded-control text-[14px]",
                collapsed ? "justify-center px-0" : "justify-between px-3",
                isActive
                  ? "bg-ink-2 font-semibold text-white before:absolute before:-left-3 before:top-2.5 before:h-6 before:w-[3px] before:rounded-r before:bg-accent"
                  : "font-medium text-ink-text hover:bg-ink-2/60 hover:text-white",
              )
            }
          >
            <span className="flex items-center gap-3">
              <item.icon size={18} />
              <span className={collapsed ? "sr-only" : undefined}>{item.label}</span>
            </span>
            {item.badge !== undefined && item.badge > 0 && (collapsed ? <span aria-hidden="true" className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-white" /> : <CountBadge count={item.badge} />)}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

function UserBlock({ name, line, collapsed, onSignOut, onNavigate }: SidebarProps & { name: string; line: string; onSignOut: () => void }) {
  return (
    <div className={clsx("flex items-center gap-2.5", collapsed ? "flex-col p-1" : "p-2")}>
      <Link to="/account" onClick={onNavigate} title={collapsed ? `${name}: your account` : undefined} className={clsx("flex min-w-0 items-center gap-2.5 rounded-control hover:bg-ink-2/60", collapsed ? "h-11 w-11 justify-center" : "flex-1 px-1 py-1")}>
        <Monogram name={name} size="md" tone="dark" round />
        <span className={clsx("min-w-0 flex-1", collapsed && "sr-only")}>
          <span className="block truncate text-[13px] font-semibold text-white">{name}</span>
          <span className="block truncate text-[12px] text-ink-text">{line}</span>
        </span>
      </Link>
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

function CollapseToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-label={collapsed ? "Expand menu" : "Collapse menu"}
      title={collapsed ? "Expand menu" : "Collapse menu"}
      data-testid="sidebar-collapse"
      className={clsx("hidden h-11 items-center gap-3 rounded-control text-[13px] font-medium text-ink-text hover:bg-ink-2/60 hover:text-white shell:flex", collapsed ? "justify-center px-0" : "px-3")}
    >
      <IconArrowLeft size={18} className={clsx("transition-transform", collapsed && "rotate-180")} />
      {!collapsed && <span>Collapse menu</span>}
    </button>
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

/** Every site the agency looks after, for the switcher (RLS limits it to the person's agencies). */
function useAgencySites(enabled: boolean) {
  return useQuery({
    queryKey: ["agency-sites"],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("sites").select("id, name, status").order("name");
      if (error) throw new Error(error.message);
      return (data ?? []) as SiteOption[];
    },
  });
}

function AgencySidebarContent({ collapsed, onNavigate }: SidebarProps) {
  const { user, agencies, agency, agencyRole, signOut } = useAuth();
  const navigate = useNavigate();
  const openCount = useOpenRequestCount(true);
  const siteCount = useSiteCount(true);
  const name = displayName(user);
  const current = agency ?? agencies[0]?.agency ?? null;

  const items: NavItem[] = [
    { key: "projects", to: "/projects", label: "Projects", icon: IconGlobe },
    { key: "agency-requests", to: "/agency/requests", label: "Change requests", icon: IconBranch, badge: openCount },
    { key: "agency-team", to: "/agency/team", label: "Team", icon: IconTeam },
    { key: "agency-settings", to: "/agency/settings", label: "Settings", icon: IconSettings },
  ];

  return (
    <div className={clsx("flex h-full flex-col justify-between gap-6 p-4 pt-4", collapsed ? "sm:px-2" : "sm:px-3")}>
      <div className="flex flex-col gap-4">
        <div className={clsx("flex items-center gap-3 py-1", collapsed ? "justify-center" : "px-2")}>
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-white text-ink">
            <WireA size={22} />
          </span>
          <div className={clsx("min-w-0", collapsed && "sr-only")}>
            <div className="font-display text-[18px] font-semibold leading-tight text-white">Armature</div>
            <div className="text-[12px] text-ink-text">Agency workspace</div>
          </div>
        </div>

        {current && !collapsed && (
          <div className="flex h-11 items-center justify-between gap-2 rounded-control border border-ink-2 px-3 text-[14px] font-semibold text-white">
            <span className="flex min-w-0 items-center gap-2.5">
              {current.logo_url ? <img src={current.logo_url} alt="" className="h-6 w-6 shrink-0 rounded-sm object-contain" /> : <Monogram name={current.name} size="sm" tone="white" className="font-display" />}
              <span className="truncate">{current.name}</span>
            </span>
            {agencies.length > 1 && <IconChevronDown size={16} className="text-ink-text" />}
          </div>
        )}

        <NavList items={items} collapsed={collapsed} onNavigate={onNavigate} label="Agency" />
      </div>

      <div className="flex flex-col gap-3">
        {!collapsed && (
          <div className="flex flex-col gap-1 rounded-[10px] bg-ink-2 p-3">
            <div className="text-[13px] font-semibold text-white">Agency plan</div>
            <div className="text-[12px] leading-relaxed text-ink-text">
              {siteCount === undefined ? "Every client portal carries your brand, not ours." : `${siteCount} ${siteCount === 1 ? "site" : "sites"} connected. Every client portal carries your brand, not ours.`}
            </div>
          </div>
        )}
        <UserBlock
          name={name}
          line={agencyRole === "owner" ? "Agency owner" : "Agency staff"}
          collapsed={collapsed}
          onNavigate={onNavigate}
          onSignOut={() => {
            void signOut().then(() => navigate("/signin", { replace: true }));
          }}
        />
      </div>
    </div>
  );
}

// --- brand (clients) ------------------------------------------------------------------

function BrandMark({ agency, size = 36 }: { agency: Agency | null; size?: number }) {
  const name = agency?.portal_name?.trim() || "Client portal";
  if (agency?.logo_url) {
    return <img src={agency.logo_url} alt="" style={{ width: size, height: size }} className="shrink-0 rounded-control bg-white object-contain" />;
  }
  return (
    <span aria-hidden="true" style={{ width: size, height: size }} className="inline-flex shrink-0 items-center justify-center rounded-control bg-white font-display text-[15px] font-bold text-ink">
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function ClientBrand({ agency, collapsed }: { agency: Agency | null; collapsed: boolean }) {
  const portalName = agency?.portal_name?.trim() || "Client portal";
  return (
    <div className={clsx("flex items-center gap-3 py-1", collapsed ? "justify-center" : "px-2")}>
      <BrandMark agency={agency} />
      <div className={clsx("min-w-0", collapsed && "sr-only")}>
        <div className="truncate text-[14px] font-semibold leading-tight text-white">{portalName}</div>
        <div className="text-[12px] text-ink-text">Client portal</div>
      </div>
    </div>
  );
}

/** A client whose account has no site yet: the brand, and their account. */
function NoSiteSidebarContent({ collapsed, onNavigate }: SidebarProps) {
  const { user, agency, signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <div className={clsx("flex h-full flex-col justify-between gap-6 p-4 pt-4", collapsed ? "sm:px-2" : "sm:px-3")}>
      <div className="flex flex-col gap-5">
        <ClientBrand agency={agency} collapsed={collapsed} />
        <NavList items={[{ key: "account", to: "/account", label: "Settings", icon: IconSettings }]} collapsed={collapsed} onNavigate={onNavigate} label="Main" />
      </div>
      <UserBlock
        name={displayName(user)}
        line="Client"
        collapsed={collapsed}
        onNavigate={onNavigate}
        onSignOut={() => {
          void signOut().then(() => navigate("/signin", { replace: true }));
        }}
      />
    </div>
  );
}

// --- inside a site ------------------------------------------------------------------------

/** The site's name at the top of its menu: a switcher when there is more than one site to open, a plain block otherwise. */
function SiteName({ siteId, siteName, sites, isStaff, collapsed, onNavigate }: SidebarProps & { siteId: string; siteName: string; sites: SiteOption[]; isStaff: boolean }) {
  if (collapsed) {
    return (
      <div className="flex justify-center" title={siteName}>
        <Monogram name={siteName || "?"} size="lg" tone="white" />
      </div>
    );
  }
  if (sites.length < 2) {
    return (
      <div className="flex h-11 items-center gap-2.5 rounded-control border border-ink-2 px-3 text-[14px] font-semibold text-white" data-testid="site-name">
        <Monogram name={siteName || "?"} size="sm" tone="white" />
        <span className="truncate">{siteName}</span>
      </div>
    );
  }
  return <SiteSwitcher siteId={siteId} siteName={siteName} sites={sites} isStaff={isStaff} onNavigate={onNavigate} />;
}

function SiteSidebarContent({ siteId, collapsed, onNavigate }: SidebarProps & { siteId: string }) {
  const { user, sites, agency, agencyRole, isStaff: staffAnywhere, signOut } = useAuth();
  const navigate = useNavigate();
  const query = useSiteQuery(siteId);
  const site = query.data ?? null;
  const isStaff = useIsStaffFor(site);
  const agencySites = useAgencySites(staffAnywhere);
  const membership = sites.find((entry) => entry.site.id === siteId);
  const root = `/sites/${siteId}`;
  const name = displayName(user);

  const switcherSites: SiteOption[] = staffAnywhere ? (agencySites.data ?? []) : sites.map((entry) => ({ id: entry.site.id, name: entry.site.name, status: entry.site.status }));
  const siteName = site?.name ?? membership?.site.name ?? switcherSites.find((entry) => entry.id === siteId)?.name ?? "";
  const hostingOnly = site ? isHostingOnly(site) : true;
  const unread = useUnreadCount(site ? siteId : undefined);
  const items: NavItem[] = site ? siteNavItems({ root, isStaff, hostingOnly }).map((item) => (item.key === "contact" ? { ...item, badge: unread } : item)) : [];

  return (
    <div className={clsx("flex h-full flex-col justify-between gap-6 p-4 pt-4", collapsed ? "sm:px-2" : "sm:px-3")} data-testid="site-sidebar">
      <div className="flex flex-col gap-4">
        {staffAnywhere ? (
          <Link
            to="/projects"
            onClick={onNavigate}
            title={collapsed ? "Back to Projects" : undefined}
            data-testid="back-to-projects"
            className={clsx("flex h-11 items-center gap-2 rounded-control text-[13px] font-medium text-ink-text hover:bg-ink-2/60 hover:text-white", collapsed ? "justify-center px-0" : "px-2")}
          >
            <IconArrowLeft size={16} />
            <span className={collapsed ? "sr-only" : undefined}>Back to Projects</span>
          </Link>
        ) : (
          <ClientBrand agency={agency} collapsed={collapsed} />
        )}

        {siteName ? <SiteName siteId={siteId} siteName={siteName} sites={switcherSites} isStaff={staffAnywhere} collapsed={collapsed} onNavigate={onNavigate} /> : <Skeleton className="h-11 rounded-control bg-ink-2" />}

        {site ? (
          <NavList items={items} collapsed={collapsed} onNavigate={onNavigate} label={siteName} />
        ) : (
          <div className="flex flex-col gap-0.5" role="status" aria-label="Loading the menu">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-11 rounded-control bg-ink-2/60" />
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <UserBlock
          name={name}
          line={
            staffAnywhere
              ? agencyRole === "owner"
                ? "Agency owner"
                : "Agency staff"
              : membership
                ? `${membership.role === "client_owner" ? "Owner" : SITE_ROLE_LABELS[membership.role].replace("Client ", "")}, ${membership.site.name}`
                : "Client"
          }
          collapsed={collapsed}
          onNavigate={onNavigate}
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
  const { isStaff, agency, sites, membershipsError, refresh } = useAuth();
  const location = useLocation();
  const siteMatch = useMatch("/sites/:siteId/*");
  const inUrl = siteMatch?.params.siteId && siteMatch.params.siteId !== "new" ? siteMatch.params.siteId : undefined;
  // Clients always live inside a site: outside one, the sidebar shows the one in the URL, else their first.
  const siteId = inUrl ?? (isStaff ? undefined : sites[0]?.site.id);
  const siteQuery = useSiteQuery(siteId ?? "");

  // The drawer remembers which route it was opened on, so any route change (back
  // button included) closes it without an effect.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const menuOpen = openedOn === location.pathname;
  const closeMenu = () => setOpenedOn(null);

  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggleCollapsed = () =>
    setCollapsed((current) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, current ? "no" : "yes");
      } catch {
        // A private window: the choice lasts for this visit only.
      }
      return !current;
    });

  const sidebar = (inDrawer: boolean) => {
    const props = { collapsed: !inDrawer && collapsed, onNavigate: closeMenu };
    if (siteId) return <SiteSidebarContent siteId={siteId} {...props} />;
    if (isStaff) return <AgencySidebarContent {...props} />;
    return <NoSiteSidebarContent {...props} />;
  };
  const brandTitle = isStaff ? (siteId ? siteQuery.data?.name || "Armature" : "Armature") : agency?.portal_name?.trim() || "Client portal";
  const navLabel = siteId ? "Site" : isStaff ? "Agency" : "Main";

  return (
    <div className="min-h-dvh bg-ground">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-panel focus:px-3 focus:py-2">
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
        {sidebar(true)}
      </Drawer>

      <div className="flex min-h-dvh">
        <nav
          aria-label={navLabel}
          data-testid="sidebar"
          data-collapsed={collapsed ? "yes" : "no"}
          style={collapsed ? { width: COLLAPSED_WIDTH, minWidth: COLLAPSED_WIDTH } : undefined}
          className="sticky top-0 hidden h-dvh w-[var(--sidebar-width)] min-w-0 shrink-0 flex-col overflow-x-hidden bg-ink text-ink-text transition-[width] duration-150 shell:flex"
        >
          <div className="min-h-0 flex-1 overflow-y-auto">{sidebar(false)}</div>
          <div className={clsx("shrink-0 border-t border-ink-2 p-2", collapsed && "px-2")}>
            <CollapseToggle collapsed={collapsed} onToggle={toggleCollapsed} />
          </div>
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
