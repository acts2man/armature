# Where each thing lives

Armature is deliberately split between two homes so a client site keeps working
even if Armature is unreachable.

## In the GitHub repository (with your code)

- **Content** — `content/pages.json` (short fields per section), `content/layouts/*.json`
  (whole page layouts built visually), `content/site-kit.json` (colours, fonts,
  breakpoints, menus, site-wide SEO).
- **Blog posts** — `content/posts/*.json` and the generated `content/posts/index.json`
  the site reads for the list. **(Coming in a later job.)**
- **Pictures and PDFs added long ago** — `public/assets/…`.
- **The Armature kit itself** — `src/lib/armature-kit/`, plus your `src/lib/armature.ts`.
- **sitemap.xml and robots.txt** — `public/sitemap.xml` and `public/robots.txt`,
  rewritten by every publish.

## In Supabase (the editing layer)

- **Sign-ins and roles** — agency staff, agency members, site members, invitations.
- **Change requests** — the messages clients send you for anything they cannot do
  themselves.
- **Drafts** — the in-progress work per person per site.
- **Templates** — saved sections and pages, per site or agency-wide.
- **Form submissions** — every message someone sent through a form widget.
- **Uploaded files** — the site-files bucket, one folder per client.

Visitor stats were removed on request; the design in `docs/BUILDER_SPEC.md`
stays for a possible later reintroduction. Sites that were wired for the old
beacon keep building without a code change (the kit accepts the option and
does nothing with it).

## Why it matters

- The **site** always renders straight from its GitHub repository and Netlify. It
  works whether or not Armature is reachable.
- The **dashboard** relies on Supabase. If Supabase is down, the site itself is
  fine; editors just can't sign in until it comes back.
