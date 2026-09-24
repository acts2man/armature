# Setting up Armature, step by step

This guide is written for someone who has never used a terminal. Every click is spelled out. Do the parts in order; each one takes ten to twenty minutes.

You will create accounts on three services, all of which have free tiers that are enough for a small agency:

- **Supabase** (supabase.com) holds the database, sign-in, and the small server programs ("edge functions") that talk to GitHub.
- **GitHub** (github.com) holds this dashboard's code and every client site's code. You create one "GitHub App" there; it is the key the dashboard uses to write to client sites.
- **Netlify** (netlify.com) hosts the dashboard itself.

Keep a notes file open while you work. You will be asked to copy a handful of values from one place to another, and this guide tells you each time.

**Never paste a secret into an email, a chat, or this repository.** Secrets go only into the places this guide names.

## Before you start

- You need this repository under your own GitHub account. If it is not there yet, open the repository page on GitHub, press **Fork** at the top right, and use your copy from now on.
- Sign up (or sign in) at supabase.com, github.com and netlify.com.

---

## Part A — Create the Supabase project and apply the migrations

### A1. Create the project

1. Go to https://supabase.com/dashboard and sign in.
2. Press **New project**.
3. Fill in: **Name** (for example "Armature"), a **Database password** (press **Generate a password**, then copy it into your notes; you may need it later), and a **Region** close to you.
4. Press **Create new project** and wait until the project page stops saying it is setting up (one to two minutes).

### A2. Copy the values you will need later

1. In the left sidebar, press the gear icon **Project Settings**, then **General**. Copy the **Project ID** (a run of lowercase letters, also called the *project ref*) into your notes as `PROJECT_REF`. It is also the part of your browser address after `/project/`.
2. Still in Project Settings, open **Data API** (on some dashboards it is called **API**). Copy the **Project URL** (it looks like `https://abcdefghijklmnop.supabase.co`) into your notes as `SUPABASE_URL`.
3. Open **API Keys** in the same settings area. Copy the key labelled **Publishable key** (it starts with `sb_publishable_`) into your notes as `PUBLISHABLE_KEY`. If your dashboard only shows a legacy **anon** key, that works too.
   Do **not** copy the secret or service-role key. The dashboard never needs it anywhere you can paste it; Supabase gives it to the edge functions automatically.

### A3. Apply the migrations, in order

A migration is a text file of database instructions. You paste each one into the SQL editor and run it once.

1. In GitHub, open your copy of this repository and navigate to the folder `supabase/migrations`.
2. Open `20260921000100_armature_core.sql`. Press the **Raw** button (top right of the file view). You now see plain text.
3. Select all (Ctrl+A on Windows, Cmd+A on Mac) and copy.
4. In Supabase, press **SQL Editor** in the left sidebar, then **New query** (or the **+** button).
5. Paste, then press **Run** (bottom right, or Ctrl/Cmd+Enter).
6. Wait for the message **Success. No rows returned**. If you see an error instead, read Part G below; the usual cause is running the same file twice.
7. Repeat steps 2 to 6 for `20260921000200_armature_storage.sql`, then `20260922000100_hosting_and_services.sql`, then `20260923000100_forms.sql`, then `20260923000200_page_builder.sql`, then `20260923000300_profiles_last_sign_in.sql`.

To confirm: press **Table Editor** in the left sidebar. You should see tables named `agencies`, `sites`, `publishes`, `change_requests` and a few more.

### A4. Tell Supabase where the dashboard lives

You will only know the dashboard's address after Part D. Come back and do this then:

1. **Authentication** in the left sidebar, then **URL Configuration**.
2. **Site URL**: your Netlify address, for example `https://acme-portal.netlify.app`.
3. **Redirect URLs**: press **Add URL** and enter your Netlify address followed by `/**`, for example `https://acme-portal.netlify.app/**`. Save.

Also, under **Authentication**, open **Sign In / Providers** (or **Providers**) and check **Email** is enabled. You can leave **Confirm email** switched on: people then receive an email to confirm their address the first time they create an account, and the "Email me a sign-in link" and "Forgot your password?" options also send email through Supabase. Invite links do not use email; you copy and send those yourself (Part F4).

