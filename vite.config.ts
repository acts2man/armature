import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The frontend bundle may only ever see VITE_-prefixed variables. Vite enforces
// that prefix itself; scripts/check-secrets.sh greps the built output as a second guard.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      // shared/builder imports zod through an `npm:` specifier so Deno and the
      // Supabase edge-function bundler resolve it without an import map; here it
      // resolves to the npm package like any other dependency.
      { find: /^npm:zod(@.*)?$/, replacement: "zod" },
      { find: "@shared", replacement: fileURLToPath(new URL("./shared", import.meta.url)) },
      { find: "@kit", replacement: fileURLToPath(new URL("./kit", import.meta.url)) },
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
    ],
  },
  build: {
    sourcemap: false,
    target: "es2022",
  },
  test: {
    // The kit folder ships to sites verbatim, so its tests live in tests/kit/, not kit/.
    include: ["shared/**/*.test.ts", "bridge/**/*.test.ts", "tests/kit/**/*.test.ts", "tests/kit/**/*.test.tsx", "examples/**/*.test.ts", "src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
});
