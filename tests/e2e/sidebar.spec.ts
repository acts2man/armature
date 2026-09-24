/**
 * The WordPress-style sidebar: agency staff move between Projects and a site's own menu
 * (Back to Projects, the site's name, Site settings at the bottom); clients land on their site's
 * Dashboard and never see the agency menu; the menu collapses to icons on a desktop and
 * slides out on a phone; nothing unbuilt is linked.
 */
import { expect, test, type Page } from "@playwright/test";
import { SITE_ID, installMocks } from "./mocks.ts";

/**
 * The items a connected site shows today, in order. Posts sits between Dashboard
 * and Media (WordPress order); Requests (change requests to the agency) sits
 * between Contact and Appearance. Stats was removed on request in kit 2.9.0.
 */
const STAFF_ITEMS = ["Dashboard", "Posts", "Media", "Pages", "Contact", "Requests", "Appearance", "Users", "Site settings"];
const CLIENT_ITEMS = ["Dashboard", "Posts", "Media", "Pages", "Contact", "Requests", "Appearance", "Users"];
const HIDDEN: string[] = ["nav-stats"];

const sidebar = (page: Page) => page.getByTestId("sidebar");
const itemLabels = (page: Page) => sidebar(page).getByTestId("site-sidebar").locator("ul a").evaluateAll((links) => links.map((link) => link.textContent?.trim()));

