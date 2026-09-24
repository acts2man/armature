/**
 * The seven-section Getting Started guide, in plain English.
 *
 * The same data drives the page under /getting-started and the tests that check
 * we have 7 sections, screenshot slugs and known section keys. Keeping every
 * piece of copy here means an agency (or Troy) can rewrite a paragraph without
 * touching the React file.
 *
 * Screenshots are stored as SVG placeholders under public/guide-screenshots/ so
 * each step has an image out of the box; an agency can replace the .svg with a
 * real .png or .jpg later. Videos are stored under public/guide-videos/<key>.webm
 * and produced by scripts/record-guide-videos.mjs.
 */

/** The seven known section keys. Server rejects any other key. */
export const SECTION_KEYS = [
  "agency-setup",
  "add-site",
  "set-up-site",
  "give-access",
  "editing-publishing",
  "keep-updated",
  "troubleshoot",
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

export type Step = {
  /** The action the reader takes, in plain English. */
  text: string;
  /** Slug of the screenshot for this step; served at /guide-screenshots/<slug>.svg. */
  screenshot: string;
  /** What the screenshot shows (also used as the image's alt text). */
  caption: string;
};

export type Section = {
  key: SectionKey;
  title: string;
  /** One paragraph, rendered italic: why the reader is doing this at all. */
  what: string;
  steps: Step[];
  /** What it costs, when there is money involved. Sections 3, 5 and 6. */
  cost?: string;
  /** One paragraph on what to do when the section's most-common problem hits. */
  troubleshoot: string;
  video: {
    /** Short line the fallback UI shows when no .webm is present. */
    placeholder: string;
    /** What the walkthrough shows on screen, described for people who cannot watch it. */
    captions: string;
  };
};

export const GETTING_STARTED_SECTIONS: readonly Section[] = [
  {
    key: "agency-setup",
    title: "1. One-time agency setup",
    what:
      "Do this once, then every future site takes minutes. You'll create the GitHub App the dashboard uses to write to client sites, note your Netlify team, and (if you want it) turn on branded email so invites go out under your agency's name.",
    steps: [
      {
        text:
          "Create the GitHub App. On GitHub, click your profile picture, then Settings, then Developer settings, then GitHub Apps, then New GitHub App. Give it a short name (clients see this), paste your dashboard's address as Homepage URL, then paste the same address followed by /github/setup as the Setup URL. Tick the box called \"Redirect on update.\" Under Repository permissions, set Contents to Read and write.",
        screenshot: "01-agency-setup-create-app",
        caption: "The GitHub 'New GitHub App' form filled in, with Homepage URL, Setup URL and Contents = Read and write highlighted.",
      },
      {
        text:
          "Choose who can install the App. On the same form, pick 'Any account' so a client's own GitHub organisation can install it there. Save the App, then click 'Install App' and install it on your own organisation to start.",
        screenshot: "01-agency-setup-install-choice",
        caption: "'Any account' and 'Install App' shown on the App's settings page.",
      },
      {
        text:
          "Pick 'All repositories' or 'Only select repositories.' 'All repositories' means every repo on your organisation shows up in Add a site's dropdown from now on — nothing to click each time. 'Only select repositories' means you (or a repo owner) has to tick each repository under GitHub's Configure page before it appears. Both work; the choice is about how much you trust the App and how many client repos live on the same organisation.",
        screenshot: "01-agency-setup-repo-access",
        caption: "GitHub's 'All repositories' vs 'Only select repositories' choice with a short note under each.",
      },
      {
        text:
          "Change repository access later. Click your GitHub profile picture, then Settings, then Applications, then Installed GitHub Apps. Find your App in the list, click Configure, and change 'Repository access' at the top of that page.",
        screenshot: "01-agency-setup-change-access",
        caption: "GitHub's 'Installed GitHub Apps' list with Configure highlighted, then Repository access at the top of the Configure page.",
      },
      {
        text:
          "Connect Netlify. Sign in at netlify.com and note your team name (top-left of the dashboard). You will connect each client site's repository to Netlify separately from the site's dashboard; nothing to click here right now.",
        screenshot: "01-agency-setup-netlify",
        caption: "The Netlify dashboard with the team switcher highlighted in the top-left.",
      },
      {
        text:
          "Optional: turn on branded email. Create a free Resend account at resend.com and verify a domain you own. Copy your Resend API key and paste it in Supabase under Edge Functions, then Secrets, as RESEND_API_KEY. Everything Armature does still works without it — invites just show you the link to copy and send by hand.",
        screenshot: "01-agency-setup-email",
        caption: "Resend's API key page, and Supabase Edge Functions Secrets with RESEND_API_KEY set.",
      },
    ],
    cost:
      "Free: GitHub Apps and Netlify's starter tier cost nothing. Resend has a free tier of 3,000 emails a month and one verified domain.",
    troubleshoot:
      "GitHub didn't bring you back after Install. This happens when 'Redirect on update' is off or the Setup URL is blank. Click your profile picture, then Settings, then Applications, then Installed GitHub Apps, click your App's Configure button, then press Save at the bottom — GitHub will redirect back to your dashboard's Setup URL right away and the App will show as installed.",
    video: {
      placeholder: "The GitHub App from empty to installed, then Netlify, then optional email.",
      captions:
        "GitHub App name, Setup URL, permissions, Redirect on update, All repositories vs Only select repositories, where to change repo access later, Netlify sign-in and team, and turning on Resend for branded email.",
    },
  },
  {
    key: "add-site",
    title: "2. Connect a new client site",
    what:
      "Once the GitHub App is installed, adding a client's site takes about two minutes. The dashboard checks the repository, fills in the branch and saves the site so you (and the client, once invited) can start editing.",
    steps: [
      {
        text:
          "Open Projects (in the left-hand sidebar). Press 'Add a site'. Step 1 shows a green 'Connected to <your organisation>' when the GitHub App is already linked.",
        screenshot: "02-add-site-start",
        caption: "Projects with the 'Add a site' button, and step 1 showing a linked GitHub account.",
      },
      {
        text:
          "Pick the client's repository. Step 2 shows a dropdown of every repository the GitHub App can see. Pick the client's, or type owner/name if you know it. The branch fills in from the repository's default (usually 'main').",
        screenshot: "02-add-site-repo",
        caption: "The repository dropdown open, with a repository picked and the branch autofilled to 'main'.",
      },
      {
        text:
          "Press 'Check and connect'. Each check turns green when it passes, or amber when it does not. Amber next to 'Armature files' just means the site has not been set up yet — the next section fixes that.",
        screenshot: "02-add-site-check",
        caption: "The green-and-amber checklist after Check and connect: repository green, files amber.",
      },
      {
        text:
          "Read the outcome. A site whose files are missing lands as 'Needs setup' — nothing is broken, it just has not been set up yet. Open the site's Dashboard and follow Section 3.",
        screenshot: "02-add-site-needs-setup",
        caption: "The Projects list with a new site showing the Needs setup pill.",
      },
    ],
    troubleshoot:
      "The repo is not in the dropdown. The GitHub App does not have access to it yet. Click the 'Don't see it?' link on the Add a site page — it opens the App's Configure page on GitHub. Tick the missing repositories under Repository access, press Save, and come back. The dropdown picks them up on the next load.",
    video: {
      placeholder: "Add a site in about a minute, from Add a site to Needs setup.",
      captions:
        "The linked-account row, the repository dropdown, the branch autofill, the check-and-connect checklist and a Needs setup outcome.",
    },
  },
  {
    key: "set-up-site",
    title: "3. Set up the site with the 'Set up this site' prompt",
    what:
      "One-time per site. Claude Code writes the Armature files (schema, pages, kit) directly on the site's connected branch. There is no test branch: before it pushes, Claude builds the site as it is today, takes screenshots of every page, does the setup, takes screenshots again, and compares them page-by-page (pixels, visible text, links, image alts and head tags). Nothing gets pushed unless every page matches. If anything goes wrong once it lands, Site settings → Undo setup restores the pre-setup state as one revert commit.",
    steps: [
      {
        text:
          "Open the site with the Needs setup pill. Its Dashboard shows a 'Set up this site' card with a ready-to-paste prompt.",
        screenshot: "03-setup-card",
        caption: "The site Dashboard with the 'Set up this site' card and its Copy prompt button.",
      },
      {
        text:
          "Press 'Copy prompt'. Then open Claude Code on the web, pick this same repository, and paste. Claude works directly on the connected branch and takes BEFORE screenshots of every page before it changes anything.",
        screenshot: "03-setup-claude-code",
        caption: "The Claude Code screen with the pasted prompt; the terminal below shows the BEFORE screenshots being captured page by page.",
      },
      {
        text:
          "Claude does the setup, rebuilds, and takes AFTER screenshots. It compares them: no more than 0.5% pixel difference per page, and the visible text, links, image alt attributes and head tags must match exactly. Only when every page passes does it push.",
        screenshot: "03-setup-verify",
        caption: "The BEFORE / AFTER comparison in Claude Code's terminal, page by page.",
      },
      {
        text:
          "Once Claude pushes and Netlify rebuilds, Armature reads the new data-armature-kit attribute on the site's HTML and flips the site from Needs setup to Connected on its own — no button to press. If anything looks wrong, open Site settings → Undo setup to restore the pre-setup state as one revert commit.",
        screenshot: "03-setup-connected",
        caption: "The Kit card on Site settings turning green as the site flips from Needs setup to Connected, with Undo setup right below.",
      },
    ],
    cost:
      "One Netlify build per push. Netlify's Starter and free plans include a fixed number of build minutes each month; paid plans include unlimited builds. The BEFORE / AFTER screenshots run locally on the machine running Claude Code — no Netlify build is used for them.",
    troubleshoot:
      "Claude stopped without pushing and said a page didn't match. That's working as intended. Read the diff line it printed (the pixel difference percentage, or the first line of the text / link / alt / head diff), tell Claude what to fix (usually a still-coded section wrapper that changed a class, or a head tag the kit hasn't been asked to render yet), and re-run the prompt. Something looks wrong on the live site after Claude pushed. Open Site settings → Undo setup: one confirmation and Armature commits the pre-setup files back to the connected branch as a single revert. Netlify rebuilds once and the live site is back to how it was.",
    video: {
      placeholder: "Set up a site with Claude Code, direct-to-connected-branch with BEFORE / AFTER verification.",
      captions:
        "Copy prompt, paste into Claude Code, watch BEFORE screenshots capture every page, the setup run, AFTER screenshots capture the same pages, the comparison pass and the push land.",
    },
  },
  {
    key: "give-access",
    title: "4. Give the client access",
    what:
      "Turn a site over to the person who will edit it. You choose how much they can change (words, styles, or the full builder), and 'View as client' lets you see the site's Dashboard exactly as they will — safer than signing in with their account.",
    steps: [
      {
        text:
          "Open the site, then Users. Press 'Invite user'. Paste the client's email and pick their editing level.",
        screenshot: "04-access-invite",
        caption: "The Users page with the Invite user dialog open and an email typed in.",
      },
      {
        text:
          "Explain the three editing levels. 'Words only' means the client can change text on existing pages and swap pictures, and nothing else. 'Words + styles' adds colour, fonts and spacing. 'Full builder' lets them drag widgets and build new pages. Set this under Site settings then Editing at any time.",
        screenshot: "04-access-editing-level",
        caption: "Site settings > Editing showing the three radio-button levels with a short line each.",
      },
      {
        text:
          "Send the invite link. Armature shows a copyable link (and, if you have Resend on from Section 1, it emails the client too). Send it however you like — email, text, chat. When the client opens the link, sets a password, and signs in, they land on the site's Dashboard.",
        screenshot: "04-access-invite-link",
        caption: "The invite success card with a copyable link and 'Email sent' or 'Copy to send yourself' state.",
      },
      {
        text:
          "Use 'View as client' to check. Site settings > View as client puts you into the client's view of the Dashboard, read-only. Every write is refused while you view; press Stop to come back.",
        screenshot: "04-access-view-as",
        caption: "The View-as-client banner across the top of the Dashboard, with the Stop button.",
      },
    ],
    troubleshoot:
      "The invite link stopped working. Invite links expire after seven days. Open Users, find the invite, and press Resend — it makes a new link. If the client says the link 'goes nowhere', they may be already signed in as someone else — ask them to sign out first.",
    video: {
      placeholder: "Inviting a client three ways: invite link, View as client, and editing level.",
      captions:
        "Send an invite, watch the link appear, switch on View as client to see what the client will see, and choose Words only vs Words + styles vs Full builder.",
    },
  },
  {
    key: "editing-publishing",
    title: "5. Editing and publishing",
    what:
      "Every edit becomes a commit on GitHub which becomes a Netlify build. Fast, cheap, and everything is versioned. Bunch several field edits into one publish and you spend one build credit instead of one per field — that matters on Netlify's credit-limited plans.",
    steps: [
      {
        text:
          "Open the site, then Pages. Click a page — the visual editor opens the live site inside the dashboard. Click text on the page to edit it in place. Everything you change is a draft until you press Publish.",
        screenshot: "05-editing-pages",
        caption: "The visual editor with a headline being edited, and the top bar showing 'Draft'.",
      },
      {
        text:
          "Bunch edits together to save build credits. Every field you change is one edit. All the edits since your last publish go into ONE commit on the next press of Publish. On Netlify's credit-limited plans this means one build credit instead of one per field. On paid plans (Netlify Pro and up) builds are unlimited and it does not matter.",
        screenshot: "05-editing-batching",
        caption: "The visual editor showing several Changed pills across the page and one Publish button.",
      },
      {
        text:
          "Press Publish. One commit lands on the connected branch. Netlify rebuilds and the live site updates in one to two minutes. The publish dialog shows a summary grouped by page, then 'Published. Live in about 2 minutes' with a link to the commit.",
        screenshot: "05-editing-publish",
        caption: "The Publish success dialog with a per-page summary and the commit link.",
      },
      {
        text:
          "Read the Publish history. Site > Publish history lists every publish with the person who pressed it, the fields changed, and a link to the GitHub commit and the Netlify build.",
        screenshot: "05-editing-history",
        caption: "The Publish history page with three publishes and their commit / build links.",
      },
    ],
    cost:
      "Each publish is one commit and one Netlify rebuild. Netlify's Starter and free plans include a fixed number of build minutes each month — one rebuild costs one Netlify build credit on those plans. Paid plans (Pro and up) include unlimited builds.",
    troubleshoot:
      "The Publish button will not light up. Look at the top of the editor. If it says 'Not connected to GitHub', press 'Check connection' — every red line has a fix written under it (usually a missing installation, a renamed branch, or a repository the App no longer has access to).",
    video: {
      placeholder: "Editing and publishing, from a headline change to the Netlify build.",
      captions:
        "Edit a headline, edit a picture, note the Changed pills, press Publish, watch the commit URL appear and the Netlify build finish.",
    },
  },
  {
    key: "keep-updated",
    title: "6. Keeping sites up to date",
    what:
      "Armature ships a shared 'kit' folder that every client site copies. Some kit changes need an update on each site; others don't. The dashboard shows which ones do, and one click updates a site — always as a real commit, never a force-push.",
    steps: [
      {
        text:
          "Know which changes need an update. New widgets, changes to what the site outputs (SEO tags, structured data), and changes to how the site talks to the editor (bridge protocol) all need a kit update on each site. Changes that only touch Armature's own screens (Projects, Users, the editor UI) do not.",
        screenshot: "06-keep-updated-what-needs",
        caption: "A two-column list: 'Needs a kit update' vs 'Does not need one', with kit release notes highlighted.",
      },
      {
        text:
          "Open Site settings > Connection. The Kit card shows the site's current version, the current release, and one of three verdicts: up to date, update available, or update available (one-time setup step). Press 'Update kit'.",
        screenshot: "06-keep-updated-kit-card",
        caption: "The Kit card with the current version, the latest version, and the Update kit button.",
      },
      {
        text:
          "Test the update on ONE site first. Pick a site that will not embarrass you if the build is slow. The 'Update kit' modal explains what will change in plain English. Press Update. Armature commits the new kit files under the site's kit_path in ONE commit, and Netlify rebuilds.",
        screenshot: "06-keep-updated-one-site",
        caption: "The Update kit modal on one site with the plain-English notes, then a successful commit link.",
      },
      {
        text:
          "When you're happy, use Update all. From Projects, press 'Update all' — it walks every site that needs an update, three at a time. If two sites in a row need attention, it stops and asks you to check.",
        screenshot: "06-keep-updated-update-all",
        caption: "The Update all screen showing three sites in progress and a Stop button.",
      },
      {
        text:
          "Undo update restores the previous kit version. Site settings > Kit history > Undo. Armature commits the previous version's files as a new commit (never a force-push). Netlify rebuilds and the site is back on the earlier kit. (Undo update is not the same as Undo setup — Undo setup, in Section 3, rolls the whole site back to before Armature was installed on it.)",
        screenshot: "06-keep-updated-undo",
        caption: "The Kit history with an Undo button next to the last update.",
      },
      {
        text:
          "'One-time setup steps' reappear when a release adds one. Some updates need a fresh 'Set up this site' pass — because the kit added a new file the site has to import, or a new folder it has to serve. Armature says so on the Kit card; run Section 3 again for that site.",
        screenshot: "06-keep-updated-setup-step",
        caption: "The Kit card showing 'This update needs a one-time setup step' and a link to the setup prompt.",
      },
    ],
    cost:
      "One Netlify build per site updated. On the Starter and free plans that is one build credit per site; on Pro and up it is free.",
    troubleshoot:
      "A site shows 'Needs attention' after an update. Open Netlify and read the build log — usually a missing environment variable or a new file the site never imported. Fix it, and either re-run the failed build from Netlify or press Undo update and try again once you've made the change.",
    video: {
      placeholder: "Update kit, one site and then all of them.",
      captions:
        "Kit card on one site, Update kit modal with release notes, a successful commit, Update all from Projects three sites at a time, Undo, and the one-time setup step case.",
    },
  },
  {
    key: "troubleshoot",
    title: "7. Troubleshooting",
    what:
      "The four or five things that go wrong most often, with the fix. Every fix is written in plain English and lives inside the app too, next to the button that shows the problem.",
    steps: [
      {
        text:
          "GitHub didn't bring me back after Install. Click your profile picture on GitHub, then Settings, then Applications, then Installed GitHub Apps, click your App's Configure button, and press Save at the bottom. GitHub redirects to your dashboard's Setup URL right away.",
        screenshot: "07-troubleshoot-github-install",
        caption: "Installed GitHub Apps > Configure > Save, with the redirect landing back on the dashboard.",
      },
      {
        text:
          "A repository is not in Add a site's dropdown. The GitHub App does not have access to it. On the Add a site page, click 'Don't see it?' — it opens the App's Configure page on GitHub. Tick the missing repositories under Repository access, press Save, come back, and the dropdown picks them up.",
        screenshot: "07-troubleshoot-repo-missing",
        caption: "'Don't see it?' on Add a site, then the App's Configure page with an unticked repo.",
      },
      {
        text:
          "The visual editor will not load. Open Site settings > Connection and press 'Check connection'. Every red line has a plain-English fix written under it: a renamed branch, a repository the App no longer has access to, or a missing environment variable on Netlify.",
        screenshot: "07-troubleshoot-editor-connection",
        caption: "The Check connection results with three lines and a Fix button next to a red one.",
      },
      {
        text:
          "A site shows 'Needs attention' in Projects. Either the connection or the last publish failed. Open Site settings and read the Connection panel — the fix is there. If the issue is Netlify (the build failed), the Netlify build log has the exact error.",
        screenshot: "07-troubleshoot-needs-attention",
        caption: "A site row in Projects with the Needs attention pill, and the Connection panel underneath with a red line and its fix.",
      },
      {
        text:
          "A publish hit a conflict. Someone else changed the same field while you were editing. The publish dialog offers three choices: 'Keep yours' (your version wins), 'Keep theirs' (their version stays), or 'Resolve field-by-field' (pick per field). Nothing is overwritten silently.",
        screenshot: "07-troubleshoot-conflict",
        caption: "The publish conflict dialog with the three choice buttons and the conflicting field named.",
      },
      {
        text:
          "The setup pushed, but the live site looks wrong. Open Site settings > Undo setup and press it. Armature commits the pre-setup files back to the connected branch as one revert commit (never a force-push); Netlify rebuilds once and the site is back to how it was before Armature was installed. The site flips back to Needs setup and you can re-run the prompt after Claude fixes whatever caused the mismatch. Undo setup is only offered for sites Armature saved as Needs setup with a snapshot on file — legacy sites need a manual revert on GitHub instead.",
        screenshot: "07-troubleshoot-undo-setup",
        caption: "The Site settings > Undo setup card with its confirmation dialog and the revert commit link that follows.",
      },
    ],
    troubleshoot:
      "None of the above matches what I'm seeing. Open Help (in the sidebar) — it is a searchable index of everything Armature does. If it isn't there either, open the site with the problem and press 'Ask for help' on its Dashboard; the dashboard sends you a copyable summary of the site's state (repo, branch, kit version, last publish, last error) that you can paste into a ticket.",
    video: {
      placeholder: "The five things that go wrong most often, thirty seconds each.",
      captions:
        "Each of the five fixes above shown once: the GitHub install redirect, a missing repo, the visual editor's Check connection, a Needs attention site, and the publish conflict dialog.",
    },
  },
];

// Compile-time check: SECTIONS holds one entry per SECTION_KEY, in the right order.
const _sanity: [Section["key"], ...Section["key"][]] = [...SECTION_KEYS];
void _sanity;

/** URL of the placeholder screenshot for a given step slug. */
export function screenshotUrl(slug: string): string {
  return `/guide-screenshots/${slug}.svg`;
}

/** URL of the recorded walkthrough for a given section key. */
export function videoUrl(key: SectionKey): string {
  return `/guide-videos/${key}.webm`;
}

/** Every screenshot slug the guide references (steps only). */
export function allScreenshotSlugs(): string[] {
  return GETTING_STARTED_SECTIONS.flatMap((section) => section.steps.map((step) => step.screenshot));
}

/** Hosts that are allowed for the 'Use my own video' override. */
export const VIDEO_ALLOW_HOSTS = ["youtube.com", "www.youtube.com", "youtu.be", "vimeo.com", "player.vimeo.com", "www.vimeo.com", "loom.com", "www.loom.com", "wistia.com", "www.wistia.com", "wistia.net", "fast.wistia.net", "fast.wistia.com"] as const;

/**
 * Is a URL an allowed video-override link?
 * - Must parse as an http(s) URL.
 * - Host must be one of the allow-listed video hosts (YouTube, Vimeo, Loom, Wistia).
 */
export function isAllowedVideoUrl(candidate: string): boolean {
  const trimmed = candidate.trim();
  if (!trimmed) return false;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.host.toLowerCase();
  return (VIDEO_ALLOW_HOSTS as readonly string[]).some((allowed) => host === allowed);
}
