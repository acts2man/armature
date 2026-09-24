/**
 * The preview runner: a working copy per site under the cache directory, dependencies
 * installed once and reused while the lockfile is unchanged, and the site's Vite dev
 * server started in a child process with the Armature plugins. Every step is timed so
 * the report can say how long a first open and a later open take.
 *
 * Cache layout: <cacheDir>/sites/<owner>__<repo>__<branch>/repo (the clone, with its
 * node_modules kept between runs). The working copy is reset to the branch head on
 * every open, so each editing session starts from what is published.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PreviewStatus, Timings } from "../shared/types.ts";

export type PreviewOptions = {
  cacheDir: string;
  /** "owner/repo" */
  repo: string;
  branch: string;
  /** Where to clone from: a GitHub URL by default; a local path or file:// URL in tests. */
  source?: string;
  /** A token for private repositories (https://x-access-token:<token>@github.com/...). */
  token?: string;
  editorOrigins: string[];
  env: Record<string, string>;
  log?: (line: string) => void;
};

export type Preview = {
  dir: string;
  url: string;
  headCommit: string;
  timings: Timings;
  process: ChildProcess;
  stop: () => Promise<void>;
};

const here = fileURLToPath(new URL(".", import.meta.url));

function run(command: string, args: string[], cwd: string, log?: (line: string) => void): { ok: boolean; output: string } {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: { ...process.env, CI: "1", ADBLOCK: "1", HUSKY: "0" }, maxBuffer: 64 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  log?.(`$ ${command} ${args.join(" ")}\n${output.slice(-4000)}`);
  return { ok: result.status === 0, output };
}

export function siteKey(repo: string, branch: string): string {
  return `${repo.replace("/", "__")}__${branch.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
}

function cloneUrl(options: PreviewOptions): string {
  if (options.source) return options.source;
  return options.token ? `https://x-access-token:${options.token}@github.com/${options.repo}.git` : `https://github.com/${options.repo}.git`;
}

/** Clone or refresh the working copy; returns whether the clone was reused. */
export function prepareWorkingCopy(options: PreviewOptions): { dir: string; cached: boolean; headCommit: string } {
  const dir = join(options.cacheDir, "sites", siteKey(options.repo, options.branch), "repo");
  const url = cloneUrl(options);
  if (existsSync(join(dir, ".git"))) {
    const fetched = run("git", ["fetch", "--depth", "50", "origin", options.branch], dir, options.log);
    if (!fetched.ok) throw new Error(`Could not fetch ${options.repo} ${options.branch}: ${fetched.output.slice(-500)}`);
    run("git", ["checkout", "-f", "-B", options.branch, `origin/${options.branch}`], dir, options.log);
    run("git", ["reset", "--hard", `origin/${options.branch}`], dir, options.log);
    run("git", ["clean", "-fd"], dir, options.log);
    return { dir, cached: true, headCommit: head(dir) };
  }
  mkdirSync(resolve(dir, ".."), { recursive: true });
  const cloned = run("git", ["clone", "--depth", "50", "--branch", options.branch, "--single-branch", url, dir], resolve(dir, ".."), options.log);
  if (!cloned.ok) throw new Error(`Could not clone ${options.repo} (${options.branch}): ${cloned.output.replace(options.token ?? "\u0000", "***").slice(-500)}`);
  return { dir, cached: false, headCommit: head(dir) };
}

export function head(dir: string): string {
  return run("git", ["rev-parse", "HEAD"], dir).output.trim();
}

function lockHash(dir: string): string {
  const hash = createHash("sha1");
  for (const name of ["package.json", "package-lock.json", "bun.lock", "bun.lockb", "pnpm-lock.yaml", "yarn.lock"]) {
    const path = join(dir, name);
    if (existsSync(path)) hash.update(name).update(readFileSync(path));
  }
  return hash.digest("hex");
}

/**
 * Install dependencies unless node_modules already matches the lockfile. bun is tried
 * first when the site uses it; npm from the public registry is the fallback (Lovable's
 * lockfiles point at a private mirror that only Lovable's own sandboxes can reach).
 */
