/**
 * Publish the working copy's changes as ONE commit on the content branch.
 *
 * The editor started from `baseCommitSha`. If the branch still points there, the
 * changed files go up as they are. If someone else published in the meantime, each
 * changed file is rebased on top of their version with a three-way line merge
 * (base, mine, theirs). Files that merge cleanly are listed in `rebased`; files
 * where both sides touched the same lines come back as conflicts for the person
 * to resolve ("mine" keeps the editor's copy, "theirs" leaves the file out).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CommitFile, ContentRepo } from "../../supabase/functions/_shared/githubRepo.ts";
import type { ChangedFile, PublishResult } from "../shared/types.ts";
import { collectChanges, readDiff } from "./changes.ts";
import { merge3 } from "./merge3.ts";

export type PublishInput = {
  /** Files the site's own tooling rewrites when the dev server starts (a generated route tree, say): never published. */
  ignore?: string[];
  /** The working copy (a git clone with uncommitted edits). */
  dir: string;
  repo: ContentRepo;
  /** The commit the working copy was cloned from. */
  baseCommitSha: string;
  message: string;
  resolutions?: Record<string, "mine" | "theirs">;
  /** Optional fast path for the base version of a file (for example `git show <base>:<path>` locally). */
  readBase?: (path: string) => string | null;
};

type Conflict = { path: string; message: string };

function commitFileFor(dir: string, change: ChangedFile): CommitFile {
  if (change.status === "deleted") return { path: change.path, content: "", encoding: "utf-8", delete: true };
  const bytes = readFileSync(join(dir, change.path));
  return change.binary
    ? { path: change.path, content: bytes.toString("base64"), encoding: "base64" }
    : { path: change.path, content: bytes.toString("utf8"), encoding: "utf-8" };
}

/** A file's text at a ref, or null when the ref does not have it (a 404 from GitHub, "not found" from a fake). */
async function readOrNull(repo: ContentRepo, path: string, ref: string): Promise<string | null> {
  try {
    return (await repo.readTextFile(path, ref)).text;
  } catch {
    return null;
  }
}

export async function publishChanges(input: PublishInput): Promise<PublishResult> {
  const { dir, repo, baseCommitSha, message } = input;
  const resolutions = input.resolutions ?? {};
  const ignore = input.ignore ?? [];

  try {
    const changes = collectChanges(dir, ignore);
    if (changes.length === 0) return { ok: false, code: "nothing", message: "Nothing to publish yet." };

    const head = await repo.getBranchHead();
    const files: CommitFile[] = [];
    const rebased: string[] = [];
    const conflicts: Conflict[] = [];

    for (const change of changes) {
      const mine = commitFileFor(dir, change);
      if (head === baseCommitSha) {
        files.push(mine);
        continue;
      }

      // The branch moved. Find out whether their side touched this file at all.
      const theirs = await readOrNull(repo, change.path, head);
      const base = input.readBase ? input.readBase(change.path) : await readOrNull(repo, change.path, baseCommitSha);
      const resolution = resolutions[change.path];

      if (theirs === base) {
        files.push(mine);
        continue;
      }
      if (resolution === "mine") {
        files.push(mine);
        continue;
      }
      if (resolution === "theirs") continue;

      if (change.binary || mine.delete) {
        const what = mine.delete ? "you deleted it and someone else changed it" : "it is a binary file that both of you changed";
        conflicts.push({ path: change.path, message: `Both you and someone else changed ${change.path}; ${what}.` });
        continue;
      }

      const merged = merge3(base ?? "", mine.content, theirs ?? "");
      if (merged.ok) {
        files.push({ path: change.path, content: merged.merged, encoding: "utf-8" });
        rebased.push(change.path);
      } else {
        const places = merged.conflicts === 1 ? "1 place overlaps" : `${merged.conflicts} places overlap`;
        conflicts.push({ path: change.path, message: `Both you and someone else changed ${change.path}; ${places}.` });
      }
    }

    if (conflicts.length > 0) {
      const names = conflicts.map((conflict) => conflict.path).join(", ");
      return {
        ok: false,
        code: "conflict",
        message: `Someone else changed ${conflicts.length === 1 ? "a file" : "files"} you also changed: ${names}. Choose whose version to keep.`,
        conflicts,
      };
    }
    if (files.length === 0) {
      return { ok: false, code: "nothing", message: "Nothing left to publish: every change was dropped in favour of the published version." };
    }

    const result = await repo.commit({ message, files, parentCommitSha: head });
    return {
      ok: true,
      commitSha: result.commitSha,
      commitUrl: result.commitUrl,
      files: files.map((file) => file.path),
      diff: readDiff(dir, ignore),
      rebased,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, code: "github_error", message: detail };
  }
}
