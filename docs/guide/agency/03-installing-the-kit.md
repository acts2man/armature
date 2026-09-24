# Installing and updating the kit

The **Armature kit** is a small React folder your site copies in. It reads the
content files, renders the pages, and (when the site is open inside Armature's
editor iframe) lets people click, drag and type on the real site.

## First install (the short way, from Armature)

1. In the site's dashboard, open **Site settings → Connection**. The **Kit**
   card shows the current kit version, what your site is on, and a **Set up
   this site** button.
2. Press **Set up this site**. Armature builds a Claude Code prompt for **this
   site** — your repo, your connected branch, your kit path, your site id and
   the stats endpoint filled in.
3. Press **Copy prompt**, open [Claude Code on the web](https://claude.ai/code),
   pick this repo, paste and send. Claude does the copy, the tiny
   `createArmatureKit()` wiring, and the one-time setup steps for the
   kit version you're installing. Every visual check runs against the
   production build and must be pixel-identical to before.
4. Push the branch. The next Netlify build serves the kit; Armature reads
   `data-armature-kit` off the live page and flips the Kit card to **Up to
   date**.

## Updating an existing site (one click)

1. The Kit card shows **Update available** when a newer kit is out. Press
   **Update kit** to open the update dialog.
2. Read the notes for every release between the site's version and the
   current one; the dialog also lists any pending setup steps (things a
   version introduced that this site has not done yet — Claude Code handles
   those via **Set up this site** when needed).
3. Confirm. Armature commits every file under the site's kit path in ONE
   commit (adds, changes and removes), message `Update Armature kit X → Y`,
   into the connected branch. Nothing outside the kit path is touched.
4. Netlify rebuilds on its own; the Kit card flips to **Up to date** once
   the deploy is live.

Test on one site first, especially for a big release. The update history
lives under the same card so you can see who updated what and when.

## What if the site's kit folder has local edits?

The kit is meant to be copied verbatim. If Armature detects that the site's
current kit files differ from what the previous version's package installed,
the update dialog stops with a list of the changed paths and offers **Overwrite
anyway**. If a site's developer has genuinely edited the kit, ask them why
first — a local edit gets lost on the next update.

## Where the kit lives in your site

Armature assumes the folder is at `src/lib/armature-kit/`. If your site's
developer put it somewhere else (say `packages/kit/`), correct the **Kit
path** on the Kit card. Armature reads it from there for every check and
every update.

## When Netlify's build costs matter

Every update is one commit, so Netlify counts one build. On Netlify's paid
plans this is fine; on their credit-limited free tier a run of Update all
across many sites can eat through the month's credits — start with your
test site, then batch the rest.

## Every visual check uses the production build

Because a dev server never tree-shakes, a widget the bundler drops from the
built site still renders under `npm run dev`. Always run

```bash
npm run build && npm run preview
```

after any kit change (from a manual copy or Armature's Update kit) and open
a page that uses builder widgets from the *built* output. The browser
console must not say `Armature: no widget renders "…"`. This repository's
`tests/e2e/production-build.spec.ts` runs the same check in CI.

## When a site "Needs attention"

If the Kit card ends up on **Needs attention** after an update, the most
common cause is that Netlify's build failed and the old kit is still live.
Open the site in Netlify to read the build log; the fix is almost always
listed there in plain English (a missing env var, a syntax error the setup
prompt did not run, or a dependency the site pins to an older version).

## Manual install (if you prefer to do it by hand)

1. Clone this repository.
2. Copy the `kit/` folder into your site at `src/lib/armature-kit/`.
3. Create the kit once, next to it:

   ```ts
   // src/lib/armature.ts
   import { createArmatureKit } from "./armature-kit";
   import schema from "../../content/schema.json";
   import content from "../../content/pages.json";
   import siteKit from "../../content/site-kit.json";     // optional
   export const armature = createArmatureKit({
     allowedOrigins: ["https://armature-sites.netlify.app"], // the dashboard's exact origin
     schema, content, siteKit,
     layouts: import.meta.glob("../../content/layouts/*.json", { eager: true }),
   });
   ```

4. Render coded pages through `<ArmatureSlot>` and add `<ArmatureRoute>` after
   every coded route. The kit's own `kit/README.md` walks through the exact
   steps, with TanStack Start / SSR notes.
