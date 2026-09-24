/**
 * Appearance: the Globals page with its live preview and one-commit save; the Header built
 * in the editor with a Site Logo and a Nav Menu (edited in context around a real page, and
 * clicking the header on any page opens the header's editor); Menus created, nested and
 * published into the site kit.
 */
import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { SITE_ID, installMocks } from "./mocks.ts";

const siteFrame = (page: Page): FrameLocator => page.frameLocator(`iframe[title$="live site"]`);
const skipTours = (page: Page) =>
  page.addInitScript(() => {
    window.localStorage.setItem("armature:visual:tour:v1", "done");
    window.localStorage.setItem("armature:builder:tour:v1", "done");
    window.localStorage.setItem("armature:dashboard:tour:v1", "done");
  });

test("Globals: the preview follows a colour change and Save publishes the kit", async ({ page }) => {
  const state = await installMocks(page);
  await skipTours(page);
  await page.goto(`/sites/${SITE_ID}/appearance`);
  await expect(page.getByRole("heading", { level: 1, name: "Appearance" })).toBeVisible();
  const preview = page.getByTestId("globals-preview");
  await expect(preview).toContainText("A headline in your heading font");
  const before = await preview.locator("h1").evaluate((node) => getComputedStyle(node).fontFamily);
  const colours = page.getByTestId("globals-editor").getByTestId("group-global-colours");
  await colours.getByTestId("color-swatch").first().click();
  await colours.getByTestId("color-text").fill("#aa0000");
  await page.keyboard.press("Escape");
  await expect(colours.getByTestId("color-popover")).toHaveCount(0);
  await expect.poll(() => preview.evaluate((node) => getComputedStyle(node).getPropertyValue("--ae-color-primary").trim())).toBe("#aa0000");
  await expect(page.getByTestId("globals-save")).toBeEnabled();
  await page.getByTestId("globals-save").click();
  await expect(page.getByText("Site look published.")).toBeVisible();
  const kit = state.builderPublishRequests.at(-1)?.["kit"] as { colors: { primary: string } };
  expect(kit.colors.primary).toBe("#aa0000");
  expect(before.length).toBeGreaterThan(0);
});

test("Menus: create a menu, add pages and a link, nest one, publish into the kit", async ({ page }) => {
  const state = await installMocks(page);
  await skipTours(page);
  await page.goto(`/sites/${SITE_ID}/appearance/menus`);
  await expect(page.getByText("No menus yet")).toBeVisible();
  // The true state: the header is still coded, so no menu can show yet.
  await expect(page.getByTestId("menus-state")).toContainText("The header is still coded");
  await page.getByTestId("menu-create").click();
  await page.getByTestId("menu-name").fill("Main menu");
  await page.getByTestId("menu-name-save").click();
  await expect(page.getByTestId("menu-select")).toHaveValue(/./);
  await expect(page.getByTestId("menu-usage")).toHaveText("Not shown anywhere yet");

  await page.getByTestId("item-add").click();
  await page.getByTestId("item-page").selectOption("home");
  await page.getByTestId("item-save").click();
  await page.getByTestId("item-add").click();
  await page.getByTestId("item-page").selectOption("about");
  await page.getByTestId("item-save").click();
  await page.getByTestId("item-add").click();
  await page.getByTestId("item-kind").selectOption("url");
  await page.getByTestId("item-href").fill("https://example.com/book");
  await page.getByTestId("item-label").fill("Book a call");
  await page.getByTestId("item-save").click();
  const items = page.getByTestId("menu-items");
  await expect(items.locator("li")).toHaveCount(3);
  await expect(items.locator("li").nth(2)).toContainText("Book a call");
  // Nest "Book a call" under "About".
  const third = items.locator("li").nth(2);
  await third.getByRole("button", { name: /Under previous/ }).click();
  await expect(items.locator("li").nth(2)).toHaveAttribute("data-depth", "1");
  await page.getByTestId("menus-save").click();
  await expect(page.getByText("Menus published.")).toBeVisible();
  const kit = state.builderPublishRequests.at(-1)?.["kit"] as { menus: { name: string; items: { label: string; kind: string; page?: string; href?: string; children?: { label: string }[] }[] }[] };
  expect(kit.menus).toHaveLength(1);
  expect(kit.menus[0]?.name).toBe("Main menu");
  expect(kit.menus[0]?.items.map((item) => item.label)).toEqual(["Home", "About"]);
  expect(kit.menus[0]?.items[1]?.children?.[0]?.label).toBe("Book a call");
  // It comes back from the site after a reload.
  await page.reload();
  await expect(page.getByTestId("menu-items").locator("li")).toHaveCount(3);
});

