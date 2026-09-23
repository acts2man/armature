/**
 * Users: the table with role, last login and status; Add User sends an invite whose link is
 * shown; resend and cancel an invite; change a role; remove a person; clients read only.
 */
import { expect, test } from "@playwright/test";
import { SITE_ID, installMocks } from "./mocks.ts";

const skipTours = (page: import("@playwright/test").Page) => page.addInitScript(() => window.localStorage.setItem("armature:dashboard:tour:v1", "done"));

test("agency staff see the table, invite someone, resend and cancel, change a role and remove a person", async ({ page }) => {
  const state = await installMocks(page);
  await skipTours(page);
  await page.goto(`/sites/${SITE_ID}/users`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Users");
  const sam = page.getByTestId("user-sam@alderstone.example");
  await expect(sam).toContainText("Sam Alder");
  await expect(sam).toContainText("Client owner");
  await expect(sam).toContainText("Active");
  await expect(sam).toContainText("ago");
  const dana = page.getByTestId("user-dana@agency.example");
  await expect(dana).toContainText("Agency owner");
  await expect(page.getByText("2 people")).toBeVisible();

  await page.getByTestId("add-user").click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#invite-email").fill("Jo@Alderstone.example");
  await dialog.locator("#invite-role").selectOption("client_editor");
  await dialog.getByRole("button", { name: "Create invite" }).click();
  await expect(dialog.getByLabel("Invite link")).toHaveValue("http://localhost:5173/invite/token-inv-1");
  await page.keyboard.press("Escape");
  const jo = page.getByTestId("user-jo@alderstone.example");
  await expect(jo).toContainText("Not signed up yet");
  await expect(jo).toContainText("Client editor");
  await expect(jo).toContainText("Invited, expires");
  await expect(page.getByText("2 people, 1 invited")).toBeVisible();

  await page.getByTestId("resend-jo@alderstone.example").click();
  await expect(page.getByLabel("Invite link")).toHaveValue("http://localhost:5173/invite/token-inv-2");
  expect(state.rows["invites"]?.length).toBe(2);
  await page.getByTestId("cancel-jo@alderstone.example").first().click();
  await expect(page.getByText("Invite cancelled.")).toBeVisible();

  await page.getByTestId("role-sam@alderstone.example").selectOption("client_editor");
  await expect(page.getByText("Role changed.")).toBeVisible();
  expect(state.rows["site_members"]?.[0]?.["role"]).toBe("client_editor");
  await expect(sam).toContainText("Client editor");

  await page.getByTestId("remove-sam@alderstone.example").click();
  await expect(page.getByRole("dialog")).toContainText("Sam Alder will no longer be able to sign in");
  await page.getByTestId("remove-confirm").click();
  await expect(page.getByText("Access removed.")).toBeVisible();
  await expect(page.getByTestId("user-sam@alderstone.example")).toHaveCount(0);
  expect(state.rows["site_members"]).toEqual([]);
});

test("a client sees who has access, read only", async ({ page }) => {
  await installMocks(page, { role: "client" });
  await skipTours(page);
  await page.goto(`/sites/${SITE_ID}/users`);
  await expect(page.getByTestId("user-sam@alderstone.example")).toContainText("Client owner");
  await expect(page.getByText("adds and removes people")).toBeVisible();
  expect(await page.getByTestId("add-user").count()).toBe(0);
  expect(await page.getByTestId("remove-sam@alderstone.example").count()).toBe(0);
  expect(await page.getByTestId("role-sam@alderstone.example").count()).toBe(0);
  expect(await page.locator("body").evaluate((body) => /\bArmature\b/.test(body.innerText))).toBe(false);
});
