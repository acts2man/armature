# Demo site

A tiny Vite + React site that follows the Armature site contract, including the
optional visual-editing bridge (v1.1). The dashboard's Playwright tests open the visual
editor against it.

```bash
cd examples/demo-site
npm install
npm run dev        # http://localhost:5174
```

- `content/schema.json` and `content/pages.json`: three pages (header & footer, home with
  two list fields, about with a URL field).
- `src/content.ts`: the `usePageCopy` hook wired to the bridge. The bridge is imported
  from `../../bridge/armature-bridge.ts` so this repository has one copy; a real site
  copies that file into its own `src/`.
- `VITE_ARMATURE_EDITOR_ORIGINS`: comma-separated editor origins allowed to embed the
  site. Defaults to the local dashboard (`http://localhost:5173`) and the production
  dashboard.
- `/every-widget` (`src/widgets.tsx`, `src/every-widget.json`): a test-only page with one
  element of every widget the kit ships. `tests/e2e/production-build.spec.ts` builds this
  site for production laid out as a real site and checks that each one renders, which is
  why `package.json` keeps `"sideEffects": false`: a real site's bundler tree-shakes with
  it, and the dev server never does.
