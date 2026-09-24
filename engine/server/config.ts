/**
 * The engine server's configuration, read from the environment once at startup (or
 * handed in directly by tests). Every value has a default so `npm run engine` works
 * with nothing set.
 *
 *   ARMATURE_ENGINE_PORT            port to listen on (4400)
 *   ARMATURE_ENGINE_CACHE           where working copies and node_modules live (<repo>/.armature-engine-cache)
 *   ARMATURE_ENGINE_EDITOR_ORIGINS  comma list of browser origins allowed to call the engine
 *   ARMATURE_ENGINE_GITHUB          "mock" (an in-memory repo per site) or "app" (the real GitHub API)
 *   ARMATURE_ENGINE_GITHUB_TOKEN    the token "app" mode uses when the open request carries none
 *   ARMATURE_ENGINE_SOURCES         JSON { "owner/repo#branch": "/local/path or url" }: clone sources (tests)
 *   ARMATURE_ENGINE_ENV             JSON { "site-id": { KEY: "value" } }: per-site env for the preview
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type GithubMode = "mock" | "app";

export type EngineConfig = {
  port: number;
  cacheDir: string;
  editorOrigins: string[];
  github: GithubMode;
  githubToken?: string;
  /** "owner/repo#branch" → clone source (a local path, file:// URL or https URL). */
  sources: Record<string, string>;
  /** site id → env values handed to the preview (merged under the open request's own env). */
  env: Record<string, Record<string, string>>;
  /** Tests: clone and detect the site, but do not install dependencies or start a dev server. */
  skipPreview?: boolean;
  /** Where request lines go; defaults to stdout. */
  log?: (line: string) => void;
};

/** The armature repository root (this file lives in <repo>/engine/server/). */
export const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export const DEFAULT_EDITOR_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

function parseJsonObject<T>(raw: string | undefined, name: string, fallback: T): T {
  if (!raw || !raw.trim()) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as T;
  } catch (error) {
    throw new Error(`${name} must be a JSON object: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): EngineConfig {
  const port = Number(env["ARMATURE_ENGINE_PORT"] ?? 4400);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`ARMATURE_ENGINE_PORT is not a port: ${env["ARMATURE_ENGINE_PORT"]}`);
  const github = env["ARMATURE_ENGINE_GITHUB"] ?? "mock";
  if (github !== "mock" && github !== "app") throw new Error(`ARMATURE_ENGINE_GITHUB must be "mock" or "app", not "${github}"`);
  const origins = (env["ARMATURE_ENGINE_EDITOR_ORIGINS"] ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
  const sources = parseJsonObject<Record<string, string>>(env["ARMATURE_ENGINE_SOURCES"], "ARMATURE_ENGINE_SOURCES", {});
  const siteEnv = parseJsonObject<Record<string, Record<string, string>>>(env["ARMATURE_ENGINE_ENV"], "ARMATURE_ENGINE_ENV", {});
  return {
    port,
    cacheDir: resolve(env["ARMATURE_ENGINE_CACHE"] || resolve(repoRoot, ".armature-engine-cache")),
    editorOrigins: origins.length > 0 ? origins : DEFAULT_EDITOR_ORIGINS,
    github,
    ...(env["ARMATURE_ENGINE_GITHUB_TOKEN"] ? { githubToken: env["ARMATURE_ENGINE_GITHUB_TOKEN"] } : {}),
    sources,
    env: siteEnv,
  };
}

/** The clone source configured for a repo and branch, if any. */
export function sourceFor(config: EngineConfig, repo: string, branch: string): string | undefined {
  return config.sources[`${repo}#${branch}`] ?? config.sources[repo];
}
