/**
 * Getting Started — a step-by-step playbook that leads an agency through the
 * first-time setup and the day-to-day work. Sits right below Projects in the
 * agency sidebar; Help stays as the searchable reference and links back here.
 *
 * Per-agency progress is saved to localStorage under
 * `armature:getting-started:<agencyId>` so ticks survive a reload; a full
 * server-side per-agency store is a follow-up.
 *
 * Videos are stubbed: each section names the walkthrough that will land there,
 * with a "Use my own video" field (any YouTube / Vimeo / Loom / Wistia link).
 * Recorded walkthroughs are a follow-up (npm run record:guide-videos).
 */
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { IconCheck, IconChevronDown, IconExternal } from "@/components/icons.tsx";
import { Input, PageHeader, Panel, Pill, SrOnly } from "@/components/ui.tsx";

type Section = {
  key: string;
  title: string;
  why: string;
  steps: string[];
  cost?: string;
  troubleshoot?: string;
  video: { placeholder: string; captions: string };
};

const SECTIONS: Section[] = [
  {
    key: "agency-setup",
    title: "1. One-time agency setup",
    why: "Do this once, then every future site takes minutes. You'll create the GitHub App the dashboard uses to write to client sites, and connect Netlify.",
    steps: [
      "GitHub: create the App under your profile picture → Settings → Developer settings → GitHub Apps → New GitHub App. Name it, set Homepage URL, and paste this dashboard's address + /github/setup as the Setup URL. Tick 'Redirect on update'. Under Repository permissions, set Contents to Read and write.",
      "GitHub: choose 'Any account' so a client's own organisation can install the App there. When you set 'All repositories' for your OWN organisation, you'll see every repo in Add a site's dropdown. 'Only select repositories' means you (or an owner) tick each one under the App's Configure page — change it later at profile picture → Settings → Applications → Installed GitHub Apps → Configure → Repository access.",
      "Netlify: sign in and note your team. You'll connect each client site's repo to Netlify separately below.",
      "Optional: turn on email sending. Add a Resend account and paste the API key into Supabase (Edge Functions → Secrets → RESEND_API_KEY). Without it, invites still work — you send the link yourself instead of the dashboard emailing it.",
    ],
    cost: "Free: GitHub Apps and Netlify's starter tier. Resend has a small free tier.",
    troubleshoot: "GitHub didn't bring you back after Install? Open profile picture → Settings → Applications → Installed GitHub Apps → your App → Configure → Save. GitHub redirects to the Setup URL then.",
    video: { placeholder: "The GitHub App from empty to installed", captions: "GitHub App name, Setup URL, permissions, Redirect on update, All repositories vs Only select repositories, and where to change access later." },
  },
  {
    key: "add-site",
    title: "2. Connect a new client site",
    why: "One site at a time; each one takes two or three minutes once the App is installed.",
    steps: [
      "Projects → Add a site. Step 1 shows 'Connected to <your org> ✓' when the App is already linked.",
      "Step 2: pick the client's repository from the dropdown, or type owner/name. The branch fills in from the repository's default (usually main).",
      "Press 'Check and connect'. Every green line means one check passed; amber means an Armature file isn't there yet.",
      "Sites without the Armature files save as 'Needs setup'. That's normal for a new site — Set up this site takes it the rest of the way.",
    ],
    troubleshoot: "The repo isn't in the list? Give the App access on GitHub — the 'Don't see it?' panel links straight to the installation's Configure page.",
    video: { placeholder: "Add a site in one minute", captions: "The linked-account row, the dropdown, the branch autofill, the checklist, and a Needs-setup outcome." },
  },
  {
    key: "set-up-site",
    title: "3. Set up the site with the prompt",
    why: "One-time per site. The prompt runs on a TEST COPY branch (armature/setup) so the live site keeps rendering while Claude Code works.",
    steps: [
      "Open the Needs setup site's Dashboard. The 'Set up this site' card has a ready-to-paste prompt.",
      "Press Copy prompt, open Claude Code on the web, pick this repo and paste. Claude does the setup on armature/setup, never on the live branch.",
      "Come back to Armature. When the branch lands, Preview appears (Netlify's branch preview) — check the site there.",
      "When you're happy, press Go live. Armature merges armature/setup into the connected branch through GitHub's API (never a force-push). Netlify rebuilds once and the site is set up.",
    ],
    cost: "One Netlify build per Go live (their credit-limited plans count builds; paid plans don't care).",
    troubleshoot: "Preview shows the OLD site? Netlify hasn't finished the branch build yet — wait a minute and refresh. Go live shows a conflict? Ask Claude Code to rebase armature/setup onto the connected branch and push again.",
    video: { placeholder: "Set up a site with Claude Code", captions: "Copy prompt → Claude Code → armature/setup pushed → Preview → Go live → the live site." },
  },
  {
    key: "give-access",
    title: "4. Give the client access",
    why: "Turn a site over to the person who will edit it.",
    steps: [
      "Site → Users → Invite user. Paste their email and choose their editing level.",
      "Copy the invite link and send it however you like (an email, a text). Once they open the link and set a password, they land on the site's Dashboard.",
      "Client editing level (Site settings → Editing) decides whether they can edit words only, styles too, or the full builder.",
      "View as client (Site settings → View as client) lets you see the site's Dashboard as they will — safer than logging in with their account.",
    ],
    troubleshoot: "The invite link stopped working? It expires after seven days; send a new one from Users.",
    video: { placeholder: "Inviting a client, three ways", captions: "Invite link, View as client, and Editing level from Words only to the full builder." },
  },
  {
    key: "editing-publishing",
    title: "5. Editing and publishing",
    why: "Every change is a GitHub commit that triggers one Netlify rebuild. Fast, cheap, and everything is versioned.",
    steps: [
      "Site → Pages → pick a page. Click text to edit it in place. Every change is a draft until you publish.",
      "Press Publish. One commit lands on the connected branch; Netlify rebuilds; the live site updates in a minute or two.",
      "Site → Publish history shows every publish with a link to the GitHub commit and the Netlify build.",
    ],
    cost: "On Netlify's credit-limited plans one publish = one build. Bunching several field edits into one publish is cheaper than one publish per field.",
    troubleshoot: "Publish button won't light up? Look at the top of the editor — 'Not connected to GitHub' comes with a Check connection button; run it.",
    video: { placeholder: "Editing and publishing", captions: "Edit a headline, publish, see the commit and the Netlify build." },
  },
  {
    key: "keep-updated",
    title: "6. Keeping sites up to date",
    why: "Armature ships a shared 'kit' folder that every client site copies. Some kit changes need an update; others don't.",
    steps: [
      "A kit release that changes anything on the CLIENT'S WEBSITE (new widgets, SEO output) OR how the site talks to the editor (bridge protocol) needs a kit update on each site.",
      "A kit release that only changes Armature's OWN screens (Projects, Users, the editor UI itself) does NOT need a site update.",
      "Site settings → Connection → Kit shows each site's version. Press Update kit to apply the latest as ONE commit. Test the update on one site first.",
      "Once you're happy, Update all runs the update across every site that needs it (three at a time; stops and asks if two in a row need attention).",
      "Undo update rolls back to the previous version as another commit — never a force-push.",
    ],
    cost: "One Netlify build per site updated.",
    troubleshoot: "A site shows 'Needs attention' after the update? Open Netlify to read the build log — usually a missing env var or a syntax error the setup prompt didn't run.",
    video: { placeholder: "Update kit, one site and then all sites", captions: "The Kit card, Update kit modal, waiting for Netlify, Update all with three at a time, and Undo." },
  },
  {
    key: "troubleshoot",
    title: "7. Troubleshooting",
    why: "The three or four things that go wrong most often, with the fix.",
    steps: [
      "GitHub didn't bring me back after Install: open profile picture → Settings → Applications → Installed GitHub Apps → your App → Configure → Save.",
      "The repo isn't in the Add-a-site dropdown: give the App access — the 'Don't see it?' panel links to the installation's Configure page.",
      "The visual editor won't load: Site settings → Connection → Check connection. Every red line has a fix written under it.",
      "A site shows 'Needs attention': the connection or the last publish failed — open Site settings and follow the connection check.",
      "A publish hit a conflict: someone else changed the same field. The publish dialog lets you keep yours, keep theirs, or resolve field-by-field.",
    ],
    video: { placeholder: "The four things that go wrong", captions: "Each of the fixes above, thirty seconds apiece." },
  },
];

