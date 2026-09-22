import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The frontend bundle may only ever see VITE_-prefixed variables. Vite enforces
// that prefix itself; scripts/check-secrets.sh greps the built output as a second guard.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  build: {
    sourcemap: false,
    target: "es2022",
  },
  test: {
    include: ["shared/**/*.test.ts", "bridge/**/*.test.ts", "examples/**/*.test.ts", "src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
});
