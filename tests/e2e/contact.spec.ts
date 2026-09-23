/**
 * The Contact inbox: unread dots, opening an entry marks it read and shows every field,
 * mark unread, the Reply link, the filter by form, Export CSV, delete for staff only, and
 * the Settings tab where agency staff set the email recipients.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { SITE_ID, installMocks, sampleSubmissions } from "./mocks.ts";

const skipTours = (page: import("@playwright/test").Page) => page.addInitScript(() => window.localStorage.setItem("armature:dashboard:tour:v1", "done"));
const PRIYA = "aaaa0001-0000-4000-8000-000000000001";
const TOM = "aaaa0001-0000-4000-8000-000000000002";
const LENA = "aaaa0001-0000-4000-8000-000000000003";

test("the inbox lists entries with unread dots; opening one marks it read and shows every field; mark unread; reply", async ({ page }) => {
  await installMocks(page, { role: "client", rows: { form_submissions: sampleSubmissions() } });
  await skipTours(page);
  await page.goto(`/sites/${SITE_ID}/contact`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Contact");
  await expect(page.getByTestId("inbox-count")).toHaveText("3 messages");
  await expect(page.getByTestId(`entry-${PRIYA}`)).toHaveAttribute("data-unread", "yes");
  await expect(page.getByTestId(`entry-${LENA}`)).toHaveAttribute("data-unread", "no");
  // The sidebar's badge counts the unread ones.
  await expect(page.getByTestId("sidebar").getByTestId("nav-contact")).toContainText("2");

  await page.getByTestId(`entry-${PRIYA}`).click();
  await expect(page).toHaveURL(new RegExp(`entry=${PRIYA}`));
  const detail = page.getByTestId("entry-detail");
  await expect(detail.getByTestId("entry-sender")).toHaveText("Priya Natarajan");
  await expect(detail.getByTestId("entry-fields")).toContainText("phone");
  await expect(detail.getByTestId("entry-fields")).toContainText("0161 555 0199");
  await expect(detail.getByTestId("entry-fields")).toContainText("two-storey extension in Didsbury");
  await expect(detail).toContainText("Contact form");
  await expect(detail.getByRole("link", { name: "Reply" })).toHaveAttribute("href", /^mailto:priya%40example\.com\?subject=Re%3A%20your%20message%20to%20Alder/);
  await expect(page.getByTestId(`entry-${PRIYA}`)).toHaveAttribute("data-unread", "no");
  await expect(page.getByTestId("sidebar").getByTestId("nav-contact")).toContainText("1");
  await page.getByTestId("entry-toggle-read").click();
  await expect(page.getByTestId(`entry-${PRIYA}`)).toHaveAttribute("data-unread", "yes");
  // Clients cannot delete.
  expect(await page.getByTestId("entry-delete").count()).toBe(0);
  expect(await page.getByTestId("contact-tab-settings").count()).toBe(0);
});

test("filter by form, unread only, mark all as read, and export the shown entries as CSV", async ({ page }) => {
  await installMocks(page, { rows: { form_submissions: sampleSubmissions() } });
  await skipTours(page);
  await page.goto(`/sites/${SITE_ID}/contact`);
  await page.getByTestId("inbox-form-filter").selectOption("Home page form");
  await expect(page.getByTestId("inbox-count")).toHaveText("1 message");
  await expect(page.getByTestId(`entry-${TOM}`)).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("inbox-export").click()]);
  expect(download.suggestedFilename()).toMatch(/^alder-stone-custom-homes-messages-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = readFileSync(await download.path(), "utf8");
  expect(csv).toContain("Received,Form,Page,Read,Your name,E-mail,How can we help");
  expect(csv).toContain("Tom Okafor,tom.okafor@example.com,Do you build in Placer County?");
  expect(csv).not.toContain("Priya");
  await page.getByTestId("inbox-form-filter").selectOption("all");
  await page.getByRole("group", { name: "Show" }).getByRole("button", { name: /Unread/ }).click();
  await expect(page.getByTestId("inbox-count")).toHaveText("2 messages");
  await page.getByTestId("inbox-mark-all-read").click();
  await expect(page.getByText("Nothing unread")).toBeVisible();
  expect(await page.getByTestId("inbox-mark-all-read").count()).toBe(0);
});

test("agency staff delete an entry, and set the email recipients under Settings", async ({ page }) => {
  const state = await installMocks(page, { rows: { form_submissions: sampleSubmissions() } });
  await skipTours(page);
  await page.goto(`/sites/${SITE_ID}/contact?entry=${LENA}`);
  await expect(page.getByTestId("entry-detail").getByTestId("entry-sender")).toHaveText("Lena Fischer");
  await page.getByTestId("entry-delete").click();
  await page.getByTestId("entry-delete-confirm").click();
  await expect(page.getByTestId(`entry-${LENA}`)).toHaveCount(0);
  await expect(page.getByTestId("inbox-count")).toHaveText("2 messages");
  expect(state.rows["form_submissions"]?.some((row) => row["id"] === LENA)).toBe(false);

  await page.getByTestId("contact-tab-settings").click();
  await expect(page.getByTestId("recipients-settings")).toBeVisible();
  await page.getByTestId("recipient-input").fill("not-an-email");
  await page.getByTestId("recipient-add").click();
  await expect(page.getByText("That does not look like an email address.")).toBeVisible();
  await page.getByTestId("recipient-input").fill("Hello@Agency.example");
  await page.getByTestId("recipient-add").click();
  await page.getByTestId("recipient-input").fill("owner@alderstone.example");
  await page.getByTestId("recipient-add").click();
  await expect(page.getByTestId("recipients-list")).toContainText("hello@agency.example");
  await page.getByTestId("recipients-save").click();
  await expect(page.getByText("Recipients saved.")).toBeVisible();
  expect(state.rows["site_services"]?.[0]?.["form_recipients"]).toEqual(["hello@agency.example", "owner@alderstone.example"]);
  await page.reload();
  await expect(page.getByTestId("recipients-list")).toContainText("owner@alderstone.example");
  await page.getByTestId("remove-owner@alderstone.example").click();
  await page.getByTestId("recipients-save").click();
  await expect(page.getByText("Recipients saved.")).toBeVisible();
  expect(state.rows["site_services"]?.[0]?.["form_recipients"]).toEqual(["hello@agency.example"]);
});

test("with no entries the inbox says so, on a phone the entry opens in a drawer", async ({ page }) => {
  await installMocks(page, { role: "client", rows: { form_submissions: sampleSubmissions() } });
  await skipTours(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/sites/${SITE_ID}/contact`);
  await page.getByTestId(`entry-${TOM}`).click();
  await expect(page.getByRole("dialog", { name: "Message" }).getByTestId("entry-sender")).toHaveText("Tom Okafor");
  await page.getByRole("button", { name: "Close message" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await installMocks(page, { role: "client" });
  await page.goto(`/sites/${SITE_ID}/contact`);
  await expect(page.getByText("No messages yet")).toBeVisible();
});
