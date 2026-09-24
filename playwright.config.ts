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
 * cloned next to this repository. Set REAL_SITE_DIR to its folder to run
 * tests/e2e/real-site.spec.ts and tests/e2e/drag-sequences.spec.ts against it, with its
 * own dev server, or with a production build when REAL_SITE_BUILD=1 (nitro's node-server
 * preset, served by node); or set REAL_SITE_URL to a site already running. Without either
 * those tests skip (CI has no clone). The site's own copy must allow http://localhost:5173
 * in ARMATURE_EDITOR_ORIGINS (src/lib/armature.ts) and in FRAME_ANCESTORS (src/server.ts)
 * — local-only edits, never committed.
 */
const REAL_SITE_DIR = process.env["REAL_SITE_DIR"];
const REAL_SITE = process.env["REAL_SITE_URL"] ?? "http://localhost:5175";
const REAL_SITE_BUILD = process.env["REAL_SITE_BUILD"] === "1";
/** The demo site is served as a production build (what a visitor gets); DEMO_SITE_DEV=1 uses its dev server instead. */
const DEMO_SITE_DEV = process.env["DEMO_SITE_DEV"] === "1";

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
      // A production build by default, so the tests see what a visitor gets (the dev server
      // once hid a bundle with two copies of React). --host binds every interface (Node
      // listens on :: in dual-stack mode) so the demo site answers on both localhost and
      // 127.0.0.1. One bridge test loads it through a 127.0.0.1 parent as a second origin;
      // on CI runners localhost resolves to ::1, so without this the 127.0.0.1 request is
      // refused.
      command: DEMO_SITE_DEV ? `npx vite --port ${SITE_PORT} --strictPort --host` : `npx vite build && npx vite preview --port ${SITE_PORT} --strictPort --host`,
      cwd: "examples/demo-site",
      url: DEMO_SITE,
      reuseExistingServer: !process.env["CI"],
      timeout: 120_000,
      // A moved dashboard must still be an allowed editor origin for the demo site.
      env: DASHBOARD_PORT === "5173" ? {} : { VITE_ARMATURE_EDITOR_ORIGINS: `${DASHBOARD},https://armature-sites.netlify.app` },
    },
    ...(REAL_SITE_DIR && !process.env["REAL_SITE_URL"]
      ? [
          {
            command: REAL_SITE_BUILD ? "NITRO_PRESET=node-server npm run build && PORT=5175 HOST=0.0.0.0 node .output/server/index.mjs" : "bun run dev -- --port 5175 --host",
            cwd: REAL_SITE_DIR,
            url: REAL_SITE,
            reuseExistingServer: true,
            timeout: 300_000,
          },
        ]
      : []),
  ],
});
