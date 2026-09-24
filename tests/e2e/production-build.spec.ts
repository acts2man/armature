/**
 * Every widget must survive a PRODUCTION build of a site whose package.json says
 * `"sideEffects": false`, and render in a browser from the built files.
 *
 * The bug this guards: the kit used to register its widgets, the widget library's CSS and
 * its glyphs as a side effect of importing modules. A bundler that trusts a site's
 * `"sideEffects": false` drops such imports, so every library widget rendered as nothing on
 * the live site while the dev server (which never tree-shakes) showed them all. The kit now
 * registers explicitly from `createArmatureKit`; this test proves it the way a site would
 * find out.
 *
 * The demo site imports the kit from ../../kit, outside its own package, where its
 * `sideEffects` flag cannot reach. A real site copies `kit/` to `src/lib/armature-kit/`
 * under its package.json, which is where the flag bites. So this test lays the demo site
 * out as a real site in examples/demo-site/.production-build/ (git-ignored, removed at the
 * end), builds it with Vite for production, serves the built files, opens /every-widget
 * (src/every-widget.json: one element of every widget type; tests/kit/widgets.test.ts
 * keeps it complete) and checks each widget's own output, the library's CSS, its glyphs
 * and a couple of interactions. Runs wherever Node, Vite and Chromium run, including CI.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { PROPS_CHECKS } from "../../kit/validate.ts";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const demo = join(repo, "examples", "demo-site");
/** The demo site laid out as a real site, built for production. */
const site = join(demo, ".production-build");

type Node = { id: string; type: string; children?: Node[] };
const flatten = (nodes: Node[]): Node[] => nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);

/**
 * What each widget's own render function puts on the page (the renderer adds only the
 * root's `ae-<type>` class and data attributes, and an unknown type renders nothing), as
 * a selector from the element's id. Every widget type needs one; the test fails otherwise.
 */
const PROOF: Record<string, (id: string) => string> = {
  container: (id) => `[data-ae-id="${id}"] > .ae-con-inner > [data-ae-id]`,
  grid: (id) => `[data-ae-id="${id}"] > .ae-con-inner > [data-ae-id]`,
  heading: (id) => `h2[data-ae-id="${id}"]`,
  text: (id) => `[data-ae-id="${id}"] p`,
  image: (id) => `figure[data-ae-id="${id}"] img[src="/assets/hero.svg"]`,
  button: (id) => `[data-ae-id="${id}"] a.ae-btn[href="/contact/"] .ae-btn-text`,
  spacer: (id) => `[data-ae-id="${id}"][aria-hidden="true"]`,
  divider: (id) => `[data-ae-id="${id}"][role="separator"] .ae-divider-text`,
  icon: (id) => `[data-ae-id="${id}"] .ae-icon-shape svg.ae-icon-svg path`,
  video: (id) => `[data-ae-id="${id}"] button.ae-video-facade .ae-video-note`,
  "icon-box": (id) => `[data-ae-id="${id}"] .ae-box-title`,
  "image-box": (id) => `[data-ae-id="${id}"] figure.ae-box-image img[src="/assets/team.svg"]`,
  "icon-list": (id) => `[data-ae-id="${id}"] li .ae-icon-list-text`,
  testimonial: (id) => `figure[data-ae-id="${id}"] blockquote.ae-testimonial-quote p`,
  "star-rating": (id) => `[data-ae-id="${id}"] .ae-stars[role="img"]`,
  alert: (id) => `[data-ae-id="${id}"][role="status"] .ae-alert-title`,
  blockquote: (id) => `figure[data-ae-id="${id}"] blockquote.ae-quote-text p`,
  cta: (id) => `[data-ae-id="${id}"] .ae-cta-title`,
  "price-table": (id) => `[data-ae-id="${id}"] .ae-price-value`,
  "social-icons": (id) => `ul[data-ae-id="${id}"] a.ae-social-link svg`,
  progress: (id) => `[data-ae-id="${id}"] [role="progressbar"]`,
  counter: (id) => `[data-ae-id="${id}"] .ae-counter-number`,
  accordion: (id) => `[data-ae-id="${id}"] button.ae-panel-toggle[aria-expanded]`,
  toggle: (id) => `[data-ae-id="${id}"] button.ae-panel-toggle[aria-expanded]`,
  tabs: (id) => `[data-ae-id="${id}"] [role="tablist"] [role="tab"]`,
  gallery: (id) => `[data-ae-id="${id}"] .ae-gallery-item img`,
  carousel: (id) => `[data-ae-id="${id}"][aria-roledescription="carousel"] .ae-carousel-slide img`,
  countdown: (id) => `[data-ae-id="${id}"][role="timer"] .ae-countdown-value`,
  "flip-box": (id) => `[data-ae-id="${id}"] .ae-flip-front .ae-flip-title`,
  toc: (id) => `nav[data-ae-id="${id}"] .ae-toc-list li a[href^="#"]`,
  map: (id) => `[data-ae-id="${id}"] iframe[src^="https://maps.google.com/"]`,
  html: (id) => `[data-ae-id="${id}"] iframe[sandbox]`,
  "site-logo": (id) => `[data-ae-id="${id}"] a.ae-logo-link img.ae-logo-img`,
  // The demo site's kit has no menus (the Appearance tests rely on that), so the widget
  // renders its own empty <nav>: still its output, never the renderer's placeholder.
  "nav-menu": (id) => `nav[data-ae-id="${id}"][aria-label="Site"]`,
  form: (id) => `form[data-ae-id="${id}"] input[name="email"]`,
};

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

