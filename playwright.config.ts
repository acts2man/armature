import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// The environment's own Chromium, when the Playwright-managed one is not installed.
const localChromium = process.env["PLAYWRIGHT_CHROMIUM"] ?? "/opt/pw-browsers/chromium";
const executablePath = existsSync(localChromium) ? localChromium : undefined;

const DASHBOARD = "http://localhost:5173";
const DEMO_SITE = "http://localhost:5174";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: DASHBOARD,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
    ...devices["Desktop Chrome"],
  },
  projects: [{ name: "chromium" }],
  webServer: [
    {
      // The dashboard against a Supabase that the tests mock entirely (tests/e2e/mocks.ts).
      command: "npx vite --port 5173 --strictPort",
      url: DASHBOARD,
      reuseExistingServer: !process.env["CI"],
      env: { VITE_SUPABASE_URL: "https://mock.supabase.test", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_mock" },
      timeout: 60_000,
    },
    {
      // --host binds every interface (Node listens on :: in dual-stack mode) so the
      // demo site answers on both localhost and 127.0.0.1. One bridge test loads it
      // through a 127.0.0.1 parent as a second origin; on CI runners localhost
      // resolves to ::1, so without this the 127.0.0.1 request is refused.
      command: "npx vite --port 5174 --strictPort --host",
      cwd: "examples/demo-site",
      url: DEMO_SITE,
      reuseExistingServer: !process.env["CI"],
      timeout: 60_000,
    },
  ],
});
