/**
 * The History panel: every step of this session, newest at the bottom, with the
 * current position marked. Click a step to jump there (undo or redo as many times as
 * it takes). Revisions (past publishes) join it in milestone 6.
 */
import { clsx } from "clsx";
import { IconCheck } from "@/components/icons.tsx";
import type { EditorHistory } from "./history.ts";

export function HistoryPanel({ history, onJump }: { history: EditorHistory; onJump: (steps: number) => void }) {
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
    </div>
  );
}
