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

### 7. Let the dashboard build the header and footer (optional, kit 2.4+)

Render the site's header and footer through the kit's chrome part, with the coded ones as
the fallback:

```tsx
import { ArmatureChrome } from "./lib/armature-kit";

<ArmatureChrome part="header" fallback={<Header />} />
<main>…</main>
<ArmatureChrome part="footer" fallback={<Footer />} />
```

Nothing changes until someone builds a header or footer under **Appearance › Header /
Footer** in the dashboard: from then on `content/layouts/_header.json` (or `_footer.json`)
renders in that place on every page, inside a `<header data-armature-part="header">` (or
`<footer>`), and the coded one is the fallback again the moment the built part is removed.
The parts use the same `import.meta.glob("../content/layouts/*.json")` as the pages, so
nothing else is needed. Two widgets exist for them: **Site Logo** (a picture linked to
`/`) and **Nav Menu** (one of the menus made under **Appearance › Menus**, stored in
`content/site-kit.json` as `menus`; page items link to the paths in `content/schema.json`
and to built pages' own paths, with one level of dropdowns, a hamburger below the width the
widget sets, and an optional sticky position). Keep `data-armature-chrome` on your coded
header and footer so the editor keeps telling clients they are coded.

### 8. Verify against a production build, never only the dev server

The kit registers every widget, the widget library's CSS and its glyphs from
`createArmatureKit()` itself; nothing is registered by importing a module for its side
effects. So a site whose `package.json` says `"sideEffects": false` (a common line in a
Vite site) keeps all of them in its production bundle. Prove it on your site anyway, when
you install the kit and after every update, because **a dev server never tree-shakes and
so hides this whole class of bug**: a widget the bundler dropped shows perfectly under
`npm run dev` and renders as nothing on the live site.

```bash
npm run build && npm run preview   # Vite; an SSR site builds, then starts its production server
```

Open a page that uses builder widgets (an accordion, a form, a gallery, a video, a nav
menu…) from the *built* output. Every element must be on the page and the browser console
must not say `Armature: no widget renders "…"`. This repository runs that check in
`tests/e2e/production-build.spec.ts`: it builds `examples/demo-site` laid out as a real
site (the kit under `src/lib/armature-kit/`, `"sideEffects": false` in its package.json),
serves the built files and checks in a browser that one element of every widget type
renders. A site's own check can copy it.

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

## Blog posts (kit 2.7+)

The kit ships a small blog: each post lives as its own JSON file at
`content/posts/<slug>.json` (a layout with `kind: "post"` and post fields in
`settings`), and `content/posts/index.json` is the site's list — the dashboard's
publish function regenerates it on every post commit. `public/rss.xml` is written
alongside so `/rss.xml` stays in step.

Add the two globs to `createArmatureKit` so posts flow through the store:

```ts
export const armature = createArmatureKit({
  /* … */
  posts: import.meta.glob("../../content/posts/*.json", { eager: true }),
  postIndex: postIndexJson,   // optional; from content/posts/index.json
});
```

Then add two routes to your router:

```tsx
import { ArmaturePost, ArmaturePostList } from "@/lib/armature-kit";

<Route path="/blog" element={<ArmaturePostList />} />
<Route path="/blog/:slug" element={<PostRoute />} />
```

```tsx
function PostRoute() {
  const { slug = "" } = useParams();
  return <ArmaturePost slug={slug} />;
}
```

Scheduled posts (a `publishedAt` in the future) sit in the repo. The dashboard
schedules a pg_cron job (see the migration
`20260924000300_posts_and_stats.sql`) that fires an edge function every
five minutes; when the moment arrives it re-commits the file (identical
bytes), Netlify rebuilds, and the site starts showing it. The kit filters
scheduled posts out of `ArmaturePost` and `ArmaturePostList` until then.

## Visitor stats: removed in kit 2.9.0

Stats were removed on request. The `stats` option on `createArmatureKit` and
the `installStatsBeacon` / `sendBeacon` exports are kept as documented
no-ops so a site whose developer still wires them (for example a test
copy of Tree Test Prep) keeps building without a code change — no beacon
fires and no request goes to `stats-ingest` (which was deleted). If stats
return in a later kit release, updating the kit will restore the beacon on
those sites without a site-side setup step.

## SEO: head tags Google actually sees

