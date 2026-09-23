# Audit against the first real site

**Site:** acts2man/treetestprep, branch `armature/git-content`, commit `5683e17`, kit 2.2.0 (its
`content/` folder is the fixture in `tests/fixtures/treetestprep/`).
**Date:** 2026-09-23. **How:** every unit, Deno and Playwright suite in this repository, plus
the real site running locally with its own dev server next to the dashboard
(`REAL_SITE_DIR=<clone> npx playwright test tests/e2e/real-site.spec.ts`), plus a crawl of every
dashboard screen as agency staff and as a client at 1440×900 and 390×844
(`tests/e2e/screens.spec.ts`).

**The main finding:** the test fixtures were too clean. Every test in this repository passed
while the first converted site was unusable, because the demo site never used a value outside
the model's narrow lists (a font weight of 650 was enough to blank the home page and throw
away the site kit). The fixture is now a real site, the validator is as wide as CSS, and one
bad value can no longer take a page down.

Legend: **Works** = verified by the named test and by hand; **Fixed** = broken before this
job, fixed and covered; **Still broken** = known limitation, with the reason and what to do.

## The visual editor on the real site

| Feature | Status | Covered by |
| --- | --- | --- |
| Every page loads with all of its content (7 pages, 140 elements, nothing unsupported) | **Fixed** (font-weight 650 invalidated the home layout and the kit) | `real-site.spec.ts` "every page loads in the editor"; `validate.test.ts` "treetestprep loads cleanly"; Deno `realSite.test.ts` |
| Every element on every page selects and shows Content, Style and Advanced | Works | `real-site.spec.ts` "every element on every page selects" (keyboard walk of the whole tree) |
| Drag between elements | Works | `real-site.spec.ts` "drag between elements…"; `builder.spec.ts` "drag anywhere" |
| Resize an image with its handle | Works | `real-site.spec.ts`; `builder.spec.ts` "image width and height handles" |
| Change padding | Works | `real-site.spec.ts`; `builder.spec.ts` "hover styles, spacing on the Advanced tab" |
| A phone-only override that leaves desktop alone | Works | `real-site.spec.ts`; `builder.spec.ts` "a tablet value overrides desktop" |
| A Globals change (site colour reaches the stylesheet) | Works | `real-site.spec.ts`; `builder.spec.ts` "changing a site colour restyles everything" |
| Save draft, reload, restore | Works | `real-site.spec.ts` "save draft, reload and restore"; `builder.spec.ts` "follow the person to another browser" |
| Publish (GitHub mocked): only the edited page goes out, byte-for-byte otherwise | Works | `real-site.spec.ts`; Deno `realSite.test.ts` "a publish of an edited page writes the page back with only that edit changed" |
| The Pages list and the warning box | **Fixed** (the box now names page, element, setting, value and what is allowed, with "Show me") | `problems.spec.ts`; `real-site.spec.ts` "the Pages list shows every page" |
| Opening the editor: no flash of the Stage 1 editor | **Fixed** | `navigation.spec.ts` "shows a skeleton … never the Stage 1 chrome" |
| The page is in the URL; every "Edit visually" link passes its page | **Fixed** | `navigation.spec.ts` "opens the page named in the URL"; "every 'Edit visually' link carries its page" |
| Unknown page in the URL: friendly note and a link to the Pages list | **Fixed** | `navigation.spec.ts` |
| Page-name menu: Page settings / All pages | **Fixed** | `navigation.spec.ts` "the page name opens a menu" |
| Header and footer: the note for clients and for staff, fields still editable | **Fixed** | `navigation.spec.ts` "the coded header and footer" |
| A value the editor cannot read: ignored, named, kept in the file on publish | **Fixed** | `problems.spec.ts`; `validate.test.ts` "a publish never erases a value"; Deno `builderPublish.test.ts` "values the validator cannot read are kept" |
| An element the editor cannot read: "Unsupported element", skipped on the site, kept on publish | **Fixed** | `problems.spec.ts` "an unreadable element shows as Unsupported element" |
| Font weight: any whole number 1–1000; Weight control with a custom entry | **Fixed** | `problems.spec.ts` "the Weight control keeps its list and takes a custom number"; `validate.test.ts` |
| The site's own content check runs the same validator | **Fixed** (documented in `kit/README.md`; the kit ships `validate.ts`) | `validate.test.ts` (same code path) |
| Undo the drag with the keyboard (Ctrl/Cmd+Z) | Works | `real-site.spec.ts` |
| Undo the drag with the top-bar Undo button right after the drop | Works (a one-off diagnostic during the audit: one step, the button undoes it, and it is then disabled) | `builder.spec.ts` "drags a widget … then undoes it" |

