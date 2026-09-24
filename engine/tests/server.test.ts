/**
 * The engine server end to end, in process: a fixture site turned into a real git
 * repository, cloned by the server into a temporary cache, opened without a preview
 * (no npm install, no dev server), edited, inspected and published to a mock repo.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEngineServer, type EngineServer } from "../server/index.ts";
import type { ChangesResponse, OpenResponse, ResolveResponse } from "../shared/api.ts";
import type { EditResult, Loc, NodeRef, PublishResult } from "../shared/types.ts";

const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));
const SITE = "site-1";
const REPO = "acme/fixture";
const BRANCH = "main";
const ENV = { VITE_SUPABASE_URL: "https://example.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "public-key" };

let root: string;
let engine: EngineServer;
let base: string;

function git(dir: string, args: string[]): string {
  const result = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { cwd: dir, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

/** The fixture as a committed git repository the server can clone from. */
function originFromFixture(name: string, dir: string): string {
  cpSync(join(fixtures, name), dir, { recursive: true });
  git(dir, ["init", "-q", "-b", BRANCH]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "fixture"]);
  return dir;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await response.json()) as T;
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${base}${path}`);
  return (await response.json()) as T;
}

async function waitForOpen(site: string): Promise<OpenResponse> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const status = await get<OpenResponse>(`/sites/status?site=${site}`);
    if (!status.ok) return status;
    if (status.status.phase === "ready" || status.status.phase === "error") return status;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("The site did not open in time.");
}

/** Position of the first occurrence of `needle` in a working copy file, as a Loc. */
function locOf(dir: string, file: string, needle: string): Loc {
  const code = readFileSync(join(dir, file), "utf8");
  const at = code.indexOf(needle);
  if (at === -1) throw new Error(`${needle} not in ${file}`);
  const before = code.slice(0, at);
  return { file, line: before.split("\n").length, col: at - (before.lastIndexOf("\n") + 1) };
}

function refTo(dir: string, file: string, needle: string, tag: string): NodeRef {
  return { loc: locOf(dir, file, needle), usage: null, indices: [], ancestors: [], component: null, tag };
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "armature-engine-server-"));
  const origin = originFromFixture("lovable-site", join(root, "origin"));
  engine = createEngineServer({
    port: 0,
    cacheDir: join(root, "cache"),
    editorOrigins: ["http://localhost:5173"],
    github: "mock",
    sources: { [`${REPO}#${BRANCH}`]: pathToFileURL(origin).href },
    env: { [SITE]: { VITE_SUPABASE_URL: ENV.VITE_SUPABASE_URL } },
    skipPreview: true,
    log: () => {},
  });
  const port = await engine.listen(0);
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await engine.close();
  rmSync(root, { recursive: true, force: true });
});

const workingCopy = () => engine.sites.ready(SITE).dir;

