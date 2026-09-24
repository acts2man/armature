#!/usr/bin/env node
/**
 * Packages the current kit folder into one JSON file that the update-kit edge
 * function reads (supabase/functions/update-kit/kit-package.json), and archives
 * a copy under supabase/functions/update-kit/packages/<version>.json so Undo
 * and any-target-version restores keep working after the current KIT_VERSION
 * moves on.
 *
 * The archive is written idempotently: if a package with the same version
 * number and identical contents already exists, nothing changes. If the file
 * exists but its contents differ, the archive is refused with an error — a
 * released version's package must never change under the hood. To move a
 * released version's package you bump KIT_VERSION and archive again.
 *
 * Runs at deploy time before `supabase functions deploy`, so whatever the
 * current commit's kit says is what the function writes to a site.
 *
 * The archive lives inside the repo (checked in as JSON files) so no external
 * paid service is needed — everything sits next to the edge function and rides
 * along on each deploy.
 *
 * The package is a plain map path→contents with a KIT_VERSION field on the
 * side, so the function can verify what it is about to install. Test files,
 * README and anything not shipped to sites are excluded; the whitelist below
 * matches what a site copies verbatim.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const KIT_DIR = join(REPO_ROOT, "kit");
const OUT_CURRENT = join(REPO_ROOT, "supabase", "functions", "update-kit", "kit-package.json");
const ARCHIVE_DIR = join(REPO_ROOT, "supabase", "functions", "update-kit", "packages");

/** Only files a site actually needs — no tests, no docs, no lockfiles. */
const INCLUDE = /\.(ts|tsx|css|json)$/;
const EXCLUDE_BASENAMES = new Set(["README.md"]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if (INCLUDE.test(entry) && !EXCLUDE_BASENAMES.has(entry)) out.push(full);
  }
  return out;
}

function readVersion() {
  const source = readFileSync(join(KIT_DIR, "version.ts"), "utf8");
  const match = source.match(/KIT_VERSION\s*=\s*["']([^"']+)["']/);
  if (!match) throw new Error(`Could not read KIT_VERSION from kit/version.ts`);
  return match[1];
}

function buildPackage() {
  const files = walk(KIT_DIR).sort();
  const kitVersion = readVersion();
  const packaged = {};
  for (const path of files) {
    const rel = relative(KIT_DIR, path).split(sep).join("/");
    packaged[rel] = readFileSync(path, "utf8");
  }
  return { kitVersion, files: packaged };
}

function writeArchive(kit) {
  mkdirSync(ARCHIVE_DIR, { recursive: true });
  const target = join(ARCHIVE_DIR, `${kit.kitVersion}.json`);
  const serialized = JSON.stringify(kit);
  if (existsSync(target)) {
    const existing = readFileSync(target, "utf8");
    if (existing === serialized) return { path: target, changed: false };
    throw new Error(
      `Refusing to overwrite ${relative(REPO_ROOT, target)}: an archived package with this version already exists but its contents differ. Bump KIT_VERSION rather than rewriting a released version's package.`,
    );
  }
  writeFileSync(target, serialized);
  return { path: target, changed: true };
}

function main() {
  const kit = buildPackage();
  const output = JSON.stringify(kit);
  mkdirSync(dirname(OUT_CURRENT), { recursive: true });
  writeFileSync(OUT_CURRENT, output);
  const archive = writeArchive(kit);
  const bytes = output.length;
  const label = archive.changed ? "archived" : "already archived";
  process.stdout.write(
    `pack-kit: ${Object.keys(kit.files).length} files, ${(bytes / 1024).toFixed(1)} KB → ${relative(REPO_ROOT, OUT_CURRENT)}; ${kit.kitVersion} ${label} → ${relative(REPO_ROOT, archive.path)}\n`,
  );
}

main();
