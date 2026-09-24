# Adding a project

Every client site lives in its own GitHub repository. Armature drives it through the
**Claude GitHub App**, which the client (or their agency) installs on that repository
once. Netlify handles the hosting.

## 1. The GitHub App

Ask an owner of the GitHub organisation (or the client themselves for a personal
repository) to install the app at
<https://github.com/apps/claude/installations/select_target>. Give it access to the
one repository. That is the whole GitHub-side setup — no personal access tokens, no
webhooks, no additional secrets.

## 2. In Armature

Open **Projects → Add a site**, then **Connect a repository**. Fill in:

- **Site name** — what the client sees. You can change it later.
- **Repository** — `owner/repo` from GitHub.
- **Branch** — the branch every publish commits to. Almost always `main`.

Armature runs a connection check that reads a few files (`content/schema.json`,
`content/pages.json`) and confirms it can write. If a step fails, the check names it
and how to fix it.

## 3. Netlify

Point a Netlify site at the same repository and branch. That is the only Netlify
setup: from then on every commit Armature makes triggers a Netlify build, which
takes a minute or two.

## Hosting-only clients

If the client already has a site you look after but no repository connected yet,
choose **Add a hosting-only client** instead. You can add contact and billing
information now, then run the **Connect repository** check any time later.

## What if the connection check fails

- **The GitHub App is not installed on that repository.** Have the owner add it (see
  step 1).
- **The branch does not exist.** Check the spelling; the Armature form will read the
  branch back.
- **Content files are missing.** The site's code needs the Armature kit installed and
  `content/schema.json` + `content/pages.json` on the branch. See the next page
  ("Installing the Armature kit") for the site-side steps.
