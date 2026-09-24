/**
 * Per-site state: the working copy, the preview (when one is running), the AST
 * editing session and what the editor needs to know about the site. Opening a site
 * runs in the background so the editor can poll /sites/status while the clone,
 * install and dev server start happen.
 */
import { spawnSync } from "node:child_process";
import type { ContentRepo } from "../../supabase/functions/_shared/githubRepo.ts";
import { Project } from "../ast/project.ts";
import { EngineSession, type SiteStyle } from "../ast/session.ts";
import { detectSite } from "../runner/detect.ts";
import { missingEnvMessage, resolveEnv } from "../runner/env.ts";
import { head, openPreview, prepareWorkingCopy, type Preview, type PreviewOptions } from "../runner/preview.ts";

/** Paths git reports as changed or untracked right now. */
function dirtyPaths(dir: string): string[] {
  const result = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all", "--no-renames"], { cwd: dir, encoding: "utf8" });
  return (result.stdout ?? "")
    .split("\n")
    .filter((line) => line.length > 3)
    .map((line) => line.slice(3).trim());
}
import type { OpenRequest } from "../shared/api.ts";
import type { PreviewStatus, SiteInfo } from "../shared/types.ts";
import { sourceFor, type EngineConfig } from "./config.ts";
import { RingLog } from "./log.ts";

export type SiteState = {
  id: string;
  request: OpenRequest;
  status: PreviewStatus;
  preview: Preview | null;
  /** Files the site's own tooling changed while starting (a generated route tree, say): not the person's edits. */
  toolingTouched: string[];
  /** The working copy, once cloned. */
  dir: string | null;
  project: Project | null;
  session: EngineSession | null;
  info: SiteInfo | null;
  /** The commit the editor's changes are based on: what a publish diffs against. */
  baseCommit: string;
  log: RingLog;
  /** The GitHub repository a publish writes to, built on the first publish and kept (the mock must remember its commits). */
  repo: ContentRepo | null;
  /** The background open task, while one is running. */
  task: Promise<void> | null;
};

export class SiteError extends Error {}

export class SiteRegistry {
  private readonly config: EngineConfig;
  private readonly sites = new Map<string, SiteState>();

  constructor(config: EngineConfig) {
    this.config = config;
  }

  get(id: string): SiteState | undefined {
    return this.sites.get(id);
  }

  ids(): string[] {
    return Array.from(this.sites.keys());
  }

  /** The site's state when it is open and ready for edits; throws a readable SiteError otherwise. */
  ready(id: string): SiteState & { dir: string; project: Project; session: EngineSession; info: SiteInfo } {
    const state = this.sites.get(id);
    if (!state) throw new SiteError(`Site "${id}" is not open. Open it first.`);
    if (state.status.phase === "error") throw new SiteError(`The site's preview failed: ${state.status.message}`);
    if (state.status.phase !== "ready" || !state.dir || !state.project || !state.session || !state.info) {
      throw new SiteError(`The site's preview is still starting (${state.status.phase}). Try again in a moment.`);
    }
    return state as SiteState & { dir: string; project: Project; session: EngineSession; info: SiteInfo };
  }

