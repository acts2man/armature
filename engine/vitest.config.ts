import { defineConfig } from "vitest/config";

/** The engine's own unit tests: `npm run test:engine`. The product's `npm test` does not include them. */
export default defineConfig({
  test: {
    include: ["engine/tests/**/*.test.ts"],
    environment: "node",
    root: new URL("..", import.meta.url).pathname,
  },
});