function Progress({ done, total }: { done: number; total: number }) {
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="flex items-center gap-3">
      <div aria-hidden="true" className="h-2 w-40 rounded-full bg-line">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-[13px] text-muted">{done} of {total} done</span>
    </div>
  );
}

function useProgress(agencyId: string, keys: string[]): [Set<string>, (key: string, done: boolean) => void] {
  const storageKey = `armature:getting-started:${agencyId}`;
  const [state, setState] = useState<Set<string>>(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
      if (!raw) return new Set();
      return new Set(JSON.parse(raw) as string[]);
    } catch {
      return new Set();
    }
  });
  const set = (key: string, done: boolean) => {
    setState((previous) => {
      const next = new Set(previous);
      if (done) next.add(key);
      else next.delete(key);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify([...next].filter((k) => keys.includes(k))));
      } catch {
        /* ignore */
      }
      return next;
    });
  };
  return [state, set];
}

function VideoBox({ section, agencyId }: { section: Section; agencyId: string }) {
  const [override, setOverride] = useState<string>(() => {
    try {
      return window.localStorage.getItem(`armature:getting-started:${agencyId}:${section.key}:video`) ?? "";
    } catch {
      return "";
    }
  });
  const save = (value: string) => {
    setOverride(value);
    try {
      if (value) window.localStorage.setItem(`armature:getting-started:${agencyId}:${section.key}:video`, value);
      else window.localStorage.removeItem(`armature:getting-started:${agencyId}:${section.key}:video`);
    } catch {
      /* ignore */
    }
  };
  const url = override.trim();
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line bg-panel p-3">
      <p className="text-[13px] font-semibold text-text">Watch it</p>
      {url ? (
        <p className="text-[13px]">
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline">
            Open your walkthrough <IconExternal size={12} />
          </a>
        </p>
      ) : (
        <p className="text-[13px] text-muted">Walkthrough coming: {section.video.placeholder}. Captions describe {section.video.captions}</p>
      )}
      <label className="flex flex-col gap-1 text-[12px] text-muted">
        Use your own video (any YouTube, Vimeo, Loom or Wistia link)
        <Input value={override} onChange={(event) => save(event.target.value)} placeholder="https://youtu.be/… (Unlisted works well)" className="font-mono" data-testid={`gs-video-${section.key}`} />
      </label>
    </div>
  );
}

