/**
 * The preview child process: one per site. It loads the site's own vite config with the
 * site's own Vite (from the site's node_modules), appends the Armature plugins, starts
 * the dev server on the given port and reports the URL to the parent over stdout. The
 * site's files are never modified: the wrapper config lives entirely in memory.
 *
 *   node --import tsx engine/runner/previewProcess.ts <siteDir> <port> <configJson>
 */
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { bridgePlugin } from "./plugins/bridgePlugin.ts";
import { sourceTagsPlugin } from "./plugins/sourceTags.ts";

type ViteModule = {
  createServer: (config: Record<string, unknown>) => Promise<{ listen: () => Promise<unknown>; resolvedUrls?: { local?: string[] } | null; config: { server: { port: number } }; close: () => Promise<void> }>;
  loadConfigFromFile: (env: { command: "serve"; mode: "development" }, configFile?: string, root?: string) => Promise<{ config: Record<string, unknown>; path: string } | null>;
  mergeConfig: (a: Record<string, unknown>, b: Record<string, unknown>) => Record<string, unknown>;
};

async function main() {
  const [siteDir, portArg, configJson] = process.argv.slice(2);
  if (!siteDir || !portArg) throw new Error("usage: previewProcess <siteDir> <port> <configJson>");
  // Vite reports module ids by their real path, so a symlinked working copy must be resolved first.
  const root = realpathSync(resolve(siteDir));
  const port = Number(portArg);
  const options = JSON.parse(configJson ?? "{}") as { editorOrigins: string[]; env: Record<string, string>; host?: string; /** Stop when the parent closes our stdin (set by the runner, which holds a pipe open). */ exitOnStdinEnd?: boolean };

  for (const [key, value] of Object.entries(options.env ?? {})) process.env[key] = value;
  process.chdir(root);

  const require = createRequire(pathToFileURL(`${root}/package.json`));
  let vitePath: string;
  try {
    vitePath = require.resolve("vite/package.json");
  } catch {
    throw new Error("The site has no vite installed. Was the install step skipped?");
  }
  const viteDir = resolve(vitePath, "..");
  const vite = (await import(pathToFileURL(resolve(viteDir, "dist/node/index.js")).href)) as ViteModule;

  const configFile = ["vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"].map((name) => resolve(root, name)).find((path) => existsSync(path));
  const loaded = configFile ? await vite.loadConfigFromFile({ command: "serve", mode: "development" }, configFile, root) : null;
  const siteConfig = loaded?.config ?? {};

  const ours = {
    configFile: false,
    root,
    plugins: [sourceTagsPlugin({ root }), bridgePlugin({ root, config: { editorOrigins: options.editorOrigins } })],
    server: { port, strictPort: true, host: options.host ?? "127.0.0.1", open: false, cors: true, headers: { "Access-Control-Allow-Origin": "*" }, fs: { strict: false } },
    logLevel: "info",
    clearScreen: false,
  };
  // Our plugins go first so the tags are added before the site's own transforms (React, TanStack).
  const merged = vite.mergeConfig(siteConfig, ours) as Record<string, unknown>;
  merged["plugins"] = [...(ours.plugins as unknown[]), ...(((siteConfig["plugins"] as unknown[]) ?? []).flat())];
  merged["configFile"] = false;
  const server = await vite.createServer(merged);
  await server.listen();
  const url = server.resolvedUrls?.local?.[0] ?? `http://127.0.0.1:${server.config.server.port}/`;
  process.stdout.write(`ARMATURE_PREVIEW_READY ${url}\n`);

  const shutdown = () => {
    void server.close().finally(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  if (options.exitOnStdinEnd) {
    process.stdin.on("end", shutdown);
    process.stdin.resume();
  }
}

main().catch((error: unknown) => {
  process.stdout.write(`ARMATURE_PREVIEW_ERROR ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
