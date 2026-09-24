/**
 * The renderer: <ArmaturePage> renders a layout, <ArmatureSlot> lets a coded page render
 * its layout (falling back to its registered site sections), <ArmatureRoute> serves
 * builder-only pages by their path. Semantic HTML only; no innerHTML anywhere. The
 * stylesheet for a page is generated from the tree and mounted as a <style> text node.
 */
import { createElement, useEffect, useMemo, useRef, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import { pageCss } from "./css.ts";
import { installEntranceAnimations, installParallax } from "./motion.ts";
import { safeAttributeName } from "./sanitize.ts";
import { computePageHead, type HeadTag } from "./seo.ts";
import type { KitSnapshot, KitStore } from "./store.ts";
import { chromeSlug, isChromeSlug, type ChromePart, type Element, type LayoutDoc, type SiteSectionProps } from "./types.ts";
import { cssIdent, googleFontsHref } from "./values.ts";
import { getWidget } from "./widgets.tsx";

export type KitRuntime = {
  store: KitStore;
  /** Slugs declared in content/schema.json: their layouts drive <ArmatureSlot>, never <ArmatureRoute>. */
  codedSlugs: Set<string>;
  /** Slots currently mounted on the page, with the section keys they would show without a layout. */
  slots: Map<string, string[]>;
  onSlotsChange: Set<() => void>;
  /** Where the Form widget sends entries (the dashboard's form-submit function), when the site set it. */
  forms?: { endpoint: string; siteId: string };
  /** Coded pages' live paths by slug (from content/schema.json), for the Nav Menu widget's page links. */
  pagePaths: Map<string, string>;
};

let runtime: KitRuntime | null = null;

export function setKitRuntime(next: KitRuntime): void {
  runtime = next;
}

export function getKitRuntime(): KitRuntime {
  if (!runtime) throw new Error("Armature: call createArmatureKit() before rendering <ArmaturePage>, <ArmatureSlot> or <ArmatureRoute>.");
  return runtime;
}

const noop = () => () => undefined;
const emptySnapshot: KitSnapshot = { content: {}, layouts: {}, kit: null as unknown as KitSnapshot["kit"], editMode: false, editing: null, editEpoch: {}, posts: {}, postIndex: { version: 1, posts: [] } };

export function useKitSnapshot(): KitSnapshot {
  const store = runtime?.store;
  return useSyncExternalStore(store ? store.subscribe : noop, store ? store.getSnapshot : () => emptySnapshot, store ? store.getSnapshot : () => emptySnapshot);
}

/** "/about/" and "/about" are the same page. */
export function normalizePath(path: string): string {
  let out = (path || "/").split(/[?#]/)[0] ?? "/";
  if (!out.startsWith("/")) out = `/${out}`;
  out = out.replace(/\/+$/, "").toLowerCase();
  return out === "" ? "/" : out;
}

// --- elements --------------------------------------------------------------------------------

/** Image elements in document order, so the first picture on a page loads eagerly. */
type RenderState = { imageOrder: Map<string, number>; page: string };

function imageOrderOf(root: Element[]): Map<string, number> {
  const order = new Map<string, number>();
  const walk = (elements: Element[]) => {
    for (const element of elements) {
      if (element.type === "image") order.set(element.id, order.size);
      if (element.children) walk(element.children);
    }
  };
  walk(root);
  return order;
}

/**
 * One element. While it is being typed into on the page the renderer hands React the very
 * same output as before, so React leaves the edited DOM alone; when the edit ends the
 * element remounts (a new key) from the saved value, discarding the browser's markup.
 */
function ElementView({ element, state }: { element: Element; state: RenderState }) {
  const snapshot = useKitSnapshot();
  return <ElementBody key={snapshot.editEpoch[element.id] ?? 0} element={element} state={state} />;
}

function ElementBody({ element, state }: { element: Element; state: RenderState }) {
  const snapshot = useKitSnapshot();
  const frozen = snapshot.editing === element.id;
  // While frozen the inputs read as null, so the memo keeps returning the output from the
  // moment the edit began (the same element object, which React skips).
  const liveElement = frozen ? null : element;
  const liveState = frozen ? null : state;
  const liveKit = frozen ? null : snapshot.kit;
  const liveMode = frozen ? null : snapshot.editMode;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally stale while the element is being edited
  return useMemo(() => renderElement(element, state, snapshot), [liveElement, liveState, liveKit, liveMode]);
}

function renderElement(element: Element, state: RenderState, snapshot: KitSnapshot): ReactNode {
  const render = getWidget(element.type);
  if (element.type === "site-section") return <SiteSectionView element={element} state={state} />;
  if (!render) {
    if (snapshot.editMode) {
      return (
        <div className={`ae-el ae-${cssIdent(element.id)} ae-unsupported`} data-ae-id={element.id} data-ae-type={element.type} style={{ padding: 12, border: "1px dashed #a32d2d", color: "#a32d2d", fontSize: 13 }}>
          Unsupported element: {element.type === "unsupported" ? String((element.props as { originalType?: string }).originalType ?? "unknown") : element.type}
        </div>
      );
    }
    warnOnce(element.type);
    return null;
  }
  const common: Record<string, string | undefined> & { className: string } = {
    className: `ae-el ae-${cssIdent(element.id)} ae-${cssIdent(element.type)}${element.advanced.cssClasses ? ` ${element.advanced.cssClasses.replace(/[<>"'&\\]/g, "")}` : ""}`,
    id: element.advanced.cssId ? cssIdent(element.advanced.cssId) : undefined,
    "data-ae-id": element.id,
    "data-ae-type": element.type,
    "data-ae-anim": element.advanced.animation && element.advanced.animation.type !== "none" ? element.advanced.animation.type : undefined,
    "data-ae-parallax": element.advanced.scroll?.parallax ? String(Math.max(-10, Math.min(10, element.advanced.scroll.parallax))) : undefined,
  };
  for (const attribute of element.advanced.attributes ?? []) {
    if (safeAttributeName(attribute.name)) common[attribute.name.toLowerCase()] = attribute.value;
  }
  const imageIndex = element.type === "image" ? (state.imageOrder.get(element.id) ?? -1) : -1;
  const children = element.children?.map((child) => <ElementView key={child.id} element={child} state={state} />);
  return <>{render({ element, common, children, kit: snapshot.kit, editMode: snapshot.editMode, imageIndex, page: state.page })}</>;
}


function SiteSectionView({ element }: { element: Element; state: RenderState }) {
  const snapshot = useKitSnapshot();
  const props = element.props as SiteSectionProps;
  const registration = getKitRuntime().store.getSection(props.key);
  const className = `ae-el ae-${cssIdent(element.id)} ae-site-section${element.advanced.cssClasses ? ` ${element.advanced.cssClasses.replace(/[<>"'&\\]/g, "")}` : ""}`;
  if (!registration) {
    if (!snapshot.editMode) return null;
    return (
      <div className={className} data-ae-id={element.id} data-ae-type="site-section" data-ae-section={props.key} style={{ padding: 16, border: "1px dashed #8a4b00", color: "#8a4b00", fontSize: 13 }}>
        The site has no section registered as "{props.key}".
      </div>
    );
  }
  const Component = registration.component as ComponentType;
  return (
    <div className={className} data-ae-id={element.id} data-ae-type="site-section" data-ae-section={props.key} id={element.advanced.cssId ? cssIdent(element.advanced.cssId) : undefined}>
      <Component />
    </div>
  );
}

const warned = new Set<string>();
function warnOnce(type: string): void {
  if (warned.has(type)) return;
  warned.add(type);
  if (typeof console !== "undefined") console.warn(`Armature: no widget renders "${type}"; the element was skipped. Update src/lib/armature-kit.`);
}

// --- pages ------------------------------------------------------------------------------------

/**
 * Every head tag the layout and site kit ask for, applied to `document.head` on the
 * client. SSR sites should use `computePageHead(layout, siteKit)` in their route.head()
 * (see kit/README.md) so Google receives the tags in the initial HTML.
 */
function usePageSeo(layout: LayoutDoc | undefined) {
  const snapshot = useKitSnapshot();
  useEffect(() => {
    if (!layout || typeof document === "undefined") return;
    const tags = computePageHead(layout, snapshot.kit, { pageLabel: layout.label });
    applyHeadTags(tags);
  }, [layout, snapshot.kit]);
}

/**
 * Insert the tags into document.head, replacing the ones we wrote last time so nothing
 * accumulates when the visitor navigates from page to page.
 */
export function applyHeadTags(tags: HeadTag[]): void {
  if (typeof document === "undefined") return;
  // Remove tags we owned last time (marked with data-armature-head).
  document.head.querySelectorAll("[data-armature-head]").forEach((node) => node.remove());
  for (const tag of tags) {
    if (tag.tag === "title") {
      // Title is a special case: replace textContent of the existing <title>, adding it if missing.
      let element = document.head.querySelector("title");
      if (!element) {
        element = document.createElement("title");
        element.setAttribute("data-armature-head", "");
        document.head.appendChild(element);
      }
      element.textContent = tag.content;
      continue;
    }
    if (tag.tag === "script") {
      const element = document.createElement("script");
      element.type = tag.type;
      element.setAttribute("data-armature-head", "");
      element.textContent = tag.content;
      document.head.appendChild(element);
      continue;
    }
    const element = document.createElement(tag.tag);
    for (const [key, value] of Object.entries(tag.attrs)) element.setAttribute(key, value);
    element.setAttribute("data-armature-head", "");
    document.head.appendChild(element);
  }
}

/**
 * React component for SPA sites: renders no visible output but keeps the head tags for
 * the given layout up to date. Place it near <ArmaturePage> or inside your page components
 * to have SEO fields applied on the client. SSR sites should prefer computePageHead()
 * inside route.head() so Google sees the tags in the initial HTML.
 */
export function ArmatureHead({ layout, pageUrl, pageLabel }: { layout: LayoutDoc; pageUrl?: string; pageLabel?: string }): null {
  const snapshot = useKitSnapshot();
  useEffect(() => {
    if (typeof document === "undefined") return;
    const tags = computePageHead(layout, snapshot.kit, { pageUrl, pageLabel: pageLabel ?? layout.label });
    applyHeadTags(tags);
  }, [layout, snapshot.kit, pageUrl, pageLabel]);
  return null;
}

/**
 * The kit's Google fonts as one <link> in the document head (created with the DOM API,
 * updated in place when the kit's font list changes, removed when it empties).
 */
function useKitFonts(kit: KitSnapshot["kit"]): void {
  const href = useMemo(() => googleFontsHref(kit), [kit]);
  useEffect(() => {
    if (typeof document === "undefined") return;
    let link = document.head.querySelector<HTMLLinkElement>("link[data-armature-fonts]");
    if (!href) {
      link?.remove();
      return;
    }
    if (!link) {
      link = document.createElement("link");
      link.rel = "stylesheet";
      link.setAttribute("data-armature-fonts", "");
      document.head.appendChild(link);
    }
    if (link.getAttribute("href") !== href) link.setAttribute("href", href);
  }, [href]);
}

/** Render one layout by slug (or a layout object) inside the kit's scope. */
export function ArmaturePage({ slug, layout: given }: { slug: string; layout?: LayoutDoc }) {
  const snapshot = useKitSnapshot();
  const layout = given ?? snapshot.layouts[slug];
  const builderPage = !getKitRuntime().codedSlugs.has(slug) && !isChromeSlug(slug);
  const css = useMemo(() => (layout ? pageCss(layout, snapshot.kit, { editMode: snapshot.editMode }) : ""), [layout, snapshot.kit, snapshot.editMode]);
  useKitFonts(snapshot.kit);
  const root = useRef<HTMLDivElement>(null);
  usePageSeo(layout);
  void builderPage;
  // Page settings the site's own frame responds to: <html data-armature-canvas="full"> for a
  // full-canvas page (hide the header and footer) and data-armature-hide-title.
  const canvas = layout?.pageSettings?.fullCanvas ? "full" : null;
  const hideTitle = !!layout?.pageSettings?.hideTitle;
  useEffect(() => {
    if (typeof document === "undefined") return;
    const html = document.documentElement;
    if (canvas) html.setAttribute("data-armature-canvas", canvas);
    if (hideTitle) html.setAttribute("data-armature-hide-title", "");
    return () => {
      html.removeAttribute("data-armature-canvas");
      html.removeAttribute("data-armature-hide-title");
    };
  }, [canvas, hideTitle]);
  useEffect(() => {
    if (!root.current) return;
    const stopEntrances = installEntranceAnimations(root.current);
    // Parallax moves elements while scrolling; the editor keeps them still so handles line up.
    const stopParallax = snapshot.editMode ? () => undefined : installParallax(root.current);
    return () => {
      stopEntrances();
      stopParallax();
    };
  }, [layout, snapshot.editMode]);
  const state = useMemo<RenderState>(() => ({ imageOrder: layout ? imageOrderOf(layout.root) : new Map(), page: slug }), [layout, slug]);
  if (!layout) return null;
  return (
    <div ref={root} className={`ae-root${layout.pageSettings?.fullCanvas ? " ae-full-canvas" : ""}`} data-ae-page={slug}>
      <style data-armature-page={slug}>{css}</style>
      {layout.root.map((element) => (
        <ElementView key={element.id} element={element} state={state} />
      ))}
    </div>
  );
}

/**
 * On a coded page: the page's layout when one exists, else the registered site sections
 * named in `defaults`, in order. The editor uses `defaults` to seed the page's tree.
 */
export function ArmatureSlot({ slug, defaults = [] }: { slug: string; defaults?: string[] }) {
  const snapshot = useKitSnapshot();
  const kit = getKitRuntime();
  const key = defaults.join(",");
  useEffect(() => {
    kit.slots.set(slug, key ? key.split(",") : []);
    for (const listener of kit.onSlotsChange) listener();
    return () => {
      kit.slots.delete(slug);
      for (const listener of kit.onSlotsChange) listener();
    };
  }, [kit, slug, key]);
  const layout = snapshot.layouts[slug];
  if (layout) return <ArmaturePage slug={slug} layout={layout} />;
  return (
    <>
      {defaults.map((sectionKey) => {
        const registration = kit.store.getSection(sectionKey);
        if (!registration) return null;
        return createElement(registration.component as ComponentType, { key: sectionKey });
      })}
    </>
  );
}

function subscribeLocation(listener: () => void) {
  window.addEventListener("popstate", listener);
  window.addEventListener("armature:navigated", listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener("armature:navigated", listener);
  };
}
const readPath = () => (typeof window === "undefined" ? "/" : window.location.pathname);

/**
 * The site's header or footer: the part built in the editor (content/layouts/_header.json
 * or _footer.json) when the site has one, else `fallback` (the coded header or footer).
 * Wrap nothing else around it: it renders the <header> or <footer> itself.
 */
export function ArmatureChrome({ part, fallback = null }: { part: ChromePart; fallback?: ReactNode }) {
  const snapshot = useKitSnapshot();
  const slug = chromeSlug(part);
  const layout = snapshot.layouts[slug];
  if (!layout) return <>{fallback}</>;
  const Tag = part === "header" ? "header" : "footer";
  return (
    <Tag className={`ae-chrome ae-chrome-${part}`} data-armature-chrome="" data-armature-part={part}>
      <ArmaturePage slug={slug} layout={layout} />
    </Tag>
  );
}

/** The path a menu item's page lives at: a coded page from the schema, or a built page's own path. */
export function pagePathOf(slug: string, layouts: Record<string, LayoutDoc>): string | null {
  const coded = getKitRuntime().pagePaths.get(slug);
  if (coded) return coded;
  const layout = layouts[slug];
  return layout && !isChromeSlug(slug) ? layout.path : null;
}

/** The builder-only page at the current path, or `fallback` (the site's 404). Place it before the site's catch-all. */
export function ArmatureRoute({ fallback = null, path }: { fallback?: ReactNode; path?: string }) {
  const snapshot = useKitSnapshot();
  const livePath = useSyncExternalStore(subscribeLocation, readPath, readPath);
  const wanted = normalizePath(path ?? livePath);
  const kit = getKitRuntime();
  const layout = Object.values(snapshot.layouts).find((candidate) => !kit.codedSlugs.has(candidate.pageSlug) && !isChromeSlug(candidate.pageSlug) && normalizePath(candidate.path) === wanted);
  if (!layout) return <>{fallback}</>;
  return (
    <>
      <style data-armature-body="">{`body { background: var(--ae-page-background, #ffffff); }`}</style>
      <ArmaturePage slug={layout.pageSlug} layout={layout} />
    </>
  );
}

/** Every builder-only page (slug, path, label), for a site's own navigation. */
export function useBuilderPages(): { slug: string; path: string; label: string }[] {
  const snapshot = useKitSnapshot();
  const kit = getKitRuntime();
  return useMemo(
    () =>
      Object.values(snapshot.layouts)
        .filter((layout) => !kit.codedSlugs.has(layout.pageSlug) && !isChromeSlug(layout.pageSlug))
        .map((layout) => ({ slug: layout.pageSlug, path: layout.path, label: layout.label ?? layout.pageSlug })),
    [snapshot.layouts, kit],
  );
}