describe("engine server", () => {
  it("answers /health and the CORS preflight for an allowed origin", async () => {
    const health = await get<{ ok: boolean; version: string }>("/health");
    expect(health.ok).toBe(true);
    expect(health.version).toMatch(/^\d/);
    const preflight = await fetch(`${base}/edits/apply`, { method: "OPTIONS", headers: { origin: "http://localhost:5173", "access-control-request-method": "POST" } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
    const denied = await fetch(`${base}/health`, { headers: { origin: "http://evil.example" } });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("reports missing env values instead of starting", async () => {
    await post("/sites/open", { site: "site-missing-env", repo: REPO, branch: BRANCH });
    const status = await waitForOpen("site-missing-env");
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.status.phase).toBe("error");
    if (status.status.phase !== "error") return;
    expect(status.status.missingEnv).toEqual(["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"]);
    expect(status.status.message).toContain("VITE_SUPABASE_URL");
    expect(status.site?.env.missing).toEqual(status.status.missingEnv);
    await post("/sites/close", { site: "site-missing-env" });
  });

  it("opens the site: clones, detects pages and Tailwind, and is ready with no preview", async () => {
    // The server's per-site env supplies one value, the request the other.
    const opened = await post<OpenResponse>("/sites/open", { site: SITE, repo: REPO, branch: BRANCH, env: { VITE_SUPABASE_PUBLISHABLE_KEY: ENV.VITE_SUPABASE_PUBLISHABLE_KEY } });
    expect(opened.ok).toBe(true);
    const status = await waitForOpen(SITE);
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.status).toMatchObject({ phase: "ready", url: "" });
    expect(status.site).not.toBeNull();
    expect(status.site?.tailwind).toBe(true);
    expect(status.site?.framework).toBe("vite-react");
    expect(status.site?.pages.map((page) => page.path)).toEqual(["/", "/about"]);
    expect(status.site?.pages.find((page) => page.path === "/")?.component).toBe("src/pages/Index.tsx");
    expect(status.site?.env).toEqual({ required: ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"], missing: [] });
    expect(status.site?.headCommit).toMatch(/^[0-9a-f]{40}$/);
    // A second open of a ready site returns at once with the same status.
    const again = await post<OpenResponse>("/sites/open", { site: SITE, repo: REPO, branch: BRANCH });
    expect(again.ok && again.status.phase).toBe("ready");
  });

  it("resolves the home page heading and applies a text edit", async () => {
    const ref = refTo(workingCopy(), "src/pages/Index.tsx", "<h1", "h1");
    const resolved = await post<ResolveResponse>("/nodes/resolve", { site: SITE, ref, page: "/" });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.node.kind).toBe("heading");
    expect(resolved.node.text).toMatchObject({ editable: true, value: "Welcome to Fixture" });
    expect(resolved.node.tailwind).toBe(true);

    const applied = await post<EditResult>("/edits/apply", { site: SITE, op: { op: "text", target: ref, value: "Hello from the engine" } });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.changed).toEqual(["src/pages/Index.tsx"]);
    expect(applied.history).toMatchObject({ canUndo: true, canRedo: false, length: 1 });
    expect(readFileSync(join(workingCopy(), "src/pages/Index.tsx"), "utf8")).toContain("Hello from the engine");

    const bad = await post<ResolveResponse>("/nodes/resolve", { site: SITE, ref: { ...ref, loc: { file: "src/pages/Nope.tsx", line: 1, col: 0 } } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message.length).toBeGreaterThan(0);
  });

  it("undo and redo walk the history and report stylesheet changes", async () => {
    const undone = await post<EditResult>("/edits/undo", { site: SITE });
    expect(undone.ok && undone.label).toBe("Undo Edit text");
    expect(readFileSync(join(workingCopy(), "src/pages/Index.tsx"), "utf8")).toContain("Welcome to");
    const redone = await post<EditResult>("/edits/redo", { site: SITE });
    expect(redone.ok && redone.label).toBe("Redo Edit text");
    expect(readFileSync(join(workingCopy(), "src/pages/Index.tsx"), "utf8")).toContain("Hello from the engine");
    // A plain-CSS site would write into its stylesheet; here Tailwind classes are used, so no cssChanged.
    expect((redone as { cssChanged?: string[] }).cssChanged).toBeUndefined();
  });

  it("lists the changed files with a diff", async () => {
    const changes = await get<ChangesResponse>(`/changes?site=${SITE}`);
    expect(changes.ok).toBe(true);
    if (!changes.ok) return;
    expect(changes.files).toMatchObject([{ path: "src/pages/Index.tsx", status: "modified", binary: false }]);
    expect(changes.files[0]?.additions).toBeGreaterThan(0);
    expect(changes.diff).toContain("+");
    expect(changes.diff).toContain("Hello from the engine");
    expect(changes.headCommit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("publishes as one commit and leaves nothing to publish afterwards", async () => {
    const published = await post<PublishResult>("/publish", { site: SITE, message: "Change the heading" });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(published.commitSha).toMatch(/^[0-9a-f]+$/);
    expect(published.files).toEqual(["src/pages/Index.tsx"]);
    expect(published.rebased).toEqual([]);
    expect(published.diff).toContain("Hello from the engine");

    const changes = await get<ChangesResponse>(`/changes?site=${SITE}`);
    expect(changes.ok && changes.files).toEqual([]);
    expect(changes.ok && changes.diff).toBe("");
    // The history starts over after a publish.
    const undone = await post<EditResult>("/edits/undo", { site: SITE });
    expect(undone.ok).toBe(false);
    // The mock repository has the new heading at its head.
    const nothing = await post<PublishResult>("/publish", { site: SITE, message: "Nothing" });
    expect(nothing).toMatchObject({ ok: false, code: "nothing" });
  });

  it("rebases a second publish over someone else's commit, or reports the conflict", async () => {
    // Someone else changes a different file (and a different part of the same file would rebase too).
    const moved = await post<{ ok: boolean; commitSha: string }>("/publish/simulate-move", { site: SITE, files: { "src/pages/About.tsx": "export default function About() {\n  return <h1>Moved by someone else</h1>;\n}\n" } });
    expect(moved.ok).toBe(true);

    const ref = refTo(workingCopy(), "src/pages/Index.tsx", "<h1", "h1");
    const applied = await post<EditResult>("/edits/apply", { site: SITE, op: { op: "text", target: ref, value: "Second heading" } });
    expect(applied.ok).toBe(true);

    const published = await post<PublishResult>("/publish", { site: SITE, message: "Second edit" });
    if (published.ok) {
      expect(published.files).toEqual(["src/pages/Index.tsx"]);
      expect(published.commitSha).not.toBe(moved.commitSha);
      expect(Array.isArray(published.rebased)).toBe(true);
      const changes = await get<ChangesResponse>(`/changes?site=${SITE}`);
      expect(changes.ok && changes.files).toEqual([]);
    } else {
      expect(published.code).toBe("conflict");
      expect(published.conflicts?.map((conflict) => conflict.path)).toContain("src/pages/Index.tsx");
    }

    // Both sides touch the same line: a conflict, resolvable by keeping "mine".
    await post("/publish/simulate-move", { site: SITE, files: { "src/pages/Index.tsx": readFileSync(join(workingCopy(), "src/pages/Index.tsx"), "utf8").replace("Second heading", "Their heading") } });
    const again = await post<EditResult>("/edits/apply", { site: SITE, op: { op: "text", target: refTo(workingCopy(), "src/pages/Index.tsx", "<h1", "h1"), value: "Third heading" } });
    expect(again.ok).toBe(true);
    const conflict = await post<PublishResult>("/publish", { site: SITE, message: "Third edit" });
    expect(conflict).toMatchObject({ ok: false, code: "conflict" });
    if (conflict.ok) return;
    expect(conflict.conflicts?.[0]?.path).toBe("src/pages/Index.tsx");
    const resolved = await post<PublishResult>("/publish", { site: SITE, message: "Third edit", resolutions: { "src/pages/Index.tsx": "mine" } });
    expect(resolved.ok).toBe(true);
  });

  it("closes the site", async () => {
    const closed = await post<{ ok: boolean; closed: boolean }>("/sites/close", { site: SITE });
    expect(closed).toEqual({ ok: true, closed: true });
    const status = await get<OpenResponse>(`/sites/status?site=${SITE}`);
    expect(status.ok && status.status.phase).toBe("idle");
    const edit = await post<EditResult>("/edits/undo", { site: SITE });
    expect(edit.ok).toBe(false);
  });
});
