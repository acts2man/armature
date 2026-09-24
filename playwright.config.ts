import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// The environment's own Chromium, when the Playwright-managed one is not installed.
const localChromium = process.env["PLAYWRIGHT_CHROMIUM"] ?? "/opt/pw-browsers/chromium";
const executablePath = existsSync(localChromium) ? localChromium : undefined;

/**
 * The dashboard and the demo site normally run on 5173 and 5174. ARMATURE_E2E_PORT and
 * ARMATURE_E2E_SITE_PORT move them, so two checkouts can test side by side on one machine
 * without one reusing the other's dev server. The specs that spell a port out stay on the
 * defaults; builder.spec.ts and problems.spec.ts follow the variables.
 */
const DASHBOARD_PORT = process.env["ARMATURE_E2E_PORT"] ?? "5173";
const SITE_PORT = process.env["ARMATURE_E2E_SITE_PORT"] ?? "5174";
const DASHBOARD = `http://localhost:${DASHBOARD_PORT}`;
const DEMO_SITE = `http://localhost:${SITE_PORT}`;
/**
 * The first real converted site (acts2man/treetestprep, branch armature/git-content),
 * cloned next to this repository and run with its own dev server. Set REAL_SITE_DIR to
 * its folder to run tests/e2e/real-site.spec.ts against it; without it those tests skip
 * (CI has no clone). The site's own copy must allow http://localhost:5173 in
 * ARMATURE_EDITOR_ORIGINS (src/lib/armature.ts) — a local-only edit, never committed.
 */
const REAL_SITE_DIR = process.env["REAL_SITE_DIR"];
const REAL_SITE = process.env["REAL_SITE_URL"] ?? "http://localhost:5175";

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
      command: `npx vite --port ${DASHBOARD_PORT} --strictPort`,
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
      command: `npx vite --port ${SITE_PORT} --strictPort --host`,
      cwd: "examples/demo-site",
      url: DEMO_SITE,
      reuseExistingServer: !process.env["CI"],
      timeout: 60_000,
      // A moved dashboard must still be an allowed editor origin for the demo site.
      env: DASHBOARD_PORT === "5173" ? {} : { VITE_ARMATURE_EDITOR_ORIGINS: `${DASHBOARD},https://armature-sites.netlify.app` },
    },
    ...(REAL_SITE_DIR
      ? [
          {
            command: "bun run dev -- --port 5175 --host",
            cwd: REAL_SITE_DIR,
            url: REAL_SITE,
            reuseExistingServer: true,
            timeout: 120_000,
          },
        ]
      : []),
  ],
});
