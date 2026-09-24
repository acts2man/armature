/**
 * undo-site-setup helpers — restore a site's entire tree to what it was at
 * `pre_setup_commit_sha` as ONE new commit on top of the current head. Not
 * a git revert (which would only undo the exact commits between then and
 * now, and misses anything committed by hand since); instead this walks the
 * tree at the pre-setup sha and the tree at the current head, and commits
 * every add/change/delete needed to make the current tree match the
 * pre-setup one. The result is bit-identical to the pre-setup snapshot and
 * lands as a single revert commit; the update commit(s) stay in git
 * history so a re-do is a fresh setup.
 *
 * Kept pure over the ContentRepo interface so it is testable without hitting
 * GitHub.
 */
import type { CommitFile, ContentRepo } from "./githubRepo.ts";

export type TreeMap = Record<string, string>; // path -> blob sha

/** List every file (recursive) in the given ref, returning path -> blob sha. */
export async function fullTree(repo: ContentRepo, ref: string): Promise<TreeMap> {
  const entries = await repo.listTree(".", ref);
  const out: TreeMap = {};
  for (const entry of entries) {
    // listTree returns { path, sha, type? } — we only want blobs; treat missing type as blob.
    if ((entry as { type?: string }).type && (entry as { type?: string }).type !== "blob") continue;
    out[entry.path] = entry.sha;
  }
  return out;
}

/**
 * Given the tree at the pre-setup snapshot and the current head, produce the
 * list of CommitFile entries needed to make the head tree match the pre-setup
 * one. Files present in both trees with the same blob sha are skipped.
 */
export async function buildRestoreFiles(repo: ContentRepo, preSetupSha: string, headSha: string, options: { readBlobText?: (path: string, ref: string) => Promise<string | null> } = {}): Promise<CommitFile[]> {
  const [before, after] = await Promise.all([fullTree(repo, preSetupSha), fullTree(repo, headSha)]);
  const readBlob = options.readBlobText ?? (async (path: string, ref: string) => {
    try {
      const file = await repo.readTextFile(path, ref);
      return file.text;
    } catch {
      return null;
    }
  });

  const files: CommitFile[] = [];

  // Files present in the pre-setup tree: bring them back (either unchanged with same sha —
  // skipped — or restore the content from the pre-setup ref).
  for (const [path, preSha] of Object.entries(before)) {
    if (after[path] === preSha) continue;
    const text = await readBlob(path, preSetupSha);
    if (text === null) continue; // A binary blob we cannot round-trip through the API; skip and warn.
    files.push({ path, content: text, encoding: "utf-8" });
  }
  // Files present only on the head tree: delete them.
  for (const path of Object.keys(after)) {
    if (path in before) continue;
    files.push({ path, content: "", encoding: "utf-8", delete: true });
  }
  return files;
}
