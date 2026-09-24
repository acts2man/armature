/**
 * Captures the page builder's documentation screenshots into docs/screenshots at
 * 1440x900, against the demo site with a mocked Supabase (tests/e2e/mocks.ts). Reflects
 * the Elementor-style layout: one left panel (Elements / Edit / Globals / Page settings),
 * a full-width canvas, and the collapse tab.
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
/** Scroll the site's own window so the element sits near the top (a higher section's image
 *  target can't overlap it), then select it by clicking. */
const pick = async (page: Page, selector: string, position?: { x: number; y: number }) => {
  await frame(page).locator(selector).evaluate((node) => node.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(500);
  await frame(page).locator(selector).click(position ? { position } : {});
  await page.waitForTimeout(300);
};
const openElements = async (page: Page) => {
  await page.getByTestId("topbar-add").click();
  await page.getByTestId("elements-panel").waitFor();
};

await shoot("builder-elements", async (page) => {
  await open(page);
  await openElements(page);
});

await shoot("builder-globals", async (page) => {
  await open(page);
  await openElements(page);
  await page.getByTestId("tab-globals").click();
  await page.waitForTimeout(300);
});

await shoot("builder-edit-heading-content", async (page) => {
  await open(page);
  await pick(page, ".ae-hdbuilds");
  await page.getByTestId("edit-title").waitFor();
});

await shoot("builder-edit-heading-style", async (page) => {
  await open(page);
  await pick(page, ".ae-hdbuilds");
  await page.getByTestId("inspector-tab-style").click();
  await page.waitForTimeout(300);
});

await shoot("builder-edit-heading-advanced", async (page) => {
  await open(page);
  await pick(page, ".ae-hdbuilds");
  await page.getByTestId("inspector-tab-advanced").click();
  await page.waitForTimeout(300);
});

await shoot("builder-edit-container-layout", async (page) => {
  await open(page);
  // Select the image, then walk up to the row container (whose corner is filled by children).
  await pick(page, ".ae-imgbuild img");
  await page.keyboard.press("ArrowLeft"); // column
  await page.waitForTimeout(150);
  await page.keyboard.press("ArrowLeft"); // row (a container: first tab is Layout)
  await page.getByTestId("edit-title").waitFor();
  await page.waitForTimeout(300);
});

await shoot("builder-text-editor-panel", async (page) => {
  await open(page);
  await pick(page, ".ae-txtbuild");
  await page.getByTestId("edit-title").waitFor();
});

await shoot("builder-drag-in-progress", async (page) => {
  await open(page);
  await openElements(page);
  await frame(page).locator(".ae-txtbuild").evaluate((node) => node.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(500);
  const from = await center(page.getByTestId("element-heading"));
  const target = await frame(page).locator(".ae-txtbuild").boundingBox();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y + 8);
  await page.mouse.move((target?.x ?? 0) + (target?.width ?? 0) / 2, (target?.y ?? 0) + 6, { steps: 12 });
  await page.getByTestId("drop-line").waitFor();
});

await shoot("builder-collapsed", async (page) => {
  await open(page);
  await page.getByTestId("panel-collapse").click();
  await page.waitForTimeout(400);
});

await shoot("builder-page-settings", async (page) => {
  await open(page);
  await page.getByTestId("topbar-page-settings").click();
  await page.getByTestId("page-settings-panel").waitFor();
  await page.waitForTimeout(300);
});

await shoot("builder-number-steppers", async (page) => {
  await open(page);
  await pick(page, ".ae-hdbuilds");
  await page.getByTestId("inspector-tab-advanced").click();
  const layout = page.getByTestId("group-layout");
  await layout.getByTestId("step-up").first().waitFor();
  const box = layout.getByTestId("number-input").filter({ has: page.getByLabel("Margin top", { exact: true }) });
  await box.getByTestId("step-up").click({ clickCount: 3 });
  await page.waitForTimeout(300);
});

await shoot("builder-font-size-toolbar", async (page) => {
  await open(page);
  await pick(page, ".ae-hdbuilds");
  await page.getByTestId("font-size-strip").waitFor();
  await page.getByTestId("font-size-strip").hover();
});

await shoot("builder-rich-text-toolbar", async (page) => {
  await open(page);
  await frame(page).locator(".ae-txtbuild").evaluate((node) => node.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(500);
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
  await pick(page, ".ae-imgbuild img");
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
  await pick(page, ".ae-secbuild", { x: 5, y: 5 });
  const handle = page.getByTestId("handle-padding-top");
  await handle.waitFor();
  await page.waitForTimeout(400);
  const start = await center(handle);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y + 24, { steps: 6 });
  await page.getByTestId("handle-value").waitFor();
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
  await frame(page).locator(".ae-hdbuilds").evaluate((node) => node.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(500);
  await frame(page).locator(".ae-hdbuilds").dblclick();
  await page.keyboard.press("End");
  await page.keyboard.type(" this year");
  await page.keyboard.press("Enter");
  await openElements(page);
  await page.getByTestId("tab-globals").click();
  await page.getByTestId("group-global-colours").getByTestId("color-swatch").first().click();
  await page.getByTestId("group-global-colours").getByTestId("color-text").fill("#1f5c4a");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByTestId("publish-builder").waitFor();
});

await browser.close();
