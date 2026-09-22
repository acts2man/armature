import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The demo imports the bridge straight from ../../bridge so there is one source of
// truth in this repository. A real site copies bridge/armature-bridge.ts into src/.
export default defineConfig({
  plugins: [react()],
  server: { fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] } },
  build: { target: "es2022" },
});
