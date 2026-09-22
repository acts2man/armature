/**
 * The 60px bar across the top of the visual editor (docs/1-visual-editor.html):
 * brand block, site name, page switcher, device toggle, undo/redo, draft status,
 * Preview and Publish.
 */
import { clsx } from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { IconCheck, IconChevronDown, IconDesktop, IconEye, IconEyeOff, IconPage, IconPhone, IconRedo, IconTablet, IconUndo, WireA } from "@/components/icons.tsx";
import { Monogram, SrOnly } from "@/components/ui.tsx";
import type { Agency } from "@/lib/types.ts";
import type { PageDefinition } from "@shared/schema.ts";
import { DEVICES, modKey, type Device } from "./pages.ts";

const barButton = "inline-flex h-10 items-center gap-2 rounded-control px-2.5 text-[14px] text-text hover:bg-ground disabled:cursor-not-allowed disabled:opacity-40";

function Menu({ label, children, open, onToggle, align = "left", testId }: { label: ReactNode; children: ReactNode; open: boolean; onToggle: (next: boolean) => void; align?: "left" | "right"; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onToggle(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onToggle(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onToggle]);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => onToggle(!open)} className={clsx(barButton, "font-medium")} data-testid={testId}>
        {label}
        <IconChevronDown size={16} className="text-muted" />
      </button>
      {open && (
        <div role="menu" className={clsx("toast-in absolute top-11 z-40 min-w-56 rounded-[10px] border border-line bg-panel p-1.5 shadow-pop", align === "right" ? "right-0" : "left-0")}>
          {children}
        </div>
      )}
    </div>
  );
}

