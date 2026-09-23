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

## Files the editor writes

```
content/layouts/<pageSlug>.json    one layout per page (coded pages: optional; builder pages: always)
content/site-kit.json              global colours, fonts, typography and button presets, container defaults, breakpoints
content/media.json                 default alt text per picture, from the media library
public/assets/uploads/             pictures added in the editor
```

A layout is `{ version: 1, pageSlug, path, label?, seo?, pageSettings?, root: Element[] }`.
The full model is in `kit/types.ts`; the validation rules are in `shared/builder/schema.ts`.

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
