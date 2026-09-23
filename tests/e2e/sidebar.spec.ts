/**
 * The WordPress-style sidebar: agency staff move between the Fleet and a site's own menu
 * (Back to Fleet, the site's name, Site settings at the bottom); clients land on their site's
 * Dashboard and never see the agency menu; the menu collapses to icons on a desktop and
 * slides out on a phone; nothing unbuilt is linked.
 */
import { expect, test, type Page } from "@playwright/test";
import { SITE_ID, installMocks } from "./mocks.ts";

/** The items a connected site shows today, in order. Later parts add Media, Contact and Appearance. */
const STAFF_ITEMS = ["Dashboard", "Media", "Pages", "Contact", "Users", "Site settings"];
const CLIENT_ITEMS = ["Dashboard", "Media", "Pages", "Contact"];
const HIDDEN = ["nav-stats", "nav-posts", "nav-appearance"];

const sidebar = (page: Page) => page.getByTestId("sidebar");
const itemLabels = (page: Page) => sidebar(page).getByTestId("site-sidebar").locator("ul a").evaluateAll((links) => links.map((link) => link.textContent?.trim()));

test.describe("agency staff", () => {
  test("the Fleet is home; a site opens its own menu with Back to Fleet, the site's name and Site settings", async ({ page }) => {
    await installMocks(page);
    await page.goto("/");
    await expect(page).toHaveURL(/\/fleet$/);
    await expect(sidebar(page).getByTestId("nav-fleet")).toHaveAttribute("aria-current", "page");
    expect(await page.getByTestId("site-sidebar").count()).toBe(0);

    await page.getByRole("link", { name: /Alder & Stone Custom Homes/ }).first().click();
    await expect(page).toHaveURL(new RegExp(`/sites/${SITE_ID}$`));
    const site = sidebar(page).getByTestId("site-sidebar");
    await expect(site.getByTestId("back-to-fleet")).toBeVisible();
    await expect(site.getByTestId("site-name")).toContainText("Alder & Stone Custom Homes");
    await expect(site.getByTestId("nav-dashboard")).toHaveAttribute("aria-current", "page");
    expect(await itemLabels(page)).toEqual(STAFF_ITEMS);
    for (const id of HIDDEN) expect(await page.getByTestId(id).count(), id).toBe(0);
    // No agency items inside a site, and no tab strip above the screen any more.
    expect(await sidebar(page).getByTestId("nav-fleet").count()).toBe(0);
    expect(await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Overview" }).count()).toBe(0);
    await expect(page.getByTestId("sidebar-tour")).toContainText("Site settings");

    await site.getByTestId("nav-settings").click();
    await expect(page).toHaveURL(new RegExp(`/sites/${SITE_ID}/settings$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Site settings");
    await expect(page.getByText("acme/alder-stone")).toBeVisible();
    await expect(page.getByTestId("check-connection")).toBeVisible();
    await page.getByTestId("settings-tab-services").click();
    await expect(page).toHaveURL(/\/settings\/services$/);
    await expect(page.getByText("Hosting & services").first()).toBeVisible();
    await page.getByTestId("settings-tab-editing").click();
    await expect(page.getByText("What clients may do", { exact: false }).first()).toBeVisible();
    await page.getByTestId("settings-tab-history").click();
    await expect(page).toHaveURL(/\/settings\/history$/);
    await expect(site.getByTestId("nav-settings")).toHaveAttribute("aria-current", "page");

    await site.getByTestId("back-to-fleet").click();
    await expect(page).toHaveURL(/\/fleet$/);
  });

  test("the old /team address lands on Users, and an unknown site address keeps the site's menu", async ({ page }) => {
    await installMocks(page);
    await page.goto(`/sites/${SITE_ID}/team`);
    await expect(page).toHaveURL(new RegExp(`/sites/${SITE_ID}/users$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Users");
    await expect(sidebar(page).getByTestId("nav-users")).toHaveAttribute("aria-current", "page");
    await page.goto(`/sites/${SITE_ID}/nothing-here`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
    await expect(sidebar(page).getByTestId("site-sidebar")).toBeVisible();
  });

  test("the menu collapses to icons and remembers it", async ({ page }) => {
    await installMocks(page);
    await page.goto(`/sites/${SITE_ID}/pages`);
    const nav = sidebar(page);
    await expect(nav).toHaveAttribute("data-collapsed", "no");
    const wide = (await nav.boundingBox())?.width ?? 0;
    await nav.getByTestId("sidebar-collapse").click();
    await expect(nav).toHaveAttribute("data-collapsed", "yes");
    // The width animates, so wait for it to settle.
    await expect.poll(async () => (await nav.boundingBox())?.width ?? 0).toBeLessThan(wide / 3);
    // Icons only, but every item keeps its name for a screen reader and as a tooltip.
    await expect(nav.getByTestId("nav-pages")).toHaveAttribute("title", "Pages");
    await expect(nav.getByTestId("nav-pages")).toHaveAccessibleName("Pages");
    await page.reload();
    await expect(sidebar(page)).toHaveAttribute("data-collapsed", "yes");
    await sidebar(page).getByTestId("sidebar-collapse").click();
    await expect(sidebar(page)).toHaveAttribute("data-collapsed", "no");
  });
});

test.describe("clients", () => {
  test("land on their site's Dashboard with the site menu, and never see the Fleet or the agency menu", async ({ page }) => {
    await installMocks(page, { role: "client" });
    await page.goto("/");
    await expect(page).toHaveURL(new RegExp(`/sites/${SITE_ID}$`));
    const site = sidebar(page).getByTestId("site-sidebar");
    await expect(site).toBeVisible();
    expect(await site.getByTestId("back-to-fleet").count()).toBe(0);
    expect(await sidebar(page).getByTestId("nav-fleet").count()).toBe(0);
    expect(await site.getByTestId("nav-settings").count()).toBe(0);
    expect(await site.getByTestId("nav-users").count()).toBe(0);
    expect(await itemLabels(page)).toEqual(CLIENT_ITEMS);
    await expect(site).toContainText("Reputation Guardians");
    await expect(site).not.toContainText("Armature");
    await expect(page.getByTestId("sidebar-tour")).toContainText("Request a change");
    await expect(page.getByTestId("sidebar-tour")).not.toContainText("Fleet");
    await page.getByTestId("sidebar-tour").getByRole("button", { name: "Got it" }).click();
    await expect(page.getByTestId("sidebar-tour")).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("sidebar-tour")).toHaveCount(0);

    await page.goto("/fleet");
    await expect(page).toHaveURL(new RegExp(`/sites/${SITE_ID}$`));
    // Agency-only screens explain themselves and point back, instead of a bare warning.
    await page.goto(`/sites/${SITE_ID}/settings`);
    await expect(page.getByRole("link", { name: "Back to your dashboard" })).toBeVisible();
    await page.goto(`/sites/${SITE_ID}/users`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Users");
    await expect(page.getByRole("link", { name: "Back to your dashboard" })).toBeVisible();
  });

  test("on a phone the menu slides out and closes when a page is chosen", async ({ page }) => {
    await installMocks(page, { role: "client" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/sites/${SITE_ID}`);
    await expect(sidebar(page)).toBeHidden();
    await page.getByRole("button", { name: "Open menu" }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByTestId("site-sidebar")).toBeVisible();
    await drawer.getByTestId("nav-pages").click();
    await expect(page).toHaveURL(new RegExp(`/sites/${SITE_ID}/pages$`));
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pages");
  });
});