  /** Open a site: returns at once with the current status; the work continues in the background. */
  open(request: OpenRequest): SiteState {
    const existing = this.sites.get(request.site);
    if (existing) {
      const same = existing.request.repo === request.repo && existing.request.branch === request.branch;
      if (same && (existing.status.phase === "ready" || existing.task)) {
        // Newer env values or a fresher token are kept for the next open.
        existing.request = { ...existing.request, ...request };
        return existing;
      }
      // An error state, an idle state, or a different repo: start over.
      void this.close(request.site);
    }
    const state: SiteState = {
      id: request.site,
      request,
      status: { phase: "cloning", message: "Fetching the site's code…", startedAt: Date.now() },
      preview: null,
      toolingTouched: [],
      dir: null,
      project: null,
      session: null,
      info: null,
      baseCommit: "",
      log: new RingLog(200),
      repo: null,
      task: null,
    };
    this.sites.set(request.site, state);
    state.task = this.start(state)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        state.log.push(`error: ${message}`);
        state.status = { phase: "error", message };
      })
      .finally(() => {
        state.task = null;
      });
    return state;
  }

  private previewOptions(state: SiteState, env: Record<string, string>): PreviewOptions {
    const source = sourceFor(this.config, state.request.repo, state.request.branch);
    return {
      cacheDir: this.config.cacheDir,
      repo: state.request.repo,
      branch: state.request.branch,
      ...(source ? { source } : {}),
      ...(state.request.token ? { token: state.request.token } : {}),
      editorOrigins: this.config.editorOrigins,
      env,
      log: (line) => state.log.push(line),
    };
  }

  private async start(state: SiteState): Promise<void> {
    // The working copy must exist before the site can be inspected, so the clone
    // happens first; openPreview repeats it cheaply (fetch + reset on a cached clone).
    const copy = prepareWorkingCopy(this.previewOptions(state, {}));
    state.dir = copy.dir;
    state.baseCommit = copy.headCommit;
    this.inspect(state, copy.headCommit);
    const info = state.info!;
    const env = resolveEnv({
      example: state.project!.read(".env.example") ?? state.project!.read(".env.sample") ?? state.project!.read(".env.template") ?? "",
      committed: state.project!.read(".env") ?? "",
      provided: { ...(this.config.env[state.id] ?? {}), ...(state.request.env ?? {}) },
    });
    info.env = { required: env.required, missing: env.missing };
    if (env.missing.length > 0) {
      state.status = { phase: "error", message: missingEnvMessage(env.missing, state.request.repo), missingEnv: env.missing };
      return;
    }
    if (this.config.skipPreview) {
      state.status = { phase: "ready", url: "", timings: { cloneMs: 0, installMs: 0, startMs: 0, totalMs: 0, cachedInstall: false, cachedClone: copy.cached } };
      return;
    }
    const preview = await openPreview(this.previewOptions(state, env.values), (status) => {
      state.status = status;
    });
    if (!this.sites.has(state.id) || this.sites.get(state.id) !== state) {
      // Closed while starting.
      await preview.stop();
      return;
    }
    state.preview = preview;
    if (preview.headCommit !== state.baseCommit) {
      // The branch moved between the two fetches: inspect again from the final head.
      state.baseCommit = preview.headCommit;
      this.inspect(state, preview.headCommit);
    }
    state.toolingTouched = dirtyPaths(preview.dir);
    if (state.toolingTouched.length > 0) state.log.push(`Ignoring files the site's tooling rewrote on start: ${state.toolingTouched.join(", ")}`);
    state.status = { phase: "ready", url: preview.url, timings: preview.timings };
  }

  /** Build the Project, the SiteInfo and a fresh EngineSession from the working copy. */
  inspect(state: SiteState, headCommit: string): void {
    if (!state.dir) throw new SiteError("The site has no working copy yet.");
    const project = new Project(state.dir);
    const detected = detectSite(project);
    const style: SiteStyle = {
      tailwind: detected.tailwind,
      tailwindVersion: detected.tailwindVersion,
      stylesheet: detected.stylesheet,
      breakpoints: detected.breakpoints,
      colors: detected.colors,
    };
    const previousPage = state.session?.pageFile ?? null;
    state.project = project;
    state.session = new EngineSession(project, style, previousPage);
    state.info = {
      framework: detected.framework,
      packageManager: detected.packageManager,
      tailwind: detected.tailwind,
      stylesheet: detected.stylesheet,
      pages: detected.pages,
      theme: detected.theme,
      env: state.info?.env ?? { required: detected.envRequired, missing: [] },
      headCommit,
    };
  }

  /**
   * Record the editor's changes as a local commit so the working copy is clean again
   * and later changes diff against what was just published. The working copy is
   * disposable (it is reset to the branch on the next open), so a local commit that
   * never gets pushed is fine.
   */
  commitLocally(state: SiteState, message: string): string {
    if (!state.dir) throw new SiteError("The site has no working copy yet.");
    const git = (args: string[]) => spawnSync("git", ["-c", "user.name=Armature", "-c", "user.email=engine@armature.local", ...args], { cwd: state.dir!, encoding: "utf8" });
    git(["add", "-A"]);
    const committed = git(["commit", "-q", "--allow-empty", "-m", message]);
    if (committed.status !== 0) throw new SiteError(`Could not record the publish locally: ${(committed.stderr || committed.stdout).trim()}`);
    const sha = head(state.dir);
    state.project?.invalidate();
    this.inspect(state, sha);
    return sha;
  }

  async close(id: string): Promise<boolean> {
    const state = this.sites.get(id);
    if (!state) return false;
    this.sites.delete(id);
    if (state.preview) await state.preview.stop();
    state.status = { phase: "idle" };
    return true;
  }

  async closeAll(): Promise<void> {
    await Promise.all(Array.from(this.sites.keys()).map((id) => this.close(id)));
  }
}
