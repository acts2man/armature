# Troubleshooting

## "Can't connect to your site" in the editor

- **The site kit isn't installed.** Check step 1 of "Installing the Armature
  kit". The site needs `src/lib/armature-kit/` and a `src/lib/armature.ts`
  that calls `createArmatureKit` with the dashboard's origin in
  `allowedOrigins`.
- **The site sends a strict Content-Security-Policy.** The site needs
  `Content-Security-Policy: frame-ancestors 'self' https://armature-sites.netlify.app`
  (or your dashboard's exact origin) so the editor may embed it. See
  `kit/README.md` step 5.
- **The kit is out of date.** Bump `KIT_VERSION` by copying `kit/` from this
  repository over `src/lib/armature-kit/`. The editor tells you the current and
  required versions in the connection message.

## "The editor won't load"

The dashboard shows a skeleton of the editor's layout with "Connecting to your
site…" for up to ten seconds. If it never resolves, open the developer console
on the site (right-click → Inspect) and look for a message starting with
`Armature: ` — it names what could not be read.

## "Publish conflict"

Someone else published something on the same page while your draft was open.
Armature merges what it can automatically. When both sides changed the same
element, the publish dialog names the element and asks you to keep yours or
theirs — everything else in your draft is kept either way.

## "The site is not updating"

- **Check Publish history** — did the publish actually commit? The commit link
  opens the exact commit on GitHub.
- **Check Netlify** — the site rebuilds on every commit; a failing build shows
  up in Netlify's Deploys list. Fix the underlying issue (usually a broken
  build, not an Armature problem) and Netlify tries again on the next commit.
- **Check the URL** — your browser may be showing a cached version. Hard-refresh
  (Ctrl+Shift+R / Cmd+Shift+R) or open the page in a private window.

## "A picture doesn't show up on the live site"

- If it's in `public/assets/`, the Netlify build must have finished (see above).
- If it's in the site-files bucket, the URL is public and CDN-cached; if you
  replaced the file with the same name, the old cached copy might still show for
  a while.

## "I can't reset a client's password"

- The **Reset password** button on the Clients screen only works for people who
  are members of a site your agency looks after. It's disabled otherwise.
- If email is on (Resend) but the reset email never arrives, run **Send test
  email** on Settings → Email sending; the outcome names the reason.
