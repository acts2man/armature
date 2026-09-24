# The code engine: editing a site's real code (proof of concept)

**What this is.** Today the visual editor only works after a site copies the Armature kit
into its repository and its pages are converted into builder JSON, and every Armature
update means updating every site. The code engine is a different approach, proven here on
Tree Test Prep's original code (acts2man/treetestprep, branch `main`, never touched by the
kit work): add a client, connect their GitHub repository, and the visual editor works on the
site's real source. Edits become one commit on GitHub and Netlify deploys as usual. Nothing
is added to the site's repository: no kit, no conversion, no build step.

Everything lives in `engine/` behind a hidden flag (`localStorage["armature:engine"] = "1"`,
or `?engine=1` once, then `/sites/<id>/engine?page=/`). The product is unchanged for users.

## How it works

1. **Preview runner** (`engine/runner/`). Armature clones the site into a cache folder,
   installs its dependencies with the site's own package manager (bun first; npm from the
   public registry as the fallback, because Lovable's lockfiles point at a private mirror only
   Lovable's sandboxes can reach), and starts the site's own Vite dev server in a child
   process. The child loads the site's own `vite.config.ts` with the site's own Vite and
   appends two Armature plugins, so no file in the repository changes:
   - **Source tags.** Every JSX element gets `data-ae="src/pages/Home.tsx:27:10"` (file, line,
     column of its opening tag) and `data-ae-c="Home"` (the component it is written in).
     A component usage such as `<Button>` gets `data-ae-p` (the usage site), which reaches the
     DOM when the component forwards its props, as shadcn components do. Elements drawn inside
     a `.map` callback get `data-ae-i` with the item's index. The tags carry a source map and
     exist only in the preview.
   - **Bridge.** One script imported from the site's client entry that speaks the editor's
     existing `armature:*` protocol (hello/ready with a nonce, the element map with padding
     and margin boxes, hover, select, inline editing, rich-text commands, scroll, navigate,
     shortcuts) and adds `armature:engine:nodes` (the source reference behind every element)
     and `armature:engine:computed` (the selected element's computed style, for the Style
     tab). It activates only inside an iframe opened with `?armature=edit` by an allowed
     editor origin.
   - **Environment.** The site's `.env.example` says which public values the preview needs;
     Armature keeps them per site; a missing one is reported in plain words before anything
     starts. (Tree Test Prep commits its public Supabase values in `.env`, so nothing was
     needed.)
2. **Site detection** (`engine/runner/detect.ts`). The framework (Vite + React or TanStack
   Start), the package manager, the pages (from `src/routes/*.tsx` or the react-router
   `<Route>` tree, with private routes such as `/admin` flagged), whether Tailwind is loaded
   on each page (from which stylesheets the root layout and each route import), the stylesheet
   the plain-CSS fallback may write into, and the theme: Tailwind v4 `@theme` colours, fonts
   and breakpoints, a v3 `tailwind.config`, or, for plain-CSS sites, the `:root` variables.
3. **The AST engine** (`engine/ast/`). When an element is clicked, the server finds its JSX
   again from the tag and works out what can be edited:
   - **Words** are traced back to where they live: literal JSX children (editable in place,
     with bold, italic and links written as `<strong>`, `<em>`, `<a>`); a `const` in the same
     file; an item of a literal array rendered with `.map` (by index); a prop, followed to the
     usage that rendered the element (so a shadcn `<Button>Save</Button>` edits `Save` where it
     is written); and content hooks such as Tree Test Prep's `usePageCopy("home")`, followed
     into the hook and its `PAGE_DEFAULTS` table in another file. Anything that comes from a
     database or an API (`useQuery`, `fetch`, Supabase), from state, from a template or a
     computation, or from a prop that cannot be traced, is shown selected with a plain-English
     note ("This comes from live data", "This is controlled by code") instead of failing.
   - **Style** maps the Style tab's controls to Tailwind classes: the standard scale when a
     value matches it exactly (`p-4` for 16px), an arbitrary value otherwise (`pt-[23px]`),
     conflicting classes replaced with tailwind-merge, `cn()`/`clsx()` and template literals
     kept with their dynamic parts. Tailwind is mobile-first and the editor's devices are
     desktop-first, so a write on one device leaves the others as they were: desktop →
     `lg:`, tablet → `md:` (or `md:max-lg:` when nothing covers desktop), phone → the base
     class with the old value carried to `md:` (or `max-md:` when nothing covered it). When
     the site's own CSS sets the same property through a class the element carries, the
     important modifier is added so the change is visible. Sites that do not run Tailwind on
     the page (Tree Test Prep's public pages: Tailwind is installed but only the admin routes
     load it) take the **plain-CSS fallback**: the element gets a generated class `ae-xxxxxx`
     and the site's stylesheet gets one marked block at its end with the rule per device,
     using the site's own breakpoints read from its media queries. This is a first cut built
     so the proof could run; the fuller design is under "Plain-CSS sites" below.
   - **Pictures**: a new file goes into the folder the current picture lives in (`public/assets/`
     for a public path, `src/assets/` for an imported asset, keeping the import), the address
     and alt text are changed where they live (for Tree Test Prep, in `PAGE_DEFAULTS`).
   - **Structure**: reorder among siblings, move into another box in the same file, delete,
     duplicate, insert a heading, text, image, button, box or row as clean JSX (with Tailwind
     classes when the page runs Tailwind). Every operation returns the element's new line so
     it stays selected after the preview hot-reloads. Items drawn by a `.map` can have their
     words changed but are not moved individually; the note says so.
   - **Shared components**: an element in a file other than the page's component (the header,
     the footer, `NavLinks`) is marked shared, with the files that use it, and the inspector
     says the change applies everywhere it is used.
   - Files are parsed and printed with recast over Babel's parser, so only the touched lines
     change and the diff stays minimal. Every edit is one undo step (file snapshots); undo
     and redo write the files back and the preview hot-reloads.