### Still broken / notes on the real site

- **Dropping into a container the site's CSS has collapsed.** The home page's video column
  carries custom CSS `@media (max-width: 767px) { selector { display: contents } }`. On the
  phone canvas that container has no box, so the editor cannot show a drop line inside it. It
  drops fine on desktop and tablet. Reason: `display: contents` removes the element's box;
  the editor can only aim at boxes. What to do: drop on desktop, or remove that CSS once the
  layout is rebuilt with builder settings. Not a code bug; recorded so nobody chases it.
- **Clicking the top-left corner of a container with no padding selects its first child.**
  The hero has no padding of its own on phones, so its corner belongs to the inner container.
  Select the inner element and press the left arrow, or use the breadcrumbs. By design; the
  arrow keys and breadcrumbs exist for this. `real-site.spec.ts` does exactly that.
- **The first few pixels of a container's first child belong to the container's "drop beside
  me" band.** Aim at the child's upper third to drop before it. By design (the band is how you
  drop next to a container); the drag ghost names the target so you can see which it is.
- **The real-site Playwright tests run only where the site is cloned.** CI has no clone of
  acts2man/treetestprep, so `real-site.spec.ts` skips there and runs locally with
  `REAL_SITE_DIR`. The clone needs two local-only edits: `http://localhost:5173` added to
  `ARMATURE_EDITOR_ORIGINS` in `src/lib/armature.ts` and to `FRAME_ANCESTORS` in
  `src/server.ts` (the site's SSR server sends `frame-ancestors` even in dev, which is the
  right thing for production and would otherwise block the local dashboard). Never commit those.
- **Wistia video, Google Fonts and the site's own Supabase** are reached by the site inside the
  editor frame as on the live site. The editor never contacts them itself.

## The dashboard, screen by screen

Every route below renders for staff and for clients at 1440 and 390 pixels wide, throws
nothing, never scrolls sideways, and never shows the word "Armature" to a client
(`screens.spec.ts`). Where a screen has a deeper test it is named.

