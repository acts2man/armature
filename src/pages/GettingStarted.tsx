/**
 * Getting Started — a step-by-step playbook that leads an agency through the
 * first-time setup and the day-to-day work. Sits right below Projects in the
 * agency sidebar; Help stays as the searchable reference and links back here.
 *
 * Per-agency state (which sections are marked done, any 'Use my own video' URL
 * pasted per section) is stored server-side in public.agency_getting_started
 * via the agency-getting-started edge function, so a staff member on any
 * device sees the same ticks and the same custom videos. localStorage keeps a
 * per-browser cache so the UI does not feel broken when Supabase is down.
 *
 * Videos are static assets under public/guide-videos/<section-key>.webm,
 * produced by scripts/record-guide-videos.mjs. When the file is missing, the
 * UI falls back to the placeholder text plus a captions description — no
 * broken video element ever renders.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { IconCheck, IconChevronDown, IconExternal, IconInfo } from "@/components/icons.tsx";
import { Button, Input, Notice, PageHeader, Panel, Pill, SrOnly } from "@/components/ui.tsx";
import { callFunction } from "@/lib/functions.ts";
import {
  GETTING_STARTED_SECTIONS,
  isAllowedVideoUrl,
  SECTION_KEYS,
  screenshotUrl,
  videoUrl,
  type Section,
  type SectionKey,
} from "@/lib/gettingStartedContent.ts";

type ProgressMap = Partial<Record<SectionKey, boolean>>;
type OverrideMap = Partial<Record<SectionKey, string>>;

type State = { progress: ProgressMap; video_overrides: OverrideMap };

type GetResponse = {
  ok: true;
  row: { agency_id: string; progress: ProgressMap; video_overrides: OverrideMap; created_at: string; updated_at: string };
};

const CACHE_KEY = (agencyId: string) => `armature:getting-started:${agencyId}`;

function readCache(agencyId: string): State {
  try {
    if (typeof window === "undefined") return { progress: {}, video_overrides: {} };
    const raw = window.localStorage.getItem(CACHE_KEY(agencyId));
    if (!raw) return { progress: {}, video_overrides: {} };
    const parsed = JSON.parse(raw) as Partial<State>;
    return { progress: parsed.progress ?? {}, video_overrides: parsed.video_overrides ?? {} };
  } catch {
    return { progress: {}, video_overrides: {} };
  }
}

function writeCache(agencyId: string, state: State) {
  try {
    window.localStorage.setItem(CACHE_KEY(agencyId), JSON.stringify(state));
  } catch {
    /* ignore private-mode / disk-full errors: the server is the source of truth */
  }
}

function Progress({ done, total }: { done: number; total: number }) {
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="flex items-center gap-3" aria-label="Getting Started progress">
      <div aria-hidden="true" className="h-2 w-40 rounded-full bg-line">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-[13px] text-muted">
        {done} of {total} done
      </span>
    </div>
  );
}

/**
 * A best-effort local-file check: HEAD the URL and see whether the server answers 200.
 * The dashboard is served by Vite in dev (which does answer HEAD) and by Netlify in
 * production (which also does). A 404 or any other error means the video isn't there,
 * and we fall back to the placeholder — the <video> element is never mounted with a
 * missing source, so no console noise either.
 */
function useVideoAvailable(key: SectionKey): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch(videoUrl(key), { method: "HEAD" })
      .then((response) => {
        if (cancelled) return;
        setAvailable(response.ok);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);
  return available;
}

