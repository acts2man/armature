# SEO and Google Search Console

Every page has its own SEO tab in **Page settings** (search title, description,
canonical URL, noindex/nofollow, Open Graph and X/Twitter share fields,
structured data presets). Site-wide defaults live in **Site settings › SEO**
(site name, site URL, title pattern, default share picture, Google verification
code, LocalBusiness business details).

## What gets into the HTML

- **SSR sites** (TanStack Start, Next.js) use `computePageHead(layout, siteKit)`
  from the kit inside `head()` / `generateMetadata()`. The tags are in the HTML
  Google downloads.
- **SPA sites** get the tags applied by `ArmatureHead` on the client. Google can
  still read them (its crawler runs JavaScript), but the initial HTML has none —
  upgrade to SSR when the SEO matters.

`kit/README.md` shows the exact code per framework.

## Sitemap and robots.txt

Every publish rewrites `public/sitemap.xml` (every page that isn't marked
noindex) and `public/robots.txt` (with the `Sitemap:` line, plus any extra rules
from Site settings › SEO). No extra route or middleware is needed.

## Verifying with Google Search Console

You don't need any Google Cloud setup.

1. In Search Console (Settings → Ownership verification → HTML tag), copy the
   `content=""` value from the meta tag Google gives you.
2. Paste it into **Site settings › SEO › Google Search Console code**. Publish.
3. Google opens the site, sees the meta tag, and marks ownership verified.

## Submitting the sitemap

Once verified: Search Console → Sitemaps → add
`https://your-site.com/sitemap.xml`. From then on Armature keeps the sitemap in
step with every publish.
