/**
 * What changed in the working copy since its last commit, read straight from git.
 * The editor's clone is never committed to locally, so "changed" means anything
 * `git status` reports against HEAD: modified, deleted and untracked files.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ChangedFile } from "../shared/types.ts";

/** Extensions that are never diffed as text, whatever their bytes look like. */
const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "bmp", "tiff", "tif", "heic",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp3", "mp4", "webm", "ogg", "wav", "m4a", "mov",
  "pdf", "zip", "gz", "tar", "7z", "rar", "wasm", "exe", "dll", "so", "dylib",
]);

function git(dir: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  return result.stdout ?? "";
}

/** True when the path looks binary by extension, or by content when the file exists. */
export function isBinaryFile(dir: string, path: string): boolean {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (path.includes(".") && BINARY_EXTENSIONS.has(extension)) return true;
  try {
    // The same heuristic git uses: a NUL byte near the start means binary.
    const bytes = readFileSync(join(dir, path));
    const probe = bytes.subarray(0, 8000);
    return probe.includes(0);
  } catch {
    return false;
  }
}

/** Line count the way `git diff --numstat` counts a brand-new file. */
function countLines(text: string): number {
  if (text === "") return 0;
  const count = text.split("\n").length;
  return text.endsWith("\n") ? count - 1 : count;
}

/** Additions and deletions per path from `git diff HEAD --numstat`, with "-" for binary. */
function numstat(dir: string): Map<string, { additions: number; deletions: number; binary: boolean }> {
  const out = new Map<string, { additions: number; deletions: number; binary: boolean }>();
  const raw = git(dir, ["diff", "HEAD", "--numstat", "-z", "--no-renames"]);
  const parts = raw.split("\0");
  for (const part of parts) {
    if (part === "") continue;
    const [added, deleted, path] = part.split("\t");
    if (path === undefined || added === undefined || deleted === undefined) continue;
    const binary = added === "-" || deleted === "-";
    out.set(path, { additions: binary ? 0 : Number(added), deletions: binary ? 0 : Number(deleted), binary });
  }
  return out;
}

/** Every changed file in the working copy, sorted by path. */
export function collectChanges(dir: string, ignore: string[] = []): ChangedFile[] {
  const raw = git(dir, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"]);
  const stats = numstat(dir);
  const entries = raw.split("\0");
  const seen = new Set<string>();
  const changes: ChangedFile[] = [];

  for (const entry of entries) {
    if (entry.length < 4) continue;
    const index = entry[0] ?? " ";
    const worktree = entry[1] ?? " ";
    const path = entry.slice(3);
    if (seen.has(path)) continue;
    seen.add(path);

    if (index === "?" && worktree === "?") {
      // Untracked: everything in it is new.
      const binary = isBinaryFile(dir, path);
      let additions = 0;
      if (!binary) {
        try {
          additions = countLines(readFileSync(join(dir, path), "utf8"));
        } catch {
          additions = 0;
        }
      }
      changes.push({ path, status: "added", additions, deletions: 0, binary });
      continue;
    }
    if (index === "!" && worktree === "!") continue;

    const stat = stats.get(path);
    const deleted = worktree === "D" || (index === "D" && worktree === " ");
    const added = index === "A" && worktree !== "D";
    const binary = stat?.binary ?? isBinaryFile(dir, path);
    changes.push({
      path,
      status: deleted ? "deleted" : added ? "added" : "modified",
      additions: stat?.additions ?? 0,
      deletions: stat?.deletions ?? 0,
      binary,
    });
  }

  return changes.filter((change) => !ignore.includes(change.path)).sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
}

/** A unified diff for a file that git does not know yet, in the shape `git diff` would print. */
function untrackedDiff(dir: string, path: string): string {
  const text = readFileSync(join(dir, path), "utf8");
  const lines = text.split("\n");
  const noNewlineAtEnd = !text.endsWith("\n") && text !== "";
  if (text.endsWith("\n")) lines.pop();
  const body = lines.map((line) => `+${line}`);
  if (noNewlineAtEnd) body.push("\\ No newline at end of file");
  const count = text === "" ? 0 : lines.length;
  return [`diff --git a/${path} b/${path}`, "new file mode 100644", "--- /dev/null", `+++ b/${path}`, `@@ -0,0 +1,${count} @@`, ...body].join("\n") + "\n";
}

/** The full diff of the working copy: tracked changes from git, plus every untracked file. */
export function readDiff(dir: string, ignore: string[] = []): string {
  let diff = git(dir, ["diff", "HEAD", "--no-renames", "--no-color", "--", ".", ...ignore.map((path) => `:(exclude)${path}`)]);
  if (diff !== "" && !diff.endsWith("\n")) diff += "\n";
  for (const change of collectChanges(dir, ignore)) {
    if (change.status !== "added") continue;
    // Staged additions are already in `git diff HEAD`; only untracked ones are missing.
    if (isTracked(dir, change.path)) continue;
    if (change.binary) {
      let size: number;
      try {
        size = statSync(join(dir, change.path)).size;
      } catch {
        size = 0;
      }
      diff += `Binary file added: ${change.path} (${size} bytes)\n`;
    } else {
      diff += untrackedDiff(dir, change.path);
    }
  }
  return diff;
}

function isTracked(dir: string, path: string): boolean {
  const result = spawnSync("git", ["ls-files", "--error-unmatch", "--", path], { cwd: dir, encoding: "utf8" });
  return result.status === 0;
}
