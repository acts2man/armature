/**
 * What the inspector shows for each widget: the Content tab (per widget), the Style tab
 * (by what the widget is: text-like, a box, a picture), its Hover twin, and the shared
 * Advanced tab. Widgets added later register their content specs and style kinds here.
 */
import { createElement as h } from "react";
import type { Element } from "@shared/builder/index.ts";
import { plainDoc, richTextToPlain } from "@kit/richText.tsx";
import { controlInputClass } from "./inputs.tsx";
import { HEIGHT_UNITS, PX_UNITS, SPACING_UNITS, WIDTH_UNITS, type ControlSpec, type Option, type Path } from "./types.ts";

const opts = (...pairs: [string, string][]): Option[] => pairs.map(([value, label]) => ({ value, label }));

const ALIGN_ICONS = [
  { value: "left", label: "Left", icon: "AlignLeft" },
  { value: "center", label: "Centre", icon: "AlignCenter" },
  { value: "right", label: "Right", icon: "AlignRight" },
];

const CONTAINER_TAGS = opts(["div", "div"], ["section", "section"], ["header", "header"], ["footer", "footer"], ["article", "article"], ["aside", "aside"], ["nav", "nav"]);

const widthControls = (): ControlSpec[] => [
  { kind: "choice", label: "Width", path: ["props", "layout"], allowNone: false, options: [{ value: "boxed", label: "Boxed" }, { value: "full", label: "Full width" }] },
  {
    kind: "if",
    id: "boxed-width",
    when: (read) => (read(["props", "layout"]) ?? "boxed") === "boxed",
    controls: [{ kind: "size", label: "Content width", path: ["props", "contentWidth"], units: WIDTH_UNITS, responsive: true, min: 0, hint: "Empty uses the site's content width." }],
  },
  { kind: "size", label: "Minimum height", path: ["props", "minHeight"], units: HEIGHT_UNITS, responsive: true, min: 0, allowScreen: true },
];

// --- content ---------------------------------------------------------------------------------------------

const contentSpecs = new Map<string, ControlSpec[]>();

/** Widgets register the controls of their Content tab. */
export function registerContentSpecs(type: string, specs: ControlSpec[]): void {
  contentSpecs.set(type, specs);
}

registerContentSpecs("container", [
  { kind: "group", label: "Container", controls: [...widthControls(), { kind: "select", label: "HTML tag", path: ["props", "tag"], options: CONTAINER_TAGS, required: true }] },
  {
    kind: "group",
    label: "Items",
    controls: [
      { kind: "choice", label: "Direction", path: ["props", "direction"], responsive: true, allowNone: false, options: [{ value: "column", label: "Stack" }, { value: "row", label: "Row" }, { value: "column-reverse", label: "Stack ↑" }, { value: "row-reverse", label: "Row ←" }] },
      { kind: "select", label: "Justify content", path: ["props", "justify"], responsive: true, options: opts(["flex-start", "Start"], ["center", "Centre"], ["flex-end", "End"], ["space-between", "Space between"], ["space-around", "Space around"], ["space-evenly", "Space evenly"]) },
      { kind: "select", label: "Align items", path: ["props", "align"], responsive: true, options: opts(["flex-start", "Start"], ["center", "Centre"], ["flex-end", "End"], ["stretch", "Stretch"], ["baseline", "Baseline"]) },
      { kind: "gap", label: "Gaps", path: ["props", "gap"], responsive: true },
      { kind: "toggle", label: "Wrap", path: ["props", "wrap"], responsive: true, hint: "Let items flow onto the next line." },
    ],
  },
  { kind: "group", label: "Additional options", open: false, controls: [{ kind: "select", label: "Overflow", path: ["props", "overflow"], options: opts(["visible", "Visible"], ["hidden", "Hidden"]) }, { kind: "link", label: "Link the whole box", path: ["props", "link"] }] },
]);

