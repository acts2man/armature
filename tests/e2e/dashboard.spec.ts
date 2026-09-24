/**
 * The site Dashboard, WordPress-style: a welcome line, "Edit your site" shortcuts, the newest
 * messages with an unread count, recent publishes and open change requests, for a client and
 * for agency staff.
 */
import { expect, test } from "@playwright/test";
import { COMMIT_SHA, SITE_ID, installMocks, sampleSubmissions } from "./mocks.ts";

const rows = () => ({
  form_submissions: sampleSubmissions(),
  publishes: [
    { id: "p1", site_id: SITE_ID, user_id: null, page_slug: "home", fields_changed: ["hero.headline"], commit_sha: COMMIT_SHA, commit_url: `https://github.com/acme/alder-stone/commit/${COMMIT_SHA}`, status: "committed", error: null, created_at: "2026-09-20T15:00:00Z" },
    { id: "p2", site_id: SITE_ID, user_id: null, page_slug: "about", fields_changed: [], commit_sha: null, commit_url: null, status: "failed", error: "GitHub answered with HTTP 502.", created_at: "2026-09-19T09:00:00Z" },
  ],
});

test("a client sees a greeting, shortcuts, two unread messages, publishes and no open requests", async ({ page }) => {
  await installMocks(page, { role: "client", rows: rows() });
  await page.addInitScript(() => window.localStorage.setItem("armature:dashboard:tour:v1", "done"));
  await page.goto(`/sites/${SITE_ID}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Sam");
  await expect(page.getByText("Here is how Alder & Stone Custom Homes is doing.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit your site" })).toHaveAttribute("href", `/sites/${SITE_ID}/visual`);
  const shortcuts = page.getByTestId("shortcuts");
  await expect(shortcuts.getByTestId("shortcut-edit")).toHaveAttribute("href", `/sites/${SITE_ID}/visual`);
  await expect(shortcuts.getByTestId("shortcut-pages")).toHaveAttribute("href", `/sites/${SITE_ID}/pages`);
  // Request a change lives on the dashboard (and under Requests in the menu), not in the editor.
  const requestCard = page.getByTestId("request-card");
  await expect(requestCard).toContainText("go to Reputation Guardians as a request");
  await expect(requestCard.getByTestId("request-new")).toHaveAttribute("href", `/sites/${SITE_ID}/requests/new`);
  await expect(page.getByRole("link", { name: "All requests" })).toHaveAttribute("href", `/sites/${SITE_ID}/requests`);
  await expect(page.getByTestId("sidebar").getByTestId("nav-requests")).toHaveAttribute("href", `/sites/${SITE_ID}/requests`);
  // Messages: the newest three, unread first by dot, with the sender and a preview.
  await expect(page.getByText("2 unread", { exact: true })).toBeVisible();
  const messages = page.getByTestId("dashboard-messages");
  await expect(messages.getByTestId("message-aaaa0001-0000-4000-8000-000000000001")).toContainText("Priya Natarajan");
  await expect(messages.getByTestId("message-aaaa0001-0000-4000-8000-000000000001")).toContainText("two-storey extension");
  await expect(messages.getByTestId("message-aaaa0001-0000-4000-8000-000000000001")).toContainText("(unread)");
  await expect(messages.getByTestId("message-aaaa0001-0000-4000-8000-000000000002")).toContainText("Tom Okafor");
  await expect(messages.getByTestId("message-aaaa0001-0000-4000-8000-000000000003")).not.toContainText("(unread)");
  await expect(page.getByText("2 unread messages")).toBeVisible();
  // Publishes and the failed one in "Needs your attention".
  await expect(page.getByText("Your last publish hit a conflict").or(page.getByText("Your last publish did not go through"))).toHaveCount(0);
  await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Failed", { exact: true })).toBeVisible();
  await expect(page.getByTestId("dashboard-requests")).toContainText("No open requests");
  await expect(page.getByRole("link", { name: "All history" })).toHaveAttribute("href", `/sites/${SITE_ID}/history`);
  // Nothing agency-only, and never the product's name.
  expect(await page.getByText("Site settings").count()).toBe(0);
  expect(await page.locator("body").evaluate((body) => /\bArmature\b/.test(body.innerText))).toBe(false);
});

test("agency staff see the site's name, the same messages, and links into Site settings", async ({ page }) => {
  await installMocks(page, { rows: rows() });
  await page.addInitScript(() => window.localStorage.setItem("armature:dashboard:tour:v1", "done"));
  await page.goto(`/sites/${SITE_ID}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Alder & Stone Custom Homes");
  await expect(page.getByText("2 unread", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "All history" })).toHaveAttribute("href", `/sites/${SITE_ID}/settings/history`);
  await expect(page.getByRole("main").getByRole("link", { name: "Site settings" })).toHaveAttribute("href", `/sites/${SITE_ID}/settings`);
});

test("with nothing yet, every panel says so", async ({ page }) => {
  await installMocks(page, { role: "client" });
  await page.goto(`/sites/${SITE_ID}`);
  await expect(page.getByText("No messages yet")).toBeVisible();
  await expect(page.getByText("Nothing published yet").first()).toBeVisible();
  await expect(page.getByText("No open requests")).toBeVisible();
  await expect(page.getByText("No unread messages")).toBeVisible();
  await expect(page.getByTestId("sidebar-tour")).toBeVisible();
});
