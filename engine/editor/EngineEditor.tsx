/**
 * /sites/:siteId/engine?page=<path> — the code engine's editor route (proof of concept,
 * behind the "armature:engine" flag; see engine/flag.ts). Loads the site row, applies the
 * agency's accent, asks the engine server to open the site's repository, shows the
 * opening progress (fetching the code, installing, starting the preview) with elapsed
 * seconds, spells out any failure (and the env keys it is missing), and hands over to
 * the workspace once the preview is ready.
 */
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { useAuth } from "../../src/auth/AuthProvider.tsx";
import { IconAlert, IconClock, IconGithub } from "../../src/components/icons.tsx";
import { useIsStaffFor, useSiteQuery } from "../../src/components/SiteLayout.tsx";
import { Button, LinkButton, Notice, Timeline, type TimelineStep } from "../../src/components/ui.tsx";
import { applyAccent } from "../../src/lib/theme.ts";
import type { Site } from "../../src/lib/types.ts";
import { NotFound } from "../../src/pages/NotFound.tsx";
import { EditorSkeleton } from "../../src/visual/EditorSkeleton.tsx";
import { engineUrl, isEngineEnabled } from "../flag.ts";
import type { SiteStatus } from "../shared/api.ts";
import type { PreviewStatus, SiteInfo } from "../shared/types.ts";
import { createEngineApi, type EngineApi } from "./api.ts";
import { EngineWorkspace } from "./EngineWorkspace.tsx";

type Session =
  | { phase: "idle" }
  | { phase: "opening" }
  | { phase: "cloning" | "installing" | "starting"; message: string; startedAt: number; info: SiteInfo | null }
  | { phase: "ready"; url: string; info: SiteInfo }
  | { phase: "error"; message: string; missingEnv?: string[] };

const PHASE_MESSAGES: Record<string, string> = { opening: "Opening the site…", cloning: "Fetching the site's code…", installing: "Installing…", starting: "Starting the preview…" };

function fromStatus(status: PreviewStatus, info: SiteInfo | null): Session {
  switch (status.phase) {
    case "idle":
      return { phase: "opening" };
    case "ready":
      return info ? { phase: "ready", url: status.url, info } : { phase: "error", message: "The preview is ready but the site could not be read." };
    case "error":
      return { phase: "error", message: status.message, missingEnv: status.missingEnv };
    default:
      return { phase: status.phase, message: status.message || PHASE_MESSAGES[status.phase] || "", startedAt: status.startedAt, info };
  }
}

/** Opens the site on the engine server and polls its status every second until it is ready or failed. */
function useEngineSession(api: EngineApi, siteId: string, site: Site | null) {
  const [session, setSession] = useState<Session>({ phase: "opening" });
  const [attempt, setAttempt] = useState(0);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const owner = site?.repo_owner ?? null;
  const name = site?.repo_name ?? null;
  const branch = site?.branch ?? null;

  useEffect(() => {
    if (!owner || !name || !siteId) return;
    const controller = new AbortController();
    const apply = (status: SiteStatus) => {
      if (controller.signal.aborted) return;
      if (!status.ok) setSession({ phase: "error", message: status.message, missingEnv: status.missingEnv });
      else setSession(fromStatus(status.status, status.site));
    };
    api
      .open({ site: siteId, repo: `${owner}/${name}`, branch: branch || "main" })
      .then((opened) => {
        if (controller.signal.aborted) return null;
        if (!opened.ok) {
          setSession({ phase: "error", message: opened.message, missingEnv: opened.missingEnv });
          return null;
        }
        apply({ ...opened, site: opened.site });
        if (opened.status.phase === "ready" || opened.status.phase === "error") return null;
        return api.waitUntilReady(siteId, { intervalMs: 1000, onStatus: apply, signal: controller.signal });
      })
      .then((final) => {
        if (final && !controller.signal.aborted && !final.ok) setSession({ phase: "error", message: final.message });
      });
    return () => controller.abort();
  }, [api, siteId, owner, name, branch, attempt]);

  const retry = () => {
    setStartedAt(Date.now());
    setSession({ phase: "opening" });
    setAttempt((count) => count + 1);
  };
  return { session, startedAt, retry };
}

function useElapsedSeconds(since: number, running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  return Math.max(0, Math.floor((now - since) / 1000));
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-ground p-6">
      <div className="w-full max-w-lg">{children}</div>
    </div>
  );
}