4. **The editor** (`engine/editor/`) reuses the existing pieces: the top bar, the collapsible
   left panel, the canvas with the scaled iframe, the control library for the Style tab, the
   overlays' visual language (hover outline, selection, handle tab, drop line, padding and
   margin handles). It talks to the engine server over a small JSON API (`engine/shared/api.ts`).
5. **Publish** (`engine/publish/`). The changed files of the working copy go out as ONE commit
   through the same `ContentRepo` interface the edge functions use
   (`supabase/functions/_shared/githubRepo.ts`), so the non-forced ref update stays the last
   line of defence. If the branch moved since the editor opened, each changed file is merged
   three ways against the base commit and the head: separate changes merge automatically
   (reported as "rebased"), the same lines changed on both sides come back as a named conflict
   with keep mine / keep theirs. A readable unified diff comes back with the result. Tests use
   an in-memory GitHub; production would mint the installation token through the existing
   GitHub App path.

## The proof on Tree Test Prep (main)

RESULTS_TABLE

### Open times

TIMINGS

### Notes from the real site

NOTES

## Where the preview runners should live

The runner needs a place to clone a site, keep its `node_modules` between opens and run
`vite dev` for the length of an editing session, isolated per client. The full comparison
with cost arithmetic and sources is in `docs/code-engine/hosting-research.md` (checked
2026-09-24; vendor pages could not be fetched directly from this environment, so the
numbers come from search excerpts of the vendors' own pages and should be re-confirmed
before signing up). The assumptions: one 2 vCPU / 2 GB sandbox per site, about 1 GB
persisted, edited two hours a day on weekdays (48 billed hours a month).

| Option | Setup for Troy | Isolation | Egress control | Working copy kept? | Plan fee | 1 site | 20 sites | 100 sites |
|---|---|---|---|---|---|---|---|---|
| **Daytona** (recommended) | Paste one API key; Armature builds one snapshot | Container | Yes, per sandbox | Yes, disk kept on stop | None ($200 credit) | ~$6 | ~$132 | ~$662 |
| Fly Sprites (runner-up) | Paste one token | Firecracker microVM | Not confirmed | Yes, sub-second restore | None | ~$6 | ~$118 | ~$590 |
| E2B | Paste key + one template | Firecracker microVM | Yes | Pause/resume (beta) | $150/mo Pro needed for 2 h sessions | ~$156 | ~$278 | ~$800 |
| CodeSandbox SDK | Paste key + one template | Firecracker microVM | Not found | Snapshot kept 7 days, then reinstall | $170/mo Scale | ~$1–7 | ~$290 | ~$866 |
| Vercel Sandbox | Paste key (Pro) | Firecracker microVM | Not found | Yes | $20/mo | ~$27 | ~$164 | ~$741 |
| Railway, one shared runner | Click-deploy, but we build and operate the runner | None between sites | None | Yes (volume) | $5–20/mo | ~$29 | ~$66 | ~$222 |
| Fly Machines, DIY | Docker + orchestrator code | Firecracker microVM | DIY | Yes (volume) | None | ~$7 | ~$33 | ~$145 |

