/**
 * Clients: every client across the agency's sites with their sites and last login; add one
 * (a login the agency creates, or an invite link); reset a password; resend and cancel an
 * invite; change which sites they can open; remove them; and "View as client", which shows
 * the site as the client sees it, saves nothing, and comes back on Exit. Clients themselves
 * never reach the screen.
 */
import { expect, test, type Page } from "@playwright/test";
import { CLIENT_ID, SITE_ID, installMocks } from "./mocks.ts";

const SECOND_SITE_ID = "66666666-6666-4666-8666-666666666666";
const extraSites = [{ id: SECOND_SITE_ID, name: "Birch Lane Bakery" }];
const skipTours = (page: Page) => page.addInitScript(() => window.localStorage.setItem("armature:dashboard:tour:v1", "done"));

test("agency staff see every client with their sites, add one, reset a password, resend and cancel an invite, change access and remove", async ({ page }) => {
  const state = await installMocks(page, { extraSites });
  await skipTours(page);
  await page.goto("/agency/clients");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Clients");
  await expect(page.getByTestId("sidebar").getByTestId("nav-agency-clients")).toHaveAttribute("aria-current", "page");
  const sam = page.getByTestId("client-sam@alderstone.example");
  await expect(sam).toContainText("Sam Alder");
  await expect(sam).toContainText("Alder & Stone Custom Homes");
  await expect(sam).toContainText("Active");
  await expect(sam).toContainText("ago");
  await expect(page.getByText("1 client", { exact: true })).toBeVisible();
  // Agency staff are not clients.
  expect(await page.getByTestId("client-dana@agency.example").count()).toBe(0);

  // Add a client with a login, on both sites at once.
  await page.getByTestId("add-client").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Jo Birch");
  await dialog.getByLabel("Email", { exact: true }).fill("Jo@Birchlane.example");
  await dialog.getByLabel("Birch Lane Bakery").check();
  await dialog.getByRole("button", { name: "Generate" }).click();
  await dialog.getByTestId("add-client-submit").click();
  await expect(dialog.getByText("Login created for Jo Birch")).toBeVisible();
  await expect(dialog.getByText("They can also open Birch Lane Bakery.")).toBeVisible();
  await page.keyboard.press("Escape");
  const jo = page.getByTestId("client-jo@birchlane.example");
  await expect(jo).toContainText("Jo Birch");
  await expect(jo).toContainText("Alder & Stone Custom Homes");
  await expect(jo).toContainText("Birch Lane Bakery");
  await expect(page.getByText("2 clients", { exact: true })).toBeVisible();
  expect(state.rows["site_members"]?.filter((row) => row["site_id"] === SECOND_SITE_ID).length).toBe(1);

  // Add a client by invite: one link per site.
  await page.getByTestId("add-client").click();
  await dialog.getByRole("button", { name: "Send an invite" }).click();
  await dialog.getByLabel("Email", { exact: true }).fill("kim@alderstone.example");
  await dialog.getByTestId("add-client-submit").click();
  await expect(dialog.getByLabel("Invite link")).toHaveValue("http://localhost:5173/invite/token-inv-1");
  await page.keyboard.press("Escape");
  const kim = page.getByTestId("client-invite-kim@alderstone.example");
  await expect(kim).toContainText("Not signed up yet");
  await expect(kim).toContainText("Invited, expires");
  await expect(page.getByText("2 clients, 1 invited", { exact: true })).toBeVisible();
  await page.getByTestId("resend-kim@alderstone.example").click();
  await expect(page.getByLabel("Invite link")).toHaveValue("http://localhost:5173/invite/token-inv-2");
  expect(state.rows["invites"]?.length).toBe(2);
  // A resend leaves the earlier link valid too, so cancelling one still leaves one pending.
  await page.getByTestId("cancel-kim@alderstone.example").first().click();
  await expect(page.getByText("Invite cancelled.")).toBeVisible();
  expect(state.rows["invites"]?.length).toBe(1);

  // Reset Sam's password: a link to pass on.
  await page.getByTestId("reset-sam@alderstone.example").click();
  await expect(page.getByRole("dialog")).toContainText("one-time link for Sam Alder");
  await page.getByTestId("reset-confirm").click();
  await expect(page.getByRole("dialog").getByLabel("Reset link")).toHaveValue(new RegExp(`^http://localhost:5173/signin#reset-${CLIENT_ID.slice(-4)}`));
  await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Change Jo's access: drop the first site, keep the bakery.
  await page.getByTestId("access-jo@birchlane.example").click();
  await expect(page.getByRole("dialog")).toContainText("Sites Jo Birch can open");
  await page.getByRole("dialog").getByLabel("Alder & Stone Custom Homes").uncheck();
  await page.getByTestId("access-save").click();
  await expect(page.getByText("Access changed.")).toBeVisible();
  await expect(jo).not.toContainText("Alder & Stone Custom Homes");
  await expect(jo).toContainText("Birch Lane Bakery");
  expect(state.rows["site_members"]?.filter((row) => row["user_id"] !== CLIENT_ID).map((row) => row["site_id"])).toEqual([SECOND_SITE_ID]);

  // Remove Sam: every membership goes, the account stays.
  await page.getByTestId("remove-sam@alderstone.example").click();
  await expect(page.getByRole("dialog")).toContainText("Sam Alder will no longer be able to sign in to Alder & Stone Custom Homes");
  await page.getByTestId("remove-confirm").click();
  await expect(page.getByText("Client removed.")).toBeVisible();
  await expect(page.getByTestId("client-sam@alderstone.example")).toHaveCount(0);
  expect(state.rows["site_members"]?.some((row) => row["user_id"] === CLIENT_ID)).toBe(false);
  await expect(page.getByText("1 client, 1 invited", { exact: true })).toBeVisible();
});