function VideoBox({
  section,
  override,
  onOverride,
  canEditOverride,
}: {
  section: Section;
  override: string;
  onOverride: (next: string) => void;
  canEditOverride: boolean;
}) {
  // Sync-during-render: the draft mirrors the incoming override until the user starts typing.
  // This is the React 19 pattern for "prop-derived state" — no setState-in-effect needed.
  const [draft, setDraft] = useState(override);
  const [lastSyncedOverride, setLastSyncedOverride] = useState(override);
  if (override !== lastSyncedOverride) {
    setDraft(override);
    setLastSyncedOverride(override);
  }
  const [problem, setProblem] = useState<string | null>(null);
  const localAvailable = useVideoAvailable(section.key);
  const trimmed = draft.trim();
  const overrideActive = override.trim().length > 0 && isAllowedVideoUrl(override);
  const localSrc = videoUrl(section.key);

  const save = () => {
    setProblem(null);
    const value = trimmed;
    if (value.length > 0 && !isAllowedVideoUrl(value)) {
      setProblem("That link is not YouTube, Vimeo, Loom or Wistia — try the video's share link instead.");
      return;
    }
    onOverride(value);
  };
  const clear = () => {
    setProblem(null);
    onOverride("");
  };

  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-panel p-3">
      <p className="text-[13px] font-semibold text-text">Watch it</p>
      {overrideActive ? (
        <p className="text-[13px]" data-testid={`gs-video-player-${section.key}`}>
          <a href={override} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline">
            Open your walkthrough <IconExternal size={12} />
          </a>
          <span className="ml-2 text-[12px] text-muted">(hosted on your video provider)</span>
        </p>
      ) : localAvailable ? (
        <video
          controls
          preload="metadata"
          className="w-full rounded-control border border-line bg-ink"
          data-testid={`gs-video-player-${section.key}`}
        >
          <source src={localSrc} type="video/webm" />
          Your browser cannot play this walkthrough. Read the numbered steps above.
        </video>
      ) : (
        <div className="rounded-control border border-dashed border-line bg-ground px-3 py-3 text-[13px]" data-testid={`gs-video-fallback-${section.key}`}>
          <p className="font-semibold text-text">Walkthrough coming</p>
          <p className="mt-1 text-muted">{section.video.placeholder}</p>
          <p className="mt-2 text-[12px] text-muted">Captions describe: {section.video.captions}</p>
        </div>
      )}
      {canEditOverride && (
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Use your own video (paste a YouTube, Vimeo, Loom or Wistia link)
          <div className="flex flex-wrap gap-2">
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="https://youtu.be/… (Unlisted works well)"
              className="min-w-0 flex-1 font-mono"
              data-testid={`gs-video-${section.key}`}
              aria-invalid={problem ? true : undefined}
              onBlur={save}
            />
            <Button variant="secondary" size="sm" onClick={save}>
              Save
            </Button>
            {override && (
              <Button variant="ghost" size="sm" onClick={clear}>
                Clear
              </Button>
            )}
          </div>
          {problem && (
            <span role="alert" className="text-[12px] text-red">
              {problem}
            </span>
          )}
        </label>
      )}
    </div>
  );
}

function SectionCard({
  section,
  done,
  onToggle,
  override,
  onOverride,
  canEditOverride,
  defaultOpen,
}: {
  section: Section;
  done: boolean;
  onToggle: () => void;
  override: string;
  onOverride: (next: string) => void;
  canEditOverride: boolean;
  defaultOpen: boolean;
}): ReactNode {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Panel
      title={
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center gap-2 text-left"
          data-testid={`gs-toggle-${section.key}`}
          aria-expanded={open}
        >
          <span aria-hidden="true">
            <IconChevronDown size={16} className={open ? "" : "-rotate-90"} />
          </span>
          <span className={done ? "text-muted line-through" : "text-text"}>{section.title}</span>
          {done && <Pill tone="green">Done</Pill>}
        </button>
      }
      aside={
        <label className="flex items-center gap-2 text-[13px] text-text">
          <input type="checkbox" checked={done} onChange={onToggle} data-testid={`gs-check-${section.key}`} />
          Mark this section done
          {done && <SrOnly>(this section is marked done)</SrOnly>}
          {done && (
            <span aria-hidden="true" className="text-green">
              <IconCheck size={16} />
            </span>
          )}
        </label>
      }
    >
      {open && (
        <div className="flex flex-col gap-4 p-5 text-[14px] leading-relaxed text-text" data-testid={`gs-body-${section.key}`}>
          <p className="italic text-muted">{section.what}</p>
          <ol className="ml-4 list-decimal space-y-5">
            {section.steps.map((step, index) => (
              <li key={index} className="space-y-2">
                <p>{step.text}</p>
                <figure className="overflow-hidden rounded-card border border-line bg-panel">
                  <img
                    src={screenshotUrl(step.screenshot)}
                    alt={step.caption}
                    loading="lazy"
                    className="block w-full max-w-2xl bg-ground"
                  />
                  <figcaption className="border-t border-line px-3 py-2 text-[12px] text-muted">{step.caption}</figcaption>
                </figure>
              </li>
            ))}
          </ol>
          {section.cost && (
            <div className="rounded-card border border-line bg-panel px-3 py-2 text-[13px]">
              <span className="font-semibold">What it costs:</span> {section.cost}
            </div>
          )}
          <div className="rounded-card border border-amber/25 bg-amber-soft px-3 py-2 text-[13px] text-amber">
            <span className="font-semibold">If something goes wrong:</span> {section.troubleshoot}
          </div>
          <VideoBox section={section} override={override} onOverride={onOverride} canEditOverride={canEditOverride} />
        </div>
      )}
    </Panel>
  );
}

