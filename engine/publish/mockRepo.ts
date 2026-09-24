/**
 * An in-memory ContentRepo for tests: a commit log, the files at each commit and a
 * head pointer. `moveBranch` plays the part of someone else publishing.
 */
import { createHash } from "node:crypto";
import type { CommitFile, CommitResult, ContentRepo, TreeEntry } from "../../supabase/functions/_shared/githubRepo.ts";

export type MockCommit = { sha: string; message: string; files: CommitFile[] };

export type MockRepoState = {
  head: string;
  commits: MockCommit[];
  /** The full file map at a commit (binary contents are stored as latin1 strings). */
  filesAt(sha: string): Record<string, string>;
};

export type MockRepo = ContentRepo & {
  state: MockRepoState;
  /** Someone else publishes: layer `files` over the current head as a new commit. */
  moveBranch(files: Record<string, string>, message?: string): string;
};

function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

export function createMockRepo(initial: Record<string, string>, opts?: { moveBranch?: (files: Record<string, string>) => void }): MockRepo {
  const snapshots = new Map<string, Record<string, string>>();
  const commits: MockCommit[] = [];
  let head = "";

  function record(message: string, files: CommitFile[], snapshot: Record<string, string>): string {
    const sha = sha1(JSON.stringify(Object.entries(snapshot).sort()) + "\n" + message + "\n" + commits.length);
    snapshots.set(sha, snapshot);
    commits.push({ sha, message, files });
    head = sha;
    return sha;
  }

  record(
    "initial",
    Object.entries(initial).map(([path, content]) => ({ path, content, encoding: "utf-8" as const })),
    { ...initial },
  );

  const state: MockRepoState = {
    get head() {
      return head;
    },
    commits,
    filesAt(sha) {
      const snapshot = snapshots.get(sha);
      if (!snapshot) throw new Error("not found");
      return { ...snapshot };
    },
  };

  const repo: MockRepo = {
    state,

    async getBranchHead() {
      return head;
    },

    async readTextFile(path, ref) {
      const snapshot = snapshots.get(ref);
      const text = snapshot?.[path];
      if (text === undefined) throw new Error("not found");
      return { text, sha: sha1(text) };
    },

    async listTree(directory, ref) {
      const snapshot = snapshots.get(ref);
      if (!snapshot) return [];
      const prefix = directory.replace(/\/+$/, "") + "/";
      const entries: TreeEntry[] = [];
      for (const [path, text] of Object.entries(snapshot)) {
        if (path.startsWith(prefix)) entries.push({ path, sha: sha1(text), size: Buffer.byteLength(text) });
      }
      return entries;
    },

    async commit({ message, files, parentCommitSha }): Promise<CommitResult> {
      if (parentCommitSha !== head) throw new Error("branch moved");
      if (files.length === 0) throw new Error("Nothing to commit");
      const snapshot = { ...(snapshots.get(head) ?? {}) };
      for (const file of files) {
        if (file.delete) {
          delete snapshot[file.path];
        } else if (file.encoding === "base64") {
          snapshot[file.path] = Buffer.from(file.content, "base64").toString("latin1");
        } else {
          snapshot[file.path] = file.content;
        }
      }
      const sha = record(message, files, snapshot);
      return { commitSha: sha, commitUrl: `https://example.test/commit/${sha}` };
    },

    moveBranch(files, message = "someone else published") {
      const snapshot = { ...(snapshots.get(head) ?? {}), ...files };
      const sha = record(
        message,
        Object.entries(files).map(([path, content]) => ({ path, content, encoding: "utf-8" as const })),
        snapshot,
      );
      opts?.moveBranch?.(files);
      return sha;
    },
  };

  return repo;
}
