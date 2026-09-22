/**
 * The page builder (site contract v2) against examples/demo-site. Milestone 1: the
 * kit renders layouts and builder-only pages, the bridge negotiates protocol 2, and
 * public visitors get no bridge activity.
 */
import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { DEMO_SITE_URL, demoLayouts, editorUrl, installMocks } from "./mocks.ts";

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

// --- milestone 2: the canvas ------------------------------------------------------------------

/** Phone view renders the frame at scale 1, so bounding boxes inside it are exact. */
async function openBuilder(page: Page, options: Parameters<typeof installMocks>[1] = {}) {
  const state = await openEditor(page, options);
  await waitForReady(page);
  await expect(page.getByTestId("visual-editor")).toHaveAttribute("data-builder", "on");
  await page.getByRole("button", { name: /Phone view/ }).click();
  await expect(page.getByTestId("canvas")).toHaveAttribute("data-scale", "1.000");
  return state;
}

async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 6, from.y + 6);
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await expect(page.getByTestId("drag-ghost")).toBeVisible();
}

const center = (box: { x: number; y: number; width: number; height: number } | null) => {
  if (!box) throw new Error("element has no box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test.describe("the page builder canvas", () => {
  test("drags a widget from the Elements panel into a container, then undoes it", async ({ page }) => {
    await openBuilder(page);
    const frame = siteFrame(page);
    await page.getByTestId("tab-elements").click();
    const item = page.getByTestId("element-heading");
    await frame.locator(".ae-txtbuild").scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const target = await frame.locator(".ae-txtbuild").boundingBox();
    await dragTo(page, center(await item.boundingBox()), { x: center(target).x, y: (target?.y ?? 0) + 6 });
    await expect(page.getByTestId("drop-line")).toBeVisible();
    await page.mouse.up();
    // The new heading sits right before the text, inside the same column.
    const headings = frame.locator(".ae-colrigh1 .ae-heading");
    await expect(headings).toHaveCount(1);
    await expect(headings.first()).toHaveText("Add your heading");
    await expect(frame.locator(".ae-colrigh1 > .ae-con-inner > :first-child")).toHaveClass(/ae-heading/);
    await expect(page.getByTestId("element-selection")).toBeVisible();
    await expect(page.getByTestId("draft-status")).toContainText("1 unpublished change");
    await expect(page.getByTestId("breadcrumbs")).toContainText("Container");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(headings).toHaveCount(0);
    await expect(page.getByTestId("draft-status")).toContainText("Nothing to publish");
    await page.getByRole("button", { name: "Redo" }).click();
    await expect(headings).toHaveCount(1);
  });

  test("refuses an invalid drop and cancels with Escape", async ({ page }) => {
    await openBuilder(page);
    const frame = siteFrame(page);
    await page.getByTestId("tab-navigator").click();
    await page.getByTestId("nav-rowbuild").click();
    await expect(page.getByTestId("element-selection")).toHaveAttribute("data-element-id", "rowbuild");
    const move = page.getByTestId("element-move");
    await frame.locator(".ae-txtbuild").scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const inside = await frame.locator(".ae-txtbuild").boundingBox();
    await dragTo(page, center(await move.boundingBox()), center(inside));
    // A container cannot be dropped inside itself: no indicator, a "Not here" ghost.
    await expect(page.getByTestId("drop-line")).toHaveCount(0);
    await expect(page.getByTestId("drag-ghost")).toContainText("Not here");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("drag-ghost")).toHaveCount(0);
    await expect(frame.locator(".ae-rowbuild .ae-txtbuild")).toHaveCount(1);
  });

  test("moves an element on the canvas with the toolbar handle", async ({ page }) => {
    await openBuilder(page);
    const frame = siteFrame(page);
    await frame.locator(".ae-btnbuild").scrollIntoViewIfNeeded();
    await frame.locator(".ae-btnbuild").click({ position: { x: 4, y: 4 } });
    await expect(page.getByTestId("element-selection")).toHaveAttribute("data-element-id", "btnbuild");
    const move = page.getByTestId("element-move");
    const text = await frame.locator(".ae-txtbuild").boundingBox();
    await dragTo(page, center(await move.boundingBox()), { x: center(text).x, y: (text?.y ?? 0) + 4 });
    await expect(page.getByTestId("drop-line")).toBeVisible();
    await page.mouse.up();
    await expect(frame.locator(".ae-colrigh1 > .ae-con-inner > :first-child")).toHaveClass(/ae-btnbuild/);
    await expect(page.getByTestId("history-steps")).toHaveText("1");
  });

  test("reorders and re-nests through the Navigator", async ({ page }) => {
    await openBuilder(page);
    const frame = siteFrame(page);
    await page.getByTestId("tab-navigator").click();
    await expect(page.getByTestId("nav-secbuild")).toBeVisible();
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    // Drop the FAQ section before the builder section (top half of the row = before).
    const target = page.getByTestId("nav-secbuild");
    await page.getByTestId("nav-secfaq01").dispatchEvent("dragstart", { dataTransfer });
    const box = await target.boundingBox();
    await target.dispatchEvent("dragover", { dataTransfer, clientX: (box?.x ?? 0) + 10, clientY: (box?.y ?? 0) + 3 });
    await target.dispatchEvent("drop", { dataTransfer, clientX: (box?.x ?? 0) + 10, clientY: (box?.y ?? 0) + 3 });
    const order = await frame.locator(".ae-root > [data-ae-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-ae-id")));
    expect(order).toEqual(["sechero1", "secfaq01", "secbuild", "secservi"]);
    // Rename through the Navigator and see it in the inspector.
    await page.getByTestId("nav-hdbuilds").dblclick();
    await page.getByTestId("navigator").getByLabel("Element name").fill("Builds title");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("nav-hdbuilds")).toContainText("Builds title");
    // Hide on phone: the badge shows, the element stays visible at 40%.
    await page.getByTestId("nav-hdbuilds").hover();
    await page.getByRole("button", { name: "Hide on mobile" }).click();
    await expect(page.getByTestId("element-overlays").getByText("Hidden on mobile")).toBeVisible();
    await expect(frame.locator(".ae-hdbuilds")).toHaveCSS("opacity", "0.4");
  });

  test("adds a section from the structure picker and fills its empty column", async ({ page }) => {
    await openBuilder(page);
    const frame = siteFrame(page);
    await page.getByTestId("tab-elements").click();
    await page.getByTestId("add-section").click();
    await page.getByTestId("pick-structure-50-50").click();
    const section = frame.locator(".ae-root > .ae-container").last();
    await expect(section.locator(":scope > .ae-con-inner > .ae-container > .ae-con-inner > .ae-container")).toHaveCount(2);
    await expect(page.getByTestId("element-selection")).toBeVisible();
    await expect(page.getByText("Drag a widget here").first()).toBeVisible();
    // Click-insert goes into the empty column once it is selected.
    const column = section.locator(".ae-con-inner > .ae-container > .ae-con-inner > .ae-container").first();
    await column.click({ position: { x: 10, y: 10 } });
    await page.getByTestId("element-button").click();
    await expect(column.locator(".ae-button")).toHaveCount(1);
  });

  test("context menu, duplicate, delete, keyboard shortcuts and the History panel", async ({ page }) => {
    await openBuilder(page);
    const frame = siteFrame(page);
    await frame.locator(".ae-hdbuilds").click({ button: "right" });
    await expect(page.getByTestId("context-menu")).toBeVisible();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await expect(frame.locator(".ae-secbuild .ae-heading")).toHaveCount(2);
    // The copy is selected; Delete removes it.
    await page.keyboard.press("Delete");
    await expect(frame.locator(".ae-secbuild .ae-heading")).toHaveCount(1);
    // Ctrl+D duplicates the selection, Ctrl+Z undoes, Shift+Ctrl+Z redoes.
    await frame.locator(".ae-hdbuilds").click();
    await page.keyboard.press("ControlOrMeta+d");
    await expect(frame.locator(".ae-secbuild .ae-heading")).toHaveCount(2);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(frame.locator(".ae-secbuild .ae-heading")).toHaveCount(1);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(frame.locator(".ae-secbuild .ae-heading")).toHaveCount(2);
    // Copy and paste across pages: the clipboard payload survives a page switch.
    await frame.locator(".ae-hdbuilds").click();
    await page.keyboard.press("ControlOrMeta+c");
    await page.getByTestId("topbar-history").click();
    await expect(page.getByTestId("history-panel")).toContainText("Duplicated Heading");
    await expect(page.getByTestId("history-panel")).toContainText("Deleted Heading");
    await page.getByTestId("history-1").click();
    await expect(frame.locator(".ae-secbuild .ae-heading")).toHaveCount(2);
    await page.getByTestId("history-2").click();
    await expect(frame.locator(".ae-secbuild .ae-heading")).toHaveCount(1);
  });

  test("types a heading in place, keeps it across a reload, and arrows walk the tree", async ({ page }) => {
    await openBuilder(page);
    const frame = siteFrame(page);
    await frame.locator(".ae-hdbuilds").dblclick();
    await expect(frame.locator(".ae-hdbuilds")).toHaveAttribute("contenteditable", /plaintext-only|true/);
    await page.keyboard.press("End");
    await page.keyboard.type(" in Sacramento");
    await page.keyboard.press("Enter");
    await expect(frame.locator(".ae-hdbuilds")).toHaveText("Recent builds in Sacramento");
    await expect(page.getByTestId("draft-status")).toContainText("1 unpublished change");
    await expect(page.getByTestId("draft-status")).not.toContainText("Saving");
    // Arrow keys (the heading is still selected after Enter): down selects the next sibling, left the parent.
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("element-selection")).toHaveAttribute("data-element-id", "rowbuild");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("element-selection")).toHaveAttribute("data-element-id", "secbuild");
    await page.reload();
    await expect(page.getByRole("dialog", { name: "You have unpublished changes" })).toBeVisible();
    await page.getByTestId("restore-keep").click();
    await waitForReady(page);
    await expect(frame.locator(".ae-hdbuilds")).toHaveText("Recent builds in Sacramento");
    await expect(page.getByTestId("draft-status")).toContainText("1 unpublished change");
  });

  test("a client at the content-only level gets Stage 1 editing and no builder", async ({ page }) => {
    await openEditor(page, { role: "client", editingLevel: "content" });
    await waitForReady(page);
    await expect(page.getByTestId("visual-editor")).toHaveAttribute("data-protocol", "2");
    await expect(page.getByTestId("visual-editor")).not.toHaveAttribute("data-builder", "on");
    await expect(page.getByTestId("builder-panel")).toHaveCount(0);
    await siteFrame(page).locator(".ae-hdbuilds").click();
    await expect(page.getByTestId("element-toolbar")).toHaveCount(0);
    await siteFrame(page).locator("h1").click();
    await expect(page.getByTestId("selection-toolbar")).toContainText("Headline");
  });

  test("a client at the builder level can build, but not touch locked elements", async ({ page }) => {
    await openEditor(page, { role: "client", editingLevel: "builder", layouts: lockedLayouts() });
    await waitForReady(page);
    await expect(page.getByTestId("visual-editor")).toHaveAttribute("data-builder", "on");
    const frame = siteFrame(page);
    await frame.locator(".ae-hdbuilds").click();
    await expect(page.getByText("Locked by the agency")).toBeVisible();
    await expect(page.getByTestId("element-toolbar")).toHaveCount(0);
    await page.keyboard.press("Delete");
    await expect(frame.locator(".ae-hdbuilds")).toHaveCount(1);
    await frame.locator(".ae-btnbuild").click({ position: { x: 4, y: 4 } });
    await expect(page.getByTestId("element-toolbar")).toBeVisible();
  });
});

function lockedLayouts(): Record<string, unknown> {
  const layouts = JSON.parse(JSON.stringify(demoLayouts)) as Record<string, { root: { id: string; children?: unknown[]; locked?: boolean }[] }>;
  const walk = (elements: { id: string; children?: unknown[]; locked?: boolean }[]) => {
    for (const element of elements) {
      if (element.id === "hdbuilds") element.locked = true;
      if (element.children) walk(element.children as typeof elements);
    }
  };
  walk(layouts["home"]!.root);
  return layouts;
}
