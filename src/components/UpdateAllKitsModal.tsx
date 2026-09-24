/**
 * The Update all kits modal. Opens from Projects when Troy presses Update all.
 * Lists every site with a pending kit update, lets him untick any (recommending
 * the test site first), and runs the batch three at a time. Progress is a live
 * list; a paused run shows the stop reason and a Continue button.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { CURRENT_KIT_VERSION } from "@kit/manifest.ts";
import { IconAlert, IconCheck, IconExternal } from "@/components/icons.tsx";
import { Button, Modal, Notice, Pill } from "@/components/ui.tsx";
import { dispatchUpdateAll, type UpdateAllController, type UpdateAllProgress, type UpdateAllRun } from "@/lib/updateAllKits.ts";
import type { Site } from "@/lib/types.ts";

type Candidate = { site: Site; recommended: boolean };

const stateTone: Record<UpdateAllRun["state"], "amber" | "green" | "blue" | "danger" | "grey"> = {
  queued: "grey",
  running: "amber",
  done: "green",
  error: "danger",
  skipped: "grey",
};
const stateLabel: Record<UpdateAllRun["state"], string> = {
  queued: "Queued",
  running: "Updating…",
  done: "Done",
  error: "Needs attention",
  skipped: "Skipped",
};

export type UpdateAllKitsModalProps = {
  open: boolean;
  onClose: () => void;
  /** Every site whose Kit column shows "Update available". */
  candidates: Site[];
  /** Which site the agency has marked as their test-first site (if any). Ticked and moved to the top. */
  testSiteId?: string | null;
};

export function UpdateAllKitsModal({ open, onClose, candidates, testSiteId }: UpdateAllKitsModalProps) {
  const initial = useMemo<Candidate[]>(() => {
    const rows = candidates.map((site) => ({ site, recommended: !!testSiteId && site.id === testSiteId }));
    // Recommended sites first, then A→Z.
    return rows.sort((a, b) => Number(b.recommended) - Number(a.recommended) || a.site.name.localeCompare(b.site.name));
  }, [candidates, testSiteId]);

  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial.map((row) => row.site.id)));
  const [progress, setProgress] = useState<UpdateAllProgress | null>(null);
  const controllerRef = useRef<UpdateAllController | null>(null);
  const queryClient = useQueryClient();

  const toggle = (siteId: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(siteId)) next.delete(siteId); else next.add(siteId);
    return next;
  });

  const start = useMutation({
    mutationFn: async () => {
      const chosen = initial.filter((row) => selected.has(row.site.id)).map(({ site }) => ({ id: site.id, name: site.name }));
      if (chosen.length === 0) throw new Error("Tick at least one site.");
      const controller = dispatchUpdateAll(chosen, {
        concurrency: 3,
        onProgress: (next) => setProgress(next),
      });
      controllerRef.current = controller;
      const final = await controller.promise;
      // Once the batch finishes, refresh anything that keys off kit_updates / sites.
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      for (const run of final.runs) {
        void queryClient.invalidateQueries({ queryKey: ["kit-updates", run.siteId] });
        void queryClient.invalidateQueries({ queryKey: ["kit-status", run.siteId] });
      }
      return final;
    },
  });

  const close = () => {
    controllerRef.current?.stop();
    controllerRef.current = null;
    setProgress(null);
    start.reset();
    onClose();
  };

  const running = start.isPending && !progress?.paused;
  const done = !!start.data;

  return (
    <Modal open={open} title={`Update all kits to ${CURRENT_KIT_VERSION}`} onClose={close}>
      <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto p-5" data-testid="update-all-modal">
        {!progress && !done && (
          <>
            <p className="text-[13px] text-text">
              {initial.length === 0 ? (
                "Every site is already on the current kit."
              ) : (
                <>Tick the sites you want to update. Armature commits the current kit as one commit per site, three sites at a time, and stops if two in a row need attention. {initial.some((r) => r.recommended) && <>The site you marked as your <span className="font-semibold">test-first</span> site is ticked and moved to the top of the list.</>}</>
              )}
            </p>
            <ul className="flex flex-col gap-1" data-testid="update-all-list">
              {initial.map((row) => (
                <li key={row.site.id} className="flex items-center justify-between rounded-card border border-line bg-panel px-3 py-2 text-[13px]">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={selected.has(row.site.id)} onChange={() => toggle(row.site.id)} data-testid={`update-all-pick-${row.site.id}`} />
                    <span className="font-semibold">{row.site.name}</span>
                    {row.recommended && <Pill tone="blue">Test first</Pill>}
                    <span className="font-mono text-[12px] text-muted">{row.site.kit_version_in_repo ?? "—"} → {CURRENT_KIT_VERSION}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}

        {progress && (
          <div className="flex flex-col gap-2" data-testid="update-all-progress">
            {progress.paused && (
              <div data-testid="update-all-paused">
                <Notice kind="warning" title="Paused">
                  {progress.pauseReason ?? "Paused."}
                  <span className="mt-2 block">
                    <Button size="sm" onClick={() => controllerRef.current?.resume()} data-testid="update-all-continue">Continue</Button>{" "}
                    <Button size="sm" variant="secondary" onClick={() => controllerRef.current?.stop()} data-testid="update-all-stop">Stop the rest</Button>
                  </span>
                </Notice>
              </div>
            )}
            <ul className="flex flex-col gap-1">
              {progress.runs.map((run) => (
                <li key={run.siteId} className="flex items-center justify-between rounded-card border border-line bg-panel px-3 py-2 text-[13px]" data-testid={`update-all-run-${run.siteId}`}>
                  <span className="flex items-center gap-2">
                    <span className="text-text font-semibold">{run.name}</span>
                    <Pill tone={stateTone[run.state]}>{stateLabel[run.state]}</Pill>
                    {run.message && <span className="text-muted">{run.message}</span>}
                  </span>
                  {run.commitUrl && (
                    <a href={run.commitUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline">
                      View <IconExternal size={12} />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {start.isError && (
          <Notice kind="danger" title="Something stopped the batch">{start.error.message}</Notice>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {!progress && !done && (
            <Button size="sm" onClick={() => start.mutate()} loading={running} disabled={selected.size === 0 || initial.length === 0} data-testid="update-all-start">
              Update {selected.size} site{selected.size === 1 ? "" : "s"}
            </Button>
          )}
          {done && (
            <span className="inline-flex items-center gap-2 text-[13px] text-green">
              <IconCheck size={16} /> Finished. Armature will keep watching each site's live version for up to fifteen minutes.
            </span>
          )}
          {running && !progress?.paused && (
            <Button size="sm" variant="secondary" onClick={() => controllerRef.current?.stop()} data-testid="update-all-stop-inline">
              <IconAlert size={14} /> Stop
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={close}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}
