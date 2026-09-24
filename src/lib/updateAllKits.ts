/**
 * The Update all runner: takes a set of sites the agency chose to update, calls
 * update-kit for up to three at a time, and streams per-site outcomes so the
 * modal can render a live list.
 *
 * The stop rule: if two consecutive sites in the run finish in the
 * `needs_attention` bucket, the runner pauses and asks the user whether to
 * carry on. `dispatch()` returns a controller with `resume()` / `stop()` and
 * emits status updates for every site through `onProgress`.
 *
 * Everything is pure JS so it stays testable — no react-query, no DOM. The
 * caller is expected to invalidate its own queries between batches.
 */
import { callFunction, isFailure } from "./functions.ts";

export type UpdateAllSite = { id: string; name: string; overwrite?: boolean };

export type UpdateAllRunState = "queued" | "running" | "done" | "error" | "skipped";

export type UpdateAllRun = {
  siteId: string;
  name: string;
  state: UpdateAllRunState;
  message?: string;
  commitUrl?: string;
  updateId?: string | null;
};

export type UpdateAllProgress = { runs: UpdateAllRun[]; paused: boolean; pauseReason?: string };

export type UpdateAllController = {
  /** Continues after a stop-rule pause. No-op if the runner is not paused. */
  resume: () => void;
  /** Stops the runner. Sites that hadn't started stay `queued`; the promise resolves. */
  stop: () => void;
  /** Resolves once every site has been processed or the runner is stopped. */
  promise: Promise<UpdateAllProgress>;
};

export type UpdateKitResponse = { ok: true; from: string | null; to: string; commit: { sha: string; url: string }; update_id: string | null };

type Deps = {
  concurrency?: number;
  /** Called after every state change (including "running" transitions) so the UI can re-render. */
  onProgress?: (progress: UpdateAllProgress) => void;
  /** Test seam: replaces the update-kit call with a stub. */
  runOne?: (site: UpdateAllSite) => Promise<UpdateKitResponse | { code: string; message: string }>;
};

const DEFAULT_CONCURRENCY = 3;

async function runViaFunction(site: UpdateAllSite): Promise<UpdateKitResponse | { code: string; message: string }> {
  const result = await callFunction<UpdateKitResponse>("update-kit", { site_id: site.id, overwrite: site.overwrite === true });
  if (isFailure(result)) return { code: result.code, message: result.message };
  return result;
}

export function dispatchUpdateAll(sites: UpdateAllSite[], deps: Deps = {}): UpdateAllController {
  const concurrency = Math.max(1, deps.concurrency ?? DEFAULT_CONCURRENCY);
  const runs: UpdateAllRun[] = sites.map((site) => ({ siteId: site.id, name: site.name, state: "queued" }));
  const bySite = new Map<string, UpdateAllSite>(sites.map((site) => [site.id, site]));
  const queue = [...runs];

  let paused = false;
  let stopped = false;
  let pauseResolver: (() => void) | null = null;
  let pauseReason: string | undefined;
  // How many completed rows there were the last time we paused. We only re-arm
  // the "two in a row" check when at least two NEW completions land after
  // resume, otherwise the runner would pause again on the very same pair.
  let completedAtLastPause = -1;

  const emit = () => {
    const snapshot: UpdateAllProgress = { runs: runs.map((r) => ({ ...r })), paused, pauseReason };
    deps.onProgress?.(snapshot);
  };

  const setState = (siteId: string, patch: Partial<UpdateAllRun>) => {
    const run = runs.find((r) => r.siteId === siteId);
    if (!run) return;
    Object.assign(run, patch);
    emit();
  };

  const consecutiveAttention = (): boolean => {
    const completed = runs.filter((r) => r.state === "error" || r.state === "done" || r.state === "skipped");
    if (completed.length < 2) return false;
    if (completed.length - completedAtLastPause < 2) return false;
    const last = completed[completed.length - 1];
    const prev = completed[completed.length - 2];
    return last?.state === "error" && prev?.state === "error";
  };

  const runFor = deps.runOne ?? runViaFunction;

  const workOne = async (): Promise<void> => {
    while (true) {
      if (stopped) return;
      if (paused) {
        await new Promise<void>((resolve) => { pauseResolver = resolve; });
        continue;
      }
      const next = queue.shift();
      if (!next) return;

      // Enforce the stop rule BEFORE starting the third-consecutive attention case.
      if (consecutiveAttention() && !paused) {
        paused = true;
        pauseReason = "Two sites in a row finished with Needs attention. Check them before Armature updates the rest.";
        completedAtLastPause = runs.filter((r) => r.state === "error" || r.state === "done" || r.state === "skipped").length;
        emit();
        // Put this job back at the head of the queue.
        queue.unshift(next);
        continue;
      }

      const site = bySite.get(next.siteId);
      if (!site) continue;
      setState(next.siteId, { state: "running" });
      try {
        const result = await runFor(site);
        if ("ok" in result) {
          setState(next.siteId, { state: "done", message: `${result.from ?? "unknown"} → ${result.to}`, commitUrl: result.commit.url, updateId: result.update_id });
        } else {
          setState(next.siteId, { state: "error", message: result.message });
        }
      } catch (cause) {
        setState(next.siteId, { state: "error", message: cause instanceof Error ? cause.message : String(cause) });
      }
    }
  };

  const workers = Array.from({ length: concurrency }, () => workOne());

  const promise = Promise.all(workers).then((): UpdateAllProgress => ({ runs: runs.map((r) => ({ ...r })), paused, pauseReason }));

  const controller: UpdateAllController = {
    resume: () => {
      if (!paused) return;
      paused = false;
      pauseReason = undefined;
      const resolver = pauseResolver;
      pauseResolver = null;
      resolver?.();
      emit();
    },
    stop: () => {
      stopped = true;
      // Mark remaining queued rows as skipped so the UI is consistent.
      for (const run of runs) if (run.state === "queued") run.state = "skipped";
      emit();
      pauseResolver?.();
    },
    promise,
  };
  emit();
  return controller;
}