registerContentSpecs("grid", [
  { kind: "group", label: "Grid", controls: [...widthControls(), { kind: "select", label: "HTML tag", path: ["props", "tag"], options: CONTAINER_TAGS, required: true }] },
  {
    kind: "group",
    label: "Items",
    controls: [
      { kind: "number", label: "Columns", path: ["props", "columns"], responsive: true, min: 1, max: 12 },
      { kind: "number", label: "Rows", path: ["props", "rows"], responsive: true, min: 1, max: 24, hint: "Empty adds rows as items need them." },
      { kind: "gap", label: "Gaps", path: ["props", "gap"], responsive: true },
      { kind: "select", label: "Auto flow", path: ["props", "autoFlow"], options: opts(["row", "Row"], ["column", "Column"], ["row dense", "Row, dense"], ["column dense", "Column, dense"]) },
      { kind: "select", label: "Justify items", path: ["props", "justifyItems"], responsive: true, options: opts(["start", "Start"], ["center", "Centre"], ["end", "End"], ["stretch", "Stretch"]) },
      { kind: "select", label: "Align items", path: ["props", "alignItems"], responsive: true, options: opts(["start", "Start"], ["center", "Centre"], ["end", "End"], ["stretch", "Stretch"]) },
    ],
  },
  { kind: "group", label: "Additional options", open: false, controls: [{ kind: "select", label: "Overflow", path: ["props", "overflow"], options: opts(["visible", "Visible"], ["hidden", "Hidden"]) }] },
]);

registerContentSpecs("heading", [
  {
    kind: "group",
    label: "Heading",
    controls: [
      { kind: "text", label: "Title", path: ["props", "text"], multiline: true, max: 500, hint: "Or double-click it on the page." },
      { kind: "link", label: "Link", path: ["props", "link"] },
      { kind: "select", label: "HTML tag", path: ["props", "tag"], required: true, options: opts(["h1", "H1"], ["h2", "H2"], ["h3", "H3"], ["h4", "H4"], ["h5", "H5"], ["h6", "H6"], ["p", "p"], ["div", "div"], ["span", "span"]), hint: "One H1 per page helps search engines." },
    ],
  },
]);

registerContentSpecs("text", [
  {
    kind: "group",
    label: "Text Editor",
    controls: [
      { kind: "note", text: "Double-click the text on the page to edit it with the formatting toolbar (bold, italic, links, lists, alignment)." },
      {
        kind: "custom",
        id: "text-plain",
        render: ({ read, write, editOnPage }) =>
          h(
            "div",
            { className: "flex flex-col gap-2" },
            h("label", { htmlFor: "text-plain", className: "text-[12px] font-semibold text-muted" }, "Plain text (formatting is removed when you type here)"),
            h("textarea", {
              id: "text-plain",
              value: richTextToPlain(read(["props", "doc"]) as never),
              onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => write(["props", "doc"], plainDoc(event.target.value), "Changed text", "text-plain"),
              className: `${controlInputClass} min-h-32 py-1.5 leading-relaxed`,
            }),
            editOnPage && h("button", { type: "button", onClick: editOnPage, className: "h-8 rounded-sm border border-line text-[12px] font-semibold text-text hover:bg-ground" }, "Edit on the page"),
          ),
      },
    ],
  },
]);

registerContentSpecs("image", [
  { kind: "group", label: "Image", controls: [{ kind: "image", label: "Picture", path: ["props"] }, { kind: "text", label: "Caption", path: ["props", "caption"], max: 300 }] },
  {
    kind: "group",
    label: "Size",
    controls: [
      { kind: "size", label: "Width", path: ["props", "width"], units: WIDTH_UNITS, responsive: true, min: 0 },
      { kind: "size", label: "Height", path: ["props", "height"], units: HEIGHT_UNITS, responsive: true, min: 0 },
      { kind: "select", label: "Fit", path: ["props", "fit"], options: opts(["cover", "Cover (crop)"], ["contain", "Contain"], ["fill", "Stretch"], ["none", "Natural"]) },
      { kind: "choice", label: "Alignment", path: ["props", "align"], responsive: true, options: ALIGN_ICONS },
    ],
  },
  {
    kind: "group",
    label: "Link",
    open: false,
    controls: [
      { kind: "select", label: "On click", path: ["props", "link", "kind"], required: true, options: opts(["none", "Nothing"], ["lightbox", "Open larger (lightbox)"], ["url", "Go to a link"]) },
      {
        kind: "if",
        id: "image-link-url",
        when: (read) => read(["props", "link", "kind"]) === "url",
        controls: [
          { kind: "text", label: "Link address", path: ["props", "link", "href"], placeholder: "https://… or /contact/" },
          { kind: "toggle", label: "Open in a new tab", path: ["props", "link", "newTab"] },
        ],
      },
    ],
  },
]);