test.describe("agency staff", () => {
  test("Projects is home; a site opens its own menu with Back to Projects, the site's name and Site settings", async ({ page }) => {
    await installMocks(page);
    await page.goto("/");
    await expect(page).toHaveURL(/\/projects$/);
    await expect(sidebar(page).getByTestId("nav-projects")).toHaveAttribute("aria-current", "page");
    expect(await page.getByTestId("site-sidebar").count()).toBe(0);

    await page.getByRole("link", { name: /Alder & Stone Custom Homes/ }).first().click();
    await expect(page).toHaveURL(new RegExp(`/sites/${SITE_ID}$`));
    const site = sidebar(page).getByTestId("site-sidebar");
    await expect(site.getByTestId("back-to-projects")).toBeVisible();
    await expect(site.getByTestId("site-name")).toContainText("Alder & Stone Custom Homes");
    await expect(site.getByTestId("nav-dashboard")).toHaveAttribute("aria-current", "page");
    expect(await itemLabels(page)).toEqual(STAFF_ITEMS);
    for (const id of HIDDEN) expect(await page.getByTestId(id).count(), id).toBe(0);
    // No agency items inside a site, and no tab strip above the screen any more.
    expect(await sidebar(page).getByTestId("nav-projects").count()).toBe(0);
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

    await site.getByTestId("back-to-projects").click();
    await expect(page).toHaveURL(/\/projects$/);
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

  test("the old /fleet address lands on Projects", async ({ page }) => {
    await installMocks(page);
    await page.goto("/fleet");
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Projects");
    // Pages is the one way into the editor: no accent button in the menu.
    await page.goto(`/sites/${SITE_ID}`);
    await expect(sidebar(page).getByTestId("nav-pages")).toBeVisible();
    expect(await page.getByTestId("sidebar-edit-visually").count()).toBe(0);
    expect(await page.getByRole("link", { name: "Edit site visually" }).count()).toBe(0);
  });

  test("the site switcher is a real menu: search when there are many sites, keyboard, Escape, outside click, and it keeps the section", async ({ page }) => {
    const names = ["Birch Dental", "Cedar Cabinets", "Dune Yoga", "Elm Street Bakery", "Fern Florists", "Granite Roofing", "Harbour Law"];
    await installMocks(page, { moreSites: names.map((name, index) => ({ id: `aaaaaaaa-0000-4000-8000-00000000000${index + 1}`, name })) });
    await page.goto(`/sites/${SITE_ID}/pages`);
    const site = sidebar(page).getByTestId("site-sidebar");
    const button = site.getByTestId("site-switcher");
    await expect(button).toContainText("Alder & Stone Custom Homes");
    await expect(button).toHaveAttribute("aria-haspopup", "listbox");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    // Not a native select any more.
    expect(await site.locator("select").count()).toBe(0);

    await button.click();
    const menu = site.getByTestId("site-menu");
    await expect(menu).toBeVisible();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    const options = menu.getByRole("option");
    await expect(options).toHaveCount(8);
    await expect(menu.getByRole("option", { name: "Alder & Stone Custom Homes" })).toHaveAttribute("aria-selected", "true");
    // Eight sites: a search box, focused on opening.
    const search = site.getByTestId("site-search");
    await expect(search).toBeFocused();
    await search.fill("cedar");
    await expect(options).toHaveCount(1);
    await expect(options.first()).toHaveText(/Cedar Cabinets/);
    // Enter picks the highlighted site and lands on the same section (Pages).
    await search.press("Enter");
    await expect(page).toHaveURL(/\/sites\/aaaaaaaa-0000-4000-8000-000000000002\/pages$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pages");
    await expect(site.getByTestId("site-switcher")).toContainText("Cedar Cabinets");
    await expect(menu).toHaveCount(0);

    // Arrow keys move, Escape closes and returns focus to the button.
    await site.getByTestId("site-switcher").focus();
    await page.keyboard.press("ArrowDown");
    await expect(site.getByTestId("site-menu")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await expect(site.getByTestId("site-menu")).toHaveCount(0);
    await expect(site.getByTestId("site-switcher")).toBeFocused();
    await expect(page).toHaveURL(/\/pages$/);

    // A click outside closes it without choosing anything.
    await site.getByTestId("site-switcher").click();
    await expect(site.getByTestId("site-menu")).toBeVisible();
    await page.getByRole("heading", { level: 1 }).click();
    await expect(site.getByTestId("site-menu")).toHaveCount(0);

    // A section the other site does not have (Pages on a hosting-only site) lands on its Dashboard.
    await installMocks(page, { moreSites: [{ id: "aaaaaaaa-0000-4000-8000-0000000000aa", name: "Hosted Only", status: "hosting_only" }] });
    await page.goto(`/sites/${SITE_ID}/pages`);
    await site.getByTestId("site-switcher").click();
    // Two sites: no search box; the list itself takes the keys.
    expect(await site.getByTestId("site-search").count()).toBe(0);
    await site.getByTestId("site-option-aaaaaaaa-0000-4000-8000-0000000000aa").click();
    await expect(page).toHaveURL(/\/sites\/aaaaaaaa-0000-4000-8000-0000000000aa$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hosted Only");
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
  test("land on their site's Dashboard with the site menu, and never see Projects or the agency menu", async ({ page }) => {
    await installMocks(page, { role: "client" });
    await page.goto("/");
    await expect(page).toHaveURL(new RegExp(`/sites/${SITE_ID}$`));
    const site = sidebar(page).getByTestId("site-sidebar");
    await expect(site).toBeVisible();
    expect(await site.getByTestId("back-to-projects").count()).toBe(0);
    expect(await sidebar(page).getByTestId("nav-projects").count()).toBe(0);
    expect(await site.getByTestId("nav-settings").count()).toBe(0);
    expect(await itemLabels(page)).toEqual(CLIENT_ITEMS);
    await expect(site).toContainText("Reputation Guardians");
    await expect(site).not.toContainText("Armature");
    await expect(page.getByTestId("sidebar-tour")).toContainText("Request a change");
    await expect(page.getByTestId("sidebar-tour")).not.toContainText("Projects");
    await page.getByTestId("sidebar-tour").getByRole("button", { name: "Got it" }).click();
    await expect(page.getByTestId("sidebar-tour")).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("sidebar-tour")).toHaveCount(0);

    await page.goto("/projects");
    await expect(page).toHaveURL(new RegExp(`/sites/${SITE_ID}$`));
    // Agency-only screens explain themselves and point back, instead of a bare warning.
    await page.goto(`/sites/${SITE_ID}/settings`);
    await expect(page.getByRole("link", { name: "Back to your dashboard" })).toBeVisible();
    await page.goto(`/sites/${SITE_ID}/users`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Users");
    await expect(page.getByText("adds and removes people")).toBeVisible();
  });

  test("a client with two sites switches between them with the keyboard and keeps the section", async ({ page }) => {
    await installMocks(page, { role: "client", moreSites: [{ id: "aaaaaaaa-0000-4000-8000-0000000000bb", name: "Sam's Second Site" }] });
    await page.goto(`/sites/${SITE_ID}/contact`);
    const site = sidebar(page).getByTestId("site-sidebar");
    await site.getByTestId("site-switcher").focus();
    await page.keyboard.press("Enter");
    const list = site.getByRole("listbox", { name: "Sites" });
    await expect(list).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/sites\/aaaaaaaa-0000-4000-8000-0000000000bb\/contact$/);
    await expect(site.getByTestId("site-switcher")).toContainText("Sam's Second Site");
    await expect(site).not.toContainText("Armature");
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
