/**
 * Keep the site's formatting after a structural edit. recast prints a moved or inserted
 * element in its own style; when the site has Prettier and the file was Prettier-clean
 * before the edit, the touched file is formatted with the site's own Prettier so the diff
 * shows only the change. A file that was not clean to begin with is left alone, because
 * formatting it would swamp the diff.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "./project.ts";

const cleanBefore = new Map<string, boolean>();

function prettierBin(project: Project): string | null {
  const bin = join(project.root, "node_modules", ".bin", "prettier");
  return existsSync(bin) ? bin : null;
}

function runPrettier(project: Project, bin: string, file: string, source: string): string | null {
  const result = spawnSync(bin, ["--stdin-filepath", file], { cwd: project.root, input: source, encoding: "utf8", timeout: 20_000 });
  return result.status === 0 ? result.stdout : null;
}

/** Whether the file, as committed, already matches the site's Prettier output (cached per session). */
function wasClean(project: Project, bin: string, file: string, original: string): boolean {
  const cached = cleanBefore.get(`${project.root}:${file}`);
  if (cached !== undefined) return cached;
  const formatted = runPrettier(project, bin, file, original);
  const clean = formatted !== null && formatted === original;
  cleanBefore.set(`${project.root}:${file}`, clean);
  return clean;
}

/** The content to write: formatted when the site has Prettier and the file was clean, else as printed. */
export function formatLikeSite(project: Project, file: string, printed: string): string {
  if (!/\.(tsx|jsx|ts|js)$/.test(file)) return printed;
  const bin = prettierBin(project);
  if (!bin) return printed;
  const original = project.read(file);
  if (original === null || !wasClean(project, bin, file, original)) return printed;
  return runPrettier(project, bin, file, printed) ?? printed;
}