registerContentSpecs("button", [
  {
    kind: "group",
    label: "Button",
    controls: [
      { kind: "text", label: "Text", path: ["props", "text"], max: 120 },
      { kind: "link", label: "Link", path: ["props", "link"] },
      { kind: "select", label: "Site button style", path: ["props", "preset"], required: true, options: opts(["kit:button.primary", "Primary"], ["kit:button.secondary", "Secondary"], ["kit:button.outline", "Outline"]), hint: "Set these up once in Site settings. Style values override them here." },
      { kind: "select", label: "Size", path: ["props", "size"], required: true, options: opts(["sm", "Small"], ["md", "Medium"], ["lg", "Large"], ["xl", "Extra large"]) },
      { kind: "choice", label: "Alignment", path: ["props", "align"], responsive: true, options: [...ALIGN_ICONS, { value: "justify", label: "Full width", icon: "AlignJustify" }] },
    ],
  },
  { kind: "group", label: "Icon", open: false, controls: [{ kind: "icon", label: "Icon", path: ["props", "icon"] }, { kind: "choice", label: "Icon position", path: ["props", "iconPosition"], allowNone: false, options: [{ value: "before", label: "Before" }, { value: "after", label: "After" }] }] },
]);

registerContentSpecs("spacer", [{ kind: "group", label: "Spacer", controls: [{ kind: "size", label: "Space", path: ["props", "height"], units: HEIGHT_UNITS, responsive: true, min: 0, max: 1000, hint: "Or drag its bottom edge on the page." }] }]);