Every page has its own SEO fields in the editor's Page settings (search title,
description, canonical URL, noindex/nofollow, Open Graph and X/Twitter share fields,
and structured data presets — LocalBusiness, Organization, Article, FAQ from an
accordion on the page, BreadcrumbList). The site-wide defaults live in Site settings ›
SEO (site name, site URL, default share picture, title pattern, Google Search Console
code, business details). Every publish also writes `public/sitemap.xml` (every page
that isn't noindex) and `public/robots.txt` (with the `Sitemap:` line) in the same
commit, so the search-engine files stay in step with the pages that exist.

The kit ships one pure function, `computePageHead(layout, siteKit, opts)`, that turns a
layout and the site kit's SEO block into the exact head tags Google should see — the
`<title>`, meta description, robots, canonical, Open Graph, Twitter card, Google
verification and JSON-LD script for structured data. Use it in the way that fits your
framework:

### An SPA (React Router, Vite, plain React)

Import `ArmatureHead` from the kit and render it near your page component. It writes
the tags into `document.head` via useEffect. Google reads what its crawler sees when it
executes JavaScript, so an SPA reaches Google — but adding the tags to the initial
HTML always beats leaving them to run-time. If you can, upgrade to SSR.

```tsx
import { ArmatureHead, ArmaturePage, useKitSnapshot } from "@/lib/armature-kit";

function BuilderPage({ slug }: { slug: string }) {
  const { layouts } = useKitSnapshot();
  const layout = layouts[slug];
  if (!layout) return null;
  return (
    <>
      <ArmatureHead layout={layout} pageUrl={typeof window !== "undefined" ? window.location.href : undefined} />
      <ArmaturePage slug={slug} layout={layout} />
    </>
  );
}
```

### An SSR site: TanStack Start

TanStack Start routes take a `head()` function whose return value the framework
inserts into the served HTML. Compute the tags with the kit and hand them back:

```tsx
// src/routes/$.tsx
import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { ArmatureRoute, computePageHead, useKitSnapshot } from "@/lib/armature-kit";
import { NotFound } from "@/components/NotFound";
import { armature } from "@/lib/armature";
import siteKit from "../../content/site-kit.json";

export const Route = createFileRoute("/$")({
  component: ArmatureCatchAll,
  head({ params }) {
    // The framework reads content/layouts/*.json at build time.
    const layout = armature.getSnapshot().layouts?.[params._splat ?? "home"];
    if (!layout) return {};
    const tags = computePageHead(layout, siteKit, { pageUrl: `${siteKit.seo?.siteUrl ?? ""}${layout.path ?? "/"}` });
    return {
      title: tags.find((tag) => tag.tag === "title")?.content,
      meta: tags.filter((tag) => tag.tag === "meta").map((tag) => ({ ...tag.attrs })),
      links: tags.filter((tag) => tag.tag === "link").map((tag) => ({ ...tag.attrs })),
      scripts: tags.filter((tag) => tag.tag === "script").map((tag) => ({ type: "application/ld+json", children: (tag as { content: string }).content })),
    };
  },
});
```

### An SSR site: Next.js

`computePageHead` also works from Next's Metadata API (or the app router `generateMetadata`)
— read the layout you need, compute the tags, and shape them into Metadata.

### A plain HTML template

`renderHeadHtml(tags)` returns the tags as one HTML string, ready to inject into any
server template that has an `<head>` section.

### How Google sees a non-SSR site

Google's crawler executes JavaScript, so an SPA using `ArmatureHead` reaches Google —
but the initial HTML the crawler downloads has none of the SEO tags. On sites that need
the strongest signal (marketing landing pages, blog posts you promote heavily), upgrade
to SSR (TanStack Start, Next.js) and use `computePageHead()` inside `head()` /
`generateMetadata()` so the tags are already in the HTML.

### Verifying with Google Search Console (no Google Cloud setup)

1. Get the verification code from Google Search Console (Settings › Ownership
   verification › HTML tag), paste the `content=""` value into **Site settings › SEO
   › Google Search Console code** and publish.
2. Google opens the site, sees the meta tag, and marks ownership verified.
3. Submit the sitemap once at Search Console › Sitemaps › `https://your-site.com/sitemap.xml`.

Nothing else in Google Cloud is needed. From here on Armature keeps the sitemap in step
with every publish.

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
  and reported; a required content setting (a heading's text, a list's items) gets a safe
  stand-in (`""`, `[]`) so the element still renders with that one value ignored;
- only an element it cannot read at all (no id, a duplicate id, no widget type, content
  settings that are not an object) is skipped on the site and shown as "Unsupported
  element" in the editor;
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

- `content/layouts/_header.json` and `content/layouts/_footer.json`: the header and footer
  built in the editor (see step 7). `content/trash/<slug>.json`: pages in the bin, never
  rendered.

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
4. **Verify against a production build** (step 8 above): `npm run build && npm run preview`,
   then open a page with builder widgets from the built output. The dev server cannot show
   a widget the bundler dropped. Kits before 2.5.0 registered their widgets through
   side-effect imports and lost every library widget on a site with `"sideEffects": false`.

No dependency changes are needed to update: React remains the only dependency.
