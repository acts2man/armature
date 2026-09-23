/**
 * The Armature site kit — site contract v2: page builder.
 *
 * Copy this folder into your site as src/lib/armature-kit/ and create the kit once:
 *
 *   // src/lib/armature.ts
 *   import { createArmatureKit } from "./armature-kit";
 *   import schema from "../../content/schema.json";
 *   import content from "../../content/pages.json";
 *   import siteKit from "../../content/site-kit.json";      // optional
 *
 *   export const armature = createArmatureKit({
 *     allowedOrigins: ["https://armature-sites.netlify.app"],
 *     schema,
 *     content,
 *     siteKit,
 *     layouts: import.meta.glob("../../content/layouts/*.json", { eager: true }),
 *     navigate: (path) => router.navigate(path),          // optional, for client-side routers
 *   });
 *
 * Then: register the sections you hand-coded, render `<ArmatureSlot slug="home"
 * defaults={["hero", "faq"]} />` on a coded page, place `<ArmatureRoute fallback={<NotFound />} />`
 * before your 404 so builder-only pages are served, and keep reading content with
 * `armature.text()`, `armature.link()`, `armature.image()`, `armature.list()` and
 * `armature.plain()` exactly as in contract v1.1.
 *
 * React is the only dependency. Public visitors never run the bridge: it activates
 * only inside the editor's iframe, with the edit flag, from an allowlisted origin.
 */
import { createBridge, PROTOCOL_VERSION, type SiteSchemaLike } from "./bridge.ts";
import { setKitRuntime, type KitRuntime } from "./renderer.tsx";
import { createKitStore, type ContentTree, type LinkValue, type ListValue } from "./store.ts";
import type { LayoutDoc, SiteKit } from "./types.ts";
import "./widgets.tsx";
import "./library/index.ts";

export const KIT_VERSION = "2.3.0";
export { PROTOCOL_VERSION };

export type ArmatureKitConfig = {
  /** Exact origins of the editor that may embed this site, e.g. ["https://armature-sites.netlify.app"]. */
  allowedOrigins: string[];
  /** content/schema.json */
  schema: SiteSchemaLike;
  /** content/pages.json */
  content: ContentTree;
  /** content/site-kit.json, when the site has one. */
  siteKit?: SiteKit | null;
  /** `import.meta.glob("../../content/layouts/*.json", { eager: true })`, or an array of layouts. */
  layouts?: Record<string, unknown> | LayoutDoc[];
  /** Client-side navigation for the editor's page switcher. Default: a full page load. */
  navigate?: (path: string) => void;
  /**
   * Where the Form widget sends entries: the dashboard's form-submit function and this
   * site's id (both shown on the site's settings in the dashboard). Without it, forms
   * show a note instead of sending.
   */
  forms?: { endpoint: string; siteId: string };
};

export type ArmatureKit = {
  readonly active: boolean;
  readonly version: string;
  subscribe(listener: () => void): () => void;
  getSnapshot(): ContentTree;
  text(slug: string, section: string, field: string): string;
  plain(slug: string, section: string, field: string): string;
  link(slug: string, section: string, field: string): LinkValue;
  image(slug: string, section: string, field: string): string;
  list(slug: string, section: string, field: string): ListValue;
  encode(value: string, path: string): string;
  /** Register a hand-coded section so the editor can place, move and wrap it. */
  registerSiteSection(key: string, options: { label: string; component: unknown; repeatable?: boolean }): void;
};

export function createArmatureKit(config: ArmatureKitConfig): ArmatureKit {
  const store = createKitStore({ content: config.content, layouts: config.layouts, siteKit: config.siteKit ?? null });
  const runtime: KitRuntime = {
    store,
    codedSlugs: new Set((config.schema?.pages ?? []).map((page) => page.slug)),
    slots: new Map(),
    onSlotsChange: new Set(),
    forms: config.forms && /^https:\/\/[^\s]+$/i.test(config.forms.endpoint) && /^[0-9a-f-]{36}$/i.test(config.forms.siteId) ? config.forms : undefined,
  };
  setKitRuntime(runtime);
  const bridge = createBridge({ allowedOrigins: config.allowedOrigins, schema: config.schema, store, kitVersion: KIT_VERSION, navigate: config.navigate, slots: runtime.slots, onSlotsChange: runtime.onSlotsChange });

  const itemTypes = new Map<string, Record<string, string>>();
  for (const page of config.schema?.pages ?? []) {
    for (const section of page.sections ?? []) {
      for (const field of section.fields ?? []) {
        if (field.type === "list") itemTypes.set(`${page.slug}.${section.key}.${field.key}`, Object.fromEntries((field.itemFields ?? []).map((item) => [item.key, item.type])));
      }
    }
  }
  const raw = (slug: string, section: string, field: string) => store.getSnapshot().content[slug]?.[section]?.[field];

  return {
    active: bridge.active,
    version: KIT_VERSION,
    subscribe: store.subscribe,
    getSnapshot: () => store.getSnapshot().content,
    text(slug, section, field) {
      const value = raw(slug, section, field);
      return typeof value === "string" ? bridge.encode(value, `${slug}.${section}.${field}`) : "";
    },
    plain(slug, section, field) {
      const value = raw(slug, section, field);
      return typeof value === "string" ? value : "";
    },
    link(slug, section, field) {
      const value = raw(slug, section, field);
      if (value && typeof value === "object" && !Array.isArray(value)) return { label: bridge.encode(value.label ?? "", `${slug}.${section}.${field}`), href: value.href ?? "" };
      return { label: "", href: "" };
    },
    image(slug, section, field) {
      const value = raw(slug, section, field);
      return typeof value === "string" ? value : "";
    },
    list(slug, section, field) {
      const value = raw(slug, section, field);
      if (!Array.isArray(value)) return [];
      if (!bridge.active) return value;
      const root = `${slug}.${section}.${field}`;
      const types = itemTypes.get(root) ?? {};
      return value.map((item, index) => {
        const out: Record<string, string> = {};
        for (const [key, text] of Object.entries(item)) {
          const type = types[key];
          out[key] = type === "text" || type === "textarea" || type === undefined ? bridge.encode(text, `${root}[${index}].${key}`) : text;
        }
        return out;
      });
    },
    encode: bridge.encode,
    registerSiteSection(key, options) {
      store.registerSection(key, { label: options.label, component: options.component, repeatable: options.repeatable ?? false });
    },
  };
}

export { ArmaturePage, ArmatureRoute, ArmatureSlot, useBuilderPages, useKitSnapshot } from "./renderer.tsx";
export { RichText, plainDoc, richTextToPlain } from "./richText.tsx";
export { Icon } from "./icon.tsx";
export { pageCss, kitCss, elementsCss, registerBaseCss, registerStyleTarget, registerWidgetCss } from "./css.ts";
export { registerWidget } from "./widgets.tsx";
export { defaultSiteKit } from "./defaults.ts";
export { resolve, own, setAt, isResponsive, hasOverride } from "./responsive.ts";
export * from "./values.ts";
export { checkLayout, checkSiteKit, checkElement, describeProblem, settingLabel, readPath, LAYOUT_LIMITS, isAllowedHref, isAllowedMediaSrc, isAllowedVideoUrl, CONTAINER_TYPES, AGENCY_ONLY_TYPES, isKnownElementType, registerPropsCheck, type Problem, type ProblemPath, type CheckReport } from "./validate.ts";
export type * from "./types.ts";
export type { ContentTree, LinkValue, ListValue } from "./store.ts";
