/**
 * Captures the page builder's documentation screenshots into docs/screenshots at
 * 1440x900, against the demo site with a mocked Supabase (tests/e2e/mocks.ts).
 *
 *   npx tsx tests/e2e/builder-screenshots.ts     (both dev servers must be running: see playwright.config.ts)
 */
import { chromium, type Locator, type Page } from "@playwright/test";
import { COMMIT_SHA, SITE_ID, STAFF_ID, editorUrl, installMocks } from "./mocks.ts";

const OUT = "docs/screenshots";
const DASHBOARD = "http://localhost:5173";
const chromiumPath = process.env["PLAYWRIGHT_CHROMIUM"] ?? "/opt/pw-browsers/chromium";

const browser = await chromium.launch({ executablePath: chromiumPath, args: ["--ignore-certificate-errors"] });
const shoot = async (name: string, run: (page: Page) => Promise<void>, options: Parameters<typeof installMocks>[1] = {}) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await installMocks(page, { allowFonts: true, ...options });
  await page.addInitScript(() => {
    window.localStorage.setItem("armature:visual:tour:v1", "done");
    window.localStorage.setItem("armature:builder:tour:v1", "done");
  });
  try {
    await run(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log(`${OUT}/${name}.png`);
  } finally {
    await context.close();
  }
};

const frame = (page: Page) => page.frameLocator('iframe[title$="live site"]');
const open = async (page: Page) => {
  await page.goto(`${DASHBOARD}${editorUrl()}`);
  await frame(page).locator("h1").waitFor({ timeout: 20_000 });
  await page.getByTestId("visual-editor").and(page.locator('[data-builder="on"]')).waitFor();
  await page.waitForTimeout(800);
};
const center = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("no box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const scrollTo = async (page: Page, selector: string) => {
  // Scroll the site's own window only (scrollIntoView would also scroll the editor around it).
  await frame(page).locator(selector).evaluate((node) => {
    const rect = node.getBoundingClientRect();
    window.scrollBy({ top: rect.top - window.innerHeight / 2 + rect.height / 2, behavior: "instant" });
  });
  await page.waitForTimeout(700);
};

await shoot("builder-drag-in-progress", async (page) => {
  await open(page);
  await page.getByTestId("tab-elements").click();
  await scrollTo(page, ".ae-txtbuild");
  const from = await center(page.getByTestId("element-heading"));
  const target = await frame(page).locator(".ae-txtbuild").boundingBox();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y + 8);
  await page.mouse.move((target?.x ?? 0) + (target?.width ?? 0) / 2, (target?.y ?? 0) + 6, { steps: 12 });
  await page.getByTestId("drop-line").waitFor();
});

await shoot("builder-rich-text-toolbar", async (page) => {
  await open(page);
  await scrollTo(page, ".ae-txtbuild");
  const text = frame(page).locator(".ae-txtbuild");
  await text.dblclick();
  await page.getByTestId("richtext-toolbar").waitFor();
  await text.evaluate((node) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const first = walker.nextNode() as Text;
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(first, Math.min(first.data.length, 24));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
});

await shoot("builder-image-resize", async (page) => {
  await open(page);
  await scrollTo(page, ".ae-imgbuild");
  await frame(page).locator(".ae-imgbuild img").click();
  const handle = page.getByTestId("handle-image-width");
  await handle.waitFor();
  await page.waitForTimeout(400);
  const start = await center(handle);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 60, start.y, { steps: 8 });
  await page.getByTestId("handle-value").waitFor();
});

await shoot("builder-spacing-handles", async (page) => {
  await open(page);
  await page.getByTestId("tab-navigator").click();
  await page.getByTestId("nav-secbuild").click();
  await scrollTo(page, ".ae-secbuild");
  const handle = page.getByTestId("handle-padding-top");
  await handle.waitFor();
  await page.waitForTimeout(400);
  const start = await center(handle);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y + 24, { steps: 6 });
  await page.getByTestId("handle-value").waitFor();
});

await shoot("builder-style-tab", async (page) => {
  await open(page);
  await scrollTo(page, ".ae-hdbuilds");
  await frame(page).locator(".ae-hdbuilds").click();
  await page.getByTestId("inspector-tab-style").click();
});

await shoot("builder-navigator", async (page) => {
  await open(page);
  await scrollTo(page, ".ae-btnbuild");
  await frame(page).locator(".ae-btnbuild").click({ position: { x: 4, y: 4 } });
  await page.getByTestId("tab-navigator").click();
});

await shoot("builder-site-settings", async (page) => {
  await open(page);
  await page.getByTestId("tab-site").click();
});

await shoot("builder-pages", async (page) => {
  await open(page);
  await page.getByTestId("tab-pages").click();
  await page.getByTestId("new-page").click();
  await page.getByLabel("Title", { exact: true }).fill("Our services");
  await page.getByLabel("Landing page").check();
});

await shoot("builder-media", async (page) => {
  await open(page);
  await page.getByTestId("tab-media").click();
});

await shoot(
  "builder-history-versions",
  async (page) => {
    await open(page);
    await page.getByTestId("topbar-history").click();
    await page.getByTestId("revisions").getByTestId("revision").nth(1).click();
    await page.getByTestId("revision-banner").waitFor();
  },
  {
    rows: {
      publishes: [
        { id: "p2", site_id: SITE_ID, user_id: STAFF_ID, page_slug: "home", fields_changed: [], commit_sha: COMMIT_SHA, commit_url: null, status: "committed", error: null, created_at: new Date(Date.now() - 2 * 86_400_000).toISOString() },
        { id: "p1", site_id: SITE_ID, user_id: STAFF_ID, page_slug: "home", fields_changed: [], commit_sha: "1111111aaaaaaa2222222bbbbbbb3333333ccccc", commit_url: null, status: "committed", error: null, created_at: new Date(Date.now() - 12 * 86_400_000).toISOString() },
      ],
    },
  },
);

await shoot("builder-publish-dialog", async (page) => {
  await open(page);
  await scrollTo(page, ".ae-hdbuilds");
  await frame(page).locator(".ae-hdbuilds").dblclick();
  await page.keyboard.press("End");
  await page.keyboard.type(" this year");
  await page.keyboard.press("Enter");
  await page.getByTestId("tab-site").click();
  await page.getByTestId("group-global-colours").getByTestId("color-text").first().fill("#1f5c4a");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByTestId("publish-builder").waitFor();
});

await browser.close();
