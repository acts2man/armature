/**
 * Needs setup: the first thing to do for a site whose repository is connected
 * but the Armature files aren't in place yet. Shows the ready-to-paste setup
 * prompt.
 *
 * Setup now runs directly on the site's connected branch (no test-copy branch)
 * — the prompt tells Claude Code to build the site, take BEFORE screenshots
 * of every page, do the setup, take AFTER screenshots, and only push when
 * every page matches. Once Claude pushes and Netlify rebuilds, kit-status
 * sees the kit on the connected branch and the site flips from Needs setup
 * to Connected on its own. Undo setup, on Site settings, restores the
 * pre-setup state as one revert commit if anything goes wrong.
 *
 * Agency staff only. Clients whose site is needs_setup are pointed at their
 * agency ("your agency is finishing the setup"); the card does not render for
 * them.
 */
import { useState } from "react";
import { KIT_RELEASES, CURRENT_KIT_VERSION } from "@kit/index.ts";
import { IconAlert } from "@/components/icons.tsx";
import { Button, Panel } from "@/components/ui.tsx";
import { buildSetupPrompt } from "@/lib/kitSetupPrompt.ts";
import type { Site } from "@/lib/types.ts";

export function NeedsSetupCard({ site, supabaseUrl }: { site: Site; supabaseUrl: string }) {
  const [copied, setCopied] = useState<"idle" | "copied">("idle");

  const prompt = buildSetupPrompt({
    repo: `${site.repo_owner}/${site.repo_name}`,
    branch: site.branch ?? "main",
    kitPath: site.kit_path ?? "src/lib/armature-kit",
    siteId: site.id,
    liveUrl: site.live_url,
    supabaseUrl,
    currentVersion: CURRENT_KIT_VERSION,
    fromVersion: null,
    releases: KIT_RELEASES,
    pendingSteps: [],
    preSetupCommitSha: site.pre_setup_commit_sha ?? null,
  });

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied("copied");
      setTimeout(() => setCopied("idle"), 2500);
    } catch {
      /* ignore */
    }
  };

  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-2">
          <IconAlert size={16} /> This site isn't set up for Armature yet
        </span>
      }
    >
      <div className="flex flex-col gap-4 p-5" data-testid="needs-setup-card">
        <p className="text-[14px] leading-relaxed text-text">
          The repository is connected, but the Armature files (content, schema and kit) aren't there yet. That's a one-time step. Copy the prompt below, open <a href="https://claude.ai/code" target="_blank" rel="noreferrer" className="text-primary underline">Claude Code on the web</a>, pick this repo and paste it in.
        </p>
        <div className="rounded-card border border-line bg-panel p-3 text-[13px] leading-relaxed text-text" data-testid="needs-setup-heads-up">
          <p className="font-semibold">Heads up before you paste:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>This is a big Claude Code session — similar in size to converting a whole site. Give it room and don't cancel it partway.</li>
            <li>Nothing changes on the live site until every page passes. Claude builds the site as it is today, takes screenshots and DOM snapshots of every page, does the setup, rebuilds and compares — no push until everything matches. Claude works directly on <span className="font-mono">{site.branch}</span>.</li>
            <li>If anything looks wrong on the live site once it lands, Site settings → Undo setup restores the pre-setup state as one revert commit.</li>
          </ul>
        </div>
        <div className="flex flex-col gap-2" data-testid="setup-prompt">
          <textarea
            readOnly
            value={prompt}
            rows={16}
            className="w-full rounded-card border border-line bg-panel p-3 font-mono text-[12px] leading-snug"
            data-testid="needs-setup-prompt"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void onCopy()} data-testid="copy-needs-setup-prompt">Copy prompt</Button>
            {copied === "copied" && <span className="text-[12px] text-green">Copied to clipboard.</span>}
          </div>
        </div>
        <p className="text-[12px] text-muted">
          Once Claude pushes and Netlify rebuilds, this card will disappear on its own — Armature reads data-armature-kit on the site's HTML and flips Needs setup to Connected the next time it checks.
        </p>
      </div>
    </Panel>
  );
}
