/**
 * The repository a publish writes to. "mock" mode keeps an in-memory repository per
 * site, seeded from the working copy's committed files, so publishing can be tried
 * end to end with no GitHub at all (and a test hook can pretend someone else pushed).
 * "app" mode talks to GitHub with an installation token: the open request carries
 * one (minted by the dashboard's GitHub App path, see supabase/functions/_shared/
 * githubApp.ts), or ARMATURE_ENGINE_GITHUB_TOKEN supplies one for local use.
 */
import { spawnSync } from "node:child_process";
import { createGithubContentRepo, type ContentRepo } from "../../supabase/functions/_shared/githubRepo.ts";
import { isBinaryFile } from "../publish/changes.ts";
import { createMockRepo, type MockRepo } from "../publish/mockRepo.ts";
import type { EngineConfig } from "./config.ts";
import { SiteError, type SiteState } from "./sites.ts";

function git(dir: string, args: string[], input?: string): string {
  const result = spawnSync("git", args, { cwd: dir, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...(input === undefined ? {} : { input }) });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new SiteError(`git ${args[0]} failed: ${(result.stderr || "").trim()}`);
  return result.stdout ?? "";
}

/** Every text file committed at HEAD in the working copy, as path → content. */
export function committedTextFiles(dir: string): Record<string, string> {
  const entries = git(dir, ["ls-tree", "-r", "-z", "HEAD"]).split("\0").filter(Boolean);
  const wanted: { path: string; sha: string }[] = [];
  for (const entry of entries) {
    // "<mode> <type> <sha>\t<path>"
    const tab = entry.indexOf("\t");
    if (tab === -1) continue;
    const [, type, sha] = entry.slice(0, tab).split(" ");
    const path = entry.slice(tab + 1);
    if (type !== "blob" || !sha) continue;
    if (isBinaryFile(dir, path)) continue;
    wanted.push({ path, sha });
  }
  const out: Record<string, string> = {};
  if (wanted.length === 0) return out;
  // One git call for every blob: "<sha> blob <size>\n<bytes>\n" per object, parsed as bytes.
  const result = spawnSync("git", ["cat-file", "--batch"], { cwd: dir, maxBuffer: 256 * 1024 * 1024, input: wanted.map((file) => file.sha).join("\n") + "\n" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new SiteError(`git cat-file failed: ${result.stderr.toString("utf8").trim()}`);
  const batch: Buffer = result.stdout;
  let offset = 0;
  for (const file of wanted) {
    const headerEnd = batch.indexOf(0x0a, offset);
    if (headerEnd === -1) break;
    const header = batch.subarray(offset, headerEnd).toString("utf8").split(" ");
    if (header[1] === "missing") {
      offset = headerEnd + 1;
      continue;
    }
    const size = Number(header[2] ?? 0);
    const start = headerEnd + 1;
    out[file.path] = batch.subarray(start, start + size).toString("utf8");
    offset = start + size + 1;
  }
  return out;
}

/** The contents of a committed file at HEAD, or null when HEAD does not have it. */
export function readCommitted(dir: string, path: string): string | null {
  const result = spawnSync("git", ["show", `HEAD:${path}`], { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return result.status === 0 ? (result.stdout ?? "") : null;
}

/** The site's repository, built on first use and then kept for the site's lifetime. */
export function repositoryFor(config: EngineConfig, state: SiteState): ContentRepo {
  if (state.repo) return state.repo;
  if (!state.dir) throw new SiteError("The site has no working copy yet.");
  if (config.github === "mock") {
    const mock = createMockRepo(committedTextFiles(state.dir));
    // The mock has its own commit ids; the editor's base is the mock's first commit.
    state.baseCommit = mock.state.head;
    state.repo = mock;
    return mock;
  }
  const token = state.request.token ?? config.githubToken;
  if (!token) throw new SiteError("Publishing needs a GitHub token: open the site with one, or set ARMATURE_ENGINE_GITHUB_TOKEN.");
  state.repo = createGithubContentRepo({ token, repo: state.request.repo, branch: state.request.branch });
  return state.repo;
}

export function mockRepositoryFor(config: EngineConfig, state: SiteState): MockRepo {
  if (config.github !== "mock") throw new SiteError("This engine is not running with ARMATURE_ENGINE_GITHUB=mock.");
  return repositoryFor(config, state) as MockRepo;
}
