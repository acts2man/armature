# Changelog

All notable changes to Armature are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
- No preview of unpublished changes.
- Publishing is per page.
- Agency logos are given as an https URL, not uploaded.
- Migrations are applied by hand in the Supabase SQL editor; there is no automatic migration runner.
- Sign-up confirmation and password-reset emails use Supabase's default templates and sender.
