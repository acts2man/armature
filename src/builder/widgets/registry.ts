/**
 * The editor's widget catalogue: what the Elements panel lists, the defaults a new
 * element gets, and how each type is described. The kit renders; this only creates.
 * Content controls per widget are registered in ./controls (milestone 3).
 */
import type { Element } from "@shared/builder/index.ts";
import { plainDoc } from "@kit/richText.tsx";
import { px, pct } from "@kit/values.ts";
import { createElement } from "../store.ts";

export type WidgetGroup = "layout" | "basic" | "general" | "agency";

export type WidgetDefinition = {
  type: string;
  label: string;
  group: WidgetGroup;
  /** Name of an icon in src/components/icons.tsx, resolved by the panel. */
  icon: string;
  keywords?: string[];
  /** Agency-only widgets are hidden from clients. */
  agencyOnly?: boolean;
  create: () => Element;
};

const definitions = new Map<string, WidgetDefinition>();

export function registerWidgetDefinition(definition: WidgetDefinition): void {
  definitions.set(definition.type, definition);
}

export const widgetDefinition = (type: string): WidgetDefinition | undefined => definitions.get(type);
export const widgetDefinitions = (): WidgetDefinition[] => Array.from(definitions.values());
export const widgetLabel = (type: string): string => definitions.get(type)?.label ?? (type === "site-section" ? "Section" : type === "unsupported" ? "Unsupported element" : type.charAt(0).toUpperCase() + type.slice(1));

export const GROUP_LABELS: Record<WidgetGroup, string> = { layout: "Layout", basic: "Basic", general: "General", agency: "Agency only" };

// --- the core widgets (milestone 1 renderers) -------------------------------------------------------

registerWidgetDefinition({
  type: "container",
  label: "Container",
  group: "layout",
  icon: "Section",
  keywords: ["section", "flex", "box", "row", "column"],
  create: () => createElement("container", { tag: "div", layout: "boxed", direction: "column", gap: { column: px(20), row: px(20) } }),
});

registerWidgetDefinition({
  type: "grid",
  label: "Grid",
  group: "layout",
  icon: "Grid",
  keywords: ["columns", "cells"],
  create: () => createElement("grid", { tag: "div", layout: "boxed", columns: { desktop: 3, tablet: 2, mobile: 1 }, gap: { column: px(24), row: px(24) } }),
});

registerWidgetDefinition({
  type: "heading",
  label: "Heading",
  group: "basic",
  icon: "Heading",
  keywords: ["title", "h1", "h2"],
  create: () => createElement("heading", { text: "Add your heading", tag: "h2" }, { style: { typography: { preset: "kit:type.h2" } } }),
});

registerWidgetDefinition({
  type: "text",
  label: "Text Editor",
  group: "basic",
  icon: "Paragraph",
  keywords: ["paragraph", "rich", "copy", "body"],
  create: () => createElement("text", { doc: plainDoc("Start writing here. Double-click to edit the text right on the page, and use the toolbar for bold, links and lists.") }, { style: { typography: { preset: "kit:type.body" } } }),
});

registerWidgetDefinition({
  type: "image",
  label: "Image",
  group: "basic",
  icon: "Image",
  keywords: ["picture", "photo"],
  create: () => createElement("image", { src: "", alt: "", fit: "cover", link: { kind: "none" }, width: pct(100) }),
});

registerWidgetDefinition({
  type: "button",
  label: "Button",
  group: "basic",
  icon: "Pointer",
  keywords: ["link", "cta", "call to action"],
  create: () => createElement("button", { text: "Click here", link: { href: "#" }, preset: "kit:button.primary", size: "md", iconPosition: "before", align: "left" }),
});

registerWidgetDefinition({
  type: "spacer",
  label: "Spacer",
  group: "basic",
  icon: "Spacer",
  keywords: ["gap", "space", "empty"],
  create: () => createElement("spacer", { height: px(50) }),
});

registerWidgetDefinition({
  type: "divider",
  label: "Divider",
  group: "basic",
  icon: "Divider",
  keywords: ["line", "rule", "separator"],
  create: () => createElement("divider", { style: "solid", width: pct(100), weight: px(1), color: "kit:color.text", align: "center" }),
});

// --- structures (the "Select your structure" picker) --------------------------------------------------

export type Structure = { id: string; label: string; columns: number[]; rows?: number };

export const STRUCTURES: Structure[] = [
  { id: "1", label: "1 column", columns: [100] },
  { id: "50-50", label: "50 / 50", columns: [50, 50] },
  { id: "33-66", label: "33 / 66", columns: [33.33, 66.67] },
  { id: "66-33", label: "66 / 33", columns: [66.67, 33.33] },
  { id: "3", label: "3 columns", columns: [33.33, 33.33, 33.33] },
  { id: "4", label: "4 columns", columns: [25, 25, 25, 25] },
  { id: "25-50-25", label: "25 / 50 / 25", columns: [25, 50, 25] },
  { id: "2-rows", label: "2 rows", columns: [100], rows: 2 },
  { id: "6", label: "6 columns", columns: [16.66, 16.66, 16.66, 16.66, 16.66, 16.66] },
];

/** A boxed section holding the structure's columns (containers with percentage widths that stack on phones). */
export function createStructure(structure: Structure): Element {
  const column = (width: number) =>
    createElement("container", { tag: "div", layout: "full", direction: "column", gap: { column: px(20), row: px(20) } }, {
      advanced: structure.columns.length > 1 ? { width: { desktop: "custom", mobile: "full" }, customWidth: { desktop: { value: +width.toFixed(2), unit: "%" } } } : {},
      children: [],
    });
  const rows = structure.rows ?? 1;
  const rowOf = () => createElement("container", { tag: "div", layout: "full", direction: { desktop: "row", mobile: "column" }, align: "stretch", gap: { column: px(24), row: px(24) } }, { children: structure.columns.map(column) });
  if (structure.columns.length === 1 && rows === 1) {
    return createElement("container", { tag: "section", layout: "boxed", direction: "column", gap: { column: px(20), row: px(20) } }, { children: [] });
  }
  return createElement("container", { tag: "section", layout: "boxed", direction: "column", gap: { column: px(24), row: px(24) } }, {
    children: Array.from({ length: rows }, rowOf),
  });
}
