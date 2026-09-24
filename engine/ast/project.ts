/**
 * The site's working copy as the AST engine sees it: files read and written by
 * repo-relative path, parsed on demand and cached by content, import specifiers
 * resolved the way the site's bundler resolves them (relative paths, tsconfig `paths`
 * such as `@/`, extensions and index files).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { parseSource, type ParsedFile } from "./parse.ts";

const SOURCE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mjs"];

/** JSON with comments and trailing commas, as tsconfig files are written. */
export function parseJsonc(text: string): unknown {
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'])\/\/.*$/gm, "$1")
    .replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(stripped);
}

export class Project {
  readonly root: string;
  private readonly texts = new Map<string, string>();
  private readonly parsedFiles = new Map<string, { code: string; parsed: ParsedFile }>();
  private pathAliases: { prefix: string; targets: string[] }[] | null = null;

  constructor(root: string) {
    this.root = resolve(root);
  }

  abs(rel: string): string {
    return join(this.root, rel);
  }

  rel(abs: string): string {
    return relative(this.root, abs).split("\\").join("/");
  }

  exists(rel: string): boolean {
    return existsSync(this.abs(rel));
  }

  isDirectory(rel: string): boolean {
    try {
      return statSync(this.abs(rel)).isDirectory();
    } catch {
      return false;
    }
  }

  read(rel: string): string | null {
    const cached = this.texts.get(rel);
    if (cached !== undefined) return cached;
    try {
      const text = readFileSync(this.abs(rel), "utf8");
      this.texts.set(rel, text);
      return text;
    } catch {
      return null;
    }
  }

  readBinary(rel: string): Buffer | null {
    try {
      return readFileSync(this.abs(rel));
    } catch {
      return null;
    }
  }

  write(rel: string, text: string): void {
    mkdirSync(dirname(this.abs(rel)), { recursive: true });
    writeFileSync(this.abs(rel), text);
    this.texts.set(rel, text);
    this.parsedFiles.delete(rel);
  }

  writeBinary(rel: string, data: Buffer): void {
    mkdirSync(dirname(this.abs(rel)), { recursive: true });
    writeFileSync(this.abs(rel), data);
  }

  remove(rel: string): void {
    rmSync(this.abs(rel), { force: true });
    this.texts.delete(rel);
    this.parsedFiles.delete(rel);
  }

  /** Directory entries (names only), or [] when the directory does not exist. */
  readdir(rel: string): string[] {
    try {
      return readdirSync(this.abs(rel || "."));
    } catch {
      return [];
    }
  }

  /** Forget a file's cached text (after something else wrote it). */
  invalidate(rel?: string): void {
    if (rel) {
      this.texts.delete(rel);
      this.parsedFiles.delete(rel);
    } else {
      this.texts.clear();
      this.parsedFiles.clear();
    }
  }

  parsed(rel: string): ParsedFile | null {
    const code = this.read(rel);
    if (code === null) return null;
    const cached = this.parsedFiles.get(rel);
    if (cached && cached.code === code) return cached.parsed;
    const parsed = parseSource(code);
    this.parsedFiles.set(rel, { code, parsed });
    return parsed;
  }

  private aliases(): { prefix: string; targets: string[] }[] {
    if (this.pathAliases) return this.pathAliases;
    const out: { prefix: string; targets: string[] }[] = [];
    for (const name of ["tsconfig.json", "tsconfig.app.json", "jsconfig.json"]) {
      const text = this.read(name);
      if (!text) continue;
      try {
        const config = parseJsonc(text) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
        const baseUrl = config.compilerOptions?.baseUrl ?? ".";
        for (const [pattern, targets] of Object.entries(config.compilerOptions?.paths ?? {})) {
          const prefix = pattern.replace(/\*$/, "");
          out.push({ prefix, targets: targets.map((target) => posix.normalize(posix.join(baseUrl, target.replace(/\*$/, "")))) });
        }
      } catch {
        // an unreadable tsconfig: no aliases from it
      }
    }
    if (out.length === 0) out.push({ prefix: "@/", targets: ["src/"] });
    this.pathAliases = out;
    return out;
  }

  private withExtension(rel: string): string | null {
    if (this.exists(rel) && !this.isDirectory(rel)) return rel;
    for (const extension of SOURCE_EXTENSIONS) {
      if (this.exists(rel + extension)) return rel + extension;
    }
    for (const extension of SOURCE_EXTENSIONS) {
      const index = posix.join(rel, `index${extension}`);
      if (this.exists(index)) return index;
    }
    // "./x.js" written for a TypeScript file.
    const swapped = rel.replace(/\.jsx?$/, "");
    if (swapped !== rel) return this.withExtension(swapped);
    return null;
  }

  /** The repo-relative file an import points at, or null for a package or an unknown file. */
  resolveImport(fromRel: string, source: string): string | null {
    if (source.startsWith(".")) {
      return this.withExtension(posix.normalize(posix.join(posix.dirname(fromRel), source)));
    }
    if (source.startsWith("/")) return this.withExtension(source.slice(1));
    for (const alias of this.aliases()) {
      if (source.startsWith(alias.prefix)) {
        for (const target of alias.targets) {
          const found = this.withExtension(posix.join(target, source.slice(alias.prefix.length)));
          if (found) return found;
        }
      }
    }
    return null;
  }

  /** Every source file under `dir` (default src/), repo-relative. */
  listSourceFiles(dir = "src"): string[] {
    const out: string[] = [];
    const visit = (rel: string) => {
      let entries: string[];
      try {
        entries = readdirSync(this.abs(rel));
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry === "node_modules" || entry.startsWith(".")) continue;
        const child = rel ? `${rel}/${entry}` : entry;
        if (this.isDirectory(child)) visit(child);
        else if (/\.(tsx|jsx|ts|js)$/.test(entry)) out.push(child);
      }
    };
    visit(dir);
    return out.sort();
  }
}
