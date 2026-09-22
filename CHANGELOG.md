# Changelog

All notable changes to Armature are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **The visual editor** (`/sites/:siteId/visual`, "Edit site visually" in both shells; clients and agency staff): the live website inside the dashboard, edited in place. Click text and type on the page (Enter commits, Esc cancels), click a picture to replace it or drop a file onto it, click a button to edit its label and link, manage lists (add, duplicate, delete with undo, drag to reorder) in the inspector with the page updating live. Desktop 1440 / tablet 820 / phone 390 views, undo/redo with keystrokes grouped into sensible steps, Preview mode, keyboard shortcuts (`?`), a three-step first-run tour, and a "Need something bigger?" bar that opens a change request prefilled with the page and field. Layout follows docs/1-visual-editor.html: top bar, dark icon rail, Pages/Layers panel (a dot on changed fields, "off page" for fields not on the current page), the scaled canvas with the "armature wire" selection (1.5px accent outline, corner handles, a floating dark toolbar, a dashed hover outline) drawn above the frame, and the inspector. Under 900px, a friendly note and the form editor.
- **One draft per site across every page**, autosaved to this browser per site and person and offered back on return ("You have unpublished changes from <time>. Keep / Discard"), with a leave-page warning. The store is built so Stage 2 (design tokens) and Stage 3 (sections) become new change kinds without a rewrite.
- **Batch publishing**: `content-publish-batch` writes every changed field and picture on every page as one commit, through the same engine as the form editor (`runPublish` is now a one-page batch): schema validation, URL and image rules, field-level conflict merge across pages, re-validation before commit, no force-push, one `publishes` row per publish with every `slug.section.field` changed. List item pictures carry their item index. The publish dialog shows the changes grouped by page, then progress, then "Published. Live in about 2 minutes" with the commit link; a conflict names the fields and offers to reload while keeping the rest of the draft.
- **Connection states, never silent**: "Loading your site…", "Connecting the editor…", a 10-second handshake timeout, and precise failures: no live URL, an unreachable site, a site without the bridge or with the wrong allowlist ("This site isn't set up for visual editing yet. Use the page editor instead"), a site that blocks framing (`site-embed-check` reads its X-Frame-Options / frame-ancestors and the editor prints the exact header to add), a different protocol version.
- **Site contract v1.1, visual editing (optional)**: `bridge/armature-bridge.ts`, one dependency-free file a site copies in. Inert unless in an iframe with `?armature=edit` from an allowlisted origin; nonce handshake with origin and source checks on every message; invisible stega markers (compatible with `@vercel/stega`) on text values in edit mode, stripped from the DOM after mapping; images matched by `src`; `data-armature-field` for anything else; contenteditable in-place editing; a subscribe/getSnapshot store for drafts; route reporting; Ctrl/Cmd-click follows links. Every message is documented in docs/SITE_CONTRACT.md, with `armature:tokens:*` and `armature:sections:*` reserved.
- `examples/demo-site`: a Vite + React site that follows the contract, and `tests/e2e`: Playwright tests of the editor against it (handshake, outlines, inline edit with undo/redo, image replace, lists, page switching, device toggle, draft restore, batch publish and conflicts with GitHub mocked, the bridge ignoring a non-allowlisted origin and doing nothing outside an iframe). CI runs them.
- The change-request form prefills its title and details from the query string (used by the visual editor).

- **Hosting-only clients**: a site can exist before its GitHub repository is connected. "Add a site" offers "Connect a repository" and "Add a hosting-only client" (name and live URL); a hosting-only site shows "Connect repository", which runs the usual checks and upgrades it in place. Pages, the editor and publishing say so plainly until then.
- **Hosting & services** on each site's overview (agency only): what the agency charges for hosting, the domain and email (mailboxes, flat or per mailbox), the automatic-email sender, the agreement date and notes, edited in a drawer with a live yearly total. Stored in cents, entered in dollars. Clients never see it: the `site_services` table is unreadable to client accounts, and the RLS proof checks that.
- Fleet now shows the yearly billing total, renewals due in the next 30 days (amber when close, red when past), and a yearly total and next renewal per site, with sorting by name, total or renewal and a search box.
- Migration `20260922000100_hosting_and_services.sql`: nullable repository columns, the `hosting_only` status, the `site_services` table and the `site_billing` view.

### Changed