function SectionCard({ section, done, onToggle, agencyId }: { section: Section; done: boolean; onToggle: () => void; agencyId: string }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <Panel
      title={
        <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-2 text-left" data-testid={`gs-toggle-${section.key}`}>
          <span aria-hidden="true"><IconChevronDown size={16} className={open ? "" : "-rotate-90"} /></span>
          <span className={done ? "text-muted line-through" : "text-text"}>{section.title}</span>
          {done && <Pill tone="green">Done</Pill>}
        </button>
      }
      aside={
        <label className="flex items-center gap-2 text-[13px] text-text">
          <input type="checkbox" checked={done} onChange={onToggle} data-testid={`gs-check-${section.key}`} />
          Mark done
          {done && <SrOnly>(this section is marked done)</SrOnly>}
          {done && <span aria-hidden="true" className="text-green"><IconCheck size={16} /></span>}
        </label>
      }
    >
      {open && (
        <div className="flex flex-col gap-3 p-5 text-[14px] leading-relaxed text-text" data-testid={`gs-body-${section.key}`}>
          <p className="italic text-muted">{section.why}</p>
          <ol className="ml-4 list-decimal space-y-2">
            {section.steps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
          {section.cost && (
            <p className="rounded-card border border-line bg-panel px-3 py-2 text-[13px]"><span className="font-semibold">What it costs:</span> {section.cost}</p>
          )}
          {section.troubleshoot && (
            <p className="rounded-card border border-line bg-panel px-3 py-2 text-[13px]"><span className="font-semibold">If something goes wrong:</span> {section.troubleshoot}</p>
          )}
          <VideoBox section={section} agencyId={agencyId} />
        </div>
      )}
    </Panel>
  );
}

export function GettingStarted() {
  const { agency } = useAuth();
  const agencyId = agency?.id ?? "no-agency";
  const keys = useMemo(() => SECTIONS.map((section) => section.key), []);
  const [done, setDone] = useProgress(agencyId, keys);

  return (
    <div className="flex flex-col gap-5" data-testid="getting-started">
      <PageHeader
        title="Getting started"
        description="A step-by-step playbook for using Armature end-to-end. Tick a section off when you're done; the ticks stay per agency and per browser. Help (in the sidebar) is the searchable reference; it links back here for the how."
      />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-panel px-4 py-3">
        <div className="text-[14px] font-semibold text-text">Your progress</div>
        <Progress done={SECTIONS.filter((section) => done.has(section.key)).length} total={SECTIONS.length} />
      </div>
      <div className="flex flex-col gap-4">
        {SECTIONS.map((section) => (
          <SectionCard
            key={section.key}
            section={section}
            done={done.has(section.key)}
            onToggle={() => setDone(section.key, !done.has(section.key))}
            agencyId={agencyId}
          />
        ))}
      </div>
      <p className="text-[13px] text-muted">
        Looking for something specific? <Link to="/agency/help" className="text-primary underline">Help</Link> is a searchable index of everything Armature does.
      </p>
    </div>
  );
}
