/**
 * The editor side of the widget library: what the Elements panel lists, the content a
 * new element starts with, its Content tab and its Style tab kind. The kit renders each
 * of these (kit/library/); the shared schemas validate them (shared/builder/widgetSchemas.ts).
 * Import this module once, next to the registry.
 */
import { createElement as h } from "react";
import { newElementId, type Element } from "@shared/builder/index.ts";
import { px } from "@kit/values.ts";
import { controlInputClass } from "../controls/inputs.tsx";
import { registerContentSpecs, registerStyleKind } from "../controls/specs.ts";
import type { ControlSpec, Option } from "../controls/types.ts";
import { createElement } from "../store.ts";
import { registerWidgetDefinition, type WidgetGroup } from "./registry.ts";

const rid = () => newElementId();
const opts = (...pairs: [string, string][]): Option[] => pairs.map(([value, label]) => ({ value, label }));
const ALIGN = [
  { value: "left", label: "Left", icon: "AlignLeft" },
  { value: "center", label: "Centre", icon: "AlignCenter" },
  { value: "right", label: "Right", icon: "AlignRight" },
];
const TITLE_TAGS = opts(["h2", "H2"], ["h3", "H3"], ["h4", "H4"], ["h5", "H5"], ["h6", "H6"], ["p", "p"], ["div", "div"]);
const align = (path: string[] = ["props", "align"]): ControlSpec => ({ kind: "choice", label: "Alignment", path, responsive: true, options: ALIGN });
const group = (label: string, controls: ControlSpec[], open = true): ControlSpec => ({ kind: "group", label, controls, open });

/** A small inline icon value (lucide nodes) for defaults, so a new widget never starts blank. */
const glyph = (name: string, nodes: [string, Record<string, string>][]) => ({ name, nodes });
const STAR = glyph("Star", [["path", { d: "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" }]]);
const CHECK = glyph("Check", [["path", { d: "M20 6 9 17l-5-5" }]]);

type Library = { type: string; label: string; group: WidgetGroup; icon: string; keywords?: string[]; agencyOnly?: boolean; props: () => Record<string, unknown>; content: ControlSpec[]; style?: "text" | "box" | "container" | "media" | "section" | "minimal" };

const panelItemFields: ControlSpec[] = [
  { kind: "text", label: "Title", path: ["title"], max: 300 },
  { kind: "text", label: "Content", path: ["content"], multiline: true, max: 10_000, hint: "A blank line starts a new paragraph." },
];
const imageRowFields: ControlSpec[] = [{ kind: "image", label: "Picture", path: [] }, { kind: "text", label: "Caption", path: ["caption"], max: 500 }];
const sampleImages = () => [
  { id: rid(), src: "/assets/hero.svg", alt: "", caption: "" },
  { id: rid(), src: "/assets/hero.svg", alt: "", caption: "" },
  { id: rid(), src: "/assets/hero.svg", alt: "", caption: "" },
];

