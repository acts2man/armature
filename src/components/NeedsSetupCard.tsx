/**
 * Needs setup: the first thing to do for a site whose repository is connected
 * but the Armature files aren't in place yet. Shows the ready-to-paste setup
 * prompt (test-copy branch armature/setup), plus Preview and Go live once
 * Claude Code has pushed the branch.
 *
 * Agency staff only. Clients whose site is needs_setup are pointed at their
 * agency ("your agency is finishing the setup"); the card does not render for
 * them.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { KIT_RELEASES, CURRENT_KIT_VERSION } from "@kit/index.ts";
import { IconAlert, IconExternal, IconGithub } from "@/components/icons.tsx";
import { Button, Field, Input, Notice, Panel } from "@/components/ui.tsx";
import { callFunction, isFailure } from "@/lib/functions.ts";
import { buildSetupPrompt, SETUP_BRANCH } from "@/lib/kitSetupPrompt.ts";
import type { Site } from "@/lib/types.ts";

type StatusResponse = { ok: true; action: "status"; setupBranchExists: boolean; setupBranchSha: string | null; previewUrl: string | null; connectedBranch: string; setupBranch: string };
type GoLiveResponse = { ok: true; action: "go_live"; kind: "merged" | "already_merged"; commit?: { sha: string; url: string } } | { ok: true; action: "go_live"; kind: "conflict"; message: string };

function useSetupStatus(siteId: string, netlifySlug: string | null) {
  return useQuery({
    queryKey: ["finish-setup", siteId, netlifySlug ?? ""],
    queryFn: async () => {
      const result = await callFunction<StatusResponse>("finish-setup", { site_id: siteId, action: "status", netlify_slug: netlifySlug });
      if (isFailure(result)) throw new Error(result.message);
      return result;
    },
    refetchInterval: (query) => (query.state.data?.setupBranchExists ? false : 20_000),
  });
}

export function NeedsSetupCard({ site, supabaseUrl }: { site: Site; supabaseUrl: string }) {
  const [netlifySlug, setNetlifySlug] = useState<string | null>(null);
  const [slugDraft, setSlugDraft] = useState("");
  const [copied, setCopied] = useState<"idle" | "copied">("idle");
  const queryClient = useQueryClient();
  const status = useSetupStatus(site.id, netlifySlug);

  const goLive = useMutation({
    mutationFn: async () => {
      const result = await callFunction<GoLiveResponse>("finish-setup", { site_id: site.id, action: "go_live" });
      if (isFailure(result)) throw new Error(result.message);
      return result;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["finish-setup", site.id] });
      void queryClient.invalidateQueries({ queryKey: ["site", site.id] });
    },
  });

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
          Claude works on a test-copy branch (<span className="font-mono">{SETUP_BRANCH}</span>) branched from <span className="font-mono">{site.branch}</span>, so the live site stays exactly as it is until you press Go live.
        </p>

        <div className="flex flex-col gap-2" data-testid="setup-prompt">
          <textarea
            readOnly
            value={prompt}
            rows={14}
            className="w-full rounded-card border border-line bg-panel p-3 font-mono text-[12px] leading-snug"
            data-testid="needs-setup-prompt"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void onCopy()} data-testid="copy-needs-setup-prompt">Copy prompt</Button>
            {copied === "copied" && <span className="text-[12px] text-green">Copied to clipboard.</span>}
          </div>
        </div>

        <div className="border-t border-line pt-4">
          <p className="text-[13px] font-semibold text-text mb-2">When Claude Code finishes and pushes the branch</p>
          {status.isPending && <p className="text-[13px] text-muted">Checking GitHub for {SETUP_BRANCH}…</p>}
          {status.isError && (
            <Notice kind="danger" title="Could not check GitHub">
              {status.error.message}
            </Notice>
          )}
          {status.data && !status.data.setupBranchExists && (
            <p className="text-[13px] text-muted" data-testid="setup-not-pushed">
              Waiting for <span className="font-mono">{SETUP_BRANCH}</span> to appear on GitHub. This checks itself every 20 seconds. Once Claude pushes the branch, Preview and Go live show up here.
            </p>
          )}
          {status.data && status.data.setupBranchExists && (
            <div className="flex flex-col gap-3" data-testid="setup-ready">
              <p className="text-[13px] text-text">
                The test copy is on <span className="font-mono">{SETUP_BRANCH}</span> ({status.data.setupBranchSha?.slice(0, 7)}).
              </p>
              {status.data.previewUrl ? (
                <p className="text-[13px]">
                  Preview:{" "}
                  <a href={status.data.previewUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline">
                    {status.data.previewUrl} <IconExternal size={12} />
                  </a>
                </p>
              ) : (
                <div className="flex flex-col gap-2 rounded-card border border-line bg-ground p-3">
                  <p className="text-[13px] text-text">Armature could not guess the Netlify branch preview URL for this site. Paste the Netlify site name (from your Netlify dashboard, the part before <span className="font-mono">.netlify.app</span>):</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Field label="Netlify site name" htmlFor="netlify-slug" className="max-w-sm">
                      <Input id="netlify-slug" placeholder="alder-stone" value={slugDraft} onChange={(event) => setSlugDraft(event.target.value)} className="font-mono" data-testid="netlify-slug-input" />
                    </Field>
                    <Button size="sm" variant="secondary" onClick={() => setNetlifySlug(slugDraft.trim() || null)} data-testid="netlify-slug-save">Use this slug</Button>
                  </div>
                </div>
              )}
              <div className="rounded-card border border-line bg-panel p-3 text-[13px]">
                <p className="font-semibold text-text">Go live merges <span className="font-mono">{SETUP_BRANCH}</span> into <span className="font-mono">{status.data.connectedBranch}</span> as one merge, through GitHub's API. Never a force-push.</p>
                <p className="mt-1 text-muted">Netlify then rebuilds the live site once. On paid plans that's fine; on Netlify's credit-limited free tier it counts as one build.</p>
              </div>
              {goLive.data?.kind === "conflict" && (
                <Notice kind="danger" title="GitHub reported a merge conflict">
                  {goLive.data.message}. Ask Claude Code to rebase <span className="font-mono">{SETUP_BRANCH}</span> onto <span className="font-mono">{status.data.connectedBranch}</span>, resolve the conflict, and push again — then press Go live again.
                </Notice>
              )}
              {goLive.data?.kind === "merged" && goLive.data.commit && (
                <Notice kind="success" title="Merged. Netlify is rebuilding.">
                  <a href={goLive.data.commit.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline">
                    View the merge commit <IconExternal size={12} />
                  </a>
                </Notice>
              )}
              {goLive.data?.kind === "already_merged" && (
                <Notice kind="info" title="Already merged.">Netlify has the setup live already. Refresh the site to see the Kit card go green.</Notice>
              )}
              {goLive.isError && (
                <Notice kind="danger" title="Go live did not go through">
                  {goLive.error.message}
                </Notice>
              )}
              <div>
                <Button size="sm" onClick={() => goLive.mutate()} loading={goLive.isPending} data-testid="go-live" disabled={goLive.data?.kind === "merged" || goLive.data?.kind === "already_merged"}>
                  <IconGithub size={16} /> Go live
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
