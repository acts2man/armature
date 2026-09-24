/**
 * The Pages screen as a WordPress "All Pages" table: every page with its type and last
 * publish, search and count, row actions with an "Edit visually" deep link for every page,
 * "Add New Page" that opens the editor on the new page, Duplicate, Trash and Restore.
 */
import { expect, test } from "@playwright/test";
import { COMMIT_SHA, SITE_ID, STAFF_ID, installMocks } from "./mocks.ts";

const skipTours = (page: import("@playwright/test").Page) =>
  page.addInitScript(() => {
    window.localStorage.setItem("armature:visual:tour:v1", "done");
    window.localStorage.setItem("armature:builder:tour:v1", "done");
    window.localStorage.setItem("armature:dashboard:tour:v1", "done");
  });

const publishes = [{ id: "p1", site_id: SITE_ID, user_id: STAFF_ID, page_slug: "home, about", fields_changed: [], commit_sha: COMMIT_SHA, commit_url: `https://github.com/acme/alder-stone/commit/${COMMIT_SHA}`, status: "committed", error: null, created_at: "2026-09-20T15:00:00Z" }];

test("the table lists every page with type, last publish and who, and every row has its Edit visually link", async ({ page }) => {
  await installMocks(page, { rows: { publishes } });
  await skipTours(page);
  await page.goto(`/sites/${SITE_ID}/pages`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pages");
  await expect(page.getByTestId("pages-count")).toHaveText("3 pages");
  // The demo site: Home's layout holds a builder container between its coded sections (Builder, with form fields),
  // About has no layout (Coded), Contact exists only as a layout (Builder).
  const home = page.getByTestId("page-row-home");
  await expect(home).toContainText("Builder");
  await expect(page.getByTestId("page-row-about")).toContainText("Coded");
  await expect(page.getByTestId("page-row-contact")).toContainText("Builder");
  // "By" is the person's name from their profile, never an id or email.
  await expect(home).toContainText("Dana Whitfield");
  await expect(home).not.toContainText("dana@agency.example");
  await expect(home).not.toContainText(STAFF_ID);
  // Row actions are in view without hovering.
  await expect(page.getByTestId("page-actions-home")).toHaveCSS("opacity", "1");
  await expect(page.getByTestId("edit-visually-home")).toBeVisible();
  for (const slug of ["home", "about", "contact"]) {
    await expect(page.getByTestId(`edit-visually-${slug}`)).toHaveAttribute("href", `/sites/${SITE_ID}/visual?page=${slug}`);
    await expect(page.getByTestId(`page-title-${slug}`)).toHaveAttribute("href", `/sites/${SITE_ID}/visual?page=${slug}`);
    await expect(page.getByTestId(`page-settings-${slug}`)).toHaveAttribute("href", `/sites/${SITE_ID}/visual?page=${slug}&panel=settings`);
    await expect(page.getByTestId(`view-${slug}`)).toHaveAttribute("href", /^http:\/\/localhost:5174\//);
  }
  await expect(page.getByTestId("edit-text-home")).toHaveAttribute("href", `/sites/${SITE_ID}/pages/home`);
  expect(await page.getByTestId("edit-text-contact").count()).toBe(0);
  // Duplicate and Trash only on pages that exist as a layout alone (a coded page stays in the site's code).
  expect(await page.getByTestId("trash-home").count()).toBe(0);
  expect(await page.getByTestId("duplicate-home").count()).toBe(0);
  await expect(page.getByTestId("trash-contact")).toBeVisible();
  await expect(page.getByTestId("duplicate-contact")).toBeVisible();
  // The header & footer is not a page: one line under the table, with its text editor.
  await expect(page.getByTestId("chrome-row")).toContainText("Its words and pictures also edit by clicking them on any page");
  expect(await page.getByTestId("edit-visually-shared").count()).toBe(0);
  // Search.
  await page.getByTestId("pages-search").fill("cont");
  await expect(page.getByTestId("pages-count")).toHaveText("1 page");
  await expect(page.getByTestId("page-row-contact")).toBeVisible();
  expect(await page.getByTestId("page-row-home").count()).toBe(0);
  // Row actions are reachable with the keyboard: tabbing into the row shows them.
  await page.getByTestId("pages-search").fill("");
  await page.getByTestId("page-title-home").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("edit-visually-home")).toBeFocused();
  // The title opens the visual editor on that page.
  await page.getByTestId("page-title-about").click();
  await expect(page.getByTestId("page-name")).toContainText("About", { timeout: 20_000 });
});

test("Page settings from the table opens the editor with that page's settings panel", async ({ page }) => {
  await installMocks(page);
  await skipTours(page);
  await page.goto(`/sites/${SITE_ID}/pages`);
  await page.getByTestId("page-settings-contact").click();
  await expect(page.getByTestId("visual-editor")).toHaveAttribute("data-builder", "on", { timeout: 20_000 });
  await expect(page.getByTestId("topbar-page-settings")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("page-name")).toContainText("Contact");
});

test("Add New Page asks for a title and an address, then opens the editor on the new page", async ({ page }) => {
  await installMocks(page);
  await skipTours(page);
  await page.goto(`/sites/${SITE_ID}/pages`);
  await page.getByTestId("add-new-page").click();
  await page.getByLabel("Title").fill("Our Services");
  await expect(page.getByLabel("Address")).toHaveValue("/our-services/");
  await page.getByTestId("new-page-create").click();
  await expect(page).toHaveURL(new RegExp(`/sites/${SITE_ID}/visual\\?page=our-services`));
  await expect(page.getByTestId("visual-editor")).toHaveAttribute("data-builder", "on", { timeout: 20_000 });
  await expect(page.getByTestId("page-name")).toContainText("Our Services", { timeout: 20_000 });
  await expect(page).toHaveURL(/\/visual\?page=our-services$/);
  // It is a draft: the Pages list does not have it until it is published.
  await page.getByTestId("page-name").click();
  await page.getByTestId("page-menu-all").click();
  await expect(page.getByRole("dialog", { name: "Leave the editor?" })).toContainText("1 unpublished change");
  await page.getByRole("button", { name: "Leave" }).click();
  await expect(page.getByTestId("pages-count")).toHaveText("3 pages");
});

test("Duplicate, Trash, Restore and Delete permanently each go through one publish", async ({ page }) => {
  const state = await installMocks(page);
  await skipTours(page);
  await page.goto(`/sites/${SITE_ID}/pages`);
  await page.getByTestId("duplicate-contact").click();
  await expect(page.getByTestId("page-row-contact-copy")).toContainText("Contact (copy)", { timeout: 15_000 });
  await expect(page.getByTestId("pages-count")).toHaveText("4 pages");
  expect(state.builderPublishRequests.at(-1)?.["copies"]).toEqual({ "contact-copy": { from: "contact", label: "Contact (copy)", path: "/contact-copy/" } });

  await page.getByTestId("trash-contact-copy").click();
  await expect(page.getByRole("dialog")).toContainText("Move this page to the bin?");
  await page.getByTestId("confirm-page-action").click();
  await expect(page.getByTestId("page-row-contact-copy")).toHaveCount(0, { timeout: 15_000 });
  expect(state.builderPublishRequests.at(-1)?.["trash"]).toEqual({ "contact-copy": "trash" });
  await expect(page.getByTestId("pages-view-trash")).toContainText("Trash (1)");

  await page.getByTestId("pages-view-trash").click();
  await expect(page.getByTestId("trash-row-contact-copy")).toBeVisible();
  await expect(page.getByTestId("pages-count")).toHaveText("1 in the bin");
  await page.getByTestId("restore-contact-copy").click();
  await expect(page.getByTestId("trash-row-contact-copy")).toHaveCount(0, { timeout: 15_000 });
  expect(state.builderPublishRequests.at(-1)?.["trash"]).toEqual({ "contact-copy": "restore" });
  await page.getByTestId("pages-view-all").click();
  await expect(page.getByTestId("page-row-contact-copy")).toBeVisible();

  await page.getByTestId("trash-contact-copy").click();
  await page.getByTestId("confirm-page-action").click();
  await expect(page.getByTestId("pages-view-trash")).toContainText("Trash (1)", { timeout: 15_000 });
  await page.getByTestId("pages-view-trash").click();
  await page.getByTestId("delete-contact-copy").click();
  await expect(page.getByRole("dialog")).toContainText("Delete this page for good?");
  await page.getByTestId("confirm-page-action").click();
  await expect(page.getByText("The bin is empty")).toBeVisible({ timeout: 15_000 });
  expect(state.builderPublishRequests.at(-1)?.["trash"]).toEqual({ "contact-copy": "delete" });
});

test("a client at the content level sees no Add New Page, Duplicate or Trash", async ({ page }) => {
  await installMocks(page, { role: "client" });
  await skipTours(page);
  await page.goto(`/sites/${SITE_ID}/pages`);
  await expect(page.getByTestId("page-row-contact")).toBeVisible();
  expect(await page.getByTestId("add-new-page").count()).toBe(0);
  expect(await page.getByTestId("duplicate-contact").count()).toBe(0);
  expect(await page.getByTestId("trash-contact").count()).toBe(0);
  await expect(page.getByTestId("edit-visually-contact")).toHaveAttribute("href", `/sites/${SITE_ID}/visual?page=contact`);
});

test("on a phone the table becomes stacked cards, nothing is cut off, and the screen never scrolls sideways", async ({ page }) => {
  await installMocks(page, { rows: { publishes } });
  await skipTours(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/sites/${SITE_ID}/pages`);
  await expect(page.getByTestId("pages-cards")).toBeVisible();
  expect(await page.getByRole("table").count()).toBe(0);
  const home = page.getByTestId("page-row-home");
  await expect(home).toBeVisible();
  await expect(home).toContainText("Builder");
  await expect(home).toContainText("by Dana Whitfield");
  await expect(home.getByTestId("edit-visually-home")).toBeVisible();
  await expect(home.getByTestId("page-actions-home")).toHaveCSS("opacity", "1");
  // Every card fits the phone: no element wider than the screen, no sideways scroll.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  expect(await home.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  // The title opens the editor on that page.
  await page.getByTestId("page-title-contact").click();
  await expect(page).toHaveURL(/\/visual\?page=contact$/);
});
