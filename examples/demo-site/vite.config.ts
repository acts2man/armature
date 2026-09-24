import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The demo imports the bridge straight from ../../bridge so there is one source of
// truth in this repository. A real site copies bridge/armature-bridge.ts into src/.
export default defineConfig({
  plugins: [react()],
  server: { fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] } },
  // The kit's React resolves from the repository root's node_modules and the demo's from
  // its own node_modules; one copy must win, or a production bundle carries two Reacts and
  // every hook throws ("Cannot read properties of null (reading 'useSyncExternalStore')").
  // The dev server happens to tolerate the pair; a production build does not.
  resolve: { dedupe: ["react", "react-dom"] },
  build: { target: "es2022" },
});
