/**
 * Seeds the engine's cache with the installed clone named by ENGINE_SITE_DIR, so the
 * proof runs against the real site without a fresh install (the cold install is measured
 * separately with engine/cli.ts). The clone must be a git checkout of the branch being
 * tested with its dependencies installed; the runner fetches and resets it on open.
 */
import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { resolve } from "node:path";
import { stampInstall, siteKey } from "../../runner/preview.ts";
import { CACHE_DIR } from "../../playwright.config.ts";

export default function globalSetup(): void {
  const siteDir = process.env["ENGINE_SITE_DIR"];
  if (!siteDir) throw new Error("Set ENGINE_SITE_DIR to an installed clone of acts2man/treetestprep (branch main).");
  if (!existsSync(resolve(siteDir, "node_modules", "vite"))) throw new Error(`${siteDir} has no node_modules/vite; install the site first.`);
  stampInstall(siteDir);
  const target = resolve(CACHE_DIR, "sites", siteKey("acts2man/treetestprep", "main"));
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  symlinkSync(resolve(siteDir), resolve(target, "repo"), "dir");
  mkdirSync(resolve(process.cwd(), "docs", "code-engine"), { recursive: true });
}
