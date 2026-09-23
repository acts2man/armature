# The page builder: specification and build plan

This document is the working specification for upgrading Armature's Stage 1 visual editor
(click-to-edit content) into a full drag-and-drop page builder. It absorbs the previously
planned Stage 2 (global colours and fonts) and Stage 3 (sections). It is written to be
picked up by a later session: the milestone checklist at the end says what is done and
what is next. Everything is manual: there are no AI features and no LLM calls anywhere in
the product.

The original brief is preserved in substance; the technical decisions taken while
building are marked **Decision**.

## Mission

Users drag widgets from a panel onto the REAL website, nest them in flexbox containers,
type rich text directly on the page with a formatting toolbar, resize images and columns
by dragging handles, drag padding and margin visually, switch containers between boxed
and full width, set different values per device, save and reuse templates, and publish
everything in one commit. Existing Stage 1 sites keep working unchanged.

## Repository map for this work

| Where | What |
| --- | --- |
| `shared/builder/` | Strict and tolerant wrappers over the kit's validator (`kit/validate.ts`: elements, layouts, site kit), the preserve module, id helpers, limits, the responsive-value helpers and the layout diff/merge used by the publish function. Imported by the dashboard and the edge functions. |
| `kit/` | The site kit (site contract v2): the folder a site copies into `src/lib/armature-kit/`. React is its only dependency. Bridge v2, renderer, widgets, CSS generator, rich-text renderer. |
| `src/builder/` | The editor side: normalized store and command/undo system, canvas overlays, drag and drop, inspector control library, panels, dialogs. `src/visual/` (Stage 1) stays and is composed into the new workspace. |
| `supabase/functions/builder-publish/` | One commit for layouts, kit, content fields, images and media, with element-level conflict merge. |
| `supabase/functions/form-submit/` | Form submissions (public endpoint with origin checks, honeypot and rate limiting). |
| `supabase/migrations/20260923000100_page_builder.sql` | Editing level per site, drafts, templates, form submissions. |
| `examples/demo-site/` | Upgraded to kit v2: one coded page with two site sections and one builder-only page. |
| `tests/e2e/builder.spec.ts` | Playwright end-to-end tests of the builder against the demo site. |
| `docs/SITE_CONTRACT.md` | "Site contract v2: page builder" section. |

## 1. Data model (lives in the client site's repository, like content today)

### Layout files

`content/layouts/<pageSlug>.json`:

```json
{
  "version": 1,
  "pageSlug": "home",
  "path": "/",
  "label": "Home",
  "seo": { "title": "", "description": "", "ogImage": "", "noindex": false },
  "pageSettings": { "hideTitle": false, "bodyBackground": null, "fullCanvas": false },
  "root": [ ...Element ]
}
```

- **Decision.** A page whose slug is declared in `content/schema.json` is a *coded page*;
  its layout file is optional and, when present, drives `<ArmatureSlot>` on that page. A
  layout whose slug is not in the schema is a *builder page*, served by `<ArmatureRoute/>`
  at its `path`. `label` is required for builder pages (the schema carries it for coded
  pages).
- A page without a layout file behaves exactly as today (Stage 1). Nothing about
  `schema.json` or `pages.json` changes; `armatureContract` stays `1`.

### Elements

```ts
type Element = {
  id: string;            // 8 chars, [a-z0-9], stable for the element's life; CSS class .ae-<id>
  type: string;          // "container", "grid", "heading", "text", "image", "button", ...
  label?: string;        // a name the person gave it (Navigator)
  props: Record<string, unknown>;     // Content tab
  style: Style;                       // Style tab (with style.hover)
  advanced: Advanced;                 // Advanced tab (layout, position, motion, visibility, attributes)
  children?: Element[];               // containers only
  locked?: boolean;                   // agency lock: clients cannot move, delete or restyle it
  meta: { createdBy: string; updatedAt: string };
};
```

- **Responsive values.** Any style or advanced value may be `{ desktop, tablet?, mobile? }`.
  Tablet inherits desktop, mobile inherits tablet. **Decision:** a responsive wrapper is
  recognised by the presence of the `desktop` key; no other value object uses that key.
  `resolve(value, device)` in `shared/builder/responsive.ts` implements the inheritance
  and is used by the CSS generator and the inspector.
