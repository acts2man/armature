/**
 * End-to-end proof of the code engine against the real site (acts2man/treetestprep,
 * branch main), separate from the product's Playwright suite:
 *
 *   ENGINE_SITE_DIR=<clone of treetestprep main, installed> npx playwright test -c engine/playwright.config.ts
 *
 * Three servers: the dashboard (Supabase mocked by tests/e2e/mocks.ts), the engine
 * server in mock-GitHub mode with its cache seeded from ENGINE_SITE_DIR, and the
 * site's preview, which the engine starts itself.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const localChromium = process.env["PLAYWRIGHT_CHROMIUM"] ?? "/opt/pw-browsers/chromium";
const executablePath = existsSync(localChromium) ? localChromium : undefined;
const root = resolve(new URL("..", import.meta.url).pathname);

export const ENGINE_URL = "http://localhost:4400";
export const DASHBOARD = "http://localhost:5173";
export const CACHE_DIR = process.env["ENGINE_CACHE_DIR"] ?? resolve(root, ".armature-engine-cache", "e2e");

export default defineConfig({
  testDir: resolve(root, "engine/tests/e2e"),
  outputDir: resolve(root, "engine/test-results"),
  globalSetup: resolve(root, "engine/tests/e2e/globalSetup.ts"),
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: DASHBOARD,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [{ name: "chromium" }],
  webServer: [
    {
      command: "npx vite --port 5173 --strictPort",
      url: DASHBOARD,
      cwd: root,
      reuseExistingServer: true,
      env: { VITE_SUPABASE_URL: "https://mock.supabase.test", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_mock" },
      timeout: 60_000,
    },
    {
      command: "node --import tsx engine/server/index.ts",
      url: `${ENGINE_URL}/health`,
      cwd: root,
      reuseExistingServer: false,
      env: {
        ARMATURE_ENGINE_PORT: "4400",
        ARMATURE_ENGINE_CACHE: CACHE_DIR,
        ARMATURE_ENGINE_GITHUB: "mock",
        ARMATURE_ENGINE_EDITOR_ORIGINS: "http://localhost:5173,http://127.0.0.1:5173",
        ARMATURE_ENGINE_SOURCES: JSON.stringify({ "acts2man/treetestprep#main": process.env["ENGINE_SITE_DIR"] ?? "" }),
      },
      timeout: 60_000,
    },
  ],
});
