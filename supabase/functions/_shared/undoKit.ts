/**
 * undo-kit-update helpers — extracted so they run under vitest / deno test
 * without booting Deno.serve or GitHub.
 *
 * Undo works by reading the kit folder at the update's `previous_commit_sha`
 * and committing those file contents back on top of the branch's current
 * head. Every file that changed (contents or existence) between the two refs
 * becomes an entry in the CommitFile array:
 *   - Restored file exists AND current file exists AND text differs → change.
 *   - Restored file exists AND current file missing → add.
 *   - Restored file missing AND current file exists → delete.
 *
 * The kit-path prefix is applied outside this module — buildUndoFiles takes
 * kit-relative paths so it stays testable with a small object.
 */
import type { CommitFile, ContentRepo } from "./githubRepo.ts";

const KIT_FILE_RE = /\.(ts|tsx|css|json)$/;
const trimSlash = (path: string) => path.replace(/^\/+|\/+$/g, "");

/**
 * Read every file under `kitPath` at the given commit ref, returning a
 * path→content map with keys relative to kitPath.
 */
export async function readKitFilesAtRef(repo: ContentRepo, kitPath: string, ref: string): Promise<Record<string, string>> {
  const trimmed = trimSlash(kitPath);
  const entries = await repo.listTree(trimmed, ref);
  const files: Record<string, string> = {};
  for (const entry of entries) {
    if (!entry.path.startsWith(`${trimmed}/`)) continue;
    const rel = entry.path.slice(trimmed.length + 1);
    if (!KIT_FILE_RE.test(rel)) continue;
    try {
      const file = await repo.readTextFile(entry.path, ref);
      files[rel] = file.text;
    } catch {
      /* skip files the API refuses (rare — binary, submodule) */
    }
  }
  return files;
}

export type BuildUndoInput = {
  kitPath: string;
  /** kit-relative → contents at the target ref. */
  restoredFiles: Record<string, string>;
  /** kit-relative → contents on the branch head right now. */
  currentFiles: Record<string, string>;
};

export function buildUndoFiles(input: BuildUndoInput): CommitFile[] {
  const kitPath = trimSlash(input.kitPath);
  const files: CommitFile[] = [];
  for (const [rel, content] of Object.entries(input.restoredFiles)) {
    const path = `${kitPath}/${rel}`;
    const existing = input.currentFiles[rel];
    if (existing === content) continue;
    files.push({ path, content, encoding: "utf-8" });
  }
  for (const rel of Object.keys(input.currentFiles)) {
    if (rel in input.restoredFiles) continue;
    files.push({ path: `${kitPath}/${rel}`, content: "", encoding: "utf-8", delete: true });
  }
  return files;
}
