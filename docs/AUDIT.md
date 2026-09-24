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
| An element the editor cannot read at all: "Unsupported element", skipped on the site, kept on publish | **Fixed** | `problems.spec.ts` "only a genuinely unreadable element shows as Unsupported"; `validate.test.ts` "turns an element it cannot read at all into an Unsupported placeholder" |
| An element of a known type with one unreadable value: renders normally with that value ignored (a required text becomes "", a required list `[]`), never a placeholder | **Fixed** (a heading without text, a button with a number for its text and a widget with stray inner elements all became placeholders before) | `problems.spec.ts` (the button whose text is `42`); `validate.test.ts` "a known element with one unreadable content value renders with that value ignored" |
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
| Projects (called Fleet until 2026-09-24; `/fleet` redirects): sites, billing totals, renewals, open requests, search | Works | `screens.spec.ts`; `sidebar.spec.ts` "the old /fleet address lands on Projects"; `services.test.ts` (totals and renewals) |
| The site switcher in the site menu: a real menu with search, keyboard, Escape and outside click, landing on the same section of the chosen site | **Fixed** (was a native `<select>` that always landed on the Dashboard) | `sidebar.spec.ts` "the site switcher is a real menu"; `siteSwitch.test.ts` |
| Pages is the one way into the editor: no "Edit site visually" in the menu, no "Edit your site" on the dashboard | **Fixed** | `sidebar.spec.ts`; `dashboard.spec.ts` |
| Pages table: Type from the layout's real content (a builder-native page no longer reads "Coded"), "By" is the person's name, row actions always in view, nothing clipped, stacked cards at 390px | **Fixed** | `pages.spec.ts`; `pageRows.test.ts`; `screens.spec.ts` |
| Appearance › Header / Footer / Menus and the editor's coded-part note say what the files hold (which part is built, what it holds, which menu it shows, where each menu is shown) | **Fixed** (the note read "still coded" even once the header was built) | `appearance.spec.ts`; `navigation.spec.ts` "once the header is built"; `chromeState.test.ts`; `pages.test.ts` (the note) |
| Add a site: GitHub App install, repository check, hosting-only client | Works | `screens.spec.ts`; Deno `siteChecks.test.ts`, `githubApp.test.ts` |
| Site overview: attention list, recent publishes, hosting & services, client editing level, site health | Works | `builder.spec.ts` "agency staff set what clients may do"; `screens.spec.ts` |
| Pages: every page with "Edit fields" and "Edit visually", connection line, the warning box | **Fixed** (per-page "Edit visually"; the Header & footer card no longer offers a visual edit that lands on Home; builder-only pages are listed too) | `navigation.spec.ts`; `problems.spec.ts`; `real-site.spec.ts` |
| Page form editor (Stage 1): fields, changed tags, revert, discard, publish, check connection | **Fixed** (at 390px the sections strip made the whole screen 17px wider than the phone, so it scrolled sideways; the layout's phone column is now capped to the viewport) | `screens.spec.ts` (fails on any sideways scroll); `visual-editor.spec.ts`; Deno `publish.test.ts` |
| Change requests: list, new (with screenshots), detail, status and note; agency-wide list; reached from the site menu's Requests item and the dashboard's "Need something bigger?" card (the editor's request bar is gone) | Works | `screens.spec.ts`; `requests.test.ts`; `sidebar.spec.ts` (the Requests item); `dashboard.spec.ts` (the card); `visual-editor.spec.ts` "clients see the agency's name" (no bar) |
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
- **A client who opens an agency-only address** (the site's Users or Site settings, or
  `/github/setup`) now gets a proper page: an `h1`, a line saying the agency looks after it,
  and a "Back to your dashboard" link. Fixed (`sidebar.spec.ts` "clients"; `screens.spec.ts`
  crawls `/github/setup` and `/fleet` as a client).
- **The not-found screen has an `h1`** ("Page not found"). Fixed (`sidebar.spec.ts` "an
  unknown site address keeps the site's menu").
- **Sidebar "N sites connected" and the Settings "looks after N sites" read 0 in the mocked
  crawl** while Projects counts 1. The count is a `HEAD … count=exact` request the mocks answer
  without a body; the real Supabase answers it correctly. Not a product bug.
- **"Add a site" shows "No mock for github-setup" in the crawl.** The mocks do not implement
  that function; the screen's own error handling is what you see, which is the point.
- **Email is still not sent** for invites and password resets beyond Supabase's own
  templates (as documented in README). Invite links are shown to copy.

## Every control on every widget

**Date:** 2026-09-24. **How:** `src/builder/controls/coverage.test.ts` takes every widget type the
Elements panel offers and every leaf control on its Content, Style (Normal and Hover) and
Advanced tabs (the popovers opened up: the typography fields, the border fields), sets a value
the way the inspector writes it, and renders the element through the kit — the stylesheet
`kit/css.ts` generates and the HTML the widget renders. A control **Works** when, at desktop, a
declaration or an attribute changes and the element still validates; when a phone-only
override on top of the desktop value changes only the phone media block (the base rules, the
tablet block and the markup stay as they were); and, on the Hover state, when only `:hover`
rules change. `builder.spec.ts` "number steppers" drives a sample of the same controls through
the real inspector (margin, opacity, the site breakpoints, the font size) and checks the canvas.
The matrix below is what the test prints (`COVERAGE_MATRIX=1 npx vitest run
src/builder/controls/coverage.test.ts --silent=false --reporter=verbose`); the counts are leaf
controls, of which "per device" have the device switch and "on hover" sit on the Hover state.

| Widget | Content | Style | Style (hover) | Advanced |
| --- | --- | --- | --- | --- |
| container | Works (11 controls, 7 per device) | Works (9 controls, 9 per device) | Works (9 controls, 8 per device, 8 on hover) | Works (30 controls, 16 per device) |
| grid | Works (11 controls, 7 per device) | Works (9 controls, 9 per device) | Works (9 controls, 8 per device, 8 on hover) | Works (30 controls, 16 per device) |
| heading | Works (3 controls) | Works (22 controls, 20 per device) | Works (23 controls, 20 per device, 22 on hover) | Works (30 controls, 16 per device) |
| text | — (the Text Editor itself; `builder.spec.ts` "the Text Editor in the panel and the text on the canvas stay in sync") | Works (22 controls, 20 per device) | Works (23 controls, 20 per device, 22 on hover) | Works (30 controls, 16 per device) |
| image | Works (9 controls, 3 per device) | Works (8 controls, 8 per device) | Works (9 controls, 8 per device, 8 on hover) | Works (30 controls, 16 per device) |
| button | Works (7 controls, 1 per device) | Works (22 controls, 20 per device) | Works (23 controls, 20 per device, 22 on hover) | Works (30 controls, 16 per device) |
| spacer | Works (1 control, 1 per device) | Works (3 controls, 3 per device) | Works (3 controls, 2 per device, 2 on hover) | Works (30 controls, 16 per device) |
| divider | Works (7 controls, 1 per device) | Works (22 controls, 20 per device) | Works (23 controls, 20 per device, 22 on hover) | Works (30 controls, 16 per device) |
| site-logo | **Fixed** (4 controls, 2 per device: Height and Alignment ignored a phone or tablet value, and a desktop value once any override existed) | Works (8 controls, 8 per device) | Works (9 controls, 8 per device, 8 on hover) | Works (30 controls, 16 per device) |
| nav-menu | **Fixed** (5 controls, 1 per device: Alignment ignored a phone or tablet value) | Works (22 controls, 20 per device) | Works (23 controls, 20 per device, 22 on hover) | Works (30 controls, 16 per device) |
| icon | Works (9 controls, 2 per device) | Works (3 controls, 3 per device) | Works (3 controls, 2 per device, 2 on hover) | Works (30 controls, 16 per device) |
| video | Works (9 controls; 3 behaviour-only: Loop, Muted, Start at) | Works (8 controls, 8 per device) | Works (9 controls, 8 per device, 8 on hover) | Works (30 controls, 16 per device) |
| icon-box | Works (9 controls, 1 per device) | Works (22 controls, 20 per device) | Works (23 controls, 20 per device, 22 on hover) | Works (30 controls, 16 per device) |
| image-box | Works (8 controls, 1 per device) | Works (22 controls, 20 per device) | Works (23 controls, 20 per device, 22 on hover) | Works (30 controls, 16 per device) |
| icon-list | Works (6 controls) | Works (22 controls, 20 per device) | Works (23 controls, 20 per device, 22 on hover) | Works (30 controls, 16 per device) |
| accordion | Works (4 controls) | Works (22 controls, 20 per device) | Works (23 controls, 20 per device, 22 on hover) | Works (30 controls, 16 per device) |
| toggle | Works (4 controls) | Works (22 controls, 20 per device) | Works (23 controls, 20 per device, 22 on hover) | Works (30 controls, 16 per device) |
| tabs | Works (3 controls) | Works (22 controls, 20 per device) | Works (23 controls, 20 per device, 22 on hover) | Works (30 controls, 16 per device) |
| testimonial | Works (7 controls, 1 per device) | Works (22 controls, 20 per device) | Works (23 controls, 20 per device, 22 on hover) | Works (30 controls, 16 per device) |
| star-rating | Works (7 controls, 1 per device) | Works (22 controls, 20 per device) | Works (23 controls, 20 per device, 22 on hover) | Works (30 controls, 16 per device) |
| counter | Works (9 controls, 1 per device; 1 behaviour-only: Duration) | Works (22 controls, 20 per device) | Works (23 controls, 20 per device, 22 on hover) | Works (30 controls, 16 per device) |
| progress | Works (7 controls) | Works (22 controls, 20 per device) | Works (23 controls, 20 per device, 22 on hover) | Works (30 controls, 16 per device) |
| alert | Works (5 controls) | Works (22 controls, 20 per device) | Works (23 controls, 20 per device, 22 on hover) | Works (30 controls, 16 per device) |
| social-icons | Works (8 controls, 1 per device) | Works (22 controls, 20 per device) | Works (23 controls, 20 per device, 22 on hover) | Works (30 controls, 16 per device) |
| gallery | Works (6 controls, 1 per device) | Works (8 controls, 8 per device) | Works (9 controls, 8 per device, 8 on hover) | Works (30 controls, 16 per device) |
| carousel | Works (12 controls, 1 per device; 4 behaviour-only: Play by itself, Seconds per slide, Pause while pointed at, Loop) | Works (8 controls, 8 per device) | Works (9 controls, 8 per device, 8 on hover) | Works (30 controls, 16 per device) |
| map | Works (4 controls, 1 per device) | Works (8 controls, 8 per device) | Works (9 controls, 8 per device, 8 on hover) | Works (30 controls, 16 per device) |
| cta | Works (9 controls, 1 per device) | Works (22 controls, 20 per device) | Works (23 controls, 20 per device, 22 on hover) | Works (30 controls, 16 per device) |
| price-table | Works (11 controls) | Works (22 controls, 20 per device) | Works (23 controls, 20 per device, 22 on hover) | Works (30 controls, 16 per device) |
| countdown | Works (9 controls) | Works (22 controls, 20 per device) | Works (23 controls, 20 per device, 22 on hover) | Works (30 controls, 16 per device) |
| flip-box | Works (13 controls, 1 per device) | Works (22 controls, 20 per device) | Works (23 controls, 20 per device, 22 on hover) | Works (30 controls, 16 per device) |
| blockquote | Works (6 controls, 1 per device) | Works (22 controls, 20 per device) | Works (23 controls, 20 per device, 22 on hover) | Works (30 controls, 16 per device) |
| toc | Works (3 controls) | Works (22 controls, 20 per device) | Works (23 controls, 20 per device, 22 on hover) | Works (30 controls, 16 per device) |
| form | Works (7 controls; 2 behaviour-only: Thank-you message, Or go to a page) | Works (22 controls, 20 per device) | Works (23 controls, 20 per device, 22 on hover) | Works (30 controls, 16 per device) |
| html | Works (3 controls, 1 per device) | Works (8 controls, 8 per device) | Works (9 controls, 8 per device, 8 on hover) | Works (30 controls, 16 per device) |

The Advanced column is the same 30 controls on every widget (Layout, In its container, In its
grid, Position, Motion effects, Responsive, Attributes, Custom CSS); a widget with no text gets
the shorter Style tab (background, border, shadow, effects).

### Fixed in this job

- **Site Logo › Height and Alignment, Nav Menu › Alignment** (`kit/library/css.ts`): the controls
  have the device switch, but the CSS hooks read the value as if it were plain, so a phone or
  tablet override produced nothing (and, for the logo, `0undefined` once the wrapper existed).
  They now go through the same per-device path as every other rule.
- **A first phone or tablet value on a typography field linked to a site text style copied the
  phone value up to desktop.** The file format needs a desktop base, and the inspector seeded it
  with the value just typed; it now seeds it with the site style's own desktop value (what desktop
  was showing), so desktop keeps looking the same. The toolbar's A− / A+ does the same, seeding
  desktop with the site style's size or the size the page computed. `builder.spec.ts` "A− and A+
  on the floating toolbar" checks the phone size moves and desktop stays at 28px.
- **Opacity** (named as broken): could not be reproduced. The matrix passes it at desktop, as a
  phone override and on hover for every widget; `builder.spec.ts` "the arrow keys step the
  focused number…" types 0.5, steps to 0.55 with the button and to 1 with Shift+ArrowUp, and
  reads each value back from the canvas. The kit's CSS has emitted `opacity` since the first
  builder commit, so the real site's kit (2.2.0) has it too. If it fails on a specific site, the
  cause is outside the control → CSS path (the site's own stylesheet, for instance); please
  send the page and the value.

### Still broken / notes on the controls

- **A phone or tablet value set before any desktop value becomes the desktop value too**
  (every control without a site-style fallback: margin, opacity, a background…). Reason: a
  per-device value is stored as `{ desktop, tablet?, mobile? }` and `desktop` is required by the
  site contract, so the first value written has to fill it. What to do: set the desktop value
  first, or after (the desktop field then edits the base and the phone keeps its override).
  Changing the contract to allow a phone-only value is a kit version bump (types, validator,
  CSS generator, every site's kit) and is not done here.
- **Behaviour-only controls** cannot show in a static render and are checked by the widget's
  own tests instead: the video's Loop, Muted and Start at (they go into the player address the
  facade builds when the visitor presses play); the carousel's Play by itself, Seconds per slide,
  Pause while pointed at and Loop (they run after the page loads, never in the editor); the
  counter's Duration (the count-up); the form's Thank-you message and Or go to a page (after the
  form is sent; `builder.spec.ts` "the form checks fields…"). They are listed in the test with
  these reasons, so a control that stops working is still caught everywhere else.
- **The site kit's own controls (Globals)** are not widget controls and are outside the matrix;
  `builder.spec.ts` "changing a site colour restyles everything" and "the Globals panel numbers
  have the same steppers" cover the kit → stylesheet path.

## Number steppers and the font-size toolbar

Every number in the inspector and in Globals (a plain number, a size, the four sides, the
four corners, a gap, a shadow offset, the stroke width, a gradient angle or stop, the overlay
and colour opacities, the custom entry of a select such as a font weight, the transition and
animation times) has up and down buttons: one step per click (1 for px and %, 0.1 for em, rem
and unitless values, 0.05 for opacity, the control's own step otherwise), ten with Shift, and a
hold repeats after 350 ms every 50 ms. The arrow keys on the field do the same. The canvas
follows every step; one hold, one key-repeat run or one scrub is one undo step (`history.ts`
merges a `drag:` group however long it lasts; typing still merges only while it keeps coming).
Headings, Text Editors, buttons and every widget whose Style tab has typography get A−, the
current size and A+ over the selected element (and on the rich-text toolbar while a Text
Editor is edited), writing the font size for the device being edited.

| Feature | Status | Covered by |
| --- | --- | --- |
| Up/down buttons step, Shift steps 10, the canvas follows, the unit sets the step (px 1, em 0.1) | Works | `builder.spec.ts` "the up and down buttons step…" |
| Press-and-hold repeats and is one undo step | Works | `builder.spec.ts` "the up and down buttons step…" (a 900 ms hold, then one Undo) |
| Arrow keys and Shift+arrows; a key-repeat run is one undo step | Works | `builder.spec.ts` "the arrow keys step the focused number…" |
| Opacity by 0.05 | Works | `builder.spec.ts` "the arrow keys step the focused number…" |
| Globals numbers (the site breakpoints reach the stylesheet) | Works | `builder.spec.ts` "the Globals panel numbers have the same steppers" |
| A− / A+ per device on the strip and on the rich-text toolbar; a hold is one undo step | Works | `builder.spec.ts` "A− and A+ on the floating toolbar…"; `fontSize.test.ts` |

## What changed under the hood (so the audit is repeatable)

- `kit/validate.ts` is the one validator, tolerant per element and per property; zod is gone.
- `shared/builder/preserve.ts` puts unread values back on publish; the publish function refuses
  new unread values.
- `content-get` returns structured `problems`; the Pages screen and the element panel show them.
- Fixtures: `tests/fixtures/treetestprep/` (the site's `content/` folder, verbatim).
- Tests added: `shared/builder/validate.test.ts`, Deno `realSite.test.ts`, Playwright
  `problems.spec.ts`, `navigation.spec.ts`, `real-site.spec.ts`, `screens.spec.ts`.
- Controls: `src/builder/controls/coverage.test.ts` (the matrix above), `src/builder/fontSize.test.ts`,
  `builder.spec.ts` "number steppers". `ARMATURE_E2E_PORT` and `ARMATURE_E2E_SITE_PORT` move the
  Playwright dev servers off 5173/5174, so two checkouts can test side by side without one
  reusing the other's server (`reuseExistingServer` is on outside CI).
