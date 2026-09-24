import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  // Edge functions are Deno code: `deno lint` and `deno check` cover them.
  globalIgnores(["dist", "node_modules", "coverage", "supabase/functions", "supabase/.temp", "examples/demo-site/.production-build"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // The site kit is copied into other projects and mixes components with helpers on purpose.
    files: ["kit/**/*.{ts,tsx}", "src/builder/widgets/**/*.{ts,tsx}", "src/builder/controls/**/*.{ts,tsx}"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  {
    // The editor is not compiled by React Compiler; the "could not preserve memoization" rule
    // only reports what the compiler would skip, and the hand-written deps are checked by
    // exhaustive-deps anyway.
    files: ["src/visual/**/*.{ts,tsx}", "src/builder/**/*.{ts,tsx}"],
    rules: { "react-hooks/preserve-manual-memoization": "off" },
  },
  {
    // The code engine's editor: the same hand-written editor code as src/visual, and its
    // control specs mix small components with plain helpers on purpose.
    files: ["engine/editor/**/*.{ts,tsx}"],
    rules: { "react-hooks/preserve-manual-memoization": "off", "react-refresh/only-export-components": "off" },
  },
]);
