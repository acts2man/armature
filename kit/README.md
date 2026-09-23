# The Armature site kit (site contract v2)

`kit/` is the folder a site copies in to become a **page builder** site: drag-and-drop
editing, layouts, global colours and fonts, new pages, and one-commit publishing from the
Armature dashboard. It is the successor to `bridge/armature-bridge.ts` (site contract
v1.1) and keeps that bridge's whole content API, so a v1.1 site upgrades by changing one
import.

**React is the only dependency.** Everything else — the renderer, the widget library, the
CSS generator, the rich-text renderer, the visual-editing bridge — lives in this folder.

**Copy this folder verbatim.** A site copies `kit/` to `src/lib/armature-kit/` and never
edits the files inside it. See [Updating the kit](#updating-the-kit).

- The whole contract, message by message, is in [docs/SITE_CONTRACT.md](../docs/SITE_CONTRACT.md).
- The data model and design notes are in [docs/BUILDER_SPEC.md](../docs/BUILDER_SPEC.md).
- A complete working example is [`examples/demo-site`](../examples/demo-site).

## What it does on a normal visit

Nothing visible. On a public visit — and during server-side rendering, where there is no
`document` — the kit is inert: it adds no listeners, no markers and no messages, and every
content helper simply reads `content/pages.json`. `<ArmaturePage>` renders published
layouts as ordinary, scoped HTML and CSS.

The visual-editing bridge wakes up only when all three hold: the page is inside an iframe,
the URL carries `?armature=edit`, and the embedding window's origin is in your
`allowedOrigins`. That allowlist names the dashboard's exact origin and must never contain
`*`.

## Installing on a new site

### 1. Copy the folder and create the kit once

Copy `kit/` from this repository to `src/lib/armature-kit/`, then create the kit a single
time for the whole app:

```ts
// src/lib/armature.ts
import { createArmatureKit } from "./armature-kit";
import type { ContentTree, SiteKit } from "./armature-kit";
import type { SiteSchemaLike } from "./armature-kit/bridge";
import schema from "../../content/schema.json";
import content from "../../content/pages.json";
import siteKit from "../../content/site-kit.json"; // optional; the default kit applies without it

export const armature = createArmatureKit({
  allowedOrigins: ["https://armature-sites.netlify.app"], // the dashboard's exact origin
  schema: schema as SiteSchemaLike,
  content: content as ContentTree,
  siteKit: siteKit as SiteKit,
  layouts: import.meta.glob("../../content/layouts/*.json", { eager: true }),
  navigate: (path) => router.navigate(path), // optional, for a client-side router
});
```

`allowedOrigins` is the only value you must get right. `siteKit` is optional (the first
save from Site settings writes `content/site-kit.json`). `navigate` lets the editor's page
switcher move client-side; without it the kit does a full load that keeps the edit flag.

The content API is unchanged from v1.1 — `armature.text()`, `armature.plain()`,
`armature.link()`, `armature.image()`, `armature.list()`, `armature.subscribe()`,
`armature.getSnapshot()` — so an upgrading site keeps every call it already has.

### 2. Register your site sections and render coded pages through a slot

Each hand-coded section the editor may place, move, hide or wrap is registered by key.
A coded page renders through `<ArmatureSlot>`:

```tsx
import { ArmatureSlot } from "./armature-kit";
import { armature } from "./armature";

armature.registerSiteSection("hero", { label: "Hero", component: Hero });
armature.registerSiteSection("faq", { label: "FAQ", component: Faq, repeatable: true });

function Home() {
  return <ArmatureSlot slug="home" defaults={["hero", "faq"]} />;
}
```

Without a layout file the slot renders `defaults` in order, exactly as the page rendered
before. With one (`content/layouts/home.json`), the layout decides the order and whatever
the builder puts between the sections. Text and pictures inside a section keep editing
through the v1.1 field system.

Builder CSS is scoped so it **never changes how a registered section renders**: every kit
reset and base rule excludes `.ae-site-section` and its descendants, so your section's own
markup keeps the browser defaults (box-sizing, margins, list styles) it was written
against.

### 3. Add the catch-all route for builder-only pages

Place `<ArmatureRoute>` **after** every hand-coded route, so it only runs for paths no
coded page owns. Pages created in the editor are served at their `path` from
`content/layouts/<slug>.json`; anything else renders your fallback.

```tsx
import { ArmatureRoute } from "./armature-kit";

// React Router:
<Route path="*" element={<ArmatureRoute fallback={<NotFound />} />} />
```

`useBuilderPages()` lists builder-only pages (slug, path, label) for your own navigation.

### 4. Mark the chrome and the page title

So page settings can hide the frame, mark the site's header and footer with
`data-armature-chrome` and a coded page's visible title with `data-armature-page-title`:

```tsx
<header data-armature-chrome="">…</header>
<footer data-armature-chrome="">…</footer>
<h1 data-armature-page-title="">{title}</h1>
```

A page set to **Full canvas** puts `data-armature-canvas="full"` on `<html>`, and one set
to **Hide the page title** puts `data-armature-hide-title` there; the kit's base CSS then
hides the marked elements. Unmarked sites simply keep their header, footer and title.

### 5. Send the frame header

Serve `Content-Security-Policy: frame-ancestors 'self' <dashboard origin>` (as in v1.1) so
the dashboard may embed the site for editing. If the site sends a CSP, also allow what the
widgets need when used: `connect-src` the form endpoint; `style-src
https://fonts.googleapis.com` and `font-src https://fonts.gstatic.com` for Google fonts;
`frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://maps.google.com
https://www.google.com` for videos and maps.

### 6. Forms (only if the site uses the Form widget)

```ts
createArmatureKit({
  /* … */
  forms: { endpoint: "https://<project>.supabase.co/functions/v1/form-submit", siteId: "<site id>" },
});
```

Without it a form shows "This form is not connected yet" and never sends.

## SSR / TanStack Start

The kit renders on the server unchanged — during SSR there is no `document`, so it stays
inert and `<ArmaturePage>` produces plain HTML and a `<style>` node. Two things to watch:

**Guard `import.meta.glob`.** It is a Vite macro. Under a test runner with no Vite
transform (`bun test`, for example) it is `undefined` and throws, so wrap it and fall back
to no layouts — the tests then read the layout files from disk instead:

```ts
import type { LayoutDoc } from "./armature-kit";

let layoutModules: Record<string, unknown> | LayoutDoc[] = [];
try {
  layoutModules = import.meta.glob("../../content/layouts/*.json", { eager: true });
} catch {
  layoutModules = [];
}

export const armature = createArmatureKit({ /* … */ layouts: layoutModules });
```

Eager `import.meta.glob` bakes every committed layout into the build, so builder-published
pages land in the server-rendered HTML with no extra request.

**Give `<ArmatureRoute>` the router's pathname**, so the server and client agree during
hydration:

```tsx
// src/routes/$.tsx  (the TanStack Start splat route, matched after every coded route)
import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { ArmatureRoute } from "@/lib/armature-kit";
import { NotFound } from "@/components/NotFound";

export const Route = createFileRoute("/$")({ component: ArmatureCatchAll });

function ArmatureCatchAll() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return <ArmatureRoute path={pathname} fallback={<NotFound />} />;
}
```

Register the router for the editor's page switcher from the root component in an effect
(`registerArmatureNavigate((path) => router.navigate({ href: path }))`).

## Validation: one set of rules for the site and the dashboard

`validate.ts` holds every rule for layout files and the site kit, with no dependencies. The
same file runs in four places, so a site can never pass its own checks while Armature
rejects its files:

- the kit itself, when it loads `content/layouts/*.json` and `content/site-kit.json`;
- the site's own content check (below);
- the dashboard, when it reads a site;
- the publish function, before it commits.

It is tolerant on purpose. **One bad value never takes a page down:**

- a setting the validator cannot read is ignored (the element keeps its other settings)
  and reported;
- an element it cannot read (no id, no type, content of the wrong shape) is skipped on
  the site and shown as "Unsupported element" in the editor;
- the site kit fills anything unreadable from the default kit;
- only a file that is not a layout at all (no `root`, no `pageSlug`, `version` not 1)
  fails to load.

Every problem says, in plain English, the page, the element, the setting, the value found
and what is allowed, and carries the raw value: **a publish never erases or rewrites a
value the editor could not read.** It goes back into the file exactly as it was unless
someone changes that very setting.

The rules are as wide as CSS wherever that is safe: font weights are any whole number 1–1000
(`650`) or `normal`/`bold`/`lighter`/`bolder`; sizes take decimals, negative values, a bare
`0`, unitless numbers (line-height `1.4`) and `px`, `%`, `em`, `rem`, `vw`, `vh`, `vmin`,
`vmax`, `ch`, `ex`, `svh`, `dvh`, `lvh`, `pt`; colours are 3/4/6/8-digit hex, every colour
function (`rgb()`, `rgba()`, `hsl()`, `hwb()`, `oklch()`, `color-mix()`…), the 148 named
colours, `transparent`, `currentColor` and `var(--name)`. They stay strict only where a value
could reach the page as code: links (`https:`, `http:`, `mailto:`, `tel:`, `/`, `#`), media
addresses (the site itself or `https:`), attribute names (never `on*`, `href`, `src`,
`style`, `class`, `id`…), and anything emitted into a stylesheet (no quotes, semicolons or
braces; no `url()` or `expression()`).

### Your site's content check must call it

Whatever script your site runs before a commit or a build (`bun run check:content`,
`npm run check`, a CI step) must validate the builder files with the kit's validator, so the
check fails, or warns, on exactly what the dashboard will report:

```ts
// scripts/check-content.ts (add to the checks you already run)
import { readdirSync, readFileSync } from "node:fs";
import { checkLayout, checkSiteKit, describeProblem } from "../src/lib/armature-kit/validate";

let failed = false;
for (const name of readdirSync("content/layouts").filter((file) => file.endsWith(".json"))) {
  const report = checkLayout(JSON.parse(readFileSync(`content/layouts/${name}`, "utf8")));
  for (const problem of report.problems) {
    // "ignored" problems still render; treat them as errors so they get fixed at the source.
    console.error(`error    ${describeProblem(problem, `content/layouts/${name}`)}`);
    failed = true;
  }
}
const kit = checkSiteKit(JSON.parse(readFileSync("content/site-kit.json", "utf8")));
for (const problem of kit.problems) {
  console.error(`error    ${describeProblem(problem, "content/site-kit.json")}`);
  failed = true;
}
if (failed) process.exit(1);
```

`checkLayout(raw)` returns `{ value, problems }`: `value` is the cleaned layout (`null` only
when the file is not a layout at all) and `problems` lists every value it could not read
(`path`, `effect`, `setting`, `found`, `allowed`, `value`, and for a setting inside an
element its `elementId`). `checkSiteKit(raw)` always returns a usable kit. `describeProblem`
turns one problem into a sentence. The strict form the dashboard uses for values made in the
editor is simply "no problems at all".

The validator is pure TypeScript with no imports outside this folder, so it runs under `bun`,
`tsx`, Vite or Deno without a bundler.

## Files the editor writes

```
content/layouts/<pageSlug>.json    one layout per page (coded pages: optional; builder pages: always)
content/site-kit.json              global colours, fonts, typography and button presets, container defaults, breakpoints
content/media.json                 default alt text per picture, from the media library
public/assets/uploads/             pictures added in the editor
```

A layout is `{ version: 1, pageSlug, path, label?, seo?, pageSettings?, root: Element[] }`.
The full model is in `kit/types.ts`; the validation rules are in `kit/validate.ts`.

## Versioning

The folder carries `KIT_VERSION` (`export const KIT_VERSION` in `index.ts`) and
`PROTOCOL_VERSION`. `PROTOCOL_VERSION` (currently `2`) is the wire protocol the editor and
kit negotiate, so an older kit and a newer editor still connect. `KIT_VERSION` tracks the
folder's own code, so a site can tell whether its copy is current. Both are exported from
`index.ts`.

## Updating the kit

1. **Replace the whole folder, verbatim.** Copy `kit/` from this repository over
   `src/lib/armature-kit/`. Do not merge file by file.
2. **Never edit files inside `src/lib/armature-kit/`.** Everything site-specific — the
   `createArmatureKit()` call, section registrations, routes — lives in your own files
   (`src/lib/armature.ts` and your pages), never in the copied folder. Local edits are
   lost on the next update and are why an update is otherwise a clean overwrite.
3. **Check `KIT_VERSION`** before and after: compare the `KIT_VERSION` in your copy against
   this repository's `kit/index.ts`. If the editor reports that a site runs an older kit,
   updating the folder is the fix.

No dependency changes are needed to update: React remains the only dependency.
