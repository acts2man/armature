/**
 * The History panel: every step of this session, newest at the bottom, with the
 * current position marked. Click a step to jump there (undo or redo as many times as
 * it takes). Below them, the published versions of the site: preview one on the canvas,
 * then restore it as a draft if it is the one you want.
 */
import { clsx } from "clsx";
import { IconCheck, IconEye } from "@/components/icons.tsx";
import { relativeTime } from "@/lib/format.ts";
import type { EditorHistory } from "./history.ts";
import type { Revision } from "./revisions.ts";

export type RevisionList = {
  revisions: Revision[];
  loading: boolean;
  previewing: string | null;
  pageLabel: (slug: string) => string;
  who: (userId: string | null) => string;
  onPreview: (revision: Revision) => void;
};

export function HistoryPanel({ history, onJump, versions }: { history: EditorHistory; onJump: (steps: number) => void; versions?: RevisionList }) {
  const entries = [...history.past, ...history.future];
  const current = history.past.length;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="history-panel">
      <p className="px-3 pb-2 text-[12px] leading-relaxed text-muted">Every change this session, oldest first. Click a step to go back or forward to it.</p>
      <ol className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <li>
          <button type="button" onClick={() => onJump(0)} className={clsx("flex h-9 w-full items-center gap-2 rounded-sm px-2 text-left text-[13px]", current === 0 ? "bg-blue-soft font-semibold text-blue" : "text-muted hover:bg-ground")}>
            <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center">{current === 0 && <IconCheck size={14} />}</span>
            Opened the editor
          </button>
        </li>
        {entries.map((entry, index) => {
          const steps = index + 1;
          const active = steps === current;
          const undone = steps > current;
          return (
            <li key={`${entry.at}-${index}`}>
              <button type="button" data-testid={`history-${steps}`} onClick={() => onJump(steps)} className={clsx("flex h-9 w-full items-center gap-2 rounded-sm px-2 text-left text-[13px]", active ? "bg-blue-soft font-semibold text-blue" : undone ? "text-muted/70 hover:bg-ground" : "text-text hover:bg-ground")}>
                <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center">{active && <IconCheck size={14} />}</span>
                <span className={clsx("truncate", undone && "line-through decoration-line")}>{entry.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {versions && (
        <section aria-label="Published versions" className="max-h-[45%] shrink-0 overflow-y-auto border-t border-line px-2 pb-3 pt-2" data-testid="revisions">
          <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-muted">Published versions</p>
          {versions.loading && <p className="px-2 py-1 text-[12px] text-muted">Loading…</p>}
          {!versions.loading && versions.revisions.length === 0 && <p className="px-2 py-1 text-[12px] text-muted">Nothing published from the editor yet.</p>}
          <ul>
            {versions.revisions.map((revision, index) => (
              <li key={revision.sha}>
                <button
                  type="button"
                  onClick={() => versions.onPreview(revision)}
                  className={clsx("flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left", versions.previewing === revision.sha ? "bg-blue-soft text-blue" : "text-text hover:bg-ground")}
                  data-testid="revision"
                >
                  <IconEye size={14} className="mt-0.5 shrink-0 text-muted" />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">
                      {relativeTime(revision.at)}
                      {index === 0 && " · live now"}
                    </span>
                    <span className="block truncate text-[11px] text-muted">
                      {versions.who(revision.userId)} · {revision.pages.map(versions.pageLabel).join(", ")}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
