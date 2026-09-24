# Installing and updating the kit

The **Armature kit** is a small React folder your site copies in. It reads the
content files, renders the pages, and (when the site is open inside Armature's
editor iframe) lets people click, drag and type on the real site.

## First install

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

4. Render coded pages through `<ArmatureSlot>` and add `<ArmatureRoute>` after every
   coded route. The kit's own `kit/README.md` walks through the exact steps, with
   TanStack Start / SSR notes.

## Updating

**Replace the whole folder verbatim.** Copy `kit/` from this repository over
`src/lib/armature-kit/`. Never edit files inside `src/lib/armature-kit/` — everything
site-specific (your `createArmatureKit()` call, section registrations, routes) lives
in your own files.

Bump the `KIT_VERSION` before and after the copy; the editor tells you when a
site is running an older kit than this dashboard.

## Every visual check uses the production build

Because a dev server never tree-shakes, a widget the bundler drops from the built
site still renders under `npm run dev`. Always run

```bash
npm run build && npm run preview
```

after installing or updating the kit, and open a page that uses builder widgets from
the *built* output. The browser console must not say `Armature: no widget renders "…"`.
This repository's `tests/e2e/production-build.spec.ts` runs the same check in CI.