/** Serves a built site's folder like a static host with a single-page fallback. */
function serve(dir: string): Promise<Server> {
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    let file = join(dir, pathname);
    if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) file = join(dir, "index.html");
    response.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    response.end(readFileSync(file));
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done(server)));
}

/** Copies the demo site to `site` the way a real site is laid out, the kit under src/lib/armature-kit/. */
function layOutAsRealSite(): void {
  rmSync(site, { recursive: true, force: true });
  mkdirSync(join(site, "src", "lib"), { recursive: true });
  for (const entry of ["content", "public", "index.html", "package.json", "vite.config.ts", "tsconfig.json"]) {
    cpSync(join(demo, entry), join(site, entry), { recursive: true });
  }
  for (const name of readdirSync(join(demo, "src"))) {
    if (!statSync(join(demo, "src", name)).isFile()) continue;
    const text = readFileSync(join(demo, "src", name), "utf8");
    writeFileSync(join(site, "src", name), text.replaceAll("../../../kit/", "./lib/armature-kit/"));
  }
  cpSync(join(repo, "kit"), join(site, "src", "lib", "armature-kit"), { recursive: true });
}

test.describe("a production build with \"sideEffects\": false", () => {
  test("renders every widget the kit ships, with the library's CSS and glyphs", async ({ page }) => {
    test.setTimeout(240_000);

    // The demo site must keep the realistic configuration, so every Playwright run has it.
    const pkg = JSON.parse(readFileSync(join(demo, "package.json"), "utf8")) as { sideEffects?: unknown };
    expect(pkg.sideEffects, 'examples/demo-site/package.json must keep "sideEffects": false').toBe(false);

    // The page must carry every widget the validator (and so the editor) knows.
    const layout = JSON.parse(readFileSync(join(demo, "src", "every-widget.json"), "utf8")) as { root: Node[] };
    const elements = flatten(layout.root);
    const known = Object.keys(PROPS_CHECKS).filter((type) => type !== "site-section").sort();
    expect(elements.map((element) => element.type).sort()).toEqual(known);
    expect(Object.keys(PROOF).sort(), "every widget type needs a proof selector").toEqual(known);

    layOutAsRealSite();
    let server: Server | null = null;
    try {
      expect(readFileSync(join(site, "src", "armature.ts"), "utf8")).toContain('from "./lib/armature-kit/index.ts"');
      expect(existsSync(join(site, "src", "lib", "armature-kit", "library", "index.ts"))).toBe(true);

      // A real production build: Vite with the site's own config, minified, tree-shaken.
      try {
        execFileSync("npx", ["vite", "build", "--outDir", "dist", "--emptyOutDir", "--logLevel", "warn"], { cwd: site, stdio: "pipe", shell: process.platform === "win32" });
      } catch (error) {
        const failed = error as { stdout?: Buffer; stderr?: Buffer };
        throw new Error(`vite build failed:\n${failed.stdout?.toString() ?? ""}\n${failed.stderr?.toString() ?? ""}`, { cause: error });
      }
      const dist = join(site, "dist");
      expect(existsSync(join(dist, "index.html"))).toBe(true);

      server = await serve(dist);
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const armatureWarnings: string[] = [];
      const pageErrors: string[] = [];
      page.on("console", (message) => {
        if (message.text().includes("Armature:")) armatureWarnings.push(message.text());
      });
      page.on("pageerror", (error) => pageErrors.push(String(error)));
      // Nothing leaves the machine: Google Fonts, the map and the video host are aborted.
      await page.route(/^https?:\/\//, (route) => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));

      await page.goto(`${origin}/every-widget`, { waitUntil: "domcontentloaded" });
      await expect(page.locator('.ae-root[data-ae-page="every-widget"]')).toBeVisible();

      for (const element of elements) {
        const root = page.locator(`[data-ae-id="${element.id}"]`);
        await expect(root, element.type).toHaveCount(1);
        await expect(root, element.type).toHaveAttribute("data-ae-type", element.type);
        await expect(root, element.type).not.toHaveClass(/ae-unsupported/);
        await expect(page.locator(PROOF[element.type]!(element.id)).first(), `${element.type} renders its own output`).toBeAttached();
        // Everything takes up room on the page except the empty menu.
        if (element.type !== "nav-menu") expect((await root.boundingBox())?.width, `${element.type} has a box`).toBeGreaterThan(0);
      }
      expect(await page.locator(".ae-unsupported").count()).toBe(0);
      expect(armatureWarnings, "the kit skipped no element").toEqual([]);
      expect(pageErrors).toEqual([]);

      // The library's base CSS and its per-widget CSS hooks travelled with the widgets.
      const css = (await page.locator('style[data-armature-page="every-widget"]').textContent()) ?? "";
      expect(css).toContain(".ae-panel-toggle");
      expect(css).toMatch(/ae-ewicon01[^}]*font-size:\s*48px/);
      expect(await page.locator('[data-ae-id="ewaccord"] .ae-panel-toggle').first().evaluate((node) => getComputedStyle(node).cursor)).toBe("pointer");

      // Glyphs from library/glyphs.ts: the accordion's minus and the icon list's check.
      await expect(page.locator('[data-ae-id="ewaccord"] .ae-panel-icon svg path[d="M5 12h14"]').first()).toBeAttached();
      await expect(page.locator('[data-ae-id="ewiconls"] .ae-icon-list-icon svg path[d="M20 6 9 17l-5-5"]').first()).toBeAttached();

      // The widgets run, not only render: tabs switch, a closed panel opens, the clock ticks.
      const secondTab = page.locator('[data-ae-id="ewtabs01"] [role="tab"]').nth(1);
      await secondTab.click();
      await expect(secondTab).toHaveAttribute("aria-selected", "true");
      await expect(page.locator('[data-ae-id="ewtabs01"] [role="tabpanel"]:not([hidden])')).toHaveText(/Then we build them/);
      const secondPanel = page.locator('[data-ae-id="ewaccord"] .ae-panel-toggle').nth(1);
      await expect(secondPanel).toHaveAttribute("aria-expanded", "false");
      await secondPanel.click();
      await expect(secondPanel).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator('[data-ae-id="ewcountd"] .ae-countdown-value').first()).not.toHaveText("--");
      await expect(page.locator('[data-ae-id="ewcountr"] .ae-counter-number')).toContainText("120");
    } finally {
      server?.close();
      rmSync(site, { recursive: true, force: true });
    }
  });
});
