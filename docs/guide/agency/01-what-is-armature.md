# What Armature is

Armature is a website-editing dashboard your agency runs for its clients. You build a
site once (the code lives on GitHub, the site is hosted on Netlify), then hand the
client a link they can sign in to and edit their own words, pictures, blog posts and
settings — with no more code changes from you.

## The three pieces

- **Your site's GitHub repository** holds every page, layout, picture and file the
  visitor sees. Every publish from Armature is one commit against that repo.
- **Netlify** hosts the built site. Each push to the main branch triggers a build; a
  publish therefore reaches the live site in about two minutes.
- **Armature** (this dashboard, and the Supabase project behind it) is the editing
  layer: logins, drafts, invitations, messages from forms, uploaded files, publish
  history and site statistics.

## Why this shape

- Every visible change is a normal Git commit, so nothing is ever "lost in a CMS".
- Nothing else runs on the site itself, so there is no plugin to update, no admin
  URL to attack.
- Clients edit in a WordPress-style dashboard, so they don't need to know Git or
  React.

## What a client sees

Clients never see the word Armature. They sign in to a portal named after your
agency, with your accent colour and logo. From there they edit their pages, read
messages sent through their site's forms, and ask you for anything they cannot do
themselves ("Change requests").
