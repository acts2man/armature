/**
 * update-kit — replaces a site's kit folder with the bundled kit package in ONE
 * commit. The function reads the site's current kit files under kit_path from
 * GitHub, computes the add/change/delete diff against the package, and writes
 * every change as a single commit (message: "Update Armature kit X → Y"). The
 * ref update is not forced, so GitHub refuses non-fast-forwards; the caller
 * gets a helpful error and can retry.
 *
 * "Local edits refused" is deliberate: if the site's current kit files do not
 * match the previous version's package, the function stops with a list of the
 * changed paths. The UI lets the person choose "Overwrite anyway".
 */
import type { CommitFile, ContentRepo } from "./githubRepo.ts";

export type KitPackage = {
  kitVersion: string;
  files: Record<string, string>;
};

export type UpdateKitInput = {
  kitPath: string;
  currentPackage: KitPackage;
  /** The site's current kit files, path -> content. */
  currentFiles: Record<string, string>;
  /** The package the site's current kit was installed from, for the local-edits check. Optional. */
  previousPackage?: KitPackage | null;
  /** true to skip the local-edits check. */
  overwrite?: boolean;
};

export type UpdateKitPlan = {
  toAdd: string[];
  toChange: string[];
  toRemove: string[];
  localEdits: string[];
};

const trimSlash = (path: string) => path.replace(/^\/+|\/+$/g, "");

/** Return the diff: files under kit_path to add, change, remove, plus any local edits. */
export function planKitUpdate(input: UpdateKitInput): UpdateKitPlan {
  const kitPath = trimSlash(input.kitPath);
  const packagedFiles = new Map(Object.entries(input.currentPackage.files));
  const currentFiles = new Map(Object.entries(input.currentFiles));
  const toAdd: string[] = [];
  const toChange: string[] = [];
  const toRemove: string[] = [];
  const localEdits: string[] = [];

  for (const [rel, contents] of packagedFiles) {
    const path = `${kitPath}/${rel}`;
    const existing = currentFiles.get(rel);
    if (existing === undefined) toAdd.push(path);
    else if (existing !== contents) toChange.push(path);
  }
  for (const rel of currentFiles.keys()) {
    if (!packagedFiles.has(rel)) toRemove.push(`${kitPath}/${rel}`);
  }
  // Local edits: files present in the previous package but whose current content differs from
  // what that package installed. Files added/removed since (e.g. glyphs.ts vanishing) are not
  // local edits — those show up as normal add/remove entries above.
  if (input.previousPackage && !input.overwrite) {
    const previousFiles = new Map(Object.entries(input.previousPackage.files));
    for (const [rel, previousContent] of previousFiles) {
      const existing = currentFiles.get(rel);
      if (existing !== undefined && existing !== previousContent) localEdits.push(`${kitPath}/${rel}`);
    }
  }
  return { toAdd, toChange, toRemove, localEdits };
}

/** Build the CommitFile list for the plan. */
export function commitFilesFor(input: UpdateKitInput, plan: UpdateKitPlan): CommitFile[] {
  const kitPath = trimSlash(input.kitPath);
  const files: CommitFile[] = [];
  for (const path of plan.toAdd) {
    const rel = path.slice(kitPath.length + 1);
    files.push({ path, content: input.currentPackage.files[rel]!, encoding: "utf-8" });
  }
  for (const path of plan.toChange) {
    const rel = path.slice(kitPath.length + 1);
    files.push({ path, content: input.currentPackage.files[rel]!, encoding: "utf-8" });
  }
  for (const path of plan.toRemove) {
    files.push({ path, content: "", encoding: "utf-8", delete: true });
  }
  return files;
}

/**
 * Read every file under kit_path from the repo at the given ref, returning a
 * path->content map (keys are relative to kit_path). Uses the ContentRepo's
 * listTree + readTextFile, so it goes through the same rate-limit-aware
 * plumbing as builder-publish.
 */
export async function readCurrentKitFiles(repo: ContentRepo, kitPath: string, ref: string): Promise<Record<string, string>> {
  const trimmed = trimSlash(kitPath);
  const entries = await repo.listTree(trimmed, ref);
  const files: Record<string, string> = {};
  for (const entry of entries) {
    if (!entry.path.startsWith(`${trimmed}/`)) continue;
    const rel = entry.path.slice(trimmed.length + 1);
    // Skip anything not in the kit's whitelist of extensions — someone may have
    // added extra folders under kit_path (a documentation image, a fixture); we
    // never touch those.
    if (!/\.(ts|tsx|css|json)$/.test(rel)) continue;
    try {
      const file = await repo.readTextFile(entry.path, ref);
      files[rel] = file.text;
    } catch {
      /* skip files the API refuses (rare — binary, submodule) */
    }
  }
  return files;
}