export function installDependencies(dir: string, log?: (line: string) => void): { cached: boolean; manager: string } {
  const stamp = join(dir, "node_modules", ".armature-install");
  const wanted = lockHash(dir);
  if (existsSync(stamp) && readFileSync(stamp, "utf8").trim() === wanted && existsSync(join(dir, "node_modules", "vite"))) return { cached: true, manager: "cache" };
  const attempts: { manager: string; command: string; args: string[] }[] = [];
  if (existsSync(join(dir, "bun.lock")) || existsSync(join(dir, "bun.lockb"))) attempts.push({ manager: "bun", command: "bun", args: ["install", "--frozen-lockfile", "--no-progress"] });
  if (existsSync(join(dir, "pnpm-lock.yaml"))) attempts.push({ manager: "pnpm", command: "pnpm", args: ["install", "--frozen-lockfile"] });
  if (existsSync(join(dir, "package-lock.json"))) attempts.push({ manager: "npm", command: "npm", args: ["ci", "--no-audit", "--no-fund"] });
  attempts.push({ manager: "npm", command: "npm", args: ["install", "--no-package-lock", "--no-audit", "--no-fund", "--registry=https://registry.npmjs.org"] });
  let lastOutput = "";
  for (const attempt of attempts) {
    const result = run(attempt.command, attempt.args, dir, log);
    if (result.ok && existsSync(join(dir, "node_modules", "vite"))) {
      writeFileSync(stamp, wanted);
      return { cached: false, manager: attempt.manager };
    }
    lastOutput = result.output;
  }
  throw new Error(`Installing the site's dependencies failed. Last output:\n${lastOutput.slice(-1500)}`);
}

export async function freePort(start = 4500): Promise<number> {
  for (let port = start; port < start + 200; port += 1) {
    const free = await new Promise<boolean>((resolvePort) => {
      const server = createServer();
      server.once("error", () => resolvePort(false));
      server.listen(port, "127.0.0.1", () => server.close(() => resolvePort(true)));
    });
    if (free) return port;
  }
  throw new Error("No free port for the preview.");
}

export function startDevServer(dir: string, port: number, options: { editorOrigins: string[]; env: Record<string, string>; log?: (line: string) => void }): Promise<{ url: string; process: ChildProcess }> {
  return new Promise((resolveStart, reject) => {
    const script = resolve(here, "previewProcess.ts");
    const child = spawn(process.execPath, ["--import", "tsx", script, dir, String(port), JSON.stringify({ editorOrigins: options.editorOrigins, env: options.env, exitOnStdinEnd: true })], {
      cwd: dir,
      env: { ...process.env, ...options.env, NODE_ENV: "development", BROWSER: "none", FORCE_COLOR: "0" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let settled = false;
    let buffer = "";
    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      options.log?.(text.trimEnd());
      buffer += text;
      const ready = /ARMATURE_PREVIEW_READY (\S+)/.exec(buffer);
      if (ready && !settled) {
        settled = true;
        resolveStart({ url: ready[1] as string, process: child });
      }
      const failed = /ARMATURE_PREVIEW_ERROR (.*)/.exec(buffer);
      if (failed && !settled) {
        settled = true;
        reject(new Error(failed[1]));
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`The preview server stopped before it was ready (exit ${code}).\n${buffer.slice(-1500)}`));
      }
    });
    setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new Error(`The preview server did not start within 120 seconds.\n${buffer.slice(-1500)}`));
      }
    }, 120_000);
  });
}

/** Wait until the dev server answers the first page (Vite's first request compiles the app). */
export async function warmUp(url: string, path = "/"): Promise<number> {
  const started = Date.now();
  const response = await fetch(new URL(path, url), { headers: { Accept: "text/html" } }).catch(() => null);
  if (response) await response.text().catch(() => "");
  return Date.now() - started;
}

export async function openPreview(options: PreviewOptions, onStatus?: (status: PreviewStatus) => void): Promise<Preview> {
  const total = Date.now();
  onStatus?.({ phase: "cloning", message: "Fetching the site's code…", startedAt: Date.now() });
  const cloneStart = Date.now();
  const copy = prepareWorkingCopy(options);
  const cloneMs = Date.now() - cloneStart;

  onStatus?.({ phase: "installing", message: "Installing the site's dependencies (the first time takes a few minutes; later opens reuse them)…", startedAt: Date.now() });
  const installStart = Date.now();
  const install = installDependencies(copy.dir, options.log);
  const installMs = Date.now() - installStart;

  onStatus?.({ phase: "starting", message: "Starting the preview…", startedAt: Date.now() });
  const startStart = Date.now();
  const port = await freePort();
  const server = await startDevServer(copy.dir, port, { editorOrigins: options.editorOrigins, env: options.env, log: options.log });
  await warmUp(server.url);
  const startMs = Date.now() - startStart;

  const timings: Timings = { cloneMs, installMs, startMs, totalMs: Date.now() - total, cachedInstall: install.cached, cachedClone: copy.cached };
  return {
    dir: copy.dir,
    url: server.url,
    headCommit: copy.headCommit,
    timings,
    process: server.process,
    stop: () =>
      new Promise((resolveStop) => {
        if (server.process.exitCode !== null) return resolveStop();
        server.process.once("exit", () => resolveStop());
        server.process.kill("SIGTERM");
        setTimeout(() => {
          if (server.process.exitCode === null) server.process.kill("SIGKILL");
          resolveStop();
        }, 5000);
      }),
  };
}
