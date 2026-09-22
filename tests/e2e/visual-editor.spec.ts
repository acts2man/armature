import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { DEMO_SITE_URL, PLAIN_SITE_URL, SITE_ID, demoContent, editorUrl, installMocks, servePlainSite } from "./mocks.ts";

const ZERO_WIDTH = new RegExp(`[${[0x200b, 0x200c, 0x200d, 0xfeff].map((point) => `\\u{${point.toString(16)}}`).join("")}]`, "u");

const siteFrame = (page: Page): FrameLocator => page.frameLocator(`iframe[title$="live site"]`);

async function openEditor(page: Page, options: Parameters<typeof installMocks>[1] = {}) {
  const state = await installMocks(page, options);
  await page.addInitScript(() => window.localStorage.setItem("armature:visual:tour:v1", "done"));
  await page.goto(editorUrl());
  await expect(page.getByTestId("visual-editor")).toBeVisible();
  return state;
}

async function waitForReady(page: Page) {
  await expect(siteFrame(page).locator("h1")).toBeVisible({ timeout: 20_000 });
  // The frame fades in only once the bridge has answered.
  await expect(page.locator(`iframe[title$="live site"]`)).toHaveCSS("opacity", "1", { timeout: 15_000 });
}

test.describe("visual editor", () => {
  test("handshake: loads the site, connects the editor and maps the fields", async ({ page }) => {
    await openEditor(page);
    await waitForReady(page);
    await expect(page.getByTestId("draft-status")).toContainText("Nothing to publish");
    await expect(page.getByTestId("layer-home.hero.title")).toBeVisible();
    await expect(page.getByTestId("layer-home.hero.title")).not.toContainText("off page");
    await expect(page.getByTestId("layer-home.seo.title")).toContainText("off page");
    // Markers never reach the visible text.
    const h1 = await siteFrame(page).locator("h1").textContent();
    expect(h1).toBe(demoContent.home!.hero!.title);
    expect(ZERO_WIDTH.test(h1 ?? "")).toBe(false);
    expect(page.url()).toContain(`/sites/${SITE_ID}/visual/home`);
  });

  test("hover and select draw outlines above the frame; the inspector follows", async ({ page }) => {
    await openEditor(page);
    await waitForReady(page);
    const frame = siteFrame(page);
    await frame.locator("h1").hover();
    await expect(page.getByText("Headline", { exact: true }).first()).toBeVisible();
    await frame.locator("h1").click();
    await expect(page.getByTestId("selection-outline")).toBeVisible();
    await expect(page.getByTestId("selection-toolbar")).toContainText("Headline");
    await expect(page.getByTestId("inspector")).toContainText("home.hero.title");
    await expect(page.getByTestId("inspector").getByLabel("Headline")).toHaveValue(demoContent.home!.hero!.title as string);
    // Esc deselects.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("selection-outline")).toBeHidden();
  });

  test("inline edit on the page, then undo and redo", async ({ page }) => {
    await openEditor(page);
    await waitForReady(page);
    const frame = siteFrame(page);
    await frame.locator("h1").click();
    await frame.locator("h1").click();
    await expect(frame.locator("h1")).toHaveAttribute("contenteditable", /plaintext-only|true/);
    await page.keyboard.type(" and love");
    await page.keyboard.press("Enter");
    await expect(frame.locator("h1")).not.toHaveAttribute("contenteditable", /.+/);
    await expect(frame.locator("h1")).toHaveText("Homes built around the way you live and love");
    await expect(page.getByTestId("draft-status")).toContainText("1 unpublished change");
    await expect(page.getByTestId("inspector").getByLabel("Headline")).toHaveValue("Homes built around the way you live and love");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(frame.locator("h1")).toHaveText("Homes built around the way you live");
    await expect(page.getByTestId("draft-status")).toContainText("Nothing to publish");
    await page.getByRole("button", { name: "Redo" }).click();
    await expect(frame.locator("h1")).toHaveText("Homes built around the way you live and love");
    // Esc while typing cancels.
    await frame.locator("p.lead").click();
    await frame.locator("p.lead").click();
    await page.keyboard.type("XYZ");
    await page.keyboard.press("Escape");
    await expect(frame.locator("p.lead")).toHaveText(demoContent.home!.hero!.body as string);
    await expect(page.getByTestId("draft-status")).toContainText("1 unpublished change");
  });

  test("replace an image from the inspector; the canvas shows it at once", async ({ page }) => {
    await openEditor(page);
    await waitForReady(page);
    await page.getByTestId("image-target-home.hero.image").click();
    await expect(page.getByTestId("inspector")).toContainText("Hero photo");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8Dwn4GBgYGJAQoYGAAlfgIDR4qVMwAAAABJRU5ErkJggg==", "base64");
    await page.getByTestId("image-input-home.hero.image").setInputFiles({ name: "new-photo.png", mimeType: "image/png", buffer: png });
    await expect(page.getByTestId("inspector")).toContainText("New picture ready to publish");
    await expect(siteFrame(page).locator("img.hero-image")).toHaveAttribute("src", /^data:image\//);
    await expect(page.getByTestId("draft-status")).toContainText("1 unpublished change");
    await page.getByRole("button", { name: "Revert to published" }).first().click();
    await expect(siteFrame(page).locator("img.hero-image")).toHaveAttribute("src", "/assets/hero.svg");
  });

  test("lists: add, reorder and delete from the inspector; the page follows", async ({ page }) => {
    await openEditor(page);
    await waitForReady(page);
    await page.getByTestId("layer-home.faq.items").click();
    const editor = page.getByTestId("list-editor");
    await expect(editor).toContainText("3 items");
    await page.getByRole("button", { name: "Add item" }).click();
    await expect(editor).toContainText("4 items");
    const question = page.getByTestId("list-item-3").getByLabel("Question");
    await question.fill("Do you build in Placer County?");
    await expect(siteFrame(page).locator("dt").nth(3)).toHaveText("Do you build in Placer County?");
    await page.getByRole("button", { name: "Move item 4 up" }).click();
    await expect(siteFrame(page).locator("dt").nth(2)).toHaveText("Do you build in Placer County?");
    // Drag item 3 (index 2) to the top (HTML5 drag events, dispatched the way a browser does).
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await page.getByTestId("drag-handle-2").dispatchEvent("dragstart", { dataTransfer });
    await page.getByTestId("list-item-0").dispatchEvent("dragover", { dataTransfer });
    await page.getByTestId("list-item-0").dispatchEvent("drop", { dataTransfer });
    await expect(siteFrame(page).locator("dt").nth(0)).toHaveText("Do you build in Placer County?");
    await page.getByRole("button", { name: "Delete item 1" }).click();
    await expect(editor).toContainText("3 items");
    await expect(siteFrame(page).locator("dt").nth(0)).toHaveText(demoContent.home!.faq!.items[0].question);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(editor).toContainText("4 items");
  });

  test("page switching through the switcher and through a link on the page", async ({ page }) => {
    await openEditor(page);
    await waitForReady(page);
    await page.getByTestId("page-switcher").click();
    await page.getByRole("menuitemradio", { name: /About/ }).click();
    await expect(siteFrame(page).locator("h1")).toHaveText(demoContent.about!.intro!.title as string);
    await expect(page).toHaveURL(new RegExp(`/visual/about$`));
    await expect(page.getByTestId("layer-about.intro.title")).toBeVisible();
    // A plain click on a link selects it and shows the hint; Ctrl+click follows it.
    await siteFrame(page).locator("nav a", { hasText: "Homes" }).click();
    await expect(page.getByText(/and click to follow this link/)).toBeVisible();
    await expect(page).toHaveURL(/\/visual\/about$/);
    await siteFrame(page).locator("nav a", { hasText: "Homes" }).click({ modifiers: ["ControlOrMeta"] });
    await expect(siteFrame(page).locator("h1")).toHaveText(demoContent.home!.hero!.title as string);
    await expect(page).toHaveURL(/\/visual\/home$/);
    // The Pages tab too.
    await page.getByRole("tab", { name: "Pages" }).click();
    await page.getByTestId("page-about").click();
    await expect(siteFrame(page).locator("h1")).toHaveText(demoContent.about!.intro!.title as string);
  });

  test("device toggle rescales the canvas", async ({ page }) => {
    await openEditor(page);
    await waitForReady(page);
    const canvas = page.getByTestId("canvas");
    await expect(canvas).toHaveAttribute("data-device-width", "1440");
    const desktopWidth = await page.getByTestId("sheet").evaluate((el) => el.clientWidth);
    await page.getByRole("button", { name: /Phone view/ }).click();
    await expect(canvas).toHaveAttribute("data-device-width", "390");
    await expect(canvas).toHaveAttribute("data-scale", "1.000");
    await expect.poll(() => page.getByTestId("sheet").evaluate((el) => el.clientWidth)).toBe(390);
    // The tablet canvas is as wide as the site kit's tablet breakpoint (1024 for the demo).
    await page.getByRole("button", { name: /Tablet view/ }).click();
    await expect(canvas).toHaveAttribute("data-device-width", "1024");
    expect(desktopWidth).toBeLessThan(1024);
    await expect(siteFrame(page).locator("h1")).toBeVisible();
  });

  test("the draft survives a reload and can be kept", async ({ page }) => {
    await openEditor(page);
    await waitForReady(page);
    await page.getByTestId("layer-home.hero.title").click();
    await page.getByTestId("inspector").getByLabel("Headline").fill("Restored headline");
    await expect(page.getByTestId("draft-status")).toContainText("1 unpublished change");
    await expect(page.getByTestId("draft-status")).not.toContainText("Saving");
    await page.reload();
    await expect(page.getByRole("dialog", { name: "You have unpublished changes" })).toBeVisible();
    await page.getByTestId("restore-keep").click();
    await waitForReady(page);
    await expect(page.getByTestId("draft-status")).toContainText("1 unpublished change");
    await expect(siteFrame(page).locator("h1")).toHaveText("Restored headline");
  });

  test("batch publish: many pages, one request, then live in about 2 minutes", async ({ page }) => {
    const state = await openEditor(page);
    await waitForReady(page);
    await page.getByTestId("layer-home.hero.title").click();
    await page.getByTestId("inspector").getByLabel("Headline").fill("Published headline");
    await page.getByTestId("layer-shared.footer.copyright").click();
    await page.getByTestId("inspector").getByLabel("Copyright line").fill("© 2027 Alder & Stone");
    await expect(page.getByTestId("draft-status")).toContainText("2 unpublished changes");
    await page.keyboard.press("ControlOrMeta+s");
    const summary = page.getByTestId("publish-summary");
    await expect(summary).toContainText("Home");
    await expect(summary).toContainText("Header & footer");
    await page.getByTestId("publish-confirm").click();
    await expect(page.getByTestId("publish-done")).toContainText("Live in about 2 minutes");
    await expect(page.getByRole("link", { name: /View the commit/ })).toHaveAttribute("href", /github\.com\/acme\/alder-stone\/commit/);
    expect(state.publishRequests).toHaveLength(1);
    const request = state.publishRequests[0] as { site_id: string; baseCommitSha: string; pages: { slug: string; fields: unknown[] }[] };
    expect(request.site_id).toBe(SITE_ID);
    expect(request.baseCommitSha).toBe("abc1234def5678abc1234def5678abc1234def56");
    expect(request.pages.map((p) => p.slug).sort()).toEqual(["home", "shared"]);
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("draft-status")).toContainText("Nothing to publish");
    // The canvas keeps showing the published words while the host rebuilds.
    await expect(siteFrame(page).locator("h1")).toHaveText("Published headline");
  });

  test("a conflict names the field, and reloading keeps the rest of the draft", async ({ page }) => {
    await openEditor(page, { publish: "conflict" });
    await waitForReady(page);
    await page.getByTestId("layer-home.hero.title").click();
    await page.getByTestId("inspector").getByLabel("Headline").fill("Mine");
    await page.getByTestId("layer-home.hero.body").click();
    await page.getByTestId("inspector").getByLabel("Intro paragraph").fill("Body stays");
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await page.getByTestId("publish-confirm").click();
    await expect(page.getByTestId("publish-conflict")).toContainText("Home → Hero → Headline");
    await page.getByRole("button", { name: "Reload and keep the rest" }).click();
    await expect(page.getByTestId("draft-status")).toContainText("1 unpublished change");
    await expect(siteFrame(page).locator("p.lead")).toHaveText("Body stays");
    await expect(siteFrame(page).locator("h1")).toHaveText(demoContent.home!.hero!.title as string);
  });

  test("preview mode hides the outlines and lets links work", async ({ page }) => {
    await openEditor(page);
    await waitForReady(page);
    await siteFrame(page).locator("h1").click();
    await expect(page.getByTestId("selection-outline")).toBeVisible();
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.getByTestId("selection-outline")).toBeHidden();
    await siteFrame(page).locator("nav a", { hasText: "About" }).click();
    await expect(siteFrame(page).locator("h1")).toHaveText(demoContent.about!.intro!.title as string);
    await expect(page).toHaveURL(/\/visual\/about$/);
    await page.getByRole("button", { name: "Exit preview" }).click();
    await siteFrame(page).locator("h1").click();
    await expect(page.getByTestId("selection-outline")).toBeVisible();
  });

  test("clients see the agency's name, never the word Armature", async ({ page }) => {
    await openEditor(page, { role: "client" });
    await waitForReady(page);
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/armature/i);
    await expect(page.getByPlaceholder(/Reputation Guardians will build it/)).toBeVisible();
  });
});