- **Hover** values live under `style.hover` with the same shape as `style` (no nested hover).
- **Units.** Every size is `{ value: number, unit: "px" | "%" | "em" | "rem" | "vw" | "vh" | "auto" }`.
  With `auto` the value is ignored.
- **Kit references.** Any colour, font, typography or button value may be a literal or a
  reference string: `kit:color.primary`, `kit:color.custom.<id>`, `kit:font.heading`,
  `kit:type.h2`, `kit:button.primary`. The CSS generator turns references into
  `var(--ae-color-primary)` and so on, so changing the kit changes every reference at
  once. Linked controls show the globe and offer "Unlink" (which copies the current kit
  value into the element).
- **Site sections.** A hand-coded section registered by the site appears in the tree as
  `{ type: "site-section", props: { key: "hero" } }`. It can be moved, hidden per device,
  deleted (restorable from the Elements panel under "Site sections") and wrapped with
  spacing and background overrides (its `style`/`advanced` apply to a wrapper `div`). Its
  inner text and images keep editing through the Stage 1 field system. Duplicating is
  allowed only when the site registered the section with `repeatable: true`. Builder
  elements can go above, below and between site sections.
- **Validation.** `kit/validate.ts` (dependency-free, copied into every site) holds the
  rules for every element type, the layout file and the site kit, and every side runs the
  same code: the site when it loads its files, the site's own content check, the
  dashboard when it reads a site, the publish function before it commits. It is tolerant:
  an unreadable setting is ignored and reported, an unreadable element becomes an
  "unsupported" placeholder (skipped on the site, named in the editor), the kit fills
  unreadable values from the defaults, and only a file that is not a layout at all fails
  to load. Every problem carries the page, element, setting, value found and what is
  allowed, in plain English, plus the raw value; a publish puts unread values back exactly
  as they were unless that setting was changed (`shared/builder/preserve.ts`), and refuses
  a new unreadable value. The rules are as wide as CSS wherever that is safe and strict only
  where a value reaches the page as code (links, media addresses, attribute names, anything
  emitted into a stylesheet).
- **Limits.** Layout file under 2 MB (checked on the serialized text), nesting depth at
  most 20, at most 5000 elements per page. Every limit failure names the page and the
  limit.

### Site kit (`content/site-kit.json`)

```json
{
  "version": 1,
  "colors": { "primary": "#1f3a2e", "secondary": "#8c6a2f", "text": "#22262b", "accent": "#e9c46a",
              "custom": [{ "id": "bone", "label": "Bone", "value": "#f3efe6" }] },
  "fonts": { "heading": "DM Serif Display", "body": "Hanken Grotesk", "custom": [] },
  "typography": { "h1": {...}, "h2": {...}, "h3": {...}, "h4": {...}, "h5": {...}, "h6": {...}, "body": {...}, "small": {...}, "button": {...} },
  "buttons": { "primary": {...}, "secondary": {...}, "outline": {...} },
  "links": { "color": "kit:color.primary", "hover": "kit:color.secondary" },
  "forms": { "fieldBackground": "#ffffff", "fieldBorder": "#d7dde3", "fieldRadius": {"value": 6, "unit": "px"}, "fieldText": "kit:color.text" },
  "container": { "contentWidth": { "value": 1140, "unit": "px" }, "padding": {...}, "gap": { "value": 20, "unit": "px" } },
  "breakpoints": { "tablet": 1024, "mobile": 767 },
  "imageRadius": { "value": 0, "unit": "px" },
  "pageBackground": "#ffffff"
}
```

A site without `site-kit.json` gets the defaults from `shared/builder/kit.ts`
(`defaultSiteKit()`); the first publish that touches the kit writes the file.

## 2. The site kit (`kit/`, site contract v2)

- The folder a site copies into `src/lib/armature-kit/`. React is its only dependency.
  `KIT_VERSION` (the folder) and `PROTOCOL_VERSION = 2` (the messages) are exported.