export function TopBar({
  siteName,
  siteId,
  isStaff,
  agency,
  userName,
  pages,
  page,
  changedByPage,
  onPage,
  device,
  onDevice,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  status,
  preview,
  onPreview,
  canPublish,
  onPublish,
}: {
  siteName: string;
  siteId: string;
  isStaff: boolean;
  agency: Agency | null;
  userName: string;
  pages: PageDefinition[];
  page: PageDefinition | undefined;
  changedByPage: Record<string, number>;
  onPage: (slug: string) => void;
  device: Device;
  onDevice: (device: Device) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  status: { kind: "clean" | "saved" | "saving"; changes: number };
  preview: boolean;
  onPreview: (next: boolean) => void;
  canPublish: boolean;
  onPublish: () => void;
}) {
  const [siteMenu, setSiteMenu] = useState(false);
  const [pageMenu, setPageMenu] = useState(false);
  const home = isStaff ? "/fleet" : `/sites/${siteId}`;
  const brandName = isStaff ? "Armature" : agency?.portal_name?.trim() || "Client portal";
  const mod = modKey();

  return (
    <header className="flex h-[60px] shrink-0 items-center justify-between gap-4 border-b border-line bg-panel pr-4" data-testid="topbar">
      <div className="flex min-w-0 items-center gap-3">
        <Link to={home} aria-label={`${brandName}, back to ${isStaff ? "all sites" : "the dashboard"}`} className="flex h-[60px] w-14 shrink-0 items-center justify-center bg-ink text-white">
          {isStaff ? (
            <WireA size={26} />
          ) : agency?.logo_url ? (
            <img src={agency.logo_url} alt="" className="h-8 w-8 rounded-sm bg-white object-contain" />
          ) : (
            <span className="font-display text-[15px] font-bold">{brandName.slice(0, 2).toUpperCase()}</span>
          )}
        </Link>
        <Menu label={<span className="max-w-64 truncate font-semibold">{siteName}</span>} open={siteMenu} onToggle={setSiteMenu}>
          <Link to={`/sites/${siteId}`} role="menuitem" className="flex h-10 items-center rounded-sm px-3 text-[14px] hover:bg-ground">
            Site dashboard
          </Link>
          <Link to={`/sites/${siteId}/pages`} role="menuitem" className="flex h-10 items-center rounded-sm px-3 text-[14px] hover:bg-ground">
            Page editor (form)
          </Link>
          <Link to={`/sites/${siteId}/history`} role="menuitem" className="flex h-10 items-center rounded-sm px-3 text-[14px] hover:bg-ground">
            Publish history
          </Link>
          {isStaff && (
            <Link to="/fleet" role="menuitem" className="flex h-10 items-center rounded-sm px-3 text-[14px] hover:bg-ground">
              All sites
            </Link>
          )}
        </Menu>
        <span className="h-6 w-px bg-line" aria-hidden="true" />
        <Menu
          label={
            <>
              <IconPage size={16} />
              <span className="max-w-48 truncate">{page?.label ?? "Page"}</span>
            </>
          }
          open={pageMenu}
          onToggle={setPageMenu}
          testId="page-switcher"
        >
          {pages.map((item) => {
            const count = changedByPage[item.slug] ?? 0;
            return (
              <button
                key={item.slug}
                type="button"
                role="menuitemradio"
                aria-checked={item.slug === page?.slug}
                onClick={() => {
                  setPageMenu(false);
                  onPage(item.slug);
                }}
                className={clsx("flex h-10 w-full items-center justify-between gap-3 rounded-sm px-3 text-left text-[14px] hover:bg-ground", item.slug === page?.slug && "bg-blue-soft font-semibold text-blue")}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{item.label}</span>
                  <span className="truncate font-mono text-[12px] text-muted">{item.path}</span>
                </span>
                {count > 0 && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label={`${count} unpublished`} />}
              </button>
            );
          })}
        </Menu>
      </div>

      <div role="group" aria-label="Preview device" className="flex items-center gap-1 rounded-[10px] bg-ground p-0.5">
        {DEVICES.map((item) => {
          const Icon = item.id === "desktop" ? IconDesktop : item.id === "tablet" ? IconTablet : IconPhone;
          const active = item.id === device;
          return (
            <button
              key={item.id}
              type="button"
              aria-label={`${item.label} view, ${item.width} pixels wide`}
              title={`${item.label} · ${item.width}px`}
              aria-pressed={active}
              onClick={() => onDevice(item.id)}
              className={clsx("inline-flex h-10 w-10 items-center justify-center rounded-control", active ? "bg-blue-soft text-accent" : "text-muted hover:text-text")}
            >
              <Icon size={18} />
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2.5">
        <button type="button" aria-label="Undo" title={`Undo (${mod}+Z)`} disabled={!canUndo} onClick={onUndo} className={clsx(barButton, "w-10 justify-center px-0 text-muted")}>
          <IconUndo size={18} />
        </button>
        <button type="button" aria-label="Redo" title={`Redo (Shift+${mod}+Z)`} disabled={!canRedo} onClick={onRedo} className={clsx(barButton, "w-10 justify-center px-0 text-muted")}>
          <IconRedo size={18} />
        </button>
        <span className="inline-flex items-center gap-1.5 text-[13px] text-muted" role="status" data-testid="draft-status">
          {status.kind === "saving" ? (
            <span className="h-2 w-2 animate-pulse rounded-full bg-amber" />
          ) : (
            <IconCheck size={15} className={status.changes > 0 ? "text-accent" : undefined} />
          )}
          <span>{status.changes === 0 ? "Nothing to publish" : status.kind === "saving" ? "Saving draft…" : `Draft saved · ${status.changes === 1 ? "1 unpublished change" : `${status.changes} unpublished changes`}`}</span>
        </span>
        <button
          type="button"
          aria-pressed={preview}
          onClick={() => onPreview(!preview)}
          className={clsx("inline-flex h-10 items-center gap-2 rounded-control border px-4 text-[14px] font-semibold", preview ? "border-ink bg-ink text-white" : "border-line bg-panel text-text hover:bg-ground")}
        >
          {preview ? <IconEyeOff size={16} /> : <IconEye size={16} />}
          <span>{preview ? "Exit preview" : "Preview"}</span>
        </button>
        <button
          type="button"
          disabled={!canPublish}
          onClick={onPublish}
          title={`Publish (${mod}+S)`}
          className="inline-flex h-10 items-center gap-2 rounded-control border border-accent bg-accent px-4 text-[14px] font-semibold text-accent-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Publish
        </button>
        <Monogram name={userName} size="lg" tone="ink" round />
        <SrOnly>Signed in as {userName}</SrOnly>
      </div>
    </header>
  );
}