**Recommendation: Daytona.** It is the one managed option that meets all three needs at
once: no plan fee (the bill grows with the business, from about $6 a month at one site to
about $660 at a hundred, and the sign-up credit covers the first year at a handful of
sites), a persisted working copy so later opens take seconds with no reinstall, and a
per-sandbox firewall so a client's `npm install` cannot reach arbitrary hosts. Setup is:
sign up, copy the API key, paste it into Armature; Armature builds one base snapshot with
Node and bun. The trade-off is isolation: containers, not microVMs. For our threat model
(our own clients' repositories; the realistic risk is a bad npm dependency) the container
boundary plus the egress allowlist plus short-lived per-site GitHub tokens is adequate. The
free tier allows five sites editing at once; ask for tier 2 before about 15 clients.
**Runner-up: Fly Sprites**, the cheapest after its October price cut and a true microVM
with a persistent disk, also "paste one token"; it is second only because it is new and its
egress controls are unconfirmed. Both are "create from snapshot, run commands, expose a
port", so switching later is a small adapter. Self-hosting on Railway or Fly Machines is
cheaper on paper and paid for in orchestration code and on-call; the Railway shared runner
also puts every client's source in one container, which rules it out.

The runner's code already has the shape a sandbox needs: `openPreview()` is "clone, install,
start, report a URL" and the editor only ever talks to the engine server's JSON API, so the
production version is the same server with `openPreview()` running inside a Daytona sandbox
and the site's dev server reached through the sandbox's preview URL (with the sandbox's
firewall allowing GitHub, the npm registry and the site's own services).

## The plan: making this Armature's main engine

**What is reused as is.** The WordPress-style dashboard (Fleet, site overview, Pages, Media,
Contact, Appearance, Users, Site settings), authentication and roles, the GitHub App
connection and its publish path (`ContentRepo`, one commit, non-forced ref update, the
`publishes` history), change requests, the editor's chrome (top bar, left panel, canvas,
device toggle), the control library (Content / Style / Advanced), the overlay and handle
language, drafts (the undo history and the changed files become the draft; saved to
`builder_drafts` as a list of file edits, restored by replaying them onto a fresh working
copy), revisions (the publish history is the site's git history; preview a revision by
opening the working copy at that commit).

**What retires.** The site kit (`kit/`, `src/lib/armature-kit/` in sites), `content/layouts/*.json`
and the layout model, `content/site-kit.json`, the conversion of pages into builder JSON, the
`builder-publish` function's layout merge (replaced by the file-level three-way merge), the
kit's bridge (replaced by the injected one), and the "Site contract" a site had to follow.
The widget library becomes a snippet library: each widget is a JSX + Tailwind snippet
inserted into the page's file, styled afterwards like any other element.

**Sites already on the kit.** Tree Test Prep's `armature/git-content` branch keeps working
with the current editor until it is moved. Moving it means switching the site row's branch
to `main` and deleting the kit branch once the client is happy; the content edited on the kit
branch (`content/pages.json`) can be replayed into `PAGE_DEFAULTS` by a one-off script, since
both are key/value per section and field. No other site is on the kit yet, so the migration
is one site.

**Pages, Media, Appearance on top of the engine.**
- *Pages* come from the site's routes (`detectSite().pages`): the Pages table lists them with
  "Edit visually" opening the engine at that path; "Add page" writes a new route file from a
  template (`src/routes/<slug>.tsx` for TanStack Start, a new `<Route>` plus a page file for
  react-router) and a page component with a hero and a text block; SEO title and description
  edit the route's `head()` or `<title>`; delete removes the route file. Private routes
  (`/admin`, `/auth`, `/dashboard`) are listed as "needs sign-in" and not opened.
- *Media* comes from the site's asset folders (`public/`, `src/assets/`), listed with where each
  file is referenced (a text search over `src/`), uploads following the folder the picture
  being replaced lives in, and alt text edited where it is written.
- *Appearance* comes from the site's theme: Tailwind v4 `@theme` colours, fonts and
  breakpoints (edited in the CSS file), a v3 `tailwind.config` (edited as an object literal),
  or a plain-CSS site's `:root` variables. The Globals tab offers these as the site's colours
  and fonts; changing one edits the theme file so every reference on the site follows.
- *Header and footer* are whatever components appear on every page (detected as the shared
  components the root layout or every page renders); the Appearance screen opens them in the
  engine like any element, with the "applies everywhere" note.

**Plain-CSS sites.** Sites that style with their own classes instead of Tailwind (Tree Test
Prep's public pages are one) keep the fallback proven here, and the fuller version reads the
site's stylesheet as an AST (PostCSS): when the element's own class (`.hero-inner`) sets the
property, edit that rule in place, scoped to the device with the site's own breakpoints, so
no generated class is needed; when it does not, add a rule for the element's class; only an
element without a usable class gets the generated `ae-` class. Values keep the site's units.
The same reader gives the Appearance screen the site's colours and fonts from `:root`.

**Order of work.** (1) The production runner on Daytona with per-site env values and the
GitHub App token, and the engine server deployed next to it. (2) Drafts and revisions on top
of the working copy. (3) Pages, Media and Appearance from detection. (4) The snippet library
and the remaining Style controls (hover, shadows, backgrounds). (5) Move Tree Test Prep to
`main`, retire the kit and the layout model, and update `docs/SITE_CONTRACT.md` to "connect
the repository".