function Progress({ session, startedAt, repo }: { session: Exclude<Session, { phase: "ready" | "error" }>; startedAt: number; repo: string }) {
  const seconds = useElapsedSeconds(session.phase === "opening" || session.phase === "idle" ? startedAt : Math.min(startedAt, session.startedAt), true);
  const order = ["cloning", "installing", "starting"] as const;
  const current = session.phase === "idle" || session.phase === "opening" ? -1 : order.indexOf(session.phase);
  const steps: TimelineStep[] = order.map((phase, index) => ({
    title: PHASE_MESSAGES[phase] ?? phase,
    detail: index === current ? `${seconds}s` : undefined,
    state: index < current ? "done" : index === current ? "current" : "todo",
  }));
  return (
    <Frame>
      <div className="toast-in flex flex-col gap-4 rounded-card border border-line bg-panel p-6 shadow-sheet" role="status" aria-live="polite" data-testid="engine-progress" data-phase={session.phase}>
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-ground text-text">
            <IconGithub size={20} />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-[18px] font-semibold text-text">Opening the site's code</h2>
            <p className="truncate font-mono text-[12px] text-muted">{repo}</p>
          </div>
        </div>
        <p className="flex items-center gap-2 text-[14px] text-text" data-testid="engine-status" data-phase={session.phase}>
          <IconClock size={15} className="text-muted" />
          {session.phase === "idle" || session.phase === "opening" ? PHASE_MESSAGES["opening"] : session.message || PHASE_MESSAGES[session.phase]}
          <span className="ml-auto tabular-nums text-muted">{seconds}s</span>
        </p>
        <Timeline steps={steps} />
        <p className="text-[12px] leading-relaxed text-muted">The first open fetches the repository and installs its dependencies; later opens reuse both and take a few seconds.</p>
      </div>
    </Frame>
  );
}

export default function EngineEditor() {
  const [enabled] = useState(() => isEngineEnabled());
  const { siteId = "" } = useParams();
  const [search] = useSearchParams();
  // Read once: the workspace keeps ?page= in step as the person moves between pages.
  const [initialPage] = useState(() => search.get("page") || "/");
  const { user, agency } = useAuth();
  const siteQuery = useSiteQuery(siteId);
  const isStaff = useIsStaffFor(siteQuery.data);
  const site = siteQuery.data ?? null;
  const api = useMemo(() => createEngineApi(engineUrl()), []);
  const { session, startedAt, retry } = useEngineSession(api, siteId, enabled ? site : null);

  useEffect(() => {
    applyAccent(agency?.accent_color);
  }, [agency?.accent_color]);

  if (!enabled) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <NotFound />
      </div>
    );
  }
  if (siteQuery.isPending) return <EditorSkeleton message="Loading your site…" />;
  if (siteQuery.isError || !site) {
    return (
      <Frame>
        <Notice kind={siteQuery.isError ? "danger" : "warning"} title={siteQuery.isError ? "The site could not be loaded" : "This site is not available to your account"} action={<LinkButton to="/" variant="secondary" size="sm">Go home</LinkButton>}>
          {siteQuery.isError ? siteQuery.error.message : "Either it does not exist, or your account has not been given access to it."}
        </Notice>
      </Frame>
    );
  }
  if (!site.repo_owner || !site.repo_name) {
    return (
      <Frame>
        <Notice kind="info" title="No repository to edit" action={<LinkButton to={`/sites/${siteId}`} variant="secondary" size="sm">Back</LinkButton>}>
          {site.name} has no GitHub repository connected, so the code engine has nothing to open.
        </Notice>
      </Frame>
    );
  }
  const repo = `${site.repo_owner}/${site.repo_name}`;

  if (session.phase === "error") {
    return (
      <Frame>
        <div className="flex flex-col gap-3" data-testid="engine-progress" data-phase="error">
          <Notice
            kind="danger"
            title="The site could not be opened"
            action={
              <>
                <Button size="sm" onClick={retry}>
                  Try again
                </Button>
                <LinkButton to={`/sites/${siteId}`} variant="secondary" size="sm">
                  Back to the site
                </LinkButton>
              </>
            }
          >
            <p data-testid="engine-status" data-phase="error">
              {session.message}
            </p>
            {session.missingEnv && session.missingEnv.length > 0 && (
              <div className="mt-2">
                <p className="font-semibold">The preview needs these environment values:</p>
                <ul className="mt-1 list-disc pl-5 font-mono text-[12px]" data-testid="engine-missing-env">
                  {session.missingEnv.map((key) => (
                    <li key={key}>{key}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-2 flex items-center gap-1.5 text-[12px]">
              <IconAlert size={13} /> Engine server: <span className="font-mono">{api.baseUrl}</span>
            </p>
          </Notice>
        </div>
      </Frame>
    );
  }
  if (session.phase !== "ready") return <Progress session={session} startedAt={startedAt} repo={repo} />;

  return (
    <EngineWorkspace
      key={`${siteId}:${session.url}`}
      api={api}
      site={site}
      info={session.info}
      previewUrl={session.url}
      isStaff={isStaff}
      agency={agency}
      userName={(user?.user_metadata?.["full_name"] as string | undefined)?.trim() || user?.email?.split("@")[0] || "You"}
      initialPage={initialPage}
    />
  );
}
