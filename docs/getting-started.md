# Getting Started guide — how it is wired

The `/getting-started` page in the dashboard is a seven-section end-to-end
walkthrough for agency owners and staff. This file is the developer's map of
where each moving part lives; the user-facing copy is in
`src/lib/gettingStartedContent.ts` and can be edited without touching React.

## Sections

Seven section keys, in this order (see `SECTION_KEYS`):

1. `agency-setup` — one-time agency setup (GitHub App, Netlify, optional Resend).
2. `add-site` — connect a new client site.
3. `set-up-site` — run the "Set up this site" prompt in Claude Code.
4. `give-access` — invite the client and pick their editing level.
5. `editing-publishing` — how a publish becomes a commit becomes a Netlify build.
6. `keep-updated` — kit updates: what needs one, how to run it, Undo, one-time setup steps.
7. `troubleshoot` — the four or five things that go wrong most often, with the fix.

Every section carries:

- `what` (why it matters — one italic paragraph).
- `steps` (numbered — each with a `screenshot` slug and a `caption`).
- `troubleshoot` (a paragraph on what to do when things break).
- `video` (`placeholder` + `captions` for the fallback UI).
- `cost` on sections 3, 5 and 6, where money is involved.

## Storage

Progress ticks and the "Use my own video" URL per section live in
`public.agency_getting_started` (migration
`supabase/migrations/20260924001000_agency_getting_started.sql`). One row per
agency; both columns are JSONB keyed by section key. RLS: only members of the
agency can read or write their own row.

The `agency-getting-started` edge function
(`supabase/functions/agency-getting-started/index.ts`) is the only server-side
writer. It:

- Verifies the caller with `resolveCaller` and `requireAgencyMember`.
- Validates the payload with `parsePatch` (rejects unknown keys, non-URL
  overrides, and any host not on the YouTube / Vimeo / Loom / Wistia
  allow-list).
- Reads: `{ agency_id, read: true }` returns the row (or a blank one).
- Writes: `{ agency_id, progress?, video_overrides? }` merges the patch and
  upserts.

The UI keeps a per-browser cache in localStorage under
`armature:getting-started:<agencyId>` so an offline dashboard still renders
the last known state; the cache is refreshed on every successful save.

## Assets

- Placeholder screenshots live under `public/guide-screenshots/*.svg`
  (one per numbered step, small, labelled). An agency replaces them with
  real screenshots by dropping a `.svg`, `.png` or `.jpg` at the same slug.
- Videos live under `public/guide-videos/<section-key>.webm`, produced by
  `npm run record:guide-videos` (`scripts/record-guide-videos.mjs`). When a
  `.webm` file is missing the UI falls back to a captioned text block, so
  nothing renders broken.

## Tests

- `tests/kit/gettingStarted.test.ts` — unit tests on the content module:
  seven sections, screenshot slugs map to real files, no leftover Stats
  copy, allow-list of video hosts.
- `supabase/functions/_shared/agencyGettingStarted.test.ts` — Deno tests for
  `parsePatch`, `mergePatch`, and the video allow-list.
- `tests/e2e/getting-started.spec.ts` — Playwright: seven section panels,
  toggling, ticking Done saves through the mocked edge function, a pasted
  YouTube link renders in the video slot, no `.webm` shows the fallback, a
  present `.webm` mounts `<video controls>`.