| Screen | Status | Covered by |
| --- | --- | --- |
| Sign in with password or magic link; password rules; the first-password gate | Works (rules and gate unit-tested; the sign-in screen itself is not driven by Playwright because Supabase auth is mocked) | `passwordGate.test.tsx`, `passwordRules.test.ts`, `loginMessage.test.ts` |
| Fleet: sites, billing totals, renewals, open requests, search | Works | `screens.spec.ts`; `services.test.ts` (totals and renewals) |
| Add a site: GitHub App install, repository check, hosting-only client | Works | `screens.spec.ts`; Deno `siteChecks.test.ts`, `githubApp.test.ts` |
| Site overview: attention list, recent publishes, hosting & services, client editing level, site health | Works | `builder.spec.ts` "agency staff set what clients may do"; `screens.spec.ts` |
| Pages: every page with "Edit fields" and "Edit visually", connection line, the warning box | **Fixed** (per-page "Edit visually"; the Header & footer card no longer offers a visual edit that lands on Home; builder-only pages are listed too) | `navigation.spec.ts`; `problems.spec.ts`; `real-site.spec.ts` |
| Page form editor (Stage 1): fields, changed tags, revert, discard, publish, check connection | **Fixed** (at 390px the sections strip made the whole screen 17px wider than the phone, so it scrolled sideways; the layout's phone column is now capped to the viewport) | `screens.spec.ts` (fails on any sideways scroll); `visual-editor.spec.ts`; Deno `publish.test.ts` |
| Change requests: list, new (with screenshots), detail, status and note; agency-wide list | Works | `screens.spec.ts`; `requests.test.ts`; `visual-editor.spec.ts` "Need something bigger" |
| Publish history: every attempt with its commit link; revisions preview and restore in the editor | Works | `screens.spec.ts`; `builder.spec.ts` "preview an older publish on the canvas" |
| Team: members, pending invitations, invite by link, create a client login; agency team | Works (the staff row reads "Unknown" only when a `profiles` row is missing, which the mocks never seed) | `screens.spec.ts`; Deno `clientAccount.test.ts`, `invite-*` functions |
| Hosting & services: record services, renewals, totals | Works | `services.test.ts`; `screens.spec.ts` |
| Form settings and submissions: the Form widget sends to the function, entries stored, emailed when set up | Works | `builder.spec.ts` "the form checks fields, sends to the form function"; Deno `formSubmit.test.ts` |
| Templates: save a section or page as a template, insert, delete | Works | `builder.spec.ts` "a section saved as a template" |
| Media: library, usage, alt text, upload for an image element | Works | `builder.spec.ts` "the modal shows usage, edits alt text" |
| Client editing levels: content / style / builder, locks, agency-only widgets | Works | `builder.spec.ts` "editing levels"; Deno `builderPublish.test.ts` "clients: the editing level, locks…" |
| Agency settings: branding, portal name, accent colour, preview | Works | `screens.spec.ts` |
| Account: sign out, password note | Works | `screens.spec.ts` |
| Phone widths (390px): every screen, the site tab bar | **Fixed** (the site's tab bar clipped its last tabs at 390px; it now wraps) | `screens.spec.ts` |
| The visual editor under 900px | Works (a friendly note and the form editor) | `visual-editor.spec.ts` |
| Clients never see "Armature" | Works | `visual-editor.spec.ts` "clients see the agency's name"; `screens.spec.ts` |

### Still broken / notes on the dashboard

- **Both Team pages' agency-staff lists logged a React "unique key" warning** when a row had no
  user id (the mocks send none). Fixed: the row key falls back to its position. (`screens.spec.ts`
  now fails on any console error.)
- **A client who types the site's /team address** sees only "Only agency staff manage who has
  access to a site." (no heading, no link). Harmless: the client sidebar never links there.
  Worth a proper heading and a "Back to your dashboard" link in the next dashboard job.
- **The not-found screen has no `h1`** (its title is an empty-state heading). Cosmetic; noted
  for the next dashboard job.
- **Sidebar "N sites connected" and the Settings "looks after N sites" read 0 in the mocked
  crawl** while Fleet counts 1. The count is a `HEAD … count=exact` request the mocks answer
  without a body; the real Supabase answers it correctly. Not a product bug.
- **"Add a site" shows "No mock for github-setup" in the crawl.** The mocks do not implement
  that function; the screen's own error handling is what you see, which is the point.
- **Email is still not sent** for invites and password resets beyond Supabase's own
  templates (as documented in README). Invite links are shown to copy.

## What changed under the hood (so the audit is repeatable)

- `kit/validate.ts` is the one validator, tolerant per element and per property; zod is gone.
- `shared/builder/preserve.ts` puts unread values back on publish; the publish function refuses
  new unread values.
- `content-get` returns structured `problems`; the Pages screen and the element panel show them.
- Fixtures: `tests/fixtures/treetestprep/` (the site's `content/` folder, verbatim).
- Tests added: `shared/builder/validate.test.ts`, Deno `realSite.test.ts`, Playwright
  `problems.spec.ts`, `navigation.spec.ts`, `real-site.spec.ts`, `screens.spec.ts`.
