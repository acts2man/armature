import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  // Edge functions are Deno code: `deno lint` and `deno check` cover them.
  globalIgnores(["dist", "node_modules", "coverage", "supabase/functions", "supabase/.temp"]),
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
    files: ["kit/**/*.{ts,tsx}", "src/builder/widgets/**/*.{ts,tsx}"],
    rules: { "react-refresh/only-export-components": "off" },
  },
]);
