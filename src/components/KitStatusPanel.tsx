/**
 * The Kit status panel for a site's Site settings › Connection tab. Shows what
 * kit version is in the site's repo, what is actually live, and the current
 * release; the verdict decides which action shows (Set up this site, Update
 * kit, or nothing). Agency staff only — a client never opens this screen.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { KIT_RELEASES } from "@kit/index.ts";
import { IconCheck, IconAlert, IconChart, IconExternal, IconGithub } from "@/components/icons.tsx";
import { Button, Modal, Notice, Panel, Pill } from "@/components/ui.tsx";
import { callFunction, isFailure } from "@/lib/functions.ts";
import { buildSetupPrompt } from "@/lib/kitSetupPrompt.ts";
import { supabase } from "@/lib/supabase.ts";
import type { Site } from "@/lib/types.ts";

type UpdateKitResult = { ok: true; from: string | null; to: string; commit: { sha: string; url: string }; changed: { added: number; changed: number; removed: number } };

type KitStatusVerdict = "not_installed" | "needs_setup" | "update_available" | "up_to_date";

type KitStatus = {
  current: string;
  inRepo: string | null;
  live: string | null;
  verdict: KitStatusVerdict;
  probed: { path: string; ok: boolean }[];
  pendingSteps: { key: string; label: string; detail: string; version: string }[];
  reason: string;
};

const VERDICT_TONE: Record<KitStatusVerdict, "green" | "amber" | "blue" | "danger"> = {
  up_to_date: "green",
  update_available: "blue",
  needs_setup: "amber",
  not_installed: "danger",
};
const VERDICT_LABEL: Record<KitStatusVerdict, string> = {
  up_to_date: "Up to date",
  update_available: "Update available",
  needs_setup: "Needs setup",
  not_installed: "Not installed",
};

function useKitStatus(siteId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["kit-status", siteId],
    enabled,
    queryFn: async () => {
      const result = await callFunction<{ ok: true; status: KitStatus }>("kit-status", { site_id: siteId });
      if (isFailure(result)) throw new Error(result.message);
      return result.status;
    },
    staleTime: 30_000,
  });
}

export function KitStatusPanel({ site }: { site: Site }) {
  const status = useKitStatus(site.id, site.status !== "hosting_only");
  const [pathDraft, setPathDraft] = useState(site.kit_path ?? "src/lib/armature-kit");
  const [setupOpen, setSetupOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [copied, setCopied] = useState<"idle" | "copied">("idle");
  const queryClient = useQueryClient();

  const savePath = useMutation({
    mutationFn: async () => {
      const next = pathDraft.trim() || "src/lib/armature-kit";
      const { error } = await supabase.from("sites").update({ kit_path: next }).eq("id", site.id);
      if (error) throw new Error(error.message);
      return next;
    },
  });

  const update = useMutation({
    mutationFn: async () => {
      const result = await callFunction<UpdateKitResult>("update-kit", { site_id: site.id, overwrite });
      if (isFailure(result)) throw new Error(result.message);
      return result;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["kit-status", site.id] });
    },
  });

  const prompt = status.data
    ? buildSetupPrompt({
        repo: `${site.repo_owner}/${site.repo_name}`,
        branch: site.branch ?? "main",
        kitPath: site.kit_path ?? "src/lib/armature-kit",
        siteId: site.id,
        liveUrl: site.live_url,
        supabaseUrl: import.meta.env["VITE_SUPABASE_URL"] ?? "",
        currentVersion: status.data.current,
        fromVersion: status.data.inRepo,
        releases: KIT_RELEASES.filter((r) => (status.data!.inRepo ? r.version > status.data!.inRepo && r.version <= status.data!.current : true)),
        pendingSteps: status.data.pendingSteps,
      })
    : "";

  const onCopyPrompt = async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied("copied");
      setTimeout(() => setCopied("idle"), 2500);
    } catch {
      /* ignore */
    }
  };

  if (site.status === "hosting_only") return null;

  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-2">
          <IconChart size={16} /> Kit
        </span>
      }
      aside={status.data ? <Pill tone={VERDICT_TONE[status.data.verdict]}>{VERDICT_LABEL[status.data.verdict]}</Pill> : undefined}
    >
      <div className="p-5" data-testid="kit-status">
        {status.isPending && <p className="text-[13px] text-muted">Checking the site's kit version…</p>}
        {status.isError && (
          <Notice kind="danger" title="Could not read the kit version">
            {status.error.message}
          </Notice>
        )}
        {status.data && (
          <div className="flex flex-col gap-4">
            <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-[160px_minmax(0,1fr)]">
              <dt className="text-muted">In the repo</dt>
              <dd className="font-mono text-text" data-testid="kit-status-in-repo">{status.data.inRepo ?? "not found"}</dd>
              <dt className="text-muted">Live on the site</dt>
              <dd className="font-mono text-text" data-testid="kit-status-live">{status.data.live ?? "unknown (Armature could not read the live page)"}</dd>
              <dt className="text-muted">Current release</dt>
              <dd className="font-mono text-text" data-testid="kit-status-current">{status.data.current}</dd>
              <dt className="text-muted">Kit path</dt>
              <dd>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    savePath.mutate();
                  }}
                  className="flex flex-wrap items-center gap-2"
                >
                  <input
                    type="text"
                    className="h-8 rounded-control border border-line px-2 font-mono text-[12px]"
                    value={pathDraft}
                    onChange={(event) => setPathDraft(event.target.value)}
                    aria-label="Kit path inside the repo"
                    data-testid="kit-path-input"
                  />
                  <Button type="submit" size="sm" variant="secondary" loading={savePath.isPending} disabled={pathDraft.trim() === (site.kit_path ?? "src/lib/armature-kit")}>
                    Save path
                  </Button>
                  {savePath.isSuccess && <span className="text-[12px] text-green">Saved.</span>}
                </form>
              </dd>
            </dl>

            <div className="flex items-start gap-2.5 text-[13px]">
              <span className={status.data.verdict === "up_to_date" ? "text-green" : status.data.verdict === "not_installed" ? "text-danger" : "text-amber"}>
                {status.data.verdict === "up_to_date" ? <IconCheck size={16} /> : <IconAlert size={16} />}
              </span>
              <span className="text-text">{status.data.reason}</span>
            </div>

            <div className="flex flex-wrap gap-2">
              {status.data.verdict === "update_available" && (
                <Button size="sm" onClick={() => { setOverwrite(false); setUpdateOpen(true); }} data-testid="update-kit">
                  <IconGithub size={16} /> Update kit
                </Button>
              )}
              {(status.data.verdict === "needs_setup" || status.data.verdict === "not_installed" || status.data.verdict === "update_available") && (
                <Button size="sm" variant={status.data.verdict === "update_available" ? "secondary" : "primary"} onClick={() => setSetupOpen(true)} data-testid="open-setup-prompt">
                  <IconGithub size={16} /> Set up this site
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {updateOpen && status.data && (
        <Modal open={updateOpen} title={`Update ${site.name} kit ${status.data.inRepo ?? "?"} → ${status.data.current}`} onClose={() => { setUpdateOpen(false); update.reset(); }}>
          <div className="flex flex-col gap-3 p-5" data-testid="update-kit-modal">
            {!update.data && !update.isError && (
              <>
                <p className="text-[13px] text-text">
                  This replaces every file under <span className="font-mono">{site.kit_path ?? "src/lib/armature-kit"}</span> on branch <span className="font-mono">{site.branch}</span> in ONE commit. It never touches anything outside that folder.
                </p>
                <div className="rounded-card border border-line bg-panel p-3 text-[13px]">
                  <div className="font-semibold text-text mb-1">What changes since {status.data.inRepo ?? "your kit"}:</div>
                  <ul className="ml-5 list-disc space-y-1 text-text">
                    {KIT_RELEASES.filter((r) => status.data!.inRepo ? r.version > status.data!.inRepo && r.version <= status.data!.current : true).map((release) => (
                      <li key={release.version}>
                        <span className="font-mono">{release.version}</span>: {release.notes.join("; ")}
                      </li>
                    ))}
                  </ul>
                </div>
                {status.data.pendingSteps.length > 0 && (
                  <Notice kind="info" title="Some setup steps arrived between versions">
                    Do these once the commit lands so the site can use the new features: {status.data.pendingSteps.map((s) => s.label).join(", ")}. Open Set up this site for the ready-to-paste prompt.
                  </Notice>
                )}
                <label className="flex items-start gap-2 text-[13px] text-text">
                  <input type="checkbox" checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} className="mt-0.5" data-testid="update-kit-overwrite" />
                  <span>Overwrite any local edits inside the kit folder. Only tick this if the site's developer has NOT customised the kit's files (it is meant to be verbatim).</span>
                </label>
              </>
            )}
            {update.data && (
              <div className="flex flex-col gap-2 text-[13px]" data-testid="update-kit-done">
                <div className="text-green font-semibold">Committed to {site.branch}.</div>
                <div>
                  {update.data.changed.added} added, {update.data.changed.changed} changed, {update.data.changed.removed} removed.
                </div>
                <a href={update.data.commit.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline">
                  View the commit <IconExternal size={12} />
                </a>
                <p className="text-muted">The site's next Netlify build picks up the new kit. Armature notices it as soon as the deploy is live (data-armature-kit on the site's HTML).</p>
              </div>
            )}
            {update.isError && (
              <Notice kind="danger" title="The update did not go through">
                {update.error.message}
              </Notice>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {!update.data && (
                <Button size="sm" onClick={() => update.mutate()} loading={update.isPending} data-testid="update-kit-confirm">
                  Update to {status.data.current}
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={() => { setUpdateOpen(false); update.reset(); }}>Close</Button>
            </div>
          </div>
        </Modal>
      )}

      {setupOpen && status.data && (
        <Modal open={setupOpen} title={`Set up ${site.name} for kit ${status.data.current}`} onClose={() => setSetupOpen(false)}>
          <div className="flex flex-col gap-3 p-5">
            <p className="text-[13px] text-text">
              Copy this prompt, open <a href="https://claude.ai/code" target="_blank" rel="noreferrer" className="text-primary underline">Claude Code on the web</a>, pick this repository and paste it in. Claude will do the setup steps for {site.name} on branch <span className="font-mono">{site.branch}</span>.
            </p>
            <textarea
              readOnly
              value={prompt}
              rows={20}
              className="w-full rounded-card border border-line bg-panel p-3 font-mono text-[12px] leading-snug"
              data-testid="setup-prompt-text"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => void onCopyPrompt()} data-testid="copy-setup-prompt">Copy prompt</Button>
              {copied === "copied" && <span className="text-[12px] text-green">Copied to clipboard.</span>}
              <Button size="sm" variant="secondary" onClick={() => setSetupOpen(false)}>Close</Button>
            </div>
          </div>
        </Modal>
      )}
    </Panel>
  );
}