export function GettingStarted() {
  const { agency, agencyRole } = useAuth();
  const agencyId = agency?.id ?? null;
  const queryClient = useQueryClient();
  // Owner (and staff, for now — we're not gating write access at the RLS level either).
  // Only clients don't see this page at all: it lives under RequireStaff in App.tsx.
  const canEditOverride = agencyRole === "owner" || agencyRole === "staff";
  const keys = useMemo(() => SECTION_KEYS.slice(), []);

  const query = useQuery({
    queryKey: ["agency-getting-started", agencyId],
    queryFn: async () => {
      if (!agencyId) throw new Error("No agency for the current sign-in.");
      const result = await callFunction<GetResponse>("agency-getting-started", { agency_id: agencyId, read: true });
      if (!result.ok) throw new Error(result.message);
      const next: State = { progress: result.row.progress ?? {}, video_overrides: result.row.video_overrides ?? {} };
      // Best-effort local cache so an offline reload still renders the last state.
      if (agencyId) writeCache(agencyId, next);
      return next;
    },
    enabled: !!agencyId,
    initialData: agencyId ? readCache(agencyId) : undefined,
    retry: 1,
  });

  const state: State = query.data ?? { progress: {}, video_overrides: {} };

  const save = useMutation({
    mutationFn: async (patch: { progress?: ProgressMap; video_overrides?: OverrideMap }) => {
      if (!agencyId) throw new Error("No agency for the current sign-in.");
      const result = await callFunction<GetResponse>("agency-getting-started", { agency_id: agencyId, ...patch });
      if (!result.ok) throw new Error(result.message);
      return { progress: result.row.progress ?? {}, video_overrides: result.row.video_overrides ?? {} } as State;
    },
    onSuccess: (next) => {
      if (!agencyId) return;
      queryClient.setQueryData(["agency-getting-started", agencyId], next);
      writeCache(agencyId, next);
    },
  });

  const setDone = (key: SectionKey, done: boolean) => {
    // Optimistic: reflect the change locally through react-query's cache, then send it.
    // If the send fails, an invalidate on the query rewinds to the server's copy.
    const optimistic: State = { progress: { ...state.progress }, video_overrides: state.video_overrides };
    if (done) optimistic.progress[key] = true;
    else delete optimistic.progress[key];
    if (agencyId) {
      writeCache(agencyId, optimistic);
      queryClient.setQueryData(["agency-getting-started", agencyId], optimistic);
    }
    save.mutate({ progress: { [key]: done } });
  };

  const setOverride = (key: SectionKey, url: string) => {
    const value = url.trim();
    const optimistic: State = { progress: state.progress, video_overrides: { ...state.video_overrides } };
    if (value) optimistic.video_overrides[key] = value;
    else delete optimistic.video_overrides[key];
    if (agencyId) {
      writeCache(agencyId, optimistic);
      queryClient.setQueryData(["agency-getting-started", agencyId], optimistic);
    }
    save.mutate({ video_overrides: { [key]: value } });
  };

  const doneCount = keys.reduce((count, key) => count + (state.progress[key] ? 1 : 0), 0);
  const nothingDone = doneCount === 0;

  return (
    <div className="flex flex-col gap-5" data-testid="getting-started">
      <PageHeader
        title="Getting started"
        description="A step-by-step playbook for using Armature end-to-end. Tick a section off when you're done; the ticks are saved for your whole agency. Help (in the sidebar) is the searchable reference; it links back here for the how."
      />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-panel px-4 py-3">
        <div className="text-[14px] font-semibold text-text">Your progress</div>
        <Progress done={doneCount} total={keys.length} />
      </div>
      {save.isError && (
        <Notice kind="danger" title="Could not save that change">
          {save.error instanceof Error ? save.error.message : String(save.error)}
        </Notice>
      )}
      {query.isError && (
        <Notice kind="warning" title="Working from a local copy" action={<Button variant="secondary" size="sm" onClick={() => query.refetch()}>Try again</Button>}>
          Progress and custom videos are saved to this browser for now — the server call failed:{" "}
          {query.error instanceof Error ? query.error.message : String(query.error)}
        </Notice>
      )}
      <div className="flex flex-col gap-4">
        {GETTING_STARTED_SECTIONS.map((section, index) => (
          <SectionCard
            key={section.key}
            section={section}
            done={!!state.progress[section.key]}
            onToggle={() => setDone(section.key, !state.progress[section.key])}
            override={state.video_overrides[section.key] ?? ""}
            onOverride={(next) => setOverride(section.key, next)}
            canEditOverride={canEditOverride}
            defaultOpen={index === 0 && nothingDone}
          />
        ))}
      </div>
      <p className="flex items-center gap-2 text-[13px] text-muted">
        <IconInfo size={14} aria-hidden="true" />
        Looking for something specific?{" "}
        <Link to="/agency/help" className="text-primary underline">
          Help
        </Link>{" "}
        is a searchable index of everything Armature does.
      </p>
    </div>
  );
}