const LIBRARY: Library[] = [
  // --- basic ---------------------------------------------------------------------------------------------
  {
    type: "icon",
    label: "Icon",
    group: "basic",
    icon: "Smile",
    keywords: ["symbol", "glyph"],
    props: () => ({ icon: STAR, view: "default", shape: "circle", size: px(48), align: "center" }),
    content: [
      group("Icon", [
        { kind: "icon", label: "Icon", path: ["props", "icon"] },
        { kind: "choice", label: "View", path: ["props", "view"], allowNone: false, options: [{ value: "default", label: "Default" }, { value: "stacked", label: "Stacked" }, { value: "framed", label: "Framed" }] },
        { kind: "if", id: "icon-shape", when: (read) => (read(["props", "view"]) ?? "default") !== "default", controls: [{ kind: "choice", label: "Shape", path: ["props", "shape"], allowNone: false, options: [{ value: "circle", label: "Circle" }, { value: "square", label: "Square" }] }] },
        { kind: "size", label: "Size", path: ["props", "size"], units: ["px", "em", "rem"], responsive: true, min: 6, max: 400 },
        { kind: "color", label: "Colour", path: ["props", "color"] },
        { kind: "if", id: "icon-second", when: (read) => (read(["props", "view"]) ?? "default") !== "default", controls: [{ kind: "color", label: "Second colour", path: ["props", "secondary"] }] },
        { kind: "number", label: "Rotate (degrees)", path: ["props", "rotate"], min: -360, max: 360 },
        { kind: "link", label: "Link", path: ["props", "link"] },
        align(),
      ]),
    ],
    style: "minimal",
  },
  {
    type: "video",
    label: "Video",
    group: "basic",
    icon: "Play",
    keywords: ["youtube", "vimeo", "mp4", "film"],
    props: () => ({ source: "youtube", url: "", aspect: "16/9", controls: true }),
    content: [
      group("Video", [
        { kind: "choice", label: "Source", path: ["props", "source"], allowNone: false, options: [{ value: "youtube", label: "YouTube" }, { value: "vimeo", label: "Vimeo" }, { value: "file", label: "File" }] },
        { kind: "text", label: "Address", path: ["props", "url"], placeholder: "https://www.youtube.com/watch?v=…", hint: "YouTube and Vimeo load only when a visitor presses play (privacy-friendly). A file lives under /assets/ or on https://." },
        { kind: "text", label: "Title (for screen readers)", path: ["props", "title"], max: 200 },
        { kind: "text", label: "Cover picture", path: ["props", "poster"], placeholder: "/assets/cover.webp", hint: "Shown until the visitor presses play." },
        { kind: "select", label: "Shape", path: ["props", "aspect"], required: true, options: opts(["16/9", "16:9"], ["4/3", "4:3"], ["1/1", "Square"], ["9/16", "Portrait 9:16"], ["21/9", "Cinema 21:9"]) },
      ]),
      group("Options", [
        { kind: "toggle", label: "Autoplay (muted)", path: ["props", "autoplay"] },
        { kind: "toggle", label: "Loop", path: ["props", "loop"] },
        { kind: "toggle", label: "Muted", path: ["props", "muted"] },
        { kind: "number", label: "Start at (seconds)", path: ["props", "start"], min: 0, max: 86_400 },
      ], false),
    ],
    style: "media",
  },
  // --- general ------------------------------------------------------------------------------------------
  {
    type: "icon-box",
    label: "Icon Box",
    group: "general",
    icon: "IconBox",
    keywords: ["feature", "service"],
    props: () => ({ icon: STAR, title: "A feature worth telling", titleTag: "h3", description: "Say what it does for the people who visit, in a sentence or two.", position: "top", align: "center" }),
    content: [
      group("Icon Box", [
        { kind: "icon", label: "Icon", path: ["props", "icon"] },
        { kind: "text", label: "Title", path: ["props", "title"], max: 300 },
        { kind: "text", label: "Description", path: ["props", "description"], multiline: true, max: 5000 },
        { kind: "link", label: "Link", path: ["props", "link"] },
        { kind: "choice", label: "Icon position", path: ["props", "position"], allowNone: false, options: [{ value: "top", label: "Top" }, { value: "left", label: "Left" }, { value: "right", label: "Right" }] },
        { kind: "select", label: "Title tag", path: ["props", "titleTag"], required: true, options: TITLE_TAGS },
        align(),
      ]),
      group("Icon look", [{ kind: "color", label: "Icon colour", path: ["props", "iconColor"] }, { kind: "size", label: "Icon size", path: ["props", "iconSize"], units: ["px", "em", "rem"], min: 6, max: 300 }], false),
    ],
  },
  {
    type: "image-box",
    label: "Image Box",
    group: "general",
    icon: "ImageBox",
    keywords: ["card", "picture", "feature"],
    props: () => ({ src: "/assets/hero.svg", alt: "", title: "A title for this picture", titleTag: "h3", description: "A short description that tells people why it matters.", position: "top", align: "left" }),
    content: [
      group("Image Box", [
        { kind: "image", label: "Picture", path: ["props"] },
        { kind: "text", label: "Title", path: ["props", "title"], max: 300 },
        { kind: "text", label: "Description", path: ["props", "description"], multiline: true, max: 5000 },
        { kind: "link", label: "Link", path: ["props", "link"] },
        { kind: "choice", label: "Picture position", path: ["props", "position"], allowNone: false, options: [{ value: "top", label: "Top" }, { value: "left", label: "Left" }, { value: "right", label: "Right" }] },
        { kind: "size", label: "Picture width", path: ["props", "imageWidth"], units: ["%", "px"], min: 5, max: 1000 },
        { kind: "select", label: "Title tag", path: ["props", "titleTag"], required: true, options: TITLE_TAGS },
        align(),
      ]),
    ],
  },
  {
    type: "icon-list",
    label: "Icon List",
    group: "general",
    icon: "ListChecks",
    keywords: ["bullets", "features", "checklist"],
    props: () => ({ items: [{ id: rid(), text: "The first thing people get" }, { id: rid(), text: "The second thing people get" }, { id: rid(), text: "And one more reason to choose you" }], icon: CHECK, layout: "stacked" }),
    content: [
      group("Items", [
        { kind: "items", label: "List items", path: ["props", "items"], itemLabel: "Item", titleKey: "text", max: 100, create: () => ({ text: "A new item" }), fields: [{ kind: "text", label: "Text", path: ["text"], max: 500 }, { kind: "icon", label: "Its own icon", path: ["icon"] }, { kind: "link", label: "Link", path: ["link"] }] },
        { kind: "icon", label: "Icon for every item", path: ["props", "icon"] },
        { kind: "choice", label: "Layout", path: ["props", "layout"], allowNone: false, options: [{ value: "stacked", label: "Stacked" }, { value: "inline", label: "In a row" }] },
        { kind: "toggle", label: "Lines between items", path: ["props", "divider"] },
        { kind: "color", label: "Icon colour", path: ["props", "iconColor"] },
        { kind: "size", label: "Space between", path: ["props", "gap"], units: ["px", "em"], min: 0, max: 100 },
      ]),
    ],
  },
  {
    type: "accordion",
    label: "Accordion",
    group: "general",
    icon: "Accordion",
    keywords: ["faq", "collapse", "questions"],
    props: () => ({ items: [{ id: rid(), title: "What does it cost?", content: "Give a straight answer here." }, { id: rid(), title: "How long does it take?", content: "Another straight answer." }], open: "first", titleTag: "h3", iconPosition: "right" }),
    content: [
      group("Items", [
        { kind: "items", label: "Items", path: ["props", "items"], itemLabel: "Item", titleKey: "title", max: 50, create: () => ({ title: "A new question", content: "Its answer." }), fields: panelItemFields },
        { kind: "select", label: "Open at first", path: ["props", "open"], required: true, options: opts(["first", "The first item"], ["none", "None"], ["all", "All"]) },
        { kind: "choice", label: "Icon side", path: ["props", "iconPosition"], allowNone: false, options: [{ value: "left", label: "Left" }, { value: "right", label: "Right" }] },
        { kind: "select", label: "Title tag", path: ["props", "titleTag"], required: true, options: TITLE_TAGS },
        { kind: "note", text: "One item opens at a time. Use Toggle to let several stay open. Click a title on the page (with the accordion selected) to open it." },
      ]),
    ],
  },
  {
    type: "toggle",
    label: "Toggle",
    group: "general",
    icon: "Toggle",
    keywords: ["faq", "collapse", "expand"],
    props: () => ({ items: [{ id: rid(), title: "A question people ask", content: "The answer, in plain words." }, { id: rid(), title: "Another question", content: "Another answer." }], open: "none", titleTag: "h3", iconPosition: "right" }),
    content: [
      group("Items", [
        { kind: "items", label: "Items", path: ["props", "items"], itemLabel: "Item", titleKey: "title", max: 50, create: () => ({ title: "A new question", content: "Its answer." }), fields: panelItemFields },
        { kind: "select", label: "Open at first", path: ["props", "open"], required: true, options: opts(["none", "None"], ["first", "The first item"], ["all", "All"]) },
        { kind: "choice", label: "Icon side", path: ["props", "iconPosition"], allowNone: false, options: [{ value: "left", label: "Left" }, { value: "right", label: "Right" }] },
        { kind: "select", label: "Title tag", path: ["props", "titleTag"], required: true, options: TITLE_TAGS },
      ]),
    ],
  },
  {
    type: "tabs",
    label: "Tabs",
    group: "general",
    icon: "Tabs",
    keywords: ["panels", "switch"],
    props: () => ({ items: [{ id: rid(), title: "First tab", content: "What's in the first tab." }, { id: rid(), title: "Second tab", content: "What's in the second tab." }, { id: rid(), title: "Third tab", content: "What's in the third tab." }], layout: "horizontal", align: "start" }),
    content: [
      group("Tabs", [
        { kind: "items", label: "Tabs", path: ["props", "items"], itemLabel: "Tab", titleKey: "title", min: 1, max: 20, create: () => ({ title: "A new tab", content: "What's in it." }), fields: panelItemFields },
        { kind: "choice", label: "Layout", path: ["props", "layout"], allowNone: false, options: [{ value: "horizontal", label: "Across" }, { value: "vertical", label: "Down the side" }] },
        { kind: "select", label: "Tab alignment", path: ["props", "align"], required: true, options: opts(["start", "Start"], ["center", "Centre"], ["end", "End"], ["stretch", "Fill the width"]) },
      ]),
    ],
  },
  {
    type: "testimonial",
    label: "Testimonial",
    group: "general",
    icon: "Testimonial",
    keywords: ["review", "quote", "client"],
    props: () => ({ quote: "They listened, they planned, and they built exactly what we hoped for.", name: "Jordan Lee", role: "Homeowner, Auburn", rating: 5, align: "center", layout: "image-top" }),
    content: [
      group("Testimonial", [
        { kind: "text", label: "Quote", path: ["props", "quote"], multiline: true, max: 5000 },
        { kind: "text", label: "Name", path: ["props", "name"], max: 200 },
        { kind: "text", label: "Role or place", path: ["props", "role"], max: 200 },
        { kind: "image", label: "Photo", path: ["props"] },
        { kind: "number", label: "Stars (0 to 5)", path: ["props", "rating"], min: 0, max: 5, step: 0.5 },
        { kind: "select", label: "Photo position", path: ["props", "layout"], required: true, options: opts(["image-top", "Above"], ["image-left", "Beside"], ["image-bottom", "Below"]) },
        align(),
      ]),
    ],
  },
  {
    type: "star-rating",
    label: "Star Rating",
    group: "general",
    icon: "Star",
    keywords: ["stars", "score", "review"],
    props: () => ({ rating: 4.5, scale: 5, title: "", align: "left" }),
    content: [
      group("Rating", [
        { kind: "number", label: "Rating", path: ["props", "rating"], min: 0, max: 10, step: 0.1 },
        { kind: "select", label: "Out of", path: ["props", "scale"], required: true, numeric: true, options: opts(["5", "5 stars"], ["10", "10 stars"]) },
        { kind: "text", label: "Title", path: ["props", "title"], max: 200 },
        { kind: "color", label: "Star colour", path: ["props", "color"] },
        { kind: "color", label: "Empty star colour", path: ["props", "emptyColor"] },
        { kind: "size", label: "Size", path: ["props", "size"], units: ["px", "em"], min: 8, max: 120 },
        align(),
      ]),
    ],
  },
  {
    type: "counter",
    label: "Counter",
    group: "general",
    icon: "Hash",
    keywords: ["number", "stat", "count up"],
    props: () => ({ start: 0, end: 250, duration: 2000, suffix: "+", separator: true, title: "Homes built", align: "center" }),
    content: [
      group("Counter", [
        { kind: "number", label: "Start", path: ["props", "start"] },
        { kind: "number", label: "End", path: ["props", "end"] },
        { kind: "number", label: "Duration (ms)", path: ["props", "duration"], min: 0, max: 20_000, step: 100, hint: "0 shows the number at once. Visitors who ask for reduced motion always see it at once." },
        { kind: "text", label: "Before the number", path: ["props", "prefix"], max: 20 },
        { kind: "text", label: "After the number", path: ["props", "suffix"], max: 20 },
        { kind: "number", label: "Decimal places", path: ["props", "decimals"], min: 0, max: 4 },
        { kind: "toggle", label: "Thousands separator", path: ["props", "separator"] },
        { kind: "text", label: "Title", path: ["props", "title"], max: 200 },
        align(),
      ]),
    ],
  },
  {
    type: "progress",
    label: "Progress Bar",
    group: "general",
    icon: "Gauge",
    keywords: ["skill", "bar", "percent"],
    props: () => ({ title: "Design", percent: 80, showPercent: true }),
    content: [
      group("Progress", [
        { kind: "text", label: "Title", path: ["props", "title"], max: 200 },
        { kind: "number", label: "Percent", path: ["props", "percent"], min: 0, max: 100 },
        { kind: "toggle", label: "Show the percent", path: ["props", "showPercent"] },
        { kind: "text", label: "Text inside the bar", path: ["props", "innerText"], max: 100 },
        { kind: "color", label: "Bar colour", path: ["props", "color"] },
        { kind: "color", label: "Track colour", path: ["props", "trackColor"] },
        { kind: "size", label: "Height", path: ["props", "height"], units: ["px"], min: 2, max: 60 },
      ]),
    ],
  },
  {
    type: "alert",
    label: "Alert",
    group: "general",
    icon: "Warning",
    keywords: ["notice", "message", "banner"],
    props: () => ({ kind: "info", title: "A heads-up for visitors", description: "Say what they need to know.", dismissible: false, icon: true }),
    content: [
      group("Alert", [
        { kind: "select", label: "Kind", path: ["props", "kind"], required: true, options: opts(["info", "Information"], ["success", "Success"], ["warning", "Warning"], ["danger", "Danger"]) },
        { kind: "text", label: "Title", path: ["props", "title"], max: 300 },
        { kind: "text", label: "Description", path: ["props", "description"], multiline: true, max: 3000 },
        { kind: "toggle", label: "Show an icon", path: ["props", "icon"] },
        { kind: "toggle", label: "Visitors can close it", path: ["props", "dismissible"] },
      ]),
    ],
  },
  {
    type: "social-icons",
    label: "Social Icons",
    group: "general",
    icon: "Share",
    keywords: ["facebook", "instagram", "linkedin", "follow"],
    props: () => ({ items: [{ id: rid(), network: "facebook", href: "https://facebook.com/" }, { id: rid(), network: "instagram", href: "https://instagram.com/" }, { id: rid(), network: "linkedin", href: "https://linkedin.com/" }], shape: "rounded", colors: "brand", align: "left" }),
    content: [
      group("Networks", [
        {
          kind: "items",
          label: "Icons",
          path: ["props", "items"],
          itemLabel: "Network",
          titleKey: "network",
          max: 30,
          create: () => ({ network: "website", href: "https://" }),
          fields: [
            { kind: "select", label: "Network", path: ["network"], required: true, options: opts(["facebook", "Facebook"], ["instagram", "Instagram"], ["x", "X"], ["twitter", "Twitter"], ["linkedin", "LinkedIn"], ["youtube", "YouTube"], ["tiktok", "TikTok"], ["pinterest", "Pinterest"], ["github", "GitHub"], ["whatsapp", "WhatsApp"], ["email", "Email"], ["phone", "Phone"], ["website", "Website"], ["rss", "RSS"]) },
            { kind: "text", label: "Link", path: ["href"], placeholder: "https://… (or an email address or phone number)" },
            { kind: "text", label: "Label for screen readers", path: ["label"], max: 80 },
          ],
        },
        { kind: "choice", label: "Shape", path: ["props", "shape"], allowNone: false, options: [{ value: "rounded", label: "Rounded" }, { value: "square", label: "Square" }, { value: "circle", label: "Circle" }] },
        { kind: "choice", label: "Colours", path: ["props", "colors"], allowNone: false, options: [{ value: "brand", label: "Brand" }, { value: "custom", label: "Custom" }] },
        { kind: "if", id: "social-custom", when: (read) => read(["props", "colors"]) === "custom", controls: [{ kind: "color", label: "Background", path: ["props", "color"] }, { kind: "color", label: "Icon colour", path: ["props", "iconColor"] }] },
        { kind: "size", label: "Size", path: ["props", "size"], units: ["px"], min: 8, max: 80 },
        { kind: "size", label: "Space between", path: ["props", "gap"], units: ["px"], min: 0, max: 60 },
        align(),
      ]),
    ],
  },
  {
    type: "gallery",
    label: "Image Gallery",
    group: "general",
    icon: "Gallery",
    keywords: ["photos", "grid", "lightbox"],
    props: () => ({ images: sampleImages(), columns: { desktop: 3, tablet: 2, mobile: 1 }, gap: px(12), aspect: "4/3", lightbox: true, captions: false }),
    content: [
      group("Pictures", [
        { kind: "items", label: "Pictures", path: ["props", "images"], itemLabel: "Picture", titleKey: "alt", max: 100, create: () => ({ src: "", alt: "" }), fields: imageRowFields },
        { kind: "number", label: "Columns", path: ["props", "columns"], responsive: true, min: 1, max: 8 },
        { kind: "size", label: "Space between", path: ["props", "gap"], units: ["px", "em"], min: 0, max: 80 },
        { kind: "select", label: "Shape", path: ["props", "aspect"], required: true, options: opts(["1/1", "Square"], ["4/3", "4:3"], ["3/2", "3:2"], ["16/9", "16:9"], ["3/4", "Portrait 3:4"], ["auto", "As uploaded"]) },
        { kind: "toggle", label: "Open larger on click", path: ["props", "lightbox"] },
        { kind: "toggle", label: "Show captions", path: ["props", "captions"] },
      ]),
    ],
    style: "media",
  },
  {
    type: "carousel",
    label: "Image Carousel",
    group: "general",
    icon: "Carousel",
    keywords: ["slider", "slideshow", "photos"],
    props: () => ({ images: sampleImages(), perView: { desktop: 1 }, gap: px(12), aspect: "16/9", autoplay: true, interval: 5000, loop: true, arrows: true, dots: true, pauseOnHover: true }),
    content: [
      group("Slides", [
        { kind: "items", label: "Pictures", path: ["props", "images"], itemLabel: "Picture", titleKey: "alt", max: 100, create: () => ({ src: "", alt: "" }), fields: imageRowFields },
        { kind: "number", label: "Pictures in view", path: ["props", "perView"], responsive: true, min: 1, max: 6 },
        { kind: "size", label: "Space between", path: ["props", "gap"], units: ["px"], min: 0, max: 80 },
        { kind: "select", label: "Shape", path: ["props", "aspect"], required: true, options: opts(["16/9", "16:9"], ["4/3", "4:3"], ["3/2", "3:2"], ["1/1", "Square"], ["3/4", "Portrait 3:4"], ["auto", "As uploaded"]) },
      ]),
      group("Behaviour", [
        { kind: "toggle", label: "Play by itself", path: ["props", "autoplay"], hint: "Never in the editor, and never for visitors who ask for reduced motion." },
        { kind: "number", label: "Seconds per slide (ms)", path: ["props", "interval"], min: 1500, max: 30_000, step: 500 },
        { kind: "toggle", label: "Pause while pointed at", path: ["props", "pauseOnHover"] },
        { kind: "toggle", label: "Loop", path: ["props", "loop"] },
        { kind: "toggle", label: "Arrows", path: ["props", "arrows"] },
        { kind: "toggle", label: "Dots", path: ["props", "dots"] },
        { kind: "toggle", label: "Captions", path: ["props", "captions"] },
        { kind: "toggle", label: "Open larger on click", path: ["props", "lightbox"] },
      ], false),
    ],
    style: "media",
  },
  {
    type: "map",
    label: "Google Map",
    group: "general",
    icon: "MapPin",
    keywords: ["location", "address", "directions"],
    props: () => ({ address: "Sacramento, CA", zoom: 12, height: px(360) }),
    content: [
      group("Map", [
        { kind: "text", label: "Address or place", path: ["props", "address"], max: 300 },
        { kind: "number", label: "Zoom (1 to 20)", path: ["props", "zoom"], min: 1, max: 20 },
        { kind: "size", label: "Height", path: ["props", "height"], units: ["px", "vh"], responsive: true, min: 100, max: 2000 },
        { kind: "text", label: "Title (for screen readers)", path: ["props", "title"], max: 200 },
      ]),
    ],
    style: "media",
  },
  {
    type: "cta",
    label: "Call to Action",
    group: "general",
    icon: "Megaphone",
    keywords: ["banner", "promo", "cta"],
    props: () => ({ layout: "classic", src: "/assets/hero.svg", alt: "", title: "Ready when you are", description: "Tell visitors what to do next, and why now.", buttonText: "Get in touch", link: { href: "/contact/" }, align: "left" }),
    content: [
      group("Call to Action", [
        { kind: "choice", label: "Layout", path: ["props", "layout"], allowNone: false, options: [{ value: "classic", label: "Picture above" }, { value: "cover", label: "Picture behind" }] },
        { kind: "image", label: "Picture", path: ["props"] },
        { kind: "text", label: "Title", path: ["props", "title"], max: 300 },
        { kind: "text", label: "Description", path: ["props", "description"], multiline: true, max: 3000 },
        { kind: "text", label: "Button text", path: ["props", "buttonText"], max: 120 },
        { kind: "link", label: "Button link", path: ["props", "link"] },
        { kind: "text", label: "Ribbon", path: ["props", "ribbon"], max: 40, hint: "A short word in the corner, like New." },
        { kind: "size", label: "Minimum height", path: ["props", "minHeight"], units: ["px", "vh"], min: 0, max: 2000 },
        align(),
      ]),
    ],
  },
  {
    type: "price-table",
    label: "Price Table",
    group: "general",
    icon: "Price",
    keywords: ["pricing", "plan", "package"],
    props: () => ({ heading: "Design package", subheading: "Everything to get to permits", currency: "$", price: "4,900", period: "one time", features: [{ id: rid(), text: "Site visit and survey", included: true }, { id: rid(), text: "Two design rounds", included: true }, { id: rid(), text: "Construction management", included: false }], buttonText: "Start here", link: { href: "/contact/" }, featured: false }),
    content: [
      group("Price", [
        { kind: "text", label: "Heading", path: ["props", "heading"], max: 200 },
        { kind: "text", label: "Subheading", path: ["props", "subheading"], max: 300 },
        { kind: "text", label: "Currency", path: ["props", "currency"], max: 8 },
        { kind: "text", label: "Price", path: ["props", "price"], max: 40 },
        { kind: "text", label: "Period", path: ["props", "period"], max: 40, placeholder: "per month" },
      ]),
      group("Features", [{ kind: "items", label: "Features", path: ["props", "features"], itemLabel: "Feature", titleKey: "text", max: 40, create: () => ({ text: "A feature", included: true }), fields: [{ kind: "text", label: "Text", path: ["text"], max: 300 }, { kind: "toggle", label: "Included", path: ["included"] }] }]),
      group("Button and extras", [
        { kind: "text", label: "Button text", path: ["props", "buttonText"], max: 120 },
        { kind: "link", label: "Button link", path: ["props", "link"] },
        { kind: "text", label: "Ribbon", path: ["props", "ribbon"], max: 40 },
        { kind: "text", label: "Small print", path: ["props", "footer"], max: 500 },
        { kind: "toggle", label: "Highlight this plan", path: ["props", "featured"] },
      ], false),
    ],
  },
  {
    type: "countdown",
    label: "Countdown",
    group: "general",
    icon: "Timer",
    keywords: ["timer", "launch", "deadline"],
    props: () => ({ mode: "date", date: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 16), labels: true, units: { days: true, hours: true, minutes: true, seconds: true }, expired: "This offer has ended." }),
    content: [
      group("Countdown", [
        { kind: "choice", label: "Counts to", path: ["props", "mode"], allowNone: false, options: [{ value: "date", label: "A date" }, { value: "evergreen", label: "Per visitor" }] },
        { kind: "if", id: "countdown-date", when: (read) => (read(["props", "mode"]) ?? "date") === "date", controls: [{ kind: "text", label: "Date and time", path: ["props", "date"], inputType: "datetime-local", hint: "In the visitor's own time zone." }] },
        { kind: "if", id: "countdown-evergreen", when: (read) => read(["props", "mode"]) === "evergreen", controls: [{ kind: "number", label: "Minutes from a visitor's first visit", path: ["props", "minutes"], min: 1, max: 525_600 }] },
        { kind: "toggle", label: "Days", path: ["props", "units", "days"] },
        { kind: "toggle", label: "Hours", path: ["props", "units", "hours"] },
        { kind: "toggle", label: "Minutes", path: ["props", "units", "minutes"] },
        { kind: "toggle", label: "Seconds", path: ["props", "units", "seconds"] },
        { kind: "toggle", label: "Labels", path: ["props", "labels"] },
        { kind: "text", label: "When it ends", path: ["props", "expired"], max: 300 },
      ]),
    ],
  },
  {
    type: "flip-box",
    label: "Flip Box",
    group: "general",
    icon: "Flip",
    keywords: ["card", "hover", "turn"],
    props: () => ({ front: { icon: STAR, title: "Point here", description: "The front says what it is." }, back: { title: "Then this", description: "The back says what to do.", buttonText: "Learn more", link: { href: "/contact/" } }, effect: "flip", direction: "left", height: px(300) }),
    content: [
      group("Front", [
        { kind: "icon", label: "Icon", path: ["props", "front", "icon"] },
        { kind: "text", label: "Title", path: ["props", "front", "title"], max: 300 },
        { kind: "text", label: "Description", path: ["props", "front", "description"], multiline: true, max: 3000 },
        { kind: "image", label: "Background picture", path: ["props", "front"] },
        { kind: "color", label: "Background colour", path: ["props", "frontColor"] },
      ]),
      group("Back", [
        { kind: "text", label: "Title", path: ["props", "back", "title"], max: 300 },
        { kind: "text", label: "Description", path: ["props", "back", "description"], multiline: true, max: 3000 },
        { kind: "text", label: "Button text", path: ["props", "back", "buttonText"], max: 120 },
        { kind: "link", label: "Button link", path: ["props", "back", "link"] },
        { kind: "color", label: "Background colour", path: ["props", "backColor"] },
      ], false),
      group("Effect", [
        { kind: "choice", label: "Effect", path: ["props", "effect"], allowNone: false, options: [{ value: "flip", label: "Flip" }, { value: "slide", label: "Slide" }, { value: "fade", label: "Fade" }] },
        { kind: "select", label: "Direction", path: ["props", "direction"], required: true, options: opts(["left", "Left"], ["right", "Right"], ["up", "Up"], ["down", "Down"]) },
        { kind: "size", label: "Height", path: ["props", "height"], units: ["px", "vh"], responsive: true, min: 80, max: 1200 },
      ], false),
    ],
  },
  {
    type: "blockquote",
    label: "Blockquote",
    group: "general",
    icon: "Quote",
    keywords: ["quote", "citation", "pull quote"],
    props: () => ({ quote: "Build what you'd want to live in.", author: "Our founder", look: "border", align: "left" }),
    content: [
      group("Quote", [
        { kind: "text", label: "Quote", path: ["props", "quote"], multiline: true, max: 5000 },
        { kind: "text", label: "Author", path: ["props", "author"], max: 200 },
        { kind: "text", label: "Source", path: ["props", "source"], max: 200 },
        { kind: "link", label: "Source link", path: ["props", "link"] },
        { kind: "choice", label: "Look", path: ["props", "look"], allowNone: false, options: [{ value: "border", label: "Line" }, { value: "quotation", label: "Quote mark" }, { value: "boxed", label: "Boxed" }] },
        align(),
      ]),
    ],
  },
  {
    type: "toc",
    label: "Table of Contents",
    group: "general",
    icon: "Toc",
    keywords: ["contents", "index", "headings", "anchor"],
    props: () => ({ title: "On this page", headings: ["h2", "h3"], marker: "bullets", collapsible: false }),
    content: [
      group("Contents", [
        { kind: "text", label: "Title", path: ["props", "title"], max: 200 },
        {
          kind: "custom",
          id: "toc-depth",
          render: ({ read, write }) => {
            const current = ((read(["props", "headings"]) as string[] | undefined) ?? ["h2", "h3"]).join(",");
            return h(
              "label",
              { className: "flex flex-col gap-1.5 text-[12px] font-medium text-muted" },
              "Headings to list",
              h(
                "select",
                { value: current, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => write(["props", "headings"], event.target.value.split(","), "Changed the headings listed"), className: controlInputClass, "aria-label": "Headings to list" },
                [["h2", "H2 only"], ["h2,h3", "H2 and H3"], ["h2,h3,h4", "H2 to H4"], ["h2,h3,h4,h5,h6", "Every heading"]].map(([value, label]) => h("option", { key: value, value }, label)),
              ),
            );
          },
        },
        { kind: "select", label: "Markers", path: ["props", "marker"], required: true, options: opts(["bullets", "Bullets"], ["numbers", "Numbers"], ["none", "None"]) },
        { kind: "toggle", label: "Visitors can fold it", path: ["props", "collapsible"] },
        { kind: "note", text: "It lists the headings on the page as it loads and keeps up as they change." },
      ]),
    ],
  },
  {
    type: "form",
    label: "Form",
    group: "general",
    icon: "Form",
    keywords: ["contact", "enquiry", "lead", "signup"],
    props: () => ({
      name: "Contact",
      submitText: "Send",
      success: "Thanks, we'll be in touch soon.",
      labels: true,
      fields: [
        { id: rid(), type: "text", label: "Your name", name: "full_name", required: true, width: 50 },
        { id: rid(), type: "email", label: "Email", name: "email", required: true, width: 50 },
        { id: rid(), type: "tel", label: "Phone", name: "phone", width: 100 },
        { id: rid(), type: "textarea", label: "How can we help?", name: "message", required: true, width: 100 },
      ],
    }),
    content: [
      group("Fields", [
        {
          kind: "items",
          label: "Fields",
          path: ["props", "fields"],
          itemLabel: "Field",
          titleKey: "label",
          min: 1,
          max: 30,
          create: () => ({ type: "text", label: "A new field", name: `field_${rid().slice(0, 5)}`, width: 100 }),
          fields: [
            { kind: "select", label: "Type", path: ["type"], required: true, options: opts(["text", "Short text"], ["email", "Email"], ["tel", "Phone"], ["textarea", "Long text"], ["number", "Number"], ["date", "Date"], ["select", "Dropdown"], ["radio", "Choice (radio)"], ["checkbox", "Checkbox"], ["consent", "Consent"]) },
            { kind: "text", label: "Label", path: ["label"], max: 300 },
            { kind: "text", label: "Name in the entry", path: ["name"], max: 40, hint: "Lowercase letters, digits and _ (each field needs its own)." },
            { kind: "text", label: "Placeholder", path: ["placeholder"], max: 200 },
            { kind: "if", id: "form-options", when: (read) => read(["type"]) === "select" || read(["type"]) === "radio", controls: [{ kind: "lines", label: "Options", path: ["options"], max: 50 }] },
            { kind: "toggle", label: "Required", path: ["required"] },
            { kind: "choice", label: "Width", path: ["width"], allowNone: false, numeric: true, options: [{ value: "100", label: "Full" }, { value: "50", label: "Half" }, { value: "33", label: "Third" }] },
            { kind: "text", label: "Help text", path: ["help"], max: 300 },
          ],
        },
        { kind: "toggle", label: "Show labels", path: ["props", "labels"], hint: "Off keeps the labels for screen readers and shows the placeholders." },
      ]),
      group("After sending", [
        { kind: "text", label: "Form name (in the email and the dashboard)", path: ["props", "name"], max: 120 },
        { kind: "text", label: "Button text", path: ["props", "submitText"], max: 120 },
        { kind: "select", label: "Button style", path: ["props", "buttonPreset"], options: opts(["kit:button.primary", "Primary"], ["kit:button.secondary", "Secondary"], ["kit:button.outline", "Outline"]) },
        { kind: "text", label: "Thank-you message", path: ["props", "success"], multiline: true, max: 1000 },
        { kind: "text", label: "Or go to a page", path: ["props", "redirect"], placeholder: "/thank-you/" },
        { kind: "note", text: "Entries are kept in the dashboard and emailed to the addresses the agency set for this site. A hidden field and a time check keep most bots out; each visitor can send a handful per hour." },
      ], false),
    ],
  },
  // --- agency only -------------------------------------------------------------------------------------------
  {
    type: "html",
    label: "HTML",
    group: "agency",
    icon: "Code",
    keywords: ["embed", "code", "iframe", "script"],
    agencyOnly: true,
    props: () => ({ code: "<p>Paste an embed code here.</p>", height: px(300), title: "Embedded content" }),
    content: [
      {
        kind: "group",
        label: "HTML",
        agencyOnly: true,
        controls: [
          { kind: "text", label: "Code", path: ["props", "code"], multiline: true, max: 100_000, placeholder: "<iframe …></iframe>" },
          { kind: "size", label: "Height", path: ["props", "height"], units: ["px", "vh"], responsive: true, min: 20, max: 4000 },
          { kind: "text", label: "Title (for screen readers)", path: ["props", "title"], max: 200 },
          { kind: "note", text: "Runs in a sandboxed frame with its own origin: scripts work, but they can never reach the page, its cookies or the editor." },
        ],
      },
      { kind: "note", text: "This embed is managed by the agency." },
    ],
    style: "media",
  },
];

for (const widget of LIBRARY) {
  registerWidgetDefinition({
    type: widget.type,
    label: widget.label,
    group: widget.group,
    icon: widget.icon,
    keywords: widget.keywords,
    agencyOnly: widget.agencyOnly,
    create: (): Element => createElement(widget.type, widget.props()),
  });
  registerContentSpecs(widget.type, widget.content);
  registerStyleKind(widget.type, widget.style ?? "box");
}

export const LIBRARY_TYPES = LIBRARY.map((widget) => widget.type);
