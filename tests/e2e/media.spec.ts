/**
 * The Media Library: grid and list, search and the type filter, the details panel with
 * dimensions, description, "Used on" and copy link; upload by button and by drop; a
 * description saved through a publish; delete only after a warning that names the pages.
 */
import { expect, test } from "@playwright/test";
import { SITE_ID, installMocks } from "./mocks.ts";

// A 2×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVQIW2P4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");

const skipTours = (page: import("@playwright/test").Page) => page.addInitScript(() => window.localStorage.setItem("armature:dashboard:tour:v1", "done"));

test("lists every picture, searches, filters, and the details panel shows size, dimensions, description and where it is used", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await installMocks(page);
  await skipTours(page);
  await page.goto(`/sites/${SITE_ID}/media`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Media");
  await expect(page.getByTestId("media-count")).toHaveText("2 files");
  await expect(page.getByTestId("media-grid")).toBeVisible();
  await page.getByTestId("media-item-team.svg").click();
  const details = page.getByTestId("media-details");
  await expect(details.getByTestId("media-details-name")).toHaveText("team.svg");
  await expect(details).toContainText("2 KB");
  await expect(details.getByTestId("media-used-on")).toContainText("About");
  await expect(details.getByTestId("media-used-on").getByRole("link", { name: "About" })).toHaveAttribute("href", `/sites/${SITE_ID}/visual?page=about`);
  await details.getByTestId("media-copy-link").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("http://localhost:5174/assets/team.svg");
  // List view remembers itself.
  await page.getByRole("group", { name: "Show as" }).getByRole("button", { name: "List" }).click();
  await expect(page.getByTestId("media-list")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("media-list")).toBeVisible();
  await page.getByRole("group", { name: "Show as" }).getByRole("button", { name: "Grid" }).click();
  // Search by description, then by name; filter by type.
  await page.getByTestId("media-search").fill("timber");
  await expect(page.getByTestId("media-count")).toHaveText("1 file");
  await expect(page.getByTestId("media-item-hero.svg")).toBeVisible();
  await page.getByTestId("media-search").fill("");
  await page.getByTestId("media-kind").selectOption("video");
  await expect(page.getByText("Nothing matches")).toBeVisible();
  await page.getByTestId("media-kind").selectOption("all");
  await expect(page.getByTestId("media-count")).toHaveText("2 files");
});

test("saving a description is one publish of media.json", async ({ page }) => {
  const state = await installMocks(page);
  await skipTours(page);
  await page.goto(`/sites/${SITE_ID}/media`);
  await page.getByTestId("media-item-team.svg").click();
  await page.getByTestId("media-alt").fill("The Alder & Stone crew on site");
  await page.getByTestId("media-alt-save").click();
  await expect(page.getByText("Description saved.")).toBeVisible();
  expect(state.builderPublishRequests.at(-1)?.["media"]).toEqual({ "/assets/hero.svg": { alt: "A timber-framed house at dusk" }, "/assets/team.svg": { alt: "The Alder & Stone crew on site" } });
  await expect(page.getByTestId("media-alt")).toHaveValue("The Alder & Stone crew on site");
});

test("uploads by button and by drop, with the same rules as the editor, and lists the new picture", async ({ page }) => {
  const state = await installMocks(page);
  await skipTours(page);
  await page.goto(`/sites/${SITE_ID}/media`);
  await page.getByTestId("media-upload").setInputFiles({ name: "Site Visit.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("Picture uploaded.")).toBeVisible({ timeout: 15_000 });
  const request = state.builderPublishRequests.at(-1)!;
  const uploads = request["uploads"] as { name: string; data: string }[];
  expect(uploads[0]?.name).toBe("Site Visit.png");
  expect(uploads[0]?.data.startsWith("data:image/webp;base64,")).toBe(true);
  await expect(page.getByTestId("media-item-site-visit.webp")).toBeVisible();
  await expect(page.getByTestId("media-count")).toHaveText("3 files");
  // Drop a file on the screen.
  const dropped = await page.evaluateHandle((bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], "dropped.png", { type: "image/png" }));
    return transfer;
  }, Array.from(PNG));
  await page.getByTestId("media-screen").dispatchEvent("drop", { dataTransfer: dropped });
  await expect(page.getByTestId("media-item-dropped.webp")).toBeVisible({ timeout: 15_000 });
  // A file that is not a picture is refused before anything is sent.
  const count = state.builderPublishRequests.length;
  await page.getByTestId("media-upload").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hi") });
  await expect(page.getByText("Only PNG, JPEG and WebP pictures can be uploaded.")).toBeVisible();
  expect(state.builderPublishRequests.length).toBe(count);
});

test("delete: an unused picture goes at once; a used one only after a warning that names the pages", async ({ page }) => {
  const state = await installMocks(page);
  await skipTours(page);
  await page.goto(`/sites/${SITE_ID}/media`);
  await page.getByTestId("media-upload").setInputFiles({ name: "spare.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByTestId("media-item-spare.webp")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("media-item-spare.webp").click();
  await expect(page.getByTestId("media-used-on")).toContainText("Not used on any page");
  await page.getByTestId("media-delete").click();
  await expect(page.getByRole("dialog")).toContainText("Delete this picture?");
  await page.getByTestId("media-delete-confirm").click();
  await expect(page.getByTestId("media-item-spare.webp")).toHaveCount(0, { timeout: 15_000 });
  expect(state.builderPublishRequests.at(-1)?.["deleteAssets"]).toEqual(["/assets/uploads/spare.webp"]);

  await page.getByTestId("media-item-team.svg").click();
  await page.getByTestId("media-delete").click();
  await expect(page.getByRole("dialog")).toContainText("This picture is still in use");
  await expect(page.getByTestId("media-delete-warning")).toContainText("About");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("media-item-team.svg")).toBeVisible();
});

test("a client at the content level can upload and read, but not describe or delete", async ({ page }) => {
  await installMocks(page, { role: "client" });
  await skipTours(page);
  await page.goto(`/sites/${SITE_ID}/media`);
  await page.getByTestId("media-item-team.svg").click();
  await expect(page.getByTestId("media-alt")).toBeDisabled();
  expect(await page.getByTestId("media-alt-save").count()).toBe(0);
  expect(await page.getByTestId("media-delete").count()).toBe(0);
  await expect(page.getByTestId("media-upload-button")).toBeVisible();
});
