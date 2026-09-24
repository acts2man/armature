/**
 * The site switcher at the top of a site's sidebar: a button that shows the current site's
 * name and opens a listbox of every site the person can open (the agency's sites for
 * staff, their own for a client), with a search box once there are more than a handful.
 * Choosing a site lands on the same section of that site (Pages stays Pages) when the
 * section exists there, else on its Dashboard.
 *
 * Keyboard: Enter, Space or the arrow keys open it; Up/Down move; Home/End jump; Enter
 * chooses; Escape or Tab closes and Escape puts focus back on the button. A click
 * outside closes it. Typing in the search box filters by name.
 */
import { clsx } from "clsx";
import { useEffect, useId, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { IconCheck, IconChevronDown, IconSearch } from "./icons.tsx";
import { SEARCH_FROM, switchTarget, type SiteOption } from "./siteSwitch.ts";
import { Monogram } from "./ui.tsx";

export function SiteSwitcher({ siteId, siteName, sites, isStaff, onNavigate }: { siteId: string; siteName: string; sites: SiteOption[]; isStaff: boolean; onNavigate?: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const labelId = useId();

  const searchable = sites.length >= SEARCH_FROM;
  const needle = query.trim().toLowerCase();
  const shown = needle ? sites.filter((site) => site.name.toLowerCase().includes(needle)) : sites;

  const close = (focusButton: boolean) => {
    setOpen(false);
    setQuery("");
    if (focusButton) buttonRef.current?.focus();
  };
  const openMenu = () => {
    setOpen(true);
    setQuery("");
    setActive(Math.max(0, sites.findIndex((site) => site.id === siteId)));
  };
  const choose = (site: SiteOption) => {
    close(true);
    if (site.id === siteId) return;
    onNavigate?.();
    navigate(switchTarget(location.pathname, siteId, site, isStaff));
  };

  // Focus the search box (or the list) once open; close on a click outside.
  useEffect(() => {
    if (!open) return;
    (searchable ? searchRef.current : listRef.current)?.focus();
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the menu opens
  }, [open]);

  // The active row, kept inside the filtered list (typing can shorten it), and in view.
  const activeIndex = Math.min(active, Math.max(0, shown.length - 1));
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive(shown.length === 0 ? 0 : (activeIndex + 1) % shown.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setActive(shown.length === 0 ? 0 : (activeIndex - 1 + shown.length) % shown.length);
        break;
      case "Home":
        event.preventDefault();
        setActive(0);
        break;
      case "End":
        event.preventDefault();
        setActive(Math.max(0, shown.length - 1));
        break;
      case "Enter": {
        event.preventDefault();
        const site = shown[activeIndex];
        if (site) choose(site);
        break;
      }
      case "Escape":
        event.preventDefault();
        close(true);
        break;
      case "Tab":
        close(false);
        break;
      default:
        break;
    }
  };

  const activeId = shown[activeIndex] ? `${listId}-${shown[activeIndex].id}` : undefined;

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Site: ${siteName}. Switch site`}
        data-testid="site-switcher"
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            openMenu();
          }
        }}
        className="flex h-11 w-full items-center gap-2.5 rounded-control border border-ink-2 px-3 text-left text-[14px] font-semibold text-white hover:border-ink-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/60"
      >
        <Monogram name={siteName || "?"} size="sm" tone="white" />
        <span className="min-w-0 flex-1 truncate" data-testid="site-name">
          {siteName}
        </span>
        <IconChevronDown size={16} className={clsx("shrink-0 text-ink-text transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="toast-in absolute inset-x-0 top-12 z-40 flex max-h-[min(24rem,60vh)] flex-col rounded-[10px] border border-ink-2 bg-ink p-1.5 shadow-pop" data-testid="site-menu" onKeyDown={onKeyDown}>
          <span id={labelId} className="sr-only">
            Sites
          </span>
          {searchable && (
            <label className="relative mb-1.5 block">
              <span className="sr-only">Search sites</span>
              <IconSearch size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-text" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                placeholder="Search sites"
                aria-controls={listId}
                aria-activedescendant={activeId}
                data-testid="site-search"
                className="h-9 w-full rounded-control border border-ink-2 bg-ink-2/60 pl-8 pr-2 text-[13px] font-medium text-white placeholder:text-ink-text focus:border-ink-line focus:outline-none"
              />
            </label>
          )}
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-labelledby={labelId}
            aria-activedescendant={searchable ? undefined : activeId}
            tabIndex={searchable ? -1 : 0}
            className="min-h-0 flex-1 overflow-y-auto outline-none"
          >
            {shown.length === 0 ? (
              <li className="px-3 py-2 text-[13px] text-ink-text">No site matches "{query.trim()}".</li>
            ) : (
              shown.map((site, index) => {
                const current = site.id === siteId;
                return (
                  <li
                    key={site.id}
                    id={`${listId}-${site.id}`}
                    role="option"
                    aria-selected={current}
                    data-index={index}
                    data-testid={`site-option-${site.id}`}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(site)}
                    className={clsx("flex h-10 cursor-pointer items-center gap-2.5 rounded-control px-2.5 text-[14px]", index === activeIndex ? "bg-ink-2 text-white" : "text-ink-text", current && "font-semibold text-white")}
                  >
                    <Monogram name={site.name} size="sm" tone={current ? "white" : "dark"} />
                    <span className="min-w-0 flex-1 truncate">{site.name}</span>
                    {current && <IconCheck size={15} className="shrink-0" />}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