test.describe("connection states", () => {
  test("a site without the bridge: says so and offers the page editor", async ({ page }) => {
    test.setTimeout(90_000);
    await installMocks(page, { liveUrl: PLAIN_SITE_URL });
    await servePlainSite(page);
    await page.addInitScript(() => window.localStorage.setItem("armature:visual:tour:v1", "done"));
    await page.goto(editorUrl());
    await expect(page.getByText("Connecting the editor…")).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("isn't set up for visual editing yet", { timeout: 20_000 });
    await expect(page.getByRole("link", { name: "Use the page editor" })).toHaveAttribute("href", `/sites/${SITE_ID}/pages`);
  });

  test("a site that blocks framing: names the exact header to add", async ({ page }) => {
    test.setTimeout(90_000);
    await installMocks(page, { liveUrl: PLAIN_SITE_URL, embed: { reachable: true, status: 200, xFrameOptions: "DENY", frameAncestors: null } });
    await servePlainSite(page);
    await page.addInitScript(() => window.localStorage.setItem("armature:visual:tour:v1", "done"));
    await page.goto(editorUrl());
    await expect(page.getByRole("alert")).toContainText("X-Frame-Options: DENY", { timeout: 20_000 });
    await expect(page.getByRole("alert")).toContainText("frame-ancestors 'self' http://localhost:5173");
  });

  test("no live URL", async ({ page }) => {
    await installMocks(page, { liveUrl: null });
    await page.goto(editorUrl());
    await expect(page.getByRole("alert")).toContainText("no live address yet");
  });

  test("under 900px: a friendly note and the form editor", async ({ page }) => {
    await installMocks(page);
    await page.setViewportSize({ width: 800, height: 700 });
    await page.goto(editorUrl());
    await expect(page.getByText("Visual editing needs a bigger screen")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open the page editor" })).toBeVisible();
  });
});

test.describe("the bridge on its own", () => {
  test("ignores messages from an origin that is not allowlisted", async ({ page }) => {
    // A parent page on another origin (127.0.0.1, not localhost) embeds the demo site with the edit flag.
    await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());
    await page.goto("http://127.0.0.1:5174/tests/not-allowed-parent.html", { waitUntil: "domcontentloaded" });
    const frame = page.frameLocator("#f");
    await expect(frame.locator("h1")).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => (window as unknown as { replies: unknown[] }).replies)).toEqual([]);
    // Still inert: no mode attribute, nothing contenteditable, and a click follows the link.
    expect(await frame.locator("html").getAttribute("data-armature-mode")).toBeNull();
    await frame.locator("h1").click();
    expect(await frame.locator("h1").getAttribute("contenteditable")).toBeNull();
    await frame.locator("nav a", { hasText: "About" }).click();
    await expect(frame.locator("h1")).toHaveText(demoContent.about!.intro!.title as string);
  });

  test("does nothing outside an iframe, even with the edit flag", async ({ page }) => {
    await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());
    await page.goto(`${DEMO_SITE_URL}/?armature=edit`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toBeVisible();
    expect(await page.locator("html").getAttribute("data-armature-mode")).toBeNull();
    const h1 = await page.locator("h1").textContent();
    expect(ZERO_WIDTH.test(h1 ?? "")).toBe(false);
    await page.locator("h1").click();
    expect(await page.locator("h1").getAttribute("contenteditable")).toBeNull();
    await page.locator("nav a", { hasText: "About" }).click();
    await expect(page).toHaveURL(/\/about\/?\?armature=edit$|\/about\/?$/);
  });
});
