/**
 * Getting into the editor: the loading screen never flashes the Stage 1 editor on a
 * builder site, the page comes from the URL, an unknown page is explained, the page
 * name in the top bar opens a small menu, and every "Edit visually" link carries its page.
 */
import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { SITE_ID, editorUrl, installMocks } from "./mocks.ts";

const siteFrame = (page: Page): FrameLocator => page.frameLocator(`iframe[title$="live site"]`);

async function skipTours(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("armature:visual:tour:v1", "done");
    window.localStorage.setItem("armature:builder:tour:v1", "done");
  });
}

test.describe("opening the editor", () => {
  test("shows a skeleton with 'Connecting to your site…' and never the Stage 1 chrome before the handshake decides", async ({ page }) => {
    await installMocks(page);
    await skipTours(page);
    // Slow the site down so the connecting state is visible for a while.
    await page.route("http://localhost:5174/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });
    await page.goto(editorUrl());
    const editor = page.getByTestId("visual-editor");
    await expect(editor).toHaveAttribute("data-connecting", "yes");
    await expect(page.getByTestId("skeleton-topbar")).toBeVisible();
    await expect(page.getByTestId("skeleton-panel")).toBeVisible();
    await expect(page.getByText("Connecting to your site…")).toBeVisible();
    // Nothing of the Stage 1 editor (its icon rail, its page switcher, its inspector) is mounted meanwhile.
    expect(await page.getByTestId("page-switcher").count()).toBe(0);
    expect(await page.getByTestId("topbar").count()).toBe(0);
    await expect(editor).toHaveAttribute("data-builder", "on", { timeout: 20_000 });
    await expect(editor).not.toHaveAttribute("data-connecting", "yes");
    await expect(page.getByTestId("topbar")).toBeVisible();
    expect(await page.getByTestId("page-switcher").count()).toBe(0);
  });

  test("opens the page named in the URL, and explains an unknown one", async ({ page }) => {
    await installMocks(page);
    await skipTours(page);
    await page.goto(editorUrl("contact"));
    await expect(page.getByTestId("page-name")).toContainText("Contact", { timeout: 20_000 });
    await expect(siteFrame(page).locator(".ae-cthead01")).toHaveText("Let's talk about your home");
    await expect(page).toHaveURL(/\/visual\?page=contact$/);
    await page.goto(editorUrl("no-such-page"));
    await expect(page.getByText('There is no page called "no-such-page"')).toBeVisible();
    await page.getByRole("link", { name: "See all pages" }).click();
    await expect(page).toHaveURL(new RegExp(`/sites/${SITE_ID}/pages$`));
  });

  test("the page name opens a menu with Page settings and All pages", async ({ page }) => {
    await installMocks(page);
    await skipTours(page);
    await page.goto(editorUrl("home"));
    await expect(page.getByTestId("visual-editor")).toHaveAttribute("data-builder", "on", { timeout: 20_000 });
    await page.getByTestId("page-name").click();
    await expect(page.getByTestId("page-menu-settings")).toBeVisible();
    await expect(page.getByTestId("page-menu-all")).toHaveAttribute("href", `/sites/${SITE_ID}/pages`);
    await page.getByTestId("page-menu-settings").click();
    await expect(page.getByTestId("topbar-page-settings")).toHaveAttribute("aria-pressed", "true");
  });

  test("every 'Edit visually' link carries its page", async ({ page }) => {
    await installMocks(page);
    await skipTours(page);
    await page.goto(`/sites/${SITE_ID}/pages`);
    await expect(page.getByTestId("edit-visually-about")).toHaveAttribute("href", `/sites/${SITE_ID}/visual?page=about`);
    await page.getByTestId("edit-visually-about").click();
    await expect(page.getByTestId("page-name")).toContainText("About", { timeout: 20_000 });
    await expect(page).toHaveURL(/\/visual\?page=about$/);
  });
});

test.describe("the coded header and footer", () => {
  test("agency staff read that the header and footer are still coded, above the fields", async ({ page }) => {
    await installMocks(page);
    await skipTours(page);
    await page.goto(editorUrl("home"));
    await expect(page.getByTestId("visual-editor")).toHaveAttribute("data-builder", "on", { timeout: 20_000 });
    const frame = siteFrame(page);
    await frame.locator("footer small").scrollIntoViewIfNeeded();
    await frame.locator("footer small").click();
    const note = page.getByTestId("chrome-note");
    await expect(note).toContainText("The header and footer are still coded. They become fully editable once converted to builder parts.");
    await expect(page.getByTestId("field-editor").getByLabel("Copyright line")).toBeVisible();
    // A field on the page itself carries no such note.
    await frame.locator(".ae-hdbuilds").click();
    await expect(page.getByTestId("chrome-note")).toHaveCount(0);
  });

  test("clients read that their agency can make them editable", async ({ page }) => {
    await installMocks(page, { role: "client", editingLevel: "builder" });
    await skipTours(page);
    await page.goto(editorUrl("home"));
    await expect(page.getByTestId("visual-editor")).toHaveAttribute("data-builder", "on", { timeout: 20_000 });
    const frame = siteFrame(page);
    await frame.locator("footer small").scrollIntoViewIfNeeded();
    await frame.locator("footer small").click();
    await expect(page.getByTestId("chrome-note")).toContainText("The header and footer are part of the site's code. Your agency can make them editable.");
    await expect(page.getByTestId("field-editor").getByLabel("Copyright line")).toBeVisible();
  });

  test("the Stage 1 editor shows the same note in its inspector", async ({ page }) => {
    await installMocks(page, { role: "client" });
    await skipTours(page);
    await page.goto(editorUrl("home"));
    await expect(siteFrame(page).locator("h1")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("layer-shared.footer.copyright").click();
    await expect(page.getByTestId("inspector").getByTestId("chrome-note")).toContainText("Your agency can make them editable.");
  });
});
