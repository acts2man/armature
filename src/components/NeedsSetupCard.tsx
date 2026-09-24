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
        <p className="text-[13px] text-muted">
          Claude Code works directly on <span className="font-mono">{site.branch}</span>. Before it pushes it builds the site, takes screenshots of every page, does the setup, takes screenshots again and compares them page by page. Nothing gets pushed unless every page matches. If anything looks wrong on the live site once it lands, Site settings → Undo setup restores the pre-setup state as one revert commit.
        </p>
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
