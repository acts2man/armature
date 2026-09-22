/**
 * The page builder (site contract v2) against examples/demo-site. Milestone 1: the
 * kit renders layouts and builder-only pages, the bridge negotiates protocol 2, and
 * public visitors get no bridge activity.
 */
import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { DEMO_SITE_URL, editorUrl, installMocks } from "./mocks.ts";

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
  await expect(page.locator(`iframe[title$="live site"]`)).toHaveCSS("opacity", "1", { timeout: 15_000 });
}

test.describe("the kit on the public site", () => {
  test("renders the home layout: site sections wrapped as elements, builder elements between them", async ({ page }) => {
    await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());
    await page.goto(`${DEMO_SITE_URL}/`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".ae-root [data-ae-id='sechero1'] h1")).toHaveText("Homes built around the way you live");
    await expect(page.locator(".ae-root .ae-hdbuilds")).toHaveText("Recent builds");
    await expect(page.locator(".ae-root .ae-txtbuild strong")).toHaveText("Then we draw.");
    await expect(page.locator(".ae-root .ae-btnbuild a.ae-btn")).toHaveAttribute("href", "/contact/");
    // Order follows the layout file: hero, the builder section, services, faq.
    const order = await page.locator(".ae-root > [data-ae-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-ae-id")));
    expect(order).toEqual(["sechero1", "secbuild", "secservi", "secfaq01"]);
    // Generated CSS is scoped and responsive; the row stacks on phones.
    const css = await page.locator("style[data-armature-page='home']").textContent();
    expect(css).toContain(".ae-root .ae-rowbuild > .ae-con-inner");
    expect(css).toContain("@media (max-width: 767px)");
    // No bridge activity, no invisible characters, no edit attributes.
    expect(await page.locator("html").getAttribute("data-armature-mode")).toBeNull();
    expect(ZERO_WIDTH.test((await page.locator("h1").textContent()) ?? "")).toBe(false);
    expect(ZERO_WIDTH.test((await page.locator(".ae-hdbuilds").textContent()) ?? "")).toBe(false);
    expect(await page.locator("[contenteditable]").count()).toBe(0);
    // The first picture is eager with a high priority; later ones lazy.
    await expect(page.locator(".ae-imgbuild img")).toHaveAttribute("loading", "eager");
  });

  test("serves a builder-only page at its path with its SEO title, and still 404s elsewhere", async ({ page }) => {
    await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());
    await page.goto(`${DEMO_SITE_URL}/contact/`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".ae-root .ae-cthead01")).toHaveText("Let's talk about your home");
    await expect(page).toHaveTitle("Contact | Alder & Stone");
    await expect(page.locator("meta[name='description']")).toHaveAttribute("content", /Get in touch/);
    await expect(page.locator(".ae-ctbutton a.ae-btn")).toHaveAttribute("href", "mailto:hello@alderstone.example");
    await expect(page.locator(".ae-ctdivide")).toHaveAttribute("role", "separator");
    expect(await page.locator("html").getAttribute("data-armature-mode")).toBeNull();
    await page.goto(`${DEMO_SITE_URL}/nothing-here/`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toHaveText("Page not found");
  });
});

test.describe("the editor with a v2 kit", () => {
  test("negotiates protocol 2, pushes the layouts and keeps Stage 1 editing inside site sections", async ({ page }) => {
    await openEditor(page);
    await waitForReady(page);
    await expect(page.getByTestId("visual-editor")).toHaveAttribute("data-protocol", "2");
    const frame = siteFrame(page);
    await expect(frame.locator("html")).toHaveAttribute("data-armature-mode", "edit");
    await expect(frame.locator(".ae-root .ae-hdbuilds")).toHaveText("Recent builds");
    // Stage 1 still works on the fields inside the hero site section.
    await frame.locator("h1").click();
    await expect(page.getByTestId("selection-toolbar")).toContainText("Headline");
    await frame.locator("h1").click();
    await page.keyboard.type("!");
    await page.keyboard.press("Enter");
    await expect(frame.locator("h1")).toHaveText("Homes built around the way you live!");
    await expect(page.getByTestId("draft-status")).toContainText("1 unpublished change");
    await expect(page.getByTestId("older-kit-notice")).toHaveCount(0);
  });
});
