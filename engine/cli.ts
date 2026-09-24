/**
 * A small command line for the runner, used to measure open times and to poke at a
 * site without the dashboard:
 *
 *   node --import tsx engine/cli.ts open acts2man/treetestprep main [--cache DIR] [--source PATH] [--keep]
 *   node --import tsx engine/cli.ts detect <dir>
 *
 * `open` prints the timings as JSON (clone, install, start, total, and whether the
 * clone and the install were reused), then stops the preview unless --keep is given.
 */
import { resolve } from "node:path";
import { Project } from "./ast/project.ts";
import { detectSite } from "./runner/detect.ts";
import { openPreview } from "./runner/preview.ts";

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const [command, first, second] = process.argv.slice(2);
  if (command === "detect" && first) {
    const detected = detectSite(new Project(resolve(first)));
    console.log(JSON.stringify(detected, null, 2));
    return;
  }
  if (command === "open" && first) {
    const cacheDir = resolve(flag("cache") ?? ".armature-engine-cache");
    const started = Date.now();
    const preview = await openPreview(
      { cacheDir, repo: first, branch: second ?? "main", source: flag("source"), editorOrigins: ["http://localhost:5173"], env: {}, log: process.env["ARMATURE_ENGINE_VERBOSE"] ? (line) => console.error(line) : undefined },
      (status) => console.error(`[${Math.round((Date.now() - started) / 1000)}s] ${status.phase}${"message" in status ? `: ${status.message}` : ""}`),
    );
    const detected = detectSite(new Project(preview.dir));
    console.log(JSON.stringify({ url: preview.url, headCommit: preview.headCommit, timings: preview.timings, framework: detected.framework, packageManager: detected.packageManager, tailwind: detected.tailwind, pages: detected.pages.map((page) => page.path) }, null, 2));
    if (process.argv.includes("--keep")) {
      console.error("Preview kept running; press Ctrl+C to stop.");
      await new Promise(() => undefined);
    }
    await preview.stop();
    return;
  }
  console.error("usage: cli.ts open <owner/repo> [branch] | detect <dir>");
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