---

## Part B — Create the GitHub App and store its secrets

The GitHub App is what lets the dashboard write to client sites. It has exactly one power: reading and writing repository contents. Nothing else.

### B1. Create the App

1. On github.com, press your profile picture (top right), then **Settings**.
2. In the left sidebar, scroll to the bottom and press **Developer settings**.
3. Press **GitHub Apps**, then **New GitHub App**.
4. Fill in the form:
   - **GitHub App name**: a name like `Acme Portal Publisher`. GitHub turns this into the App's *slug*: the same words in lowercase with hyphens (`acme-portal-publisher`). Write the slug in your notes as `APP_SLUG`. You can confirm it later: the App's public page is `https://github.com/apps/<slug>`.
   - **Homepage URL**: your Netlify address if you already have it, otherwise the address of this repository on GitHub. You can change it later.
   - **Callback URL**: leave empty. The dashboard does not use it.
   - **Setup URL**: your Netlify address followed by `/github/setup`, for example `https://acme-portal.netlify.app/github/setup`. If you do not have the Netlify address yet, leave it empty and come back after Part D (it is under the App's **General** settings). Tick **Redirect on update**. Without it, the "press Configure, then Save" recovery step in Part F1 does not bring you back to the dashboard.
   - **Webhook**: **untick Active**. The dashboard does not need webhooks.
   - **Permissions**, under **Repository permissions**: find **Contents** and choose **Read and write**. GitHub sets **Metadata** to **Read-only** on its own; that is required and cannot be turned off. Leave every other permission at **No access**.
   - **Where can this GitHub App be installed?**: choose **Any account**. This lets a client who keeps their site in their own GitHub organisation install the App there.
5. Press **Create GitHub App**.

### B2. Note the App ID and download the private key

1. You are now on the App's **General** page. Near the top it shows **App ID:** followed by a number. Write it in your notes as `APP_ID`.
2. Scroll down to **Private keys** and press **Generate a private key**. A file ending in `.pem` downloads. Keep it somewhere safe; treat it like a password. If you ever lose it, come back here, generate a new one, and repeat B3 with the new file.

### B3. Store the three secrets in Supabase

1. In Supabase, press **Edge Functions** in the left sidebar, then the **Secrets** tab. (If you cannot find it, it is also under **Project Settings → Edge Functions**.)
2. Add a secret with **Name** `GITHUB_APP_ID` and **Value** the App ID from B2. Save.
3. Add `GITHUB_APP_SLUG` with the slug from B1. Save.
4. Add `GITHUB_APP_PRIVATE_KEY`:
   - Open the downloaded `.pem` file in a plain text editor: **Notepad** on Windows (right-click the file, Open with, Notepad) or **TextEdit** on a Mac.
   - Select all, copy, and paste the whole thing into the **Value** box, including the `-----BEGIN RSA PRIVATE KEY-----` and `-----END RSA PRIVATE KEY-----` lines.
   - If the box only accepts a single line, or the key does not work later, paste the base64 form instead. On a Mac, open Terminal and run `base64 -i ~/Downloads/your-key.pem | tr -d '\n' | pbcopy` (adjust the file name), then paste. On Windows, open PowerShell and run `[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\Users\you\Downloads\your-key.pem")) | Set-Clipboard`, then paste. The dashboard accepts both forms.
   - Save.
5. Optional but recommended: add `APP_URL` with your Netlify address (no trailing slash). It is used to build invite links. Without it, the dashboard uses the address the request came from, which is normally the same thing.
6. Optional, for the page builder's Form widget: add `RESEND_API_KEY` (from https://resend.com/api-keys) so form entries are emailed, and `FORM_IP_SALT` (any long random text, for example from a password generator). Without the Resend key, entries are still saved in the dashboard; without the salt, one is derived from the service key.

Secrets only reach edge functions that were deployed **after** the secrets were saved. That is why Part B comes before Part C. If you change a secret later, redeploy the functions (Part C) afterwards.

---

## Part C — Deploy the edge functions

The edge functions are thirteen small programs in the folder `supabase/functions` of this repository. They must be uploaded to your Supabase project. There are two ways; the first needs no terminal.

### C1. The no-terminal way: a GitHub Action

This repository includes a workflow called **Deploy edge functions**. It needs two secrets stored in GitHub (not in Supabase).

1. Get a Supabase access token: go to https://supabase.com/dashboard/account/tokens, press **Generate new token**, give it a name like "GitHub deploys", press **Generate token**, and copy it. It is shown only once.
2. In GitHub, open your copy of this repository. Press **Settings** (the repository's own Settings tab, not your profile's), then in the left sidebar **Secrets and variables → Actions**.
3. Press **New repository secret**. **Name** `SUPABASE_ACCESS_TOKEN`, **Secret** the token from step 1. Press **Add secret**.
4. Press **New repository secret** again. **Name** `SUPABASE_PROJECT_REF`, **Secret** the `PROJECT_REF` from A2. Add it.
5. Press the repository's **Actions** tab. If GitHub asks you to enable workflows, press the green button to enable them.
6. In the left list press **Deploy edge functions**, then the **Run workflow** button on the right, then the green **Run workflow**.
7. A run appears in the list. Wait for it to finish (about two minutes). A green tick is not enough on its own: open the run and check that the step **Deploy every function** ran. If instead you see a yellow warning reading "Skipping the deploy: add the SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF repository secrets first", one of the two secret names in steps 3 and 4 is missing or mistyped; fix it and press **Run workflow** again. A red cross means the deploy itself failed: open the failed step and read the last lines (most often the token is wrong or expired).

From now on, every change to the functions that lands on the `main` branch deploys automatically.

To confirm: in Supabase press **Edge Functions**. You should see fourteen functions: `github-setup`, `site-connect`, `content-get`, `content-publish`, `content-publish-batch`, `builder-publish`, `site-diagnose`, `site-embed-check`, `invite-create`, `invite-accept`, `client-create`, `client-password-reset`, `password-set` and `form-submit`. `form-submit` is the only one that accepts callers who are not signed in (website visitors sending a form); `supabase/config.toml` turns off its sign-in check.

### C2. The terminal way (if you prefer)

1. Install Node.js (the **LTS** download at https://nodejs.org) and, on GitHub, download this repository (**Code → Download ZIP**) or clone it. Open a terminal in the repository folder.
2. `npx supabase login` opens a browser window; approve it. This lets the tool act as you.
3. `npx supabase link --project-ref PROJECT_REF` (use your value from A2) connects the folder to your project. It may ask for the database password from A1.
4. `npx supabase functions deploy --use-api` uploads all fourteen functions. The `--use-api` flag is needed because the functions share code with the rest of this repository (the `shared/` folder); it requires Supabase CLI 2.13.3 or newer, which `npx` fetches for you.

---

## Part D — Create the Netlify site for the dashboard

1. Go to https://app.netlify.com and sign in.
2. Press **Add new project** (on some accounts **Add new site**), then **Import an existing project**.
3. Choose **GitHub** and authorise Netlify if asked. Pick your copy of this repository.
4. On the settings page, the **Build command** should read `npm run build` and the **Publish directory** `dist`. Both come from the file `netlify.toml` in the repository, so they are normally filled in already. Leave the rest as it is and press **Deploy**.
5. Wait for the first deploy to finish. Netlify gives the site an address like `https://random-words-123456.netlify.app`. To choose a nicer one: **Project configuration → General → Site details → Change site name**. Write the final address in your notes as `DASHBOARD_URL`.
6. Now add the two variables the dashboard needs. Press **Project configuration** in the left sidebar, then **Environment variables**, then **Add a variable → Add a single variable**:
   - **Key** `VITE_SUPABASE_URL`, **Value** your `SUPABASE_URL` from A2. Leave **Scopes** as **All scopes** and **Deploy contexts** as **Same value for all deploy contexts**. Press **Create variable**.
   - Repeat with **Key** `VITE_SUPABASE_PUBLISHABLE_KEY` and the `PUBLISHABLE_KEY` from A2.
   These two are the only variables the dashboard takes. Never add the GitHub App values or any Supabase secret key here: anything in Netlify's variables that starts with `VITE_` is compiled into the public web page.
7. Variables only reach a build made after they were saved, so redeploy: press **Deploys** in the left sidebar, then **Trigger deploy → Deploy project** (or **Deploy site**). Wait for **Published**.
8. Open `DASHBOARD_URL` in your browser. You should see a sign-in page. If instead you see a message naming a missing variable, check step 6 for typos and redeploy.

Now go back and finish the two places that needed this address:

- Supabase: Part A4 (Site URL and Redirect URLs).
- GitHub: Part B1's **Setup URL** (`DASHBOARD_URL/github/setup`) if you left it empty. On github.com: profile picture → Settings → Developer settings → GitHub Apps → your App → **General** → **Setup URL** → Save changes.

---

## Part E — Create the first agency owner account

1. Open `DASHBOARD_URL/signin`.
2. Press **Create an account instead**, enter your email address, type a password of at least 6 characters under **Choose a password**, and press **Create account**. You should see **Check your inbox to confirm your email address**.
3. Open the confirmation email from Supabase and press the link in it. It brings you back to the dashboard, already signed in. (If you land on the sign-in page instead, sign in with the same email and password.)
4. The dashboard says **Your account does not have access to any site yet**. That is expected: nobody has told the database that you are an agency owner.
5. In Supabase press **SQL Editor**, then **New query**, and paste this line, replacing the three values with your own (keep the quotes):

   ```sql
   select public.bootstrap_agency('Acme Web Studio', 'you@example.com', 'Acme Client Portal');
   ```

   The first value is your agency's name. The second must be **exactly** the email address you signed up with. The third is the portal name your clients will see at the top of every page (if you leave it out, the agency name is used).

6. Press **Run**. The result is one long id. That is your agency.
7. Reload the dashboard. You now land on **Projects**, and **Settings** in the sidebar lets you set the portal name, logo and accent colour.

If step 6 says "No account with the email …", the address you typed does not match the one you signed up with (check for typos; capital letters do not matter), or you have not yet pressed **Create account** in step 2.

---

## Part F — Connect the first site

The site's developer must first make the repository follow the site contract: `content/schema.json`, `content/pages.json` and a `public/assets/uploads/` folder, as described in [SITE_CONTRACT.md](SITE_CONTRACT.md). Ask them to confirm that is done and tell you the repository (for example `acme-org/acme-site`) and the branch the site deploys from (usually `main`).

### F1. Install the GitHub App on the site's repository

1. In the dashboard, press **Projects**, then **Add a site**.
2. Press **Install the GitHub App**. GitHub opens.
3. If you belong to several GitHub accounts or organisations, GitHub asks where to install. Choose the account that **owns the site's repository** (the person doing this step must be signed in to the dashboard as agency staff AND have the right to install apps on that GitHub organisation, normally as one of its owners. If you are a member but not an owner, GitHub records an install *request* and the dashboard says it is waiting for an owner to approve it; once they have, start again from **Add a site**. A client account cannot do this step: the dashboard only links installations for agency staff.)
4. Choose **Only select repositories**, pick the site's repository, and press **Install**.
5. GitHub sends you back to the dashboard's `/github/setup` page, which shows **GitHub account … is linked**. Press **Add a site**.

If GitHub did *not* send you back (the App's Setup URL was empty at the time), go to GitHub → your profile picture → Settings → **Applications** → **Installed GitHub Apps** → your App → **Configure**, and press **Save**: GitHub then redirects you to the dashboard and the installation gets linked.

### F2. Check and connect

1. On **Add a site**, under **Which repository?**: in **Repository** paste the repository as `owner/name` or its full GitHub address; in **Branch** enter the branch (it is already `main`); in **Site name** enter the name your client will recognise (leave it blank to use the repository name); in **Live URL (optional)** enter the site's live address, which must start with `https://` (it is used for the **View live page** links).
2. Press **Check and connect**.
3. A checklist appears. Each line is a tick, a cross, or a dashed circle. A cross has the fix written under it; dashed lines were not checked because a line above them failed, so fix the first cross and press **Check and connect** again. When all lines are ticks, the site is created and **Open the site** appears.

### F3. Try an edit

1. Open the site, press **Pages**, and choose a page.
2. Change one field. It gets a **Changed** tag and the bar at the top counts one unpublished change.
3. Press **Publish changes**. Within a few seconds you get **Published. Your changes will be live in about 2 minutes** and a **View the commit** link (a commit is one saved change in the repository's history on GitHub). Open it: you will see the change in `content/pages.json`.
4. The site's own host (the client site's Netlify, not the dashboard's) rebuilds. Reload the live site after a minute or two.
5. Change the field back and publish again, so the site is as it was.

### F4. Invite the client

1. Open the site and press **Team**.
2. Enter the client's email address, choose a role (**Client owner** or **Client editor**, both can edit and publish), and press **Create invite**.
3. The dashboard shows an invite link with a **Copy link** button. Email sending is not set up in this version, so copy the link and send it to the client yourself. It expires after seven days.
4. The client opens the link, creates an account **with that same email address** (or signs in if they already have one), and sees **You now have access**; pressing **Open your site** takes them to it. They see your portal name, logo and colour, and never the word Armature.

### F5. Giving a client their login (instead of an invite)

If you would rather set up the client's account yourself and hand them a ready-made login, you can. The client never has to create an account or open a link.

1. Open the site, press **Team**, and press **Create client login** (next to **Create invite**).
2. Fill in the client's **Name** and **Email**, check the **Site** (the current site is already chosen; you can pick another of your sites), and choose a **Role** (**Client owner** or **Client editor**, both can edit and publish).
3. Under **Temporary password** press **Generate**: the dashboard makes a strong password of 14 letters, numbers and symbols and shows it. You can type your own instead, as long as it is at least 10 characters and is not the word "password", the client's email address, or one character repeated. **Show** / **Hide** toggles whether it is visible.
4. Press **Create login**. A green card shows the sign-in link, the email and the temporary password, and a ready-to-send message. Press **Copy login details** and paste it into an email or text message to the client. **The password is not shown again** once you leave this page, so send it before you dismiss the card. (Nothing is emailed by the dashboard; you deliver the details yourself.)
5. The client opens the sign-in link, signs in with the email and temporary password, and is taken straight to **Choose your password**. They cannot open any other screen until they have chosen their own password; after that they use it from then on. They see your portal name and never the word Armature.

If the email address already has an account (for example a client who edits another of your sites), the dashboard does not change their password: it only gives them access to this site, and the card says **Their existing password still applies**. They sign in as before; if they have forgotten their password, **Forgot your password?** on the sign-in page emails them a reset link.

---

### F6. Hosting-only clients, and what you charge

Some clients you only host, or you look after their domain and email, and their site is not edited here. You can still keep them under Projects.

1. Press **Projects**, then **Add a site**, then **Add a hosting-only client**. Enter the site name and its live address and press **Add client**. The site appears under Projects with the status **Hosting only**; there are no pages to edit until a repository is connected, and the dashboard says so wherever a page would be.
2. On any site's overview, the **Hosting & services** panel records what you charge: hosting (provider, yearly fee, start and renewal dates), the domain (name, registrar, who owns the account, fee and renewal), email (provider, number of mailboxes, a flat yearly amount or a price per mailbox, who manages it), automatic emails (the provider the website sends form notifications through, and the address they come from), the date the client accepted your agreement, and notes. Press **Edit**, type amounts in dollars, and watch the yearly total update as you go, for example "$200 hosting + 4 mailboxes × $30 = $320 / year".
3. Projects totals it up: **Yearly billing** across every site, **Renewals, next 30 days**, and per site the yearly total and the next renewal, marked amber when it is within 30 days and red when it has passed. Sort the table by name, yearly total or next renewal, or search it.
4. When a hosting-only client's site is ready to be edited here, open it and press **Connect repository**. The same checklist runs as for a new site, and the site keeps its name, services and members.

Clients never see this panel or any price: the database refuses them access to it outright.

The migration for this is `supabase/migrations/20260922000100_hosting_and_services.sql`; apply it in the SQL editor like the others (Part A3) before using these screens.

---

## Part F7 — Turn on visual editing for a site

The visual editor (from **Pages**) shows the live website inside the dashboard. A site supports it once its developer has done two things, described in full in [SITE_CONTRACT.md](SITE_CONTRACT.md) under "Site contract v1.1":

1. Copied `bridge/armature-bridge.ts` from this repository into the site and read every editable value through it, with the dashboard's address in `allowedOrigins` (for example `https://armature-sites.netlify.app`, exactly as it appears in the browser, no trailing slash).
2. Made the site allow the dashboard to frame it: no `X-Frame-Options`, and a `Content-Security-Policy` header with `frame-ancestors 'self' https://armature-sites.netlify.app`.

Then open the site in the dashboard, press **Pages** and choose a page (Pages is the one way into the editor). If the editor says "This site isn't set up for visual editing yet", the site has no bridge or the wrong origin in its allowlist; if it says the site refuses to be shown, it prints the exact header to add. Either way the page editor keeps working. A site that never adds the bridge simply keeps the form editor.

For the page builder (dragging widgets, styling, new pages), the site copies the `kit/` folder instead of the single bridge file and follows "Site contract v2" in [SITE_CONTRACT.md](SITE_CONTRACT.md). A site still on the bridge shows agency staff the note "This site uses an older kit version" inside the editor, with the steps.

### F8. Forms on a site

A site built with the page builder can carry Form widgets. Entries go to the `form-submit` function, which checks them against the form as published in the site's repository, rate limits each visitor, stores them and emails them.

1. Apply `20260923000100_forms.sql` (Part A3) and deploy the functions (Part C).
2. In the site's code, pass the function's address and the site's id to the kit: `createArmatureKit({ ..., forms: { endpoint: "https://PROJECT_REF.supabase.co/functions/v1/form-submit", siteId: "<the site's id from the dashboard address>" } })` (SITE_CONTRACT.md, "Forms").
3. To have entries emailed: set `RESEND_API_KEY` (Part B3, step 6), then on the site's **Hosting & services** set the automatic-email provider to Resend, a sender address on a domain verified in Resend, and the addresses entries go to (up to ten; stored as `site_services.form_recipients`).

Entries are kept in the `form_submissions` table: agency staff and the site's clients can read them; nobody can add one except the function. The visitor's IP address is never stored, only a salted hash used for the rate limits.

### F9. The page builder: who may do what

1. Apply `20260923000200_page_builder.sql` (Part A3) and deploy the functions (Part C), so `builder-publish` exists. It publishes layouts, site settings and pictures as one commit.
2. Install the kit on the site (SITE_CONTRACT.md, "Upgrading a v1.1 site to the kit").
3. On the site's overview, **Client editing** sets what the site's clients may do in the editor: **Words and pictures** (the default: the same editing as before), **Words, pictures and styling** (colours, fonts, spacing and site settings, but nothing added, moved or removed), or **The full page builder** (new pages and elements too). Agency staff always get the full builder. The publish function checks the level again, so a client cannot get around it.
4. To keep an element exactly as it is for clients, right-click it in the editor and choose **Lock for clients**: its words stay editable, its place and design do not. The HTML embed widget is agency-only.

Drafts are saved in the browser and to the person's account (`builder_drafts`) as they work, so they follow them to another computer. Saved sections and pages live in `builder_templates`, per site or for every site of the agency.

## Part G — If something goes wrong

**Running a migration says "already exists".** You ran the file before. Nothing is broken; move on to the next file.

**The sign-in page says "This dashboard is not connected to a Supabase project yet" and names a missing variable.** Part D step 6: check the variable names exactly, then Trigger deploy again.

**"The … function is not deployed to this Supabase project."** Part C has not run, or it failed. Check the Actions tab for a red run, or Supabase → Edge Functions for the thirteen names.

**After signing in: "Your account does not have access to any site yet."** For the agency owner: Part E step 5 was not run, or used a different email. For a client: either they have not opened the invite link while signed in (the link is what adds them: send it again and ask them to open it), or they signed in with an email that is not the one the invite was sent to; they should sign out and use the invited address, or you send a new invite to the address they use.

**"This invite was sent to …, but you are signed in as …".** Same cause as above. Press **Sign out and use a different email** on that page, then sign in (or create an account) with the invited address; the invite is accepted automatically.

**A client with a login you created says they are "stuck on Choose your password".** That screen is expected the first time; they need to type a new password twice (at least 10 characters, not the word "password", not their email address) and press **Save password and continue**. If the screen comes back after that, ask them to sign out and sign in again with the new password. If you need to start over, create the login again with a fresh temporary password: because the account already exists, the dashboard will not change their password, so instead ask them to use **Forgot your password?** on the sign-in page.

**"Create client login" says the site does not belong to your agency, or that only agency staff can do this.** You are signed in with an account that is not owner or staff of the agency that owns the site. Sign in with your agency account (the one from Part E).

**Confirmation or sign-in-link emails point at localhost.** Part A4: the Site URL in Supabase is still the default. Set it to `DASHBOARD_URL` and add the redirect URL.

**Check connection / Add a site: what each red line means**

| Line | What to do |
| --- | --- |
| You are signed in | Sign out and in again. If it keeps failing, the two Netlify variables from Part D step 6 point at the wrong Supabase project. |
| Your account can edit this site | Ask the agency to invite you to this site (Team). |
| GitHub App secrets reached this function | Part B3: add the missing secret named in the message, then redeploy the functions (Part C). |
| The App's private key can be read | The key was pasted incompletely or from the wrong file. Generate a new key (B2) and paste the whole `.pem` file (B3), then redeploy. |
| The App is installed on owner/name | Part F1: install the App on the account that owns the repository and include this repository. Check the owner and name for typos; they are case-sensitive. |
| That installation is linked to your agency | Part F1 step 5: the installation was never linked. Open the App on GitHub → Configure → Save so it redirects to the dashboard, or start again from Add a site → Install the GitHub App. |
| GitHub issued an access token for the repository | The repository is not included in the installation, or the App lost its Contents permission. On GitHub open the App's installation (Settings → Applications → Installed GitHub Apps → Configure) and add the repository; approve any new permissions GitHub asks for. |
| The App can write to the repository | Part B1: Contents must be **Read and write**. Change it under the App's Permissions & events, save, then approve the new permission on the installation. |
| The branch "…" exists | The branch name is wrong. It is case-sensitive; `main` is the usual value. |
| content/schema.json is present and valid | The site's developer needs to add or fix the file (SITE_CONTRACT.md). The message names the exact problem. |
| content/pages.json is present and valid | Same: every field in the schema needs a value of the right shape. The message names the first few problems. |

**The Publish button is grey.** Look at the line at the top of the editor. "Connecting to GitHub…" means wait a few seconds. "Not connected to GitHub" comes with an amber box that says why; press **Check connection**. If everything is green and Publish is still grey, you have no unpublished changes: change a field and it lights up.

**"Someone else changed this field (or these fields) while you were editing …"** Two people edited the same field; the notice **Nothing was published** lists which ones. Press **Reload and keep my changes** to load their version with your edits still in place and decide field by field, or **Discard my changes and reload** to drop yours.

**Changing the dashboard's address later** (for example a custom domain): update Netlify (Domain management), Supabase (Part A4), the GitHub App's Setup URL (Part B1) and the optional `APP_URL` secret (Part B3, then redeploy the functions).
