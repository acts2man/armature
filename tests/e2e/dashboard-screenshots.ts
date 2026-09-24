/**
 * Captures the WordPress-style dashboard's screens into docs/screenshots at 1440x900
 * (`*-desktop.png`) and 390x844 (`*-phone.png`), against the demo site with a mocked
 * Supabase (tests/e2e/mocks.ts).
 *
 *   npx tsx tests/e2e/dashboard-screenshots.ts     (both dev servers must be running: see playwright.config.ts)
 */
import { chromium, type Page } from "@playwright/test";
import { COMMIT_SHA, SITE_ID, STAFF_ID, editorUrl, installMocks, sampleSubmissions, type MockOptions } from "./mocks.ts";

/** The other sites the agency looks after, for the Projects list, the Clients screen and the site switcher. */
const MORE_SITES = [
  { id: "22222222-2222-4222-8222-222222222222", name: "Birch Lane Bakery", status: "connected" as const },
  { id: "33333333-3333-4333-8333-333333333333", name: "Cedar Ridge Dental", status: "needs_attention" as const },
  { id: "44444444-4444-4444-8444-444444444444", name: "Driftwood Kayaks", status: "hosting_only" as const },
];

const OUT = "docs/screenshots";
const DASHBOARD = "http://localhost:5173";
const chromiumPath = process.env["PLAYWRIGHT_CHROMIUM"] ?? "/opt/pw-browsers/chromium";
const SIZES = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
] as const;

const rows = () => ({
  form_submissions: sampleSubmissions(),
  publishes: [{ id: "p1", site_id: SITE_ID, user_id: STAFF_ID, page_slug: "home, about", fields_changed: [], commit_sha: COMMIT_SHA, commit_url: `https://github.com/acme/alder-stone/commit/${COMMIT_SHA}`, status: "committed", error: null, created_at: "2026-09-20T15:00:00Z" }],
});

const browser = await chromium.launch({ executablePath: chromiumPath, args: ["--ignore-certificate-errors"] });

async function shoot(name: string, route: string, options: MockOptions = {}, run?: (page: Page) => Promise<void>, fullPage = true) {
  for (const size of SIZES) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, ignoreHTTPSErrors: true, deviceScaleFactor: 1 });
    const page = await context.newPage();
    // The dev server compiles each screen on first visit; give it time.
    page.setDefaultTimeout(90_000);
    await installMocks(page, { allowFonts: true, rows: rows(), ...options });
    await page.addInitScript(() => {
      window.localStorage.setItem("armature:visual:tour:v1", "done");
      window.localStorage.setItem("armature:builder:tour:v1", "done");
    });
    await page.goto(`${DASHBOARD}${route}`);
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
    // Every screen has an h1; the visual editor (full-screen, outside the shell) has the editor root instead.
    await page.locator('h1, [data-testid="visual-editor"]').first().waitFor();
    if (run) {
      try {
        await run(page);
      } catch (error) {
        console.log(`${name} (${size.name}): ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
      }
    }
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/${name}-${size.name}.png`, fullPage });
    await context.close();
    console.log(`${OUT}/${name}-${size.name}.png`);
  }
}