- **Every screen restyled to the approved design** (docs/1-visual-editor.html to docs/4-agency-fleet.html): Bricolage Grotesque headings with Hanken Grotesk text, a dark ink sidebar (the Armature wordmark and wire-A logo for agencies; the agency's own portal name and logo for clients, who never see the word Armature), white panels with 1px borders on a cool grey ground, 44px controls, and the agency accent colour flowing through buttons, links and focus rings. Below 900px the sidebar becomes a top bar with a menu drawer.
- Fleet now opens with stat cards (sites, needs attention, open requests, publishes in the last 30 days), the client sites table, and the newest open change request in a panel on the right. The client dashboard greets the person by name and shows only what needs their attention, recent publishes, site health and change requests, with quiet empty states where there is nothing yet.
- The page editor has a sections list, one inspector-style panel per field with its key, a "Changed" tag and the accent "wire" outline on edited fields, and a sticky publish bar.
- Agency navigation is Fleet, Change requests, Team and Settings; agency staff and their invitations moved from Settings to Team. Clients get a Settings screen with their account and sites.
- Loading states use skeletons instead of spinners; saves confirm with a toast; leaving the editor with unpublished changes and removing a member ask in a dialog.

### Added

- **Create client login**: on a site's Team screen, agency staff can create a client's account themselves (name, email, site, role, temporary password with a **Generate** button and show/hide) and copy a ready-to-send message with the sign-in link, email and temporary password. The invite-link flow stays as it was. If the email already has an account, that person is only given access to the site and their existing password is left alone.
- **Choose your password** on first sign-in: an account the agency created must replace the temporary password before it can open any other screen. The new password follows the same rules (at least 10 characters; not the word "password", the email address, or one character repeated).
- Two edge functions: `client-create` (agency staff only; creates the confirmed account with the service role and never returns or logs the password) and `password-set` (the signed-in person sets their own password and the must-change flag is cleared).

### Fixed

- "Add a site" / "Check connection": the step "The App can write to the repository" now passes when the installation token GitHub issued carries Contents: write. It used to read `permissions.push` from the repository response, which GitHub does not report reliably for App installation tokens, so the step failed on real deploys right after the token step had passed.

## [0.1.0] - 2026-09-21

The first version: a manual-only editing dashboard. No AI features anywhere.

### Added

**Dashboard**

- Sign in with email and password or with an emailed sign-in link; create an account; reset a password.
- Invite acceptance page: a person opens the link, signs in or creates an account with the invited email, and is added to the site or agency.
- Fleet: every site with status, last publish and open change-request count; "Add a site" flow that installs the GitHub App, links the installation, and runs the connection checklist.
- Client home: the site, recent publishes, change requests, and the way in to editing.
- Pages list built from the site's `content/schema.json`.
- Page editor ported from the pilot: local draft, per-field Changed tags, Revert, Discard all, one Publish button, blocked-reason line, leave-page warning, three-state connection line that can never be blank, Check connection checklist, conflict panel, and images resized in the browser to WebP (2000 px longest edge, 3 MB cap).
- Change requests with screenshots in Supabase Storage; the agency sets a status and a note; the client sees updates.
- Team: invite clients to a site, see who has access, remove access, see pending invites.
- Agency settings: portal name, logo URL and accent colour, applied to every client's portal. Clients never see the word Armature.
- Publish history per site with a link to each commit and the reason for any failure.

**Publishing**

- Seven Supabase edge functions: `github-setup`, `site-connect`, `content-get`, `content-publish`, `site-diagnose`, `invite-create`, `invite-accept`.
- GitHub access through a GitHub App only: an RS256 app JWT signed with Web Crypto mints a one-hour installation token per request, scoped to the one repository.
- The pilot's publish engine, ported: schema validation, URL and image rules, one commit per publish through the Git Data API, no force-push, field-level conflict merge, re-validation of the merged file before commit, errors that are never silent, secrets that stay server-side.
- A `publishes` row for every attempt on a site the caller can access (committed, conflict or failed).

**Data and security**

- Postgres schema for agencies, members, GitHub installations, sites, site members, invites, publishes, change requests and attachments, with a `profiles` mirror of `auth.users`.
- Row-level security on every table, SECURITY DEFINER membership helpers, and a plain-SQL test proving that a client of site A cannot read site B and a member of agency X cannot read agency Y.
- A private storage bucket for screenshots, scoped by site id in the object path.
- `bootstrap_agency()` to turn the first sign-up into the first agency owner from the SQL editor.

**Site contract**

- `docs/SITE_CONTRACT.md` (v1): `content/schema.json` with `armatureContract: 1`, `content/pages.json`, `public/assets/uploads/`, and a minimal example that the tests keep valid.
- A package-free `shared/` folder used by both the browser and the edge functions.

**Docs and tooling**

- `docs/SETUP.md`: every click, for a non-developer.
- `npm run verify` (typecheck, lint, tests, build, secret grep), Deno checks and tests for the functions, `npm run db:test` for the migrations and RLS proof.
- GitHub Actions: CI, and a terminal-free edge-function deploy.
- Netlify configuration with the single-page-app redirect.

### Known limitations and stubs

- Email sending is a stub. `invite-create` logs the invite link and returns it to the agency, who copies it to the client. The dashboard says so.
- No preview of unpublished changes (the visual editor now shows drafts live; the form editor still does not).
- Publishing is per page in the form editor (the visual editor publishes every page in one commit).
- Agency logos are given as an https URL, not uploaded.
- Migrations are applied by hand in the Supabase SQL editor; there is no automatic migration runner.
- Sign-up confirmation and password-reset emails use Supabase's default templates and sender.