registerContentSpecs("divider", [
  {
    kind: "group",
    label: "Divider",
    controls: [
      { kind: "select", label: "Line style", path: ["props", "style"], required: true, options: opts(["solid", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"], ["double", "Double"]) },
      { kind: "size", label: "Width", path: ["props", "width"], units: WIDTH_UNITS, responsive: true, min: 0 },
      { kind: "size", label: "Weight", path: ["props", "weight"], units: ["px"], min: 1, max: 40 },
      { kind: "color", label: "Colour", path: ["props", "color"] },
      { kind: "choice", label: "Alignment", path: ["props", "align"], allowNone: false, options: ALIGN_ICONS },
      { kind: "text", label: "Text in the middle", path: ["props", "text"], max: 120 },
      { kind: "icon", label: "Icon in the middle", path: ["props", "icon"] },
    ],
  },
]);

registerContentSpecs("site-section", [
  { kind: "note", text: "A section built into the site's code. Click its words and pictures on the page to edit them; move it, hide it per device or delete it from here." },
]);

export const contentSpecsFor = (type: string): ControlSpec[] | undefined => contentSpecs.get(type);

// --- style -----------------------------------------------------------------------------------------------

/** What a widget's Style tab offers. */
export type StyleKind = "text" | "box" | "container" | "media" | "section" | "minimal";

const styleKinds = new Map<string, StyleKind>([
  ["container", "container"],
  ["grid", "container"],
  ["heading", "text"],
  ["text", "text"],
  ["button", "box"],
  ["image", "media"],
  ["spacer", "minimal"],
  ["divider", "text"],
  ["site-section", "section"],
]);

export function registerStyleKind(type: string, kind: StyleKind): void {
  styleKinds.set(type, kind);
}

export const styleKindOf = (type: string): StyleKind => styleKinds.get(type) ?? "box";

/**
 * The Style tab for the normal state (base ["style"]) or hover (base ["style", "hover"]).
 * Hover omits the overlay and adds the transition duration (kept on the normal style,
 * where the CSS generator reads it).
 */
export function styleSpecs(type: string, state: "normal" | "hover"): ControlSpec[] {
  const kind = styleKindOf(type);
  const base: Path = state === "hover" ? ["style", "hover"] : ["style"];
  const at = (...rest: string[]): Path => [...base, ...rest];
  const specs: ControlSpec[] = [];
  const hasText = kind === "text" || kind === "box";
  if (hasText) {
    specs.push({ kind: "group", label: "Typography", controls: [{ kind: "typography", path: at("typography") }] });
    specs.push({ kind: "group", label: "Colour", controls: [{ kind: "color", label: "Text colour", path: at("color"), responsive: true }, { kind: "shadow", label: "Text shadow", path: at("textShadow"), responsive: true, text: true }] });
  }
  if (kind !== "minimal" || state === "normal") {
    const background: ControlSpec[] = [{ kind: "background", label: "Background", path: at("background"), responsive: true }];
    if (kind === "container" && state === "normal") background.push({ kind: "overlay", path: ["style", "backgroundOverlay"] });
    specs.push({ kind: "group", label: "Background", open: kind === "container" || kind === "box", controls: background });
  }
  if (kind !== "minimal") {
    specs.push({ kind: "group", label: "Border", open: false, controls: [{ kind: "border", path: at("border") }] });
    specs.push({ kind: "group", label: "Shadow", open: false, controls: [{ kind: "shadow", label: "Box shadow", path: at("boxShadow"), responsive: true }] });
  }
  specs.push({ kind: "group", label: "Effects", open: false, controls: [{ kind: "number", label: "Opacity", path: at("opacity"), responsive: true, min: 0, max: 1, step: 0.05 }] });
  if (state === "hover") {
    specs.unshift({ kind: "number", label: "Transition (ms)", path: ["style", "transition"], min: 0, max: 5000, step: 50, hint: "How long the change to the hover look takes." });
  }
  if (kind === "section") specs.unshift({ kind: "note", text: "The section's own design comes from the site's code. These add to it." });
  return specs;
}

// --- advanced ----------------------------------------------------------------------------------------------

export function advancedSpecs(parentIsFlex: boolean): ControlSpec[] {
  const specs: ControlSpec[] = [
    {
      kind: "group",
      label: "Layout",
      controls: [
        { kind: "sides", label: "Margin", path: ["advanced", "margin"], responsive: true, units: SPACING_UNITS },
        { kind: "sides", label: "Padding", path: ["advanced", "padding"], responsive: true, units: SPACING_UNITS },
        { kind: "select", label: "Width", path: ["advanced", "width"], responsive: true, options: opts(["full", "Full width (100%)"], ["inline", "Inline (auto)"], ["custom", "Custom"]) },
        { kind: "if", id: "custom-width", when: (read) => JSON.stringify(read(["advanced", "width"]) ?? "").includes("custom"), controls: [{ kind: "size", label: "Custom width", path: ["advanced", "customWidth"], responsive: true, units: WIDTH_UNITS, min: 0 }] },
        { kind: "size", label: "Max width", path: ["advanced", "maxWidth"], responsive: true, units: WIDTH_UNITS, min: 0 },
      ],
    },
  ];
  if (parentIsFlex) {
    specs.push({
      kind: "group",
      label: "In its container",
      open: false,
      controls: [
        { kind: "select", label: "Align self", path: ["advanced", "alignSelf"], responsive: true, options: opts(["auto", "Auto"], ["flex-start", "Start"], ["center", "Centre"], ["flex-end", "End"], ["stretch", "Stretch"]) },
        { kind: "number", label: "Order", path: ["advanced", "order"], responsive: true, min: -20, max: 20 },
        { kind: "number", label: "Grow", path: ["advanced", "flexGrow"], responsive: true, min: 0, max: 20 },
        { kind: "number", label: "Shrink", path: ["advanced", "flexShrink"], responsive: true, min: 0, max: 20 },
      ],
    });
  }
  specs.push(
    {
      kind: "group",
      label: "Position",
      open: false,
      controls: [
        { kind: "select", label: "Position", path: ["advanced", "position", "type"], clearPath: ["advanced", "position"], options: opts(["absolute", "Absolute (inside its parent)"], ["fixed", "Fixed (to the screen)"]) },
        {
          kind: "if",
          id: "position-offsets",
          when: (read) => !!read(["advanced", "position", "type"]) && read(["advanced", "position", "type"]) !== "default",
          controls: [
            { kind: "size", label: "Top", path: ["advanced", "position", "top"], responsive: true, units: PX_UNITS },
            { kind: "size", label: "Right", path: ["advanced", "position", "right"], responsive: true, units: PX_UNITS },
            { kind: "size", label: "Bottom", path: ["advanced", "position", "bottom"], responsive: true, units: PX_UNITS },
            { kind: "size", label: "Left", path: ["advanced", "position", "left"], responsive: true, units: PX_UNITS },
            { kind: "number", label: "Z-index", path: ["advanced", "position", "zIndex"], min: -10, max: 9999 },
          ],
        },
      ],
    },
    {
      kind: "group",
      label: "Motion effects",
      open: false,
      controls: [
        {
          kind: "select",
          label: "Entrance animation",
          path: ["advanced", "animation", "type"],
          clearPath: ["advanced", "animation"],
          options: opts(["fadeIn", "Fade in"], ["fadeInUp", "Fade in up"], ["fadeInDown", "Fade in down"], ["fadeInLeft", "Fade in from left"], ["fadeInRight", "Fade in from right"], ["zoomIn", "Zoom in"], ["slideInUp", "Slide in up"], ["bounceIn", "Bounce in"]),
          hint: "Plays once when it scrolls into view. Visitors who ask for reduced motion never see it.",
        },
        {
          kind: "if",
          id: "animation-timing",
          when: (read) => !!read(["advanced", "animation", "type"]) && read(["advanced", "animation", "type"]) !== "none",
          controls: [
            { kind: "number", label: "Duration (ms)", path: ["advanced", "animation", "duration"], min: 100, max: 5000, step: 50 },
            { kind: "number", label: "Delay (ms)", path: ["advanced", "animation", "delay"], min: 0, max: 5000, step: 50 },
          ],
        },
      ],
    },
    {
      kind: "group",
      label: "Responsive",
      open: false,
      controls: [
        { kind: "note", text: "Hidden elements stay visible in the editor at 40% with a badge." },
        { kind: "toggle", label: "Hide on desktop", path: ["advanced", "hidden", "desktop"] },
        { kind: "toggle", label: "Hide on tablet", path: ["advanced", "hidden", "tablet"] },
        { kind: "toggle", label: "Hide on mobile", path: ["advanced", "hidden", "mobile"] },
      ],
    },
    {
      kind: "group",
      label: "Attributes",
      open: false,
      agencyOnly: true,
      controls: [
        { kind: "text", label: "CSS ID", path: ["advanced", "cssId"], max: 64, placeholder: "pricing", hint: "Letters, digits, dashes. Also the #anchor links jump to." },
        { kind: "text", label: "CSS classes", path: ["advanced", "cssClasses"], max: 200, placeholder: "is-featured" },
        { kind: "attributes", label: "Attributes", path: ["advanced", "attributes"] },
      ],
    },
    { kind: "group", label: "Custom CSS", open: false, agencyOnly: true, controls: [{ kind: "css", label: "CSS", path: ["advanced", "customCss"] }] },
  );
  return specs;
}

/** True when an element sits in a flex container (so the "In its container" group applies). */
export const isFlexParent = (parent: Pick<Element, "type"> | undefined): boolean => parent?.type === "container";