await shoot("wp-site-dashboard", `/sites/${SITE_ID}`);
await shoot("wp-projects", "/projects", { moreSites: MORE_SITES });
await shoot("wp-clients", "/agency/clients", { extraSites: MORE_SITES.map(({ id, name }) => ({ id, name })) });
await shoot("wp-site-switcher", `/sites/${SITE_ID}/pages`, { moreSites: MORE_SITES }, async (page) => {
  const open = page.getByRole("button", { name: "Open menu" });
  if (await open.isVisible()) await open.click();
  // On a phone the sidebar exists twice (the hidden desktop one and the drawer); use the one showing.
  await page.getByTestId("site-switcher").locator("visible=true").click();
  await page.getByTestId("site-menu").locator("visible=true").waitFor();
}, false);
await shoot("wp-editor-number-controls", editorUrl(), {}, async (page) => {
  const frame = page.frameLocator('iframe[title$="live site"]');
  await frame.locator("h1").waitFor({ timeout: 20_000 });
  await page.getByTestId("visual-editor").and(page.locator('[data-builder="on"]')).waitFor();
  await page.getByRole("button", { name: /Phone view/ }).click();
  await page.waitForTimeout(1200);
  await frame.locator(".ae-hdbuilds").click();
  await page.getByTestId("inspector-tab-advanced").click();
  await page.getByTestId("group-layout").getByTestId("step-up").first().waitFor();
}, false);
await shoot("wp-site-dashboard-client", `/sites/${SITE_ID}`, { role: "client" });
await shoot("wp-sidebar-collapsed", `/sites/${SITE_ID}/pages`, {}, async (page) => {
  const toggle = page.getByTestId("sidebar-collapse");
  if (await toggle.isVisible()) await toggle.click();
});
await shoot("wp-phone-menu", `/sites/${SITE_ID}`, { role: "client" }, async (page) => {
  const open = page.getByRole("button", { name: "Open menu" });
  if (await open.isVisible()) await open.click();
}, false);
await shoot("wp-pages", `/sites/${SITE_ID}/pages`, {}, async (page) => {
  await page.getByTestId("page-row-contact").hover();
});
await shoot("wp-pages-add-new", `/sites/${SITE_ID}/pages`, {}, async (page) => {
  await page.getByTestId("add-new-page").click();
  await page.getByLabel("Title").fill("Our Services");
}, false);
await shoot("wp-pages-trash", `/sites/${SITE_ID}/pages?view=trash`);
await shoot("wp-media", `/sites/${SITE_ID}/media`, {}, async (page) => {
  await page.getByTestId("media-item-team.svg").click();
});
await shoot("wp-media-list", `/sites/${SITE_ID}/media`, {}, async (page) => {
  await page.getByRole("group", { name: "Show as" }).getByRole("button", { name: "List" }).click();
});
await shoot("wp-contact", `/sites/${SITE_ID}/contact?entry=aaaa0001-0000-4000-8000-000000000001`);
await shoot("wp-contact-settings", `/sites/${SITE_ID}/contact?tab=settings`);
await shoot("wp-appearance-globals", `/sites/${SITE_ID}/appearance`);
await shoot("wp-appearance-header", `/sites/${SITE_ID}/appearance/header`);
await shoot("wp-appearance-footer", `/sites/${SITE_ID}/appearance/footer`);
await shoot("wp-appearance-menus", `/sites/${SITE_ID}/appearance/menus`, {}, async (page) => {
  await page.getByTestId("menu-create").click();
  await page.getByTestId("menu-name").fill("Main menu");
  await page.getByTestId("menu-name-save").click();
  for (const slug of ["home", "about"]) {
    await page.getByTestId("item-add").click();
    await page.getByTestId("item-page").selectOption(slug);
    await page.getByTestId("item-save").click();
  }
  await page.getByTestId("item-add").click();
  await page.getByTestId("item-kind").selectOption("url");
  await page.getByTestId("item-href").fill("https://example.com/book");
  await page.getByTestId("item-label").fill("Book a call");
  await page.getByTestId("item-parent").selectOption({ index: 2 });
  await page.getByTestId("item-save").click();
});
await shoot("wp-users", `/sites/${SITE_ID}/users`, {}, async (page) => {
  await page.getByTestId("user-sam@alderstone.example").hover();
});
await shoot("wp-users-add", `/sites/${SITE_ID}/users`, {}, async (page) => {
  await page.getByTestId("add-user").click();
}, false);
await shoot("wp-site-settings", `/sites/${SITE_ID}/settings`);
await shoot("wp-site-settings-services", `/sites/${SITE_ID}/settings/services`);
await shoot("wp-site-settings-editing", `/sites/${SITE_ID}/settings/editing`);
await shoot("wp-site-settings-history", `/sites/${SITE_ID}/settings/history`);
// The header built in the editor, edited in context around the home page.
for (const size of SIZES.slice(0, 1)) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, ignoreHTTPSErrors: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await installMocks(page, { allowFonts: true });
  await page.addInitScript(() => {
    window.localStorage.setItem("armature:visual:tour:v1", "done");
    window.localStorage.setItem("armature:builder:tour:v1", "done");
    window.localStorage.setItem("armature:dashboard:tour:v1", "done");
  });
  await page.goto(`${DASHBOARD}/sites/${SITE_ID}/appearance/header`);
  await page.getByTestId("build-header").click();
  await page.getByTestId("part-banner").waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  await page.frameLocator(`iframe[title$="live site"]`).locator(".ae-nav").click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/wp-editor-header-part-${size.name}.png` });
  await context.close();
  console.log(`${OUT}/wp-editor-header-part-${size.name}.png`);
}

await browser.close();
