/**
 * Undo setup — for a site that has a pre-setup snapshot saved (site-connect
 * writes it when the site is added as needs_setup). One click restores the
 * connected branch's tree to that snapshot as a single revert commit. Never a
 * force-push; the setup commits stay in git history so a re-do is a fresh
 * setup.
 *
 * Agency staff only. When there is no snapshot the panel says so and points at
 * the manual path (revert the setup commits in GitHub, or reconnect the site).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { IconAlert, IconExternal, IconRefresh } from "@/components/icons.tsx";
import { Button, Modal, Notice, Panel } from "@/components/ui.tsx";
import { callFunction, isFailure } from "@/lib/functions.ts";
import type { Site } from "@/lib/types.ts";

type UndoResult = { ok: true; commit: { sha: string; url: string }; changed: { restored: number; deleted: number } };

export function UndoSetupCard({ site }: { site: Site }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const queryClient = useQueryClient();

  const undo = useMutation({
    mutationFn: async (): Promise<UndoResult> => {
      const result = await callFunction<UndoResult>("undo-site-setup", { site_id: site.id });
      if (isFailure(result)) throw new Error(result.message);
      return result;
    },
    onSuccess: () => {
      // Keep the modal open so the reader sees the "Restored" line before pressing Close.
      void queryClient.invalidateQueries({ queryKey: ["kit-status", site.id] });
      void queryClient.invalidateQueries({ queryKey: ["kit-updates", site.id] });
      void queryClient.invalidateQueries({ queryKey: ["site", site.id] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  if (site.status === "hosting_only") return null;

  const hasSnapshot = !!site.pre_setup_commit_sha;

  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-2">
          <IconRefresh size={16} /> Undo setup
        </span>
      }
    >
      <div className="flex flex-col gap-3 p-5" data-testid="undo-setup-card">
        {hasSnapshot ? (
          <>
            <p className="text-[13px] text-text">
              Undo setup restores the repository to how it was BEFORE Armature was set up on it (branch <span className="font-mono">{site.branch}</span> at <span className="font-mono">{site.pre_setup_commit_sha?.slice(0, 7)}</span>). Any pages, media or settings you added through Armature since setup are removed by the revert commit; nothing is force-pushed and the setup commits stay in git history.
            </p>
            <div>
              <Button size="sm" variant="secondary" onClick={() => setConfirmOpen(true)} data-testid="open-undo-setup">
                <IconAlert size={14} /> Undo setup…
              </Button>
            </div>
          </>
        ) : (
          <p className="text-[13px] text-muted" data-testid="undo-setup-none">
            Armature does not have a pre-setup snapshot for this site (it was set up before Armature started saving the snapshot, or the site was added already fully connected). You can still undo the setup by hand: open the repository on GitHub and revert the commits that added the Armature files under <span className="font-mono">{site.kit_path ?? "src/lib/armature-kit"}</span>, <span className="font-mono">content/schema.json</span> and <span className="font-mono">content/pages.json</span>.
          </p>
        )}
      </div>

      {confirmOpen && (
        <Modal open={confirmOpen} title="Undo setup for this site?" onClose={() => { setConfirmOpen(false); undo.reset(); }}>
          <div className="flex flex-col gap-3 p-5" data-testid="undo-setup-modal">
            <p className="text-[13px] text-text">
              This puts the site back exactly how it was before Armature was set up. Your live site will rebuild once. The revert lands as one new commit on <span className="font-mono">{site.branch}</span>; the setup commits stay in git history, so a re-run is a fresh setup.
            </p>
            {undo.isError && (
              <Notice kind="danger" title="Undo setup did not go through">
                {undo.error.message}
              </Notice>
            )}
            {undo.data && (
              <div data-testid="undo-setup-done">
                <Notice kind="success" title="Restored.">
                  Committed to <span className="font-mono">{site.branch}</span>. {undo.data.changed.restored} file{undo.data.changed.restored === 1 ? "" : "s"} restored, {undo.data.changed.deleted} deleted.{" "}
                  <a href={undo.data.commit.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline">
                    View the commit <IconExternal size={12} />
                  </a>
                </Notice>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {!undo.data && (
                <Button size="sm" onClick={() => undo.mutate()} loading={undo.isPending} data-testid="confirm-undo-setup">
                  Undo setup
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={() => { setConfirmOpen(false); undo.reset(); }}>
                {undo.data ? "Close" : "Cancel"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Panel>
  );
}
