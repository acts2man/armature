#!/usr/bin/env node
/**
 * Packages the current kit folder into one JSON file that the update-kit edge
 * function reads. Runs at deploy time (before `supabase functions deploy`), so
 * whatever the current commit's kit says is what the function writes to a site.
 *
 * The package is a plain map path→contents with a KIT_VERSION field on the
 * side, so the function can verify what it is about to install. Test files,
 * README, and anything not shipped to sites are excluded; the whitelist below
 * matches what a site copies verbatim.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const KIT_DIR = join(REPO_ROOT, "kit");
const OUT = join(REPO_ROOT, "supabase", "functions", "update-kit", "kit-package.json");

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

function main() {
  const files = walk(KIT_DIR).sort();
  const kitVersion = readVersion();
  const packaged = {};
  for (const path of files) {
    const rel = relative(KIT_DIR, path).split(sep).join("/");
    packaged[rel] = readFileSync(path, "utf8");
  }
  mkdirSync(dirname(OUT), { recursive: true });
  const output = { kitVersion, files: packaged };
  writeFileSync(OUT, JSON.stringify(output));
  const bytes = JSON.stringify(output).length;
  process.stdout.write(`pack-kit: ${Object.keys(packaged).length} files, ${(bytes / 1024).toFixed(1)} KB → ${relative(REPO_ROOT, OUT)}\n`);
}

main();