test("Header: build it in the editor with a Site Logo and a Nav Menu, publish, and edit it from any page", async ({ page }) => {
  const state = await installMocks(page);
  await skipTours(page);
  await page.goto(`/sites/${SITE_ID}/appearance/header`);
  await expect(page.getByTestId("part-header")).toContainText("still part of the site's code");
  await page.getByTestId("build-header").click();
  await expect(page.getByTestId("visual-editor")).toHaveAttribute("data-builder", "on", { timeout: 20_000 });
  await expect(page.getByTestId("part-banner")).toContainText("Editing the header", { timeout: 20_000 });
  await expect(page).toHaveURL(/\/visual\?page=home&part=header$/);
  // The site now shows the built header (the kit's ArmatureChrome) with the logo placeholder and the menu note.
  const frame = siteFrame(page);
  const chrome = frame.locator("header[data-armature-part='header']");
  await expect(chrome).toBeVisible();
  await expect(chrome.locator(".ae-logo-empty")).toHaveText("Site logo");
  await expect(chrome.locator(".ae-nav-empty")).toContainText("No menu yet");
  // Clicking an element of the header selects it and the panel shows its Content settings.
  await chrome.locator(".ae-nav").click();
  await expect(page.getByTestId("part-banner")).toBeVisible();
  await expect(page.getByText("Fold into a menu button below (pixels)")).toBeVisible();
  // Back to the page, then click the header again: the header's editor opens again.
  await page.getByTestId("part-back").click();
  await expect(page.getByTestId("part-banner")).toHaveCount(0);
  await chrome.locator(".ae-logo").click();
  await expect(page.getByTestId("part-banner")).toContainText("Editing the header");
  await expect(page.getByText("Link to the home page")).toBeVisible();
  // Publish: the header goes out as content/layouts/_header.json.
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByTestId("publish-builder")).toContainText("Header");
  await page.getByTestId("publish-confirm").click();
  await expect(page.getByTestId("publish-done")).toContainText("Published", { timeout: 20_000 });
  const layouts = state.builderPublishRequests.at(-1)?.["layouts"] as Record<string, { pageSlug: string; root: { type: string; children?: { type: string }[] }[] }>;
  expect(layouts["_header"]?.pageSlug).toBe("_header");
  expect(layouts["_header"]?.root[0]?.children?.map((child) => child.type)).toEqual(["site-logo", "nav-menu"]);
  // Appearance › Header now says it is built, with a way back to the coded header.
  await page.goto(`/sites/${SITE_ID}/appearance/header`);
  await expect(page.getByTestId("part-header")).toContainText("builder part");
  // The true state, read from the file: three elements, a Nav Menu with nothing to show yet.
  await expect(page.getByTestId("part-header-state")).toContainText("It holds 3 elements. Its Nav Menu has no menu to show yet: create one under Menus, then pick it in the editor.");
  await page.goto(`/sites/${SITE_ID}/appearance/footer`);
  await expect(page.getByTestId("part-footer")).toContainText("still part of the site's code");
  await expect(page.getByTestId("part-footer-state")).toContainText("The header is already built in the editor.");
  await page.goto(`/sites/${SITE_ID}/appearance/header`);
  await expect(page.getByTestId("edit-header")).toHaveAttribute("href", `/sites/${SITE_ID}/visual?page=home&part=header`);
  await page.getByTestId("remove-header").click();
  await page.getByTestId("remove-header-confirm").click();
  await expect(page.getByText("The coded header is back.")).toBeVisible();
  expect(state.builderPublishRequests.at(-1)?.["layouts"]).toEqual({ _header: null });
  await expect(page.getByTestId("part-header")).toContainText("still part of the site's code");
});
