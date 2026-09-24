# Storage and what counts against Supabase's included amounts

Armature stores things in three places, each with its own limits.

## The site's GitHub repository

- **Code and content** — free, up to GitHub's ordinary repo limits.
- **Pictures in `public/assets/`** — every commit adds to the repo's history.
  For very large sites (thousands of uncompressed pictures) prefer the
  Supabase site-files bucket below.

## The Supabase site-files bucket (per client)

- **One folder per client** at `<agency_id>/<site_id>/…`.
- **Pictures and documents up to 20 MB each.** Videos are refused — use YouTube,
  Vimeo or Wistia with the Video widget.
- Uploads are served straight from Supabase's CDN with a long Cache-Control, so
  visitors on the same file rarely hit Supabase again.
- **Supabase Pro's included Storage** is 100 GB. The **Media library shows the
  storage each site uses** and the total across the agency, so you can spot a
  runaway site. Image transformations are OFF (they cost extra and no client
  site so far needs them).

## The Supabase database

Everything else — logins, drafts, templates, messages from forms, publish
history — lives in the database. This is far smaller than files, so Pro's
included 8 GB is comfortable for many agencies. **Sitemap/robots and blog
indexes are not stored here** (they live in the site's repository).

## Egress (bandwidth)

The site's own bandwidth is Netlify's; the Media library's storage bucket is
Supabase's. Supabase Pro includes 250 GB of egress. Keep the largest pictures
under 500 KB (WebP; the Media library resizes to 2000px automatically on upload
from the editor) and you'll stay well under.
