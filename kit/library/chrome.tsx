/**
 * Widgets for the header and footer built in the editor: Site Logo (a picture linked to
 * the home page) and Nav Menu (one of the site's menus from Appearance › Menus, with
 * dropdowns, a hamburger below a breakpoint, and an optional sticky position). Both work
 * on any page too. Semantic HTML: <nav>, <ul>, <a>; the menu opens and closes with
 * plain buttons so it works without any site code.
 */
import { useEffect, useId, useState } from "react";
import { pagePathOf, useKitSnapshot } from "../renderer.tsx";
import { safeHref, safeMediaSrc } from "../sanitize.ts";
import type { MenuItem, NavMenuProps, SiteLogoProps } from "../types.ts";
import { linkAttributes, registerWidget, type WidgetContext } from "../widgets.tsx";

function SiteLogo({ element, common, editMode }: WidgetContext) {
  const props = element.props as SiteLogoProps;
  const src = safeMediaSrc(props.src);
  const image = src ? (
    <img src={src} alt={props.alt ?? ""} width={props.naturalWidth} height={props.naturalHeight} loading="eager" decoding="sync" className="ae-logo-img" />
  ) : editMode ? (
    <span className="ae-logo-empty">Site logo</span>
  ) : null;
  const linked = props.linkHome !== false && image;
  return (
    <div {...common} className={`${common.className} ae-logo`}>
      {linked ? (
        <a href="/" className="ae-logo-link" aria-label={props.alt?.trim() || "Home"}>
          {image}
        </a>
      ) : (
        image
      )}
    </div>
  );
}

function itemHref(item: MenuItem, layouts: Record<string, import("../types.ts").LayoutDoc>): string | null {
  if (item.kind === "page") return item.page ? pagePathOf(item.page, layouts) : null;
  return safeHref(item.href) ?? null;
}

function MenuBranch({ item, layouts, depth, current }: { item: MenuItem; layouts: Record<string, import("../types.ts").LayoutDoc>; depth: number; current: string }) {
  const [open, setOpen] = useState(false);
  const href = itemHref(item, layouts);
  const children = depth < 2 ? (item.children ?? []) : [];
  const hasChildren = children.length > 0;
  const link = href ? linkAttributes({ href, newTab: item.newTab }) : null;
  const isCurrent = !!href && href.replace(/\/+$/, "") === current.replace(/\/+$/, "");
  return (
    <li className={`ae-nav-item${hasChildren ? " ae-nav-has-sub" : ""}${open ? " ae-nav-open" : ""}`}>
      <span className="ae-nav-row">
        {link ? (
          <a {...link} className="ae-nav-link" aria-current={isCurrent ? "page" : undefined}>
            {item.label}
          </a>
        ) : (
          <span className="ae-nav-link ae-nav-nolink">{item.label}</span>
        )}
        {hasChildren && (
          <button type="button" className="ae-nav-sub-toggle" aria-expanded={open} aria-label={`${open ? "Close" : "Open"} ${item.label} menu`} onClick={() => setOpen((value) => !value)} data-ae-interactive="">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        )}
      </span>
      {hasChildren && (
        <ul className="ae-nav-sub">
          {children.map((child) => (
            <MenuBranch key={child.id} item={child} layouts={layouts} depth={depth + 1} current={current} />
          ))}
        </ul>
      )}
    </li>
  );
}

function NavMenuView({ element, common, kit, editMode }: WidgetContext) {
  const props = element.props as NavMenuProps;
  const snapshot = useKitSnapshot();
  const [open, setOpen] = useState(false);
  const id = useId();
  const menu = (kit.menus ?? []).find((candidate) => candidate.id === props.menu) ?? (kit.menus ?? [])[0];
  const current = typeof window === "undefined" ? "/" : window.location.pathname;
  // Close the folded menu after a navigation (a link click on a phone).
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("armature:navigated", close);
    window.addEventListener("popstate", close);
    return () => {
      window.removeEventListener("armature:navigated", close);
      window.removeEventListener("popstate", close);
    };
  }, [open]);
  const layout = props.layout ?? "horizontal";
  const className = `${common.className} ae-nav ae-nav-${layout}${open ? " ae-nav-expanded" : ""}${props.sticky ? " ae-nav-sticky" : ""}`;
  if (!menu || menu.items.length === 0) {
    return (
      <nav {...common} className={className} aria-label="Site">
        {editMode && <span className="ae-nav-empty">{menu ? `The menu "${menu.name}" has no items yet. Add some under Appearance › Menus.` : "No menu yet. Create one under Appearance › Menus, then choose it here."}</span>}
      </nav>
    );
  }
  // The fold happens at this element's own breakpoint, so the rules travel with it.
  const breakpoint = Math.round(props.breakpoint ?? 767);
  const own = `.ae-${element.id}`;
  const fold = `@media (max-width: ${breakpoint}px) { ${own} .ae-nav-toggle { display: inline-flex; } ${own} .ae-nav-list { display: none; } ${own}.ae-nav-expanded .ae-nav-list { display: flex; flex-direction: column; align-items: stretch; } ${own} .ae-nav-sub { position: static; box-shadow: none; border: 0; padding-left: 16px; } }`;
  return (
    <nav {...common} className={className} aria-label={menu.name}>
      <style>{fold}</style>
      <button type="button" className="ae-nav-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)} data-ae-interactive="">
        <span className="ae-nav-toggle-bars" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="ae-sr-only">{open ? "Close menu" : "Open menu"}</span>
      </button>
      <ul id={id} className="ae-nav-list">
        {menu.items.map((item) => (
          <MenuBranch key={item.id} item={item} layouts={snapshot.layouts} depth={1} current={current} />
        ))}
      </ul>
    </nav>
  );
}

registerWidget("site-logo", SiteLogo);
registerWidget("nav-menu", (context) => <NavMenuView key={context.element.id} {...context} />);
