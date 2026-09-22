/**
 * Captures the visual editor's documentation screenshots into docs/screenshots at
 * 1440x900, against the demo site with a mocked Supabase (tests/e2e/mocks.ts).
 *
 *   npx tsx tests/e2e/screenshots.ts     (both dev servers must be running: see playwright.config.ts)
 */
import { chromium } from "@playwright/test";
import { editorUrl, installMocks, PLAIN_SITE_URL, servePlainSite } from "./mocks.ts";

const OUT = "docs/screenshots";
const DASHBOARD = "http://localhost:5173";
const chromiumPath = process.env["PLAYWRIGHT_CHROMIUM"] ?? "/opt/pw-browsers/chromium";

const browser = await chromium.launch({ executablePath: chromiumPath, args: ["--ignore-certificate-errors"] });
const shoot = async (name: string, run: (page: import("@playwright/test").Page) => Promise<void>, options: Parameters<typeof installMocks>[1] = {}) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await installMocks(page, { allowFonts: true, ...options });
  await page.addInitScript(() => { window.localStorage.setItem("armature:visual:tour:v1", "done"); window.localStorage.setItem("armature:builder:tour:v1", "done"); });
  await run(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await context.close();
  console.log(`${OUT}/${name}.png`);
};

const frame = (page: import("@playwright/test").Page) => page.frameLocator('iframe[title$="live site"]');
const open = async (page: import("@playwright/test").Page) => {
  await page.goto(`${DASHBOARD}${editorUrl()}`);
  await frame(page).locator("h1").waitFor({ timeout: 20_000 });
  await page.waitForTimeout(600);
};

await shoot("visual-editor-text-selected", async (page) => {
  await open(page);
  await frame(page).locator("h1").click();
  await frame(page).locator("h1").click();
  await page.keyboard.press("End");
  await page.keyboard.type(", and built to last");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
});

await shoot("visual-editor-image-selected", async (page) => {
  await open(page);
  await page.getByTestId("image-target-home.hero.image").click();
});

await shoot("visual-editor-list-selected", async (page) => {
  await open(page);
  await page.getByTestId("layer-home.faq.items").click();
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByTestId("list-item-3").getByLabel("Question").fill("Do you build in Placer County?");
  await page.getByTestId("list-item-3").getByLabel("Answer").fill("Yes. We build across Sacramento, Placer and El Dorado counties.");
  await page.getByRole("button", { name: "Move item 4 up" }).click();
  await page.getByTestId("inspector").locator("div.overflow-y-auto").evaluate((el) => el.scrollTo(0, 0));
  await frame(page).locator("body").evaluate(() => window.scrollTo(0, 0));
});

await shoot("visual-editor-publish", async (page) => {
  await open(page);
  await page.getByTestId("layer-home.hero.title").click();
  await page.getByTestId("inspector").getByLabel("Headline").fill("Homes built around the way you live, and built to last");
  await page.getByTestId("layer-shared.footer.copyright").click();
  await page.getByTestId("inspector").getByLabel("Copyright line").fill("© 2027 Alder & Stone. All rights reserved.");
  await page.getByTestId("layer-home.faq.items").click();
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByTestId("list-item-3").getByLabel("Question").fill("Do you build in Placer County?");
  await page.getByTestId("inspector").locator("div.overflow-y-auto").evaluate((el) => el.scrollTo(0, 0));
  await frame(page).locator("body").evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByTestId("publish-summary").waitFor();
});

await shoot("visual-editor-phone", async (page) => {
  await open(page);
  await page.getByRole("button", { name: /Phone view/ }).click();
  await page.waitForTimeout(500);
  await frame(page).locator("h1").click();
});

await shoot(
  "visual-editor-connection-error",
  async (page) => {
    await servePlainSite(page);
    await page.goto(`${DASHBOARD}${editorUrl()}`);
    await page.getByRole("alert").waitFor({ timeout: 20_000 });
  },
  { liveUrl: PLAIN_SITE_URL, embed: { reachable: true, status: 200, xFrameOptions: "DENY", frameAncestors: null } },
);

await browser.close();
