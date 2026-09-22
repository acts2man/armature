
/**
 * One command system and undo stack for every kind of change: Stage 1 content fields
 * and pictures, builder elements, the site kit, pages. A command names itself ("Moved
 * Image"), runs against the whole editor state and returns the next state (or null when
 * nothing changed). Continuous typing and drags carry a group key so a run of them is
 * one undo step. Each history entry keeps the state before and after (immutable, with
 * structural sharing), so undo, redo and click-to-jump are O(1) swaps. Pure module.
 */
import type { Draft } from "@/visual/draftStore.ts";
import type { BuilderState } from "./store.ts";

export type EditorState = {
  /** Stage 1: changed content fields and pictures waiting to publish. */
  content: Draft;
  builder: BuilderState;
};

export type Command = {
  label: string;
  /** Consecutive commands with the same group inside GROUP_MS merge into one step. */
  group?: string;
  run: (state: EditorState) => EditorState | null;
};

export type HistoryEntry = { label: string; before: EditorState; after: EditorState; group?: string; at: number };

export type EditorHistory = {
  present: EditorState;
  past: HistoryEntry[];
  future: HistoryEntry[];
};

export const GROUP_MS = 900;
const MAX_ENTRIES = 300;

export const createHistory = (present: EditorState): EditorHistory => ({ present, past: [], future: [] });

export function apply(history: EditorHistory, command: Command, now = Date.now()): EditorHistory {
  const next = command.run(history.present);
  if (next === null || next === history.present) return history;
  const last = history.past[history.past.length - 1];
  // A "drag:" group (one resize or spacing drag, keyed by its start) merges however long the
  // pointer rests; other groups merge only while the changes keep coming.
  if (command.group && last && last.group === command.group && (command.group.startsWith("drag:") || now - last.at < GROUP_MS)) {
    const merged: HistoryEntry = { ...last, after: next, at: now };
    return { present: next, past: [...history.past.slice(0, -1), merged], future: [] };
  }
  const entry: HistoryEntry = { label: command.label, before: history.present, after: next, group: command.group, at: now };
  return { present: next, past: [...history.past, entry].slice(-MAX_ENTRIES), future: [] };
}

export const canUndo = (history: EditorHistory): boolean => history.past.length > 0;
export const canRedo = (history: EditorHistory): boolean => history.future.length > 0;

export function undo(history: EditorHistory): EditorHistory {
  const entry = history.past[history.past.length - 1];
  if (!entry) return history;
  return { present: entry.before, past: history.past.slice(0, -1), future: [entry, ...history.future] };
}

export function redo(history: EditorHistory): EditorHistory {
  const entry = history.future[0];
  if (!entry) return history;
  return { present: entry.after, past: [...history.past, entry], future: history.future.slice(1) };
}

/** Jump so that exactly `steps` entries are applied (0 = the state the session opened with). */
export function jumpTo(history: EditorHistory, steps: number): EditorHistory {
  let current = history;
  while (current.past.length > steps && canUndo(current)) current = undo(current);
  while (current.past.length < steps && canRedo(current)) current = redo(current);
  return current;
}

/** Replace the present without recording a step (a publish, a reload, a restored draft). */
export const reset = (present: EditorState): EditorHistory => ({ present, past: [], future: [] });

/** Close the current group so the next command of the same group starts a new step. */
export function breakGroup(history: EditorHistory): EditorHistory {
  const last = history.past[history.past.length - 1];
  if (!last || !last.group) return history;
  return { ...history, past: [...history.past.slice(0, -1), { ...last, group: undefined }] };
}

/** Esc during a drag: remove the drag's step entirely (the page returns to where it was, and redo cannot bring it back). */
export function dropGroup(history: EditorHistory, group: string): EditorHistory {
  const last = history.past[history.past.length - 1];
  if (!last || last.group !== group) return history;
  return { present: last.before, past: history.past.slice(0, -1), future: history.future };
}
