/**
 * The renderer: <ArmaturePage> renders a layout, <ArmatureSlot> lets a coded page render
 * its layout (falling back to its registered site sections), <ArmatureRoute> serves
 * builder-only pages by their path. Semantic HTML only; no innerHTML anywhere. The
 * stylesheet for a page is generated from the tree and mounted as a <style> text node.
 */
import { createElement, useEffect, useMemo, useRef, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import { pageCss } from "./css.ts";
import { installEntranceAnimations } from "./motion.ts";
import { safeAttributeName } from "./sanitize.ts";
import type { KitSnapshot, KitStore } from "./store.ts";
import type { Element, LayoutDoc, SiteSectionProps } from "./types.ts";
import { cssIdent } from "./values.ts";
import { getWidget } from "./widgets.tsx";

export type KitRuntime = {
  store: KitStore;
  /** Slugs declared in content/schema.json: their layouts drive <ArmatureSlot>, never <ArmatureRoute>. */
  codedSlugs: Set<string>;
  /** Slots currently mounted on the page, with the section keys they would show without a layout. */
  slots: Map<string, string[]>;
  onSlotsChange: Set<() => void>;
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
const emptySnapshot: KitSnapshot = { content: {}, layouts: {}, kit: null as unknown as KitSnapshot["kit"], editMode: false };

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
type RenderState = { imageOrder: Map<string, number> };

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

function ElementView({ element, state }: { element: Element; state: RenderState }) {
  const snapshot = useKitSnapshot();
  const render = getWidget(element.type);
  if (element.type === "site-section") return <SiteSectionView element={element} state={state} />;
  if (!render) {
    if (snapshot.editMode) {
      return (
        <div className={`ae-el ae-${cssIdent(element.id)} ae-unsupported`} data-ae-id={element.id} data-ae-type={element.type} style={{ padding: 12, border: "1px dashed #a32d2d", color: "#a32d2d", fontSize: 13 }}>
          Unsupported element: {element.type}
        </div>
      );
    }
    warnOnce(element.type);
    return null;
  }
  const common: Record<string, string | undefined> & { className: string } = {
    className: `ae-el ae-${cssIdent(element.id)} ae-${cssIdent(element.type)}${element.advanced.cssClasses ? ` ${element.advanced.cssClasses.replace(/[^a-zA-Z0-9_\s-]/g, "")}` : ""}`,
    id: element.advanced.cssId ? cssIdent(element.advanced.cssId) : undefined,
    "data-ae-id": element.id,
    "data-ae-type": element.type,
    "data-ae-anim": element.advanced.animation && element.advanced.animation.type !== "none" ? element.advanced.animation.type : undefined,
  };
  for (const attribute of element.advanced.attributes ?? []) {
    if (safeAttributeName(attribute.name)) common[attribute.name.toLowerCase()] = attribute.value;
  }
  const imageIndex = element.type === "image" ? (state.imageOrder.get(element.id) ?? -1) : -1;
  const children = element.children?.map((child) => <ElementView key={child.id} element={child} state={state} />);
  return <>{render({ element, common, children, kit: snapshot.kit, editMode: snapshot.editMode, imageIndex })}</>;
}

function SiteSectionView({ element }: { element: Element; state: RenderState }) {
  const snapshot = useKitSnapshot();
  const props = element.props as SiteSectionProps;
  const registration = getKitRuntime().store.getSection(props.key);
  const className = `ae-el ae-${cssIdent(element.id)} ae-site-section${element.advanced.cssClasses ? ` ${element.advanced.cssClasses.replace(/[^a-zA-Z0-9_\s-]/g, "")}` : ""}`;
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

function usePageSeo(layout: LayoutDoc | undefined, builderPage: boolean) {
  useEffect(() => {
    if (!layout || typeof document === "undefined") return;
    const seo = layout.seo ?? {};
    const title = seo.title || (builderPage ? layout.label : undefined);
    if (title) document.title = title;
    const setMeta = (selector: string, attributes: Record<string, string>, content: string | undefined) => {
      let tag = document.head.querySelector<HTMLMetaElement>(selector);
      if (!content) {
        if (tag?.dataset["armature"]) tag.remove();
        return;
      }
      if (!tag) {
        tag = document.createElement("meta");
        for (const [name, value] of Object.entries(attributes)) tag.setAttribute(name, value);
        tag.dataset["armature"] = "1";
        document.head.appendChild(tag);
      }
      tag.setAttribute("content", content);
    };
    setMeta('meta[name="description"]', { name: "description" }, seo.description);
    setMeta('meta[property="og:image"]', { property: "og:image" }, seo.ogImage);
    setMeta('meta[name="robots"]', { name: "robots" }, seo.noindex ? "noindex" : undefined);
  }, [layout, builderPage]);
}

/** Render one layout by slug (or a layout object) inside the kit's scope. */
export function ArmaturePage({ slug, layout: given }: { slug: string; layout?: LayoutDoc }) {
  const snapshot = useKitSnapshot();
  const layout = given ?? snapshot.layouts[slug];
  const builderPage = !getKitRuntime().codedSlugs.has(slug);
  const css = useMemo(() => (layout ? pageCss(layout, snapshot.kit, { editMode: snapshot.editMode }) : ""), [layout, snapshot.kit, snapshot.editMode]);
  const root = useRef<HTMLDivElement>(null);
  usePageSeo(layout, builderPage);
  useEffect(() => {
    if (!root.current) return;
    return installEntranceAnimations(root.current);
  }, [layout]);
  const state = useMemo<RenderState>(() => ({ imageOrder: layout ? imageOrderOf(layout.root) : new Map() }), [layout]);
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

/** The builder-only page at the current path, or `fallback` (the site's 404). Place it before the site's catch-all. */
export function ArmatureRoute({ fallback = null, path }: { fallback?: ReactNode; path?: string }) {
  const snapshot = useKitSnapshot();
  const livePath = useSyncExternalStore(subscribeLocation, readPath, readPath);
  const wanted = normalizePath(path ?? livePath);
  const kit = getKitRuntime();
  const layout = Object.values(snapshot.layouts).find((candidate) => !kit.codedSlugs.has(candidate.pageSlug) && normalizePath(candidate.path) === wanted);
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
        .filter((layout) => !kit.codedSlugs.has(layout.pageSlug))
        .map((layout) => ({ slug: layout.pageSlug, path: layout.path, label: layout.label ?? layout.pageSlug })),
    [snapshot.layouts, kit],
  );
}