test("View as client shows the site as the client sees it, saves nothing, and Exit returns to Clients", async ({ page }) => {
  await installMocks(page);
  await skipTours(page);
  await page.goto("/agency/clients");
  await page.getByTestId("view-as-sam@alderstone.example").click();
  await expect(page).toHaveURL(new RegExp(`/sites/${SITE_ID}$`));

  // The banner names the client; the shell is the client's: brand, no Back to Fleet, no Site settings, no agency menu.
  const banner = page.getByTestId("view-as-banner");
  await expect(banner).toContainText("Viewing as Sam Alder");
  await expect(banner).toContainText("sam@alderstone.example");
  const sidebar = page.getByTestId("sidebar");
  await expect(sidebar.getByTestId("site-sidebar")).toContainText("Reputation Guardians");
  expect(await sidebar.getByTestId("back-to-fleet").count()).toBe(0);
  expect(await sidebar.getByTestId("nav-settings").count()).toBe(0);
  expect(await sidebar.getByTestId("nav-fleet").count()).toBe(0);
  await expect(sidebar.getByTestId("nav-users")).toBeVisible();

  // The Users screen takes its client branch.
  await sidebar.getByTestId("nav-users").click();
  await expect(page.getByText("adds and removes people")).toBeVisible();
  expect(await page.getByTestId("add-user").count()).toBe(0);

  // The view survives a reload (it lives in this tab), and agency screens stay out of reach while it is on.
  await page.goto("/agency/clients");
  await expect(page).toHaveURL(new RegExp(`/sites/${SITE_ID}$`));
  await expect(page.getByTestId("view-as-banner")).toContainText("Viewing as Sam Alder");
  expect(await page.getByTestId("sidebar").getByTestId("nav-fleet").count()).toBe(0);

  // A write is refused in the browser with a readable reason; nothing reaches the server.
  let writes = 0;
  page.on("request", (request) => {
    if (request.url().includes("mock.supabase.test/rest/v1/change_requests") && request.method() === "POST") writes += 1;
  });
  await page.goto(`/sites/${SITE_ID}/requests/new`);
  await page.locator("#request-title").fill("A new photo on the home page");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText("The request could not be sent")).toBeVisible();
  await expect(page.getByText("You are viewing this as Sam Alder would, so nothing can be saved here.")).toBeVisible();
  expect(writes).toBe(0);

  // Exit: back to Clients with the agency menu, and the banner gone.
  await page.getByTestId("view-as-exit").click();
  await expect(page).toHaveURL(/\/agency\/clients$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Clients");
  await expect(page.getByTestId("view-as-banner")).toHaveCount(0);
  await expect(page.getByTestId("sidebar").getByTestId("nav-fleet")).toBeVisible();
});

test("a client cannot reach the Clients screen", async ({ page }) => {
  await installMocks(page, { role: "client" });
  await skipTours(page);
  await page.goto("/agency/clients");
  await expect(page).toHaveURL(new RegExp(`/sites/${SITE_ID}$`));
  expect(await page.getByRole("heading", { level: 1, name: "Clients" }).count()).toBe(0);
  expect(await page.getByTestId("nav-agency-clients").count()).toBe(0);
  expect(await page.locator("body").evaluate((body) => /\bArmature\b/.test(body.innerText))).toBe(false);
});