- **Decision (bundler independence).** The kit never uses `import.meta.glob` itself. The
  site's own `armature.ts` passes its layouts in:

  ```ts
  export const armature = createArmatureKit({
    allowedOrigins: ["https://armature-sites.netlify.app"],
    schema, content,
    siteKit,                                                   // content/site-kit.json (optional)
    layouts: import.meta.glob("../../content/layouts/*.json", { eager: true }),
    navigate: (path) => router.navigate(path),
  });
  ```

  `createArmatureKit` also keeps the whole v1.1 content API (`text`, `plain`, `link`,
  `image`, `list`, `subscribe`, `getSnapshot`) so a v1.1 site upgrades by replacing one
  import.
- **Renderer.** `<ArmaturePage slug>` renders a layout; `<ArmatureSlot slug defaults>` lets
  a coded page render its layout and, when none exists, the `defaults` (registered site
  section keys) in order; `<ArmatureRoute fallback>` serves builder-only pages by their
  path and renders `fallback` (the site's 404) otherwise. `registerSiteSection(key, { label,
  component, repeatable })` registers hand-coded sections. Semantic HTML only; no
  `dangerouslySetInnerHTML` anywhere.
- **CSS.** `generatePageCss(layout, kit)` produces one stylesheet per page, injected as a
  `<style data-armature-page>` element by `<ArmaturePage>`: `.ae-root .ae-<id> { ... }`,
  tablet and mobile media queries from the kit breakpoints, `:hover` rules, kit values as
  custom properties on `.ae-root` (`--ae-color-primary`, `--ae-font-heading`,
  `--ae-content-width`, ...). Everything is scoped under `.ae-root` so builder CSS and
  the site's own CSS (Tailwind or anything) never fight. Zero layout shift: images carry
  `width` and `height`, the first image on a page is eager with `fetchpriority="high"`,
  the rest lazy.
- **Rich text.** Stored as TipTap-compatible JSON (`{ type: "doc", content: [...] }`).
  **Decision:** the kit does not depend on TipTap. `kit/richText.tsx` is a small
  whitelist renderer (paragraph, heading 1-6, bold, italic, underline, strike, link, bullet
  and ordered lists, blockquote, hard break, text colour and highlight from a kit
  reference or a literal, alignment). Links are accepted only with `http:`, `https:`,
  `mailto:`, `tel:` or a site path. Unknown nodes render their text; unknown marks are
  dropped.
- **Icons.** The editor's icon picker searches the MIT `lucide` icon set. The chosen icon's
  SVG nodes (`[tag, attributes][]` limited to `path`, `circle`, `rect`, `line`, `polyline`,
  `polygon`, `ellipse`) are saved into the element, so the kit needs no icon library.
- **Motion.** Entrance animations are CSS keyframes started by an IntersectionObserver
  (`kit/motion.ts`), and skipped entirely under `prefers-reduced-motion`.
- **Lazy widgets.** Carousel, map, gallery lightbox and the video player are `React.lazy`
  imports so the public bundle stays small.
- **Edit mode only** (same activation rules as v1.1: iframe + `?armature=edit` +
  allowlisted origin + nonce, origin and source verified on every message): the bridge
  renders the DRAFT tree pushed from the editor, reports a rect map for every element id
  (border box plus computed padding and margin boxes) updated on scroll, resize and DOM
  mutation once per animation frame, and hosts inline rich-text editing. Public visitors
  get no bridge code executed and no extra markup.
- **Version negotiation.** The editor says hello with `protocolVersion: 1` and `wants: 2`.
  A v1.1 bridge answers `ready` with protocol 1 and the editor runs Stage 1 only, showing
  "This site uses an older kit version, update it to use the page builder" with the exact
  steps. A v2 kit answers with protocol 2 and the builder switches on.

## 3. Widgets

Each widget has Content / Style / Advanced tabs. The editor-side definitions
(`src/builder/widgets/`) hold defaults and content controls; the kit-side
(`kit/widgets/`) holds the render function. `shared/builder/schema.ts` names every type.

- **Layout:** Container (flexbox: boxed or full width, content width, min-height including
  fit to screen, direction row/column with reverse, justify, align, column and row gap,
  wrap, overflow, HTML tag div/section/header/footer/article/aside/nav/a, link on the whole
  container; nestable), Grid container (columns/rows count or custom template, gaps, auto
  flow), and the structure picker for a new section (1 col, 50/50, 33/66, 66/33, 3 cols, 4
  cols, 25/50/25, 2 rows).
- **Basic:** Heading, Text Editor (rich text), Image, Button, Icon, Spacer, Divider, Video
  (YouTube, Vimeo, self-hosted MP4; privacy-friendly click-to-load facade).
- **General:** Icon Box, Image Box, Icon List, Accordion, Toggle, Tabs, Testimonial, Star
  Rating, Counter, Progress Bar, Alert, Social Icons, Image Gallery, Image Carousel, Google
  Map, Call to Action, Price Table, Countdown, Flip Box, Blockquote, Table of Contents,
  Form (built last).
- **Agency-only:** HTML/embed (sandboxed iframe via `srcdoc`, no `allow-same-origin`),
  custom CSS per element (scoped to `.ae-root .ae-<id>`, sanitized: no `@import`, no
  `javascript:`, no `expression(`, no `url(` to another origin), custom attributes (name
  allowlist: no `on*`, no `href`/`src`/`style`), CSS id and classes.

## 4. Editing experience

Layout follows Elementor: one switching panel on the left, the website full-bleed to the
right edge of the window (Stage 1 / content-only sites keep the older split of
`docs/1-visual-editor.html`).

- **Top bar:** on the left a menu button (Exit to dashboard, New page, Keyboard shortcuts),
  "+" (opens Elements), History (opens in the panel), undo/redo and Page settings (opens
  in the panel); in the centre the current page name with a chevron to Page settings, then
  the device toggle Desktop / Tablet / Phone (canvas width follows the kit breakpoints); on
  the right draft status, Preview and a Publish button with a dropdown (Save draft, Save as
  template, View page). No page switching in the editor — pages are chosen from the
  dashboard.
- **Left panel (about 340px), one mode at a time:** *Elements* (default and after deselect):
  header "Elements", a Widgets / Globals tab pair, a search box, and the widget tiles in a
  two-column grid grouped Layout / Basic / General / (agency-only) / Site sections / Saved
  templates; drag a tile onto the page or click to insert after the selection. The Globals
  tab holds the global colours, fonts and typography presets (the old Site tab), shown to
  agency staff and to clients at the style or builder level. *Edit* (anything selected):
  header "Edit &lt;Type&gt;" with a grid icon back to Elements, breadcrumbs of the parent
  chain, and the Content / Style / Advanced icon tabs (a container's first tab is Layout);
  a device icon on every responsive control, a dot on overridden controls. Page settings and
  History replace the panel body when opened from the top bar. A collapse tab on the panel's
  right edge (`&lt;` / `&gt;`) hides the panel so the canvas fills the window, remembered per
  user.
- **Centre:** the real site in the iframe, running to the right edge. Every overlay is drawn
  in the PARENT above the iframe from bridge-reported rects.
- **Media:** no tab; the image control's "Media library" button opens the library as a modal
  (reuse, upload, alt text).
- **Still-coded site sections:** clicking one selects it as a whole ("Edit Section"). Its
  Content tab carries a note — clients: "ask your agency to make this section fully
  editable"; staff: "convert it to builder elements in the site's repo" — and an "Editable
  here" list of the Stage 1 fields the page shows for it (words, pictures, links, lists);
  picking one selects it on the page and opens its field editor in the panel, exactly as
  clicking it on the page does.
- **Canvas interactions:** a thin hover outline with the type label (solid on a widget,
  dashed on a container); the selected element gets a solid accent outline and its handle
  tab — a widget's is a square pencil outside its top-right corner (click edits, drag moves;
  hovering it reveals parent, duplicate and delete), a container's is centred on its top
  edge with add / grip / delete (nested containers' tabs shift right so they never stack).
  Clicking anything at any depth selects exactly it; up-arrow / Alt-click selects the
  parent. Inline text editing, the resize handles and the spacing handles stay.
- **Drag and drop, anywhere.** **Decision:** pointer events, not HTML5 drag and drop,
  because the iframe never hands the parent its drag events. During a drag the parent lays
  a transparent capture layer over the iframe and hit-tests the pointer against the rect
  map plus the layout tree: the deepest element under the pointer decides, a drop can land
  between any two siblings at any depth, before the first or after the last, and inside an
  empty or nested container. The insertion edge follows the parent's flow — above/below in
  a column, left/right in a row (reversed rows included), the nearest cell edge in a grid —
  and the outer few pixels of a container mean "beside it" among its parent's children. One
  accent insertion line (or a filled container for "inside"), a dashed outline on the
  container that would receive the drop, and the drag ghost naming the target ("after
  Heading", "into Container"). The same for new widgets and for moves, which keep every
  setting. Auto-scroll near the top and bottom edges scrolls the frame through the bridge.
  Esc cancels; an invalid drop (a container into itself, a locked target, a widget into a
  non-container) shows "Not here" on the ghost and does nothing. Empty containers show
  "Drag a widget here" and a "+" that opens the Elements panel for insertion. Between
  top-level sections a hover "+" opens the structure picker.
- **Rich text on the page.** Double-click (or click a selected text widget) to type in
  place. **Decision:** the bridge makes the element `contenteditable`, the floating toolbar
  in the parent sends formatting commands (`armature:richtext:command`), the bridge applies
  them with the browser's own editing commands (no `innerHTML`, no external library) and
  serialises the DOM back to the whitelisted JSON after every input. Paste is intercepted
  and inserted as plain text with paragraph breaks kept. Headings and buttons edit inline
  as plain text.
- **Image resize:** corner handles keep the aspect ratio, side handles change width only,
  live readout, Shift frees the aspect ratio, snaps at 25/33/50/66/75/100%, writes the
  CURRENT device's width in the control's unit.
- **Column resize:** drag the border between siblings in a row to change their widths
  together (percent, live readout, snaps).
- **Spacing handles:** padding (green) and margin (orange) shaded areas on selection; drag
  an edge to change that side, Alt drags opposite sides, Shift drags all four; live values
  written to the current device.
- **Spacer and min-height:** drag the bottom edge.
- **Context menu:** Edit, Duplicate, Copy, Paste, Paste style, Reset style, Save as
  template, Navigator, Lock (agency), Hide on device, Delete.
- **Keyboard:** Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z, Ctrl/Cmd+C/V/D, Ctrl/Cmd+Shift+V paste
  style, Delete/Backspace, Esc, arrows move among siblings, Ctrl/Cmd+S opens Publish,
  Ctrl/Cmd+P preview, ? shortcut sheet. Copy/paste works across pages and sites through
  the system clipboard (a JSON payload with a type tag; ids are regenerated on paste).
- **Navigator:** full tree, drag to reorder/re-nest, rename, show/hide per device, lock
  (agency), expand/collapse, click to select and scroll into view, change dots.
- **History panel:** the list of actions with click-to-jump, plus Revisions.
- **Panel controls** are a schema-driven library (`src/builder/controls/`), laid out as
  Elementor lays them out: one row per control, the label on the left with the device icon
  right after it on a responsive control (a dot when this device overrides), the control on
  the right; wide controls (a textarea, the four spacing boxes, a picture) stack under their
  label. Typography, Text shadow, Text stroke, Box shadow and Border are each ONE row: a
  pencil opens a popover with the fields (live, closes on a click outside or Esc without
  touching the selection), and a globe where a global applies (Typography: the site text
  styles; Colour: the global colours). A colour is a swatch button that opens the picker
  (site swatches, the browser's picker, a hex, opacity, Unlink) — the swatch carries a globe
  when linked to the kit. Normal / Hover sit above the Style tab. Margin and Padding show
  four boxes (Top / Right / Bottom / Left) with the unit menu (px, %, em, rem, vw) and a link
  toggle on the label line. Width, Column span, Row span (inside a grid), HTML tag and Blend
  mode are dropdowns; alignment is an icon group. Heading > Content: Title (textarea), Link,
  HTML tag (H1–H6, p, div, span). Text Editor > Content: a full rich-text editor in the panel
  with Visual and Code tabs — Paragraph / Heading dropdown, bold, italic, underline, strike,
  lists, link, alignment, colour, clear; Code shows the document as sanitized HTML and
  converts what is typed back to the whitelisted JSON, dropping unsupported tags with a
  notice; the panel and the canvas stay in sync live in both directions. Container > Layout:
  Content width (Boxed / Full), Width, Min height, Direction, Justify, Align, Gap, Wrap, a
  Structure group (the column presets; what is inside moves into the new columns), then
  Overflow and HTML tag under Additional options. Number inputs support drag-to-scrub on the
  label, arrow keys (Shift = x10) and typed values with units ("2rem").

## 5. Pages, templates, media

- **New page:** title, path (validated, no clashes with coded routes or other layouts),
  start blank or from a template. Page settings: SEO title/description/OG image/noindex,
  hide title, full-canvas mode, page background. Duplicate and delete builder pages only.
- **Templates:** save any container or a whole page as a template, per site or
  agency-wide (`builder_templates`). Insert from the Elements panel or the template
  library modal. **Decision:** thumbnails are a placeholder card (type, element count,
  first heading) in this build; Playwright rendering is out of scope.
- **Media library:** every image under `public/assets/` in the site's repository
  (`content-get` v2 lists the tree), searchable, with "used on" computed from content
  fields and layouts, alt text editing stored in `content/media.json` (defaults for new
  inserts), uploads following the existing rules (browser resize to WebP, max 2000px,
  3 MB). Self-hosted video uploads are capped at 20 MB with a recommendation to use
  YouTube/Vimeo.

## 6. Drafts, publishing, revisions, roles

- **Drafts:** one draft per site per user (`builder_drafts`, RLS: that user and agency
  staff of the site's agency) holding every change (content fields, layouts, kit, new
  pages, media alt text). Autosaved every 2 seconds after a change, localStorage as the
  offline backup, restore prompt on return, leave-page warning.
- **Publish:** `builder-publish` commits layouts, kit, media metadata, content fields and
  images in ONE commit, keeping every existing guarantee: the kit's validator, URL/image rules,
  whole-file re-validation before the commit, no force-push, one `publishes` row.
  **Element-level conflict merge:** when the branch moved, the function reads each
  touched layout at the base commit and at the head, computes the element ids each side
  changed (added, removed, moved, or edited), and merges; when both sides changed the same
  element it names the element and the user chooses keep mine / take theirs / reload;
  everything else in the draft survives. Content fields keep the existing field-level
  merge. The publish dialog groups changes by page, shows progress, then "Published. Live
  in about 2 minutes" with the commit link.
- **Revisions:** past publishes (who, when, summary) from `publishes`; preview any
  revision in the canvas (`content-get` reads the files at that commit) and "Restore as
  draft".
- **Roles:** `sites.editing_level` is `content` (default, Stage 1 behaviour), `style`
  (content + style) or `builder`. The agency sets it on the site overview. Locked
  elements cannot be moved, deleted or restyled by clients. Agency-only widgets and
  controls are invisible to clients. Clients never see the word "Armature". "Request a
  change" stays on the bottom bar, prefilled with the page and selected element.

## 7. Quality bar

Native-feeling: overlays at 60fps (geometry outside React state), 150-200ms transitions,
skeletons, no layout jumps, crisp focus states, every control keyboard reachable, a
five-step first-run tour. One store and one undo stack for every change (continuous typing
and drags grouped into one step); every change goes through the same command system.
**Decision (M2):** the store keeps each page's layout as the same tree the kit renders and
the repository stores, with a memoized id index (element → parent, position, depth) so
by-id access is O(1) without a separate normalized copy; commands return new trees with
structural sharing, and each history entry keeps the state before and after (an O(1) swap
for undo, redo and click-to-jump). Coded pages without a layout are seeded from their
slot's sections with stable ids, outside the history, and enter the draft on the first edit.
Keyboard: ↑/↓ walk siblings, ← selects the parent, → the first child, Alt-click the parent.
**Decision (M3):** every inspector and Site settings control is a spec (`src/builder/controls/`)
rendered against a target that reads and writes paths, so elements and the kit share one
control library; a unit test writes every control of every core widget on every device
and validates the result with the shared schema. A widget's Style tab lands on what the
visitor sees (a button styles its link, an image its picture). Locked elements keep their
words editable for clients; their place and design stay the agency's. A kit change that
would make the kit invalid is dropped rather than saved. A Google font chosen anywhere joins
the kit's font list, the only list the site loads fonts from (one stylesheet link in the
head).
**Decision (M4):** handles are drawn in the editor above the frame from the kit's rect
map; each pointer frame is one command in a `drag:` group keyed by the drag's start, so a
drag is one undo step however long the pointer rests, and Esc drops the step entirely.
Handles write the device being edited (a tablet drag never touches desktop) and start from
the element's own pixel value when it has one, else from what the page measured. While an
element is typed into, the kit freezes its rendering and remounts it from the stored value
when the edit ends.
**Decision (M5):** the widget library's rules live in `kit/validate.ts` (`PROPS_CHECKS`,
next to the core widgets, so the kit and the dashboard can never disagree); its
renderers in `kit/library/`, its editor definitions and Content tabs in
`src/builder/widgets/library.ts`. Repeaters (accordion items, pictures, form fields) are a
control kind that rewrites the whole list, so every row edit is one command. Accordion,
tab and carousel clicks reach a widget in the editor once it is selected
(`data-ae-interactive`); embedded frames sit under a shield so a click selects them.
Social network glyphs are simple stroke icons shipped with the kit (lucide no longer ships
brand marks). The Form posts to a public `form-submit` function that reads the form from
the published layout, never from the request; entries live in `form_submissions` (RLS:
the site's people read, agency staff delete, nobody inserts but the function) and are
emailed through Resend with the agency's sender and recipients from `site_services`.
**Decision (M6):** the builder publishes through its own `builder-publish` function, which
reuses the content batch engine for fields and adds layouts, the kit, `content/media.json`
and pictures in the same commit; pictures ride in the draft as data URLs until then, so
there is no separate upload bucket. Layouts merge per element and per value against the
base commit (`shared/builder/merge.ts`); the same value changed on both sides is a named
conflict the person resolves, never a silent overwrite. Permissions (`shared/builder/
permissions.ts`) are checked by the function against what is committed, and the editor
runs the same check for the style level so it can say no before publish. A coded page
may get its first layout at the style level as long as it holds only its own sections.
Drafts live in the browser and in `builder_drafts`; the newer is offered back on opening.
Revisions are the publish history: preview reads the site at that commit through
`content-get` with `ref`, and a restore is an ordinary draft, so publishing it is one more
commit and history is never rewritten. Template thumbnails are placeholder cards (kind,
element count, first heading) rather than rendered images, to keep the templates table
small and free of screenshots. The editor never calls an AI service; everything is manual.
Connection states never silent. Under 900px, the friendly note and the
form editor. Security: no eval, no innerHTML in site or editor, everything sanitized,
all URLs validated, secrets server-side only, RLS on every new table, rate limits on the
form endpoint. The form editor and Stage 1 keep working as the fallback.

## 8. Verification

Every milestone runs its part; M6 runs everything: typecheck, eslint, vitest (schemas,
CSS generator including responsive inheritance and kit references, rich-text renderer,
command/undo system, conflict merge), Deno check/lint/tests for new and changed edge
functions, vite build, dist secret grep, Playwright end-to-end against the upgraded demo
site, and screenshots at 1440x900 in `docs/screenshots/` (drag in progress, rich text
toolbar, image resize, spacing handles, Style tab, Navigator, Site settings, publish
dialog) compared against the design.

## Milestones (build in order; tick when verified, changelogged, committed and pushed)

- [x] **M1 Foundation.** Data model, the validator, `site-kit.json`, `kit/` with the renderer
      core (Container, Grid, Heading, Text Editor, Image, Button, Spacer, Divider), CSS
      generator, rich-text renderer, bridge protocol v2 with v1.1 compatibility, demo-site
      upgrade, `docs/SITE_CONTRACT.md` v2.
- [x] **M2 Canvas.** Normalized store and command/undo system, element overlays, drag and
      drop (panel and move), structure picker, context menu, copy/paste/duplicate/delete,
      Navigator, keyboard shortcuts, History.
- [x] **M3 Inspector.** Schema-driven control library, Content/Style/Advanced for the M1
      widgets, responsive per-device values, hover states, units, scrubbing, Site settings
      (kit) panel with global references.
- [x] **M4 Direct manipulation.** Inline rich text with the floating toolbar, image resize
      handles, column resize, padding/margin handles, spacer/min-height drag.
- [x] **M5 Widget library.** Every remaining widget in section 3 (Form last), motion
      effects, background gradient/image/video/overlay, icon picker.
- [x] **M6 Pages and platform.** Site sections integration, new pages and page settings,
      templates, media library, Supabase drafts, element-level conflict publish,
      revisions, roles and locking, first-run tour, full Playwright suite, screenshots,
      polish pass.
