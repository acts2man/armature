/**
 * Vite plugin: serve the engine's in-page bridge as a virtual module and import it from
 * the site's client entry, in the preview only. The bridge is TypeScript in
 * engine/bridge/engineBridge.ts, transpiled here with the TypeScript compiler so the
 * site's own toolchain is not involved. Nothing is written into the site.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const VIRTUAL_ID = "virtual:armature-engine-bridge";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

/** Client entry files, relative to the site root, that get the bridge import (whichever exist). */
const ENTRY_CANDIDATES = ["src/main.tsx", "src/main.jsx", "src/index.tsx", "src/index.jsx", "src/router.tsx", "src/router.ts", "src/routes/__root.tsx", "src/App.tsx", "src/app.tsx", "app/root.tsx"];

export type BridgeConfig = {
  /** Origins allowed to drive the page (the dashboard). */
  editorOrigins: string[];
};

let cachedSource: string | null = null;

export function bridgeSource(): string {
  if (cachedSource) return cachedSource;
  const path = fileURLToPath(new URL("../../bridge/engineBridge.ts", import.meta.url));
  const source = readFileSync(path, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, removeComments: false } });
  cachedSource = output.outputText;
  return cachedSource;
}

export function bridgePlugin(options: { root: string; config: BridgeConfig }) {
  const root = options.root.replace(/\\/g, "/").replace(/\/+$/, "");
  const entries = new Set(ENTRY_CANDIDATES.map((candidate) => `${root}/${candidate}`));
  return {
    name: "armature-engine:bridge",
    enforce: "pre" as const,
    resolveId(id: string) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    load(id: string) {
      if (id !== RESOLVED_ID) return null;
      return `globalThis.__ARMATURE_ENGINE_CONFIG = ${JSON.stringify(options.config)};\n${bridgeSource()}`;
    },
    transform(code: string, id: string, transformOptions?: { ssr?: boolean }) {
      if (transformOptions?.ssr) return null;
      const clean = (id.split("?")[0] ?? id).replace(/\\/g, "/");
      if (!entries.has(clean)) return null;
      if (code.includes(VIRTUAL_ID)) return null;
      // Appended, not prepended: imports hoist, and every existing line keeps its number so
      // other source-location plugins (TanStack devtools) still agree between server and client.
      return { code: `${code}\nimport "${VIRTUAL_ID}";\n`, map: null };
    },
    transformIndexHtml(html: string) {
      if (html.includes(VIRTUAL_ID)) return html;
      return html.replace("</head>", `<script type="module" src="/@id/__x00__${VIRTUAL_ID}"></script></head>`);
    },
  };
}
