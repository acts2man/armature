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

// --- milestone 3: the inspector ----------------------------------------------------------------

test.describe("the inspector", () => {
  test("a tablet value overrides desktop, mobile inherits it, and the dot resets it", async ({ page }) => {
    await openBuilder(page);
    const frame = siteFrame(page);
    const heading = frame.locator(".ae-hdbuilds");
    await heading.click();
    await page.getByTestId("inspector-tab-style").click();
    await page.getByRole("button", { name: /Desktop view/ }).click();
    const typography = page.getByTestId("group-typography");
    const size = typography.getByLabel("Size", { exact: true });
    await size.fill("40");
    await size.press("Tab");
    await expect(heading).toHaveCSS("font-size", "40px");
    // The device icon on the control switches the whole editor to the next device.
    await typography.getByTestId("device-switch").first().click();
    await expect(page.getByRole("button", { name: /Tablet view/ })).toHaveAttribute("aria-pressed", "true");
    await expect(size).toHaveValue("");
    await expect(size).toHaveAttribute("placeholder", "40");
    await size.fill("30");
    await size.press("Tab");
    await expect(heading).toHaveCSS("font-size", "30px");
    await expect(typography.getByTestId("override-dot")).toHaveCount(1);
    await page.getByRole("button", { name: /Phone view/ }).click();
    await expect(heading).toHaveCSS("font-size", "30px");
    await expect(size).toHaveAttribute("placeholder", "30");
    await expect(typography.getByTestId("override-dot")).toHaveCount(0);
    await page.getByRole("button", { name: /Desktop view/ }).click();
    await expect(heading).toHaveCSS("font-size", "40px");
    await page.getByRole("button", { name: /Tablet view/ }).click();
    await typography.getByTestId("override-dot").click();
    await expect(heading).toHaveCSS("font-size", "40px");
    await expect(page.getByTestId("draft-status")).toContainText("unpublished change");
  });

  test("hover styles, spacing on the Advanced tab, and the agency-only groups", async ({ page }) => {
    await openBuilder(page);
    const frame = siteFrame(page);
    await frame.locator(".ae-btnbuild").click({ position: { x: 4, y: 4 } });
    await expect(page.getByTestId("element-selection")).toHaveAttribute("data-element-id", "btnbuild");
    await page.getByTestId("inspector-tab-style").click();
    await page.getByTestId("style-state-hover").click();
    const background = page.getByTestId("group-background");
    await background.getByTestId("background-kind").selectOption("color");
    // A new colour background starts linked to the site's primary colour; unlink to type one.
    await expect(background.getByTestId("color-text")).toHaveValue("primary (site)");
    await background.getByTestId("unlink-color").click();
    await background.getByTestId("color-text").fill("#cc0000");
    await page.getByLabel("Transition (ms)").fill("0");
    await page.getByLabel("Transition (ms)").press("Tab");
    await expect.poll(() => frame.locator("style[data-armature-page=home]").evaluate((node) => node.textContent ?? "")).toContain(".ae-btnbuild:hover .ae-btn { background-color: #cc0000");
    await frame.locator(".ae-btnbuild .ae-btn").hover();
    await expect(frame.locator(".ae-btnbuild .ae-btn")).toHaveCSS("background-color", "rgb(204, 0, 0)");

    await page.getByTestId("inspector-tab-advanced").click();
    const top = page.getByLabel("Padding top");
    await top.fill("24");
    await top.press("Tab");
    // Linked sides: one value sets all four.
    await expect(frame.locator(".ae-btnbuild")).toHaveCSS("padding-left", "24px");
    await expect(frame.locator(".ae-btnbuild")).toHaveCSS("padding-top", "24px");
    await expect(page.getByTestId("group-custom-css")).toBeVisible();
    await expect(page.getByTestId("group-attributes")).toBeVisible();
  });

  test("a client does not see the agency-only groups", async ({ page }) => {
    await openEditor(page, { role: "client", editingLevel: "builder" });
    await waitForReady(page);
    await siteFrame(page).locator(".ae-btnbuild").click({ position: { x: 4, y: 4 } });
    await page.getByTestId("inspector-tab-advanced").click();
    await expect(page.getByTestId("group-layout")).toBeVisible();
    await expect(page.getByTestId("group-custom-css")).toHaveCount(0);
    await expect(page.getByTestId("group-attributes")).toHaveCount(0);
  });

  test("changing a site colour restyles everything linked to it, and undo brings it back", async ({ page }) => {
    await openBuilder(page);
    const frame = siteFrame(page);
    const button = frame.locator(".ae-btnbuild .ae-btn");
    await expect(button).toHaveCSS("background-color", "rgb(31, 58, 46)");
    await page.getByTestId("tab-site").click();
    const colours = page.getByTestId("group-global-colours");
    await colours.getByTestId("color-text").first().fill("#aa0000");
    await expect(button).toHaveCSS("background-color", "rgb(170, 0, 0)");
    await expect(page.getByTestId("draft-status")).toContainText("1 unpublished change");
    await page.getByTestId("add-colour").click();
    await expect(page.getByTestId("custom-colours").getByLabel("Colour name")).toHaveCount(2);
    await page.getByRole("button", { name: "Undo" }).click();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(button).toHaveCSS("background-color", "rgb(31, 58, 46)");
  });

  test("the icon picker loads the icon set on demand and saves the icon into the button", async ({ page }) => {
    await openBuilder(page);
    const frame = siteFrame(page);
    await frame.locator(".ae-btnbuild").click({ position: { x: 4, y: 4 } });
    await page.getByTestId("group-icon").getByRole("button", { name: "Icon" }).click();
    await page.getByRole("button", { name: "Choose an icon" }).click();
    await page.getByLabel("Search icons").fill("arrow right");
    await page.getByRole("option", { name: "ArrowRight", exact: true }).click();
    await expect(frame.locator(".ae-btnbuild svg")).toHaveCount(1);
    await expect(page.getByTestId("icon-picker")).toContainText("ArrowRight");
  });

  test("a Google font chosen for an element joins the site's fonts and loads on the site", async ({ page }) => {
    await openBuilder(page);
    const frame = siteFrame(page);
    await frame.locator(".ae-hdbuilds").click();
    await page.getByTestId("inspector-tab-style").click();
    await page.getByTestId("group-typography").getByTestId("font-picker").locator("button").first().click();
    await page.getByLabel("Search fonts").fill("Fraunces");
    await page.getByRole("option", { name: /Fraunces/ }).click();
    await expect(frame.locator(".ae-hdbuilds")).toHaveCSS("font-family", /Fraunces/);
    await expect(frame.locator("link[data-armature-fonts]")).toHaveAttribute("href", /family=Fraunces/);
    await page.getByTestId("tab-site").click();
    await expect(page.getByTestId("custom-fonts")).toContainText("Fraunces");
  });
});

// --- milestone 4: direct manipulation ------------------------------------------------------------------

test.describe("direct manipulation", () => {
  test("rich text: the floating toolbar formats the selection, links it, and the draft keeps it", async ({ page }) => {
    await openBuilder(page);
    const frame = siteFrame(page);
    const text = frame.locator(".ae-txtbuild");
    await text.scrollIntoViewIfNeeded();
    await text.dblclick();
    await expect(text).toHaveAttribute("contenteditable", "true");
    await expect(page.getByTestId("richtext-toolbar")).toBeVisible();
    // Select the first word inside the page, then format it from the toolbar in the editor.
    await text.evaluate((node) => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const first = walker.nextNode() as Text;
      const range = document.createRange();
      range.setStart(first, 0);
      range.setEnd(first, first.data.indexOf(" "));
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await page.getByTestId("rt-bold").click();
    await expect(text.locator("b, strong")).toHaveCount(2);
    await expect(page.getByTestId("rt-bold")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("rt-link").click();
    await page.getByTestId("rt-link-input").fill("javascript:alert(1)");
    await expect(page.getByRole("button", { name: "Apply" })).toBeDisabled();
    await page.getByTestId("rt-link-input").fill("/contact/");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(text.locator('a[href="/contact/"]')).toHaveCount(1);
    await page.getByTestId("rt-bullets").click();
    await expect(text.locator("ul li")).toHaveCount(1);
    await page.getByTestId("rt-done").click();
    await expect(page.getByTestId("richtext-toolbar")).toHaveCount(0);
    await expect(text).not.toHaveAttribute("contenteditable", "true");
    await expect(page.getByTestId("draft-status")).toContainText("1 unpublished change");
    // The stored document is the kit's JSON, rendered by the kit: bold, the link and the list survive.
    // (The demo text already has one bold phrase.)
    await expect(text.locator("strong")).toHaveCount(2);
    await expect(text.locator('a[href="/contact/"]')).toHaveCount(1);
    await expect(text.locator("ul li")).toHaveCount(1);
    await expect(text.locator("b")).toHaveCount(0);
  });
});

test.describe("canvas handles", () => {
  const px = (value: string) => Number.parseFloat(value);
  /** A handle's centre once the canvas has stopped scrolling to the selection. */
  const settled = async (locator: ReturnType<Page["getByTestId"]>) => {
    let previous = "";
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const box = await locator.boundingBox();
      const current = JSON.stringify(box);
      if (box && current === previous) return center(box);
      previous = current;
      await locator.page().waitForTimeout(100);
    }
    throw new Error("the handle never settled");
  };

  test("a padding handle drags live, is one undo step, and Esc puts it back", async ({ page }) => {
    await openBuilder(page);
    const frame = siteFrame(page);
    await page.getByTestId("tab-navigator").click();
    await page.getByTestId("nav-secbuild").click();
    await expect(page.getByTestId("element-selection")).toHaveAttribute("data-element-id", "secbuild");
    const section = frame.locator(".ae-secbuild");
    const before = px(await section.evaluate((node) => getComputedStyle(node).paddingTop));
    const handle = page.getByTestId("handle-padding-top");
    const start = await settled(handle);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y + 10, { steps: 2 });
    await page.mouse.move(start.x, start.y + 30, { steps: 4 });
    await expect(page.getByTestId("handle-value")).toContainText("Padding top");
    await page.mouse.up();
    await expect.poll(async () => px(await section.evaluate((node) => getComputedStyle(node).paddingTop))).toBe(before + 30);
    await expect(page.getByTestId("draft-status")).toContainText("1 unpublished change");
    // One drag, one step.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => px(await section.evaluate((node) => getComputedStyle(node).paddingTop))).toBe(before);
    await expect(page.getByTestId("draft-status")).toContainText("Nothing to publish");

    // Esc mid-drag reverts and leaves nothing to undo.
    const again = await settled(handle);
    await page.mouse.move(again.x, again.y);
    await page.mouse.down();
    await page.mouse.move(again.x, again.y + 20, { steps: 4 });
    await expect.poll(async () => px(await section.evaluate((node) => getComputedStyle(node).paddingTop))).toBe(before + 20);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect.poll(async () => px(await section.evaluate((node) => getComputedStyle(node).paddingTop))).toBe(before);
    await expect(page.getByTestId("draft-status")).toContainText("Nothing to publish");

    // Arrow keys on a focused handle nudge by 1 (10 with Shift).
    await handle.focus();
    await page.keyboard.press("Shift+ArrowDown");
    await expect.poll(async () => px(await section.evaluate((node) => getComputedStyle(node).paddingTop))).toBe(before + 10);
  });

  test("the boundary between two columns resizes both, for the device being edited", async ({ page }) => {
    await openBuilder(page);
    const frame = siteFrame(page);
    await page.getByRole("button", { name: /Tablet view/ }).click();
    await page.getByTestId("tab-navigator").click();
    await page.getByTestId("nav-colleft1").click();
    const left = frame.locator(".ae-colleft1");
    const right = frame.locator(".ae-colrigh1");
    const widthOf = async (locator: typeof left) => px(await locator.evaluate((node) => getComputedStyle(node).width));
    const [l0, r0] = [await widthOf(left), await widthOf(right)];
    const handle = page.getByTestId("handle-columns");
    const start = await settled(handle);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 40, start.y, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await widthOf(left)) > l0 + 20).toBe(true);
    await expect.poll(async () => (await widthOf(right)) < r0 - 20).toBe(true);
    // Desktop keeps its 50 / 50.
    await page.getByRole("button", { name: /Desktop view/ }).click();
    await expect.poll(async () => Math.abs((await widthOf(left)) - (await widthOf(right))) < 2).toBe(true);
  });

  test("image width and height handles, and a spacer's height", async ({ page }) => {
    await openBuilder(page);
    const frame = siteFrame(page);
    const img = frame.locator(".ae-imgbuild img");
    await img.scrollIntoViewIfNeeded();
    await img.click();
    await expect(page.getByTestId("element-selection")).toHaveAttribute("data-element-id", "imgbuild");
    const w0 = (await img.boundingBox())?.width ?? 0;
    const handle = page.getByTestId("handle-image-width");
    const start = await settled(handle);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x - 80, start.y, { steps: 5 });
    await expect(page.getByTestId("handle-value")).toContainText("%");
    await page.mouse.up();
    await expect.poll(async () => Math.round((await img.boundingBox())?.width ?? 0)).toBeLessThan(w0 - 60);
    const h0 = (await img.boundingBox())?.height ?? 0;
    await page.getByTestId("handle-image-height").focus();
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Shift+ArrowDown");
    await expect.poll(async () => Math.round((await img.boundingBox())?.height ?? 0)).toBe(Math.round(h0) + 20);

    // A spacer inserted after the image: drag its bottom edge.
    await page.getByTestId("tab-elements").click();
    await page.getByTestId("element-spacer").click();
    const spacer = frame.locator(".ae-spacer");
    await expect(spacer).toHaveCount(1);
    await expect(spacer).toHaveCSS("height", "50px");
    const grip = page.getByTestId("handle-spacer");
    const g = await settled(grip);
    await page.mouse.move(g.x, g.y);
    await page.mouse.down();
    await page.mouse.move(g.x, g.y + 40, { steps: 5 });
    await page.mouse.up();
    await expect(spacer).toHaveCSS("height", "90px");
  });
});

// --- milestone 5: the widget library ---------------------------------------------------------------

test.describe("the widget library on the public site", () => {
  test("an accordion opens one item at a time, by mouse and keyboard", async ({ page }) => {
    await page.goto(`${DEMO_SITE_URL}/contact/`, { waitUntil: "domcontentloaded" });
    const accordion = page.locator(".ae-ctfaq001");
    const first = accordion.getByRole("button", { name: "How soon can you start?" });
    const second = accordion.getByRole("button", { name: "Do you work outside Sacramento?" });
    await expect(first).toHaveAttribute("aria-expanded", "true");
    await expect(accordion.getByText("Most projects start design")).toBeVisible();
    await second.click();
    await expect(second).toHaveAttribute("aria-expanded", "true");
    await expect(first).toHaveAttribute("aria-expanded", "false");
    await expect(accordion.getByText("Most projects start design")).toBeHidden();
    await second.focus();
    await page.keyboard.press("Enter");
    await expect(second).toHaveAttribute("aria-expanded", "false");
    // Social icons: bare email becomes a mailto: link, networks are labelled.
    await expect(page.locator(".ae-ctsocial").getByRole("link", { name: "Email" })).toHaveAttribute("href", "mailto:hello@alderstone.example");
    await expect(page.locator(".ae-ctsocial").getByRole("link", { name: "Instagram" })).toHaveAttribute("rel", "noopener noreferrer");
  });

  test("the form checks fields, sends to the form function, and shows the thank-you", async ({ page }) => {
    const sent: Record<string, unknown>[] = [];
    await page.route("https://demo.supabase.co/functions/v1/form-submit", async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      sent.push(body);
      const values = body["values"] as Record<string, string>;
      if (!values["email"]?.includes("@")) {
        await route.fulfill({ json: { ok: false, code: "invalid", message: "Please check the highlighted fields.", fieldErrors: { email: "Please enter a valid email address." } } });
        return;
      }
      await route.fulfill({ json: { ok: true, message: "Thanks, we'll call you within one business day." } });
    });
    await page.goto(`${DEMO_SITE_URL}/contact/`, { waitUntil: "domcontentloaded" });
    const form = page.locator("form.ae-ctform01");
    // The honeypot is there for bots, out of sight and out of the tab order.
    await expect(form.locator('input[name="ae_website"]')).toHaveAttribute("tabindex", "-1");
    await expect(form.locator(".ae-form-trap")).not.toBeInViewport();
    await form.getByLabel("Your name").fill("Ada Lovelace");
    await form.getByLabel("Email").fill("ada-at-example");
    await form.getByLabel("Project").selectOption("Remodel");
    await form.getByLabel("Tell us about it").fill("A second storey.");
    await page.waitForTimeout(300);
    // The browser's own check stops an email without @ first; the function's check is the second line.
    await form.evaluate((node) => ((node as HTMLFormElement).noValidate = true));
    await form.getByRole("button", { name: "Send" }).click();
    await expect(form.getByText("Please enter a valid email address.")).toBeVisible();
    await expect(form.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
    await form.getByLabel("Email").fill("ada@example.com");
    await form.getByRole("button", { name: "Send" }).click();
    await expect(page.locator(".ae-ctform01[role=status]")).toHaveText("Thanks, we'll call you within one business day.");
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ site_id: "11111111-1111-4111-8111-111111111111", page: "contact", element_id: "ctform01", trap: "", values: { full_name: "Ada Lovelace", email: "ada@example.com", project: "Remodel", message: "A second storey." } });
    expect(typeof sent[1]?.["started_at"]).toBe("number");
  });
});

test.describe("the widget library in the editor", () => {
  test("every group is in the Elements panel; a Tabs widget inserts, and its rows edit live", async ({ page }) => {
    await openBuilder(page);
    const frame = siteFrame(page);
    await page.getByTestId("tab-elements").click();
    for (const type of ["icon", "video", "icon-box", "accordion", "tabs", "gallery", "carousel", "countdown", "price-table", "form", "html"]) await expect(page.getByTestId(`element-${type}`)).toBeVisible();
    await frame.locator(".ae-txtbuild").click();
    await page.getByTestId("tab-elements").click();
    await page.getByTestId("element-tabs").click();
    const tabs = frame.locator(".ae-tabs");
    await expect(tabs).toHaveCount(1);
    await expect(tabs.getByRole("tab")).toHaveCount(3);
    // Rows: rename the second tab and add a fourth from the Content tab.
    const rows = page.getByTestId("items-props.items");
    await rows.getByTestId("item-row").nth(1).getByRole("button", { name: "Second tab", exact: true }).click();
    await rows.getByLabel("Title").fill("Our process");
    await expect(tabs.getByRole("tab", { name: "Our process" })).toBeVisible();
    await rows.getByTestId("add-item").click();
    await expect(tabs.getByRole("tab")).toHaveCount(4);
    // With the widget selected, a click on a tab reaches it (the selection stays).
    await tabs.getByRole("tab", { name: "Our process" }).click();
    await expect(tabs.getByRole("tab", { name: "Our process" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("element-selection")).toHaveAttribute("data-element-id", (await tabs.getAttribute("data-ae-id")) ?? "");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(tabs.getByRole("tab")).toHaveCount(3);
  });

  test("a video is a click-to-load facade that never contacts the host from the editor", async ({ page }) => {
    const hosts: string[] = [];
    page.on("request", (request) => {
      if (/youtube|ytimg|vimeo/.test(request.url())) hosts.push(request.url());
    });
    await openBuilder(page);
    const frame = siteFrame(page);
    await frame.locator(".ae-txtbuild").click();
    await page.getByTestId("tab-elements").click();
    await page.getByTestId("element-video").click();
    await page.getByLabel("Address").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    const facade = frame.locator(".ae-video-facade");
    await expect(facade).toBeVisible();
    await expect(facade).toContainText("Plays from YouTube");
    await facade.click();
    await facade.click();
    await expect(frame.locator(".ae-video iframe")).toHaveCount(0);
    expect(hosts).toEqual([]);
  });

  test("clients never see the HTML embed", async ({ page }) => {
    await openEditor(page, { role: "client", editingLevel: "builder" });
    await waitForReady(page);
    await page.getByTestId("tab-elements").click();
    await expect(page.getByTestId("element-accordion")).toBeVisible();
    await expect(page.getByTestId("element-html")).toHaveCount(0);
  });
});

// --- milestone 6: pages and platform ----------------------------------------------------------------

test.describe("the builder publish", () => {
  test("layouts and site settings go out in one publish, and the canvas keeps them", async ({ page }) => {
    const state = await openBuilder(page);
    const frame = siteFrame(page);
    await frame.locator(".ae-hdbuilds").dblclick();
    await page.keyboard.press("End");
    await page.keyboard.type(" this year");
    await page.keyboard.press("Enter");
    await page.getByTestId("tab-site").click();
    await page.getByTestId("group-global-colours").getByTestId("color-text").first().fill("#aa0000");
    await expect(page.getByTestId("draft-status")).toContainText("2 unpublished changes");
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    const builderList = page.getByTestId("publish-builder");
    await expect(builderList).toContainText("Home");
    await expect(builderList).toContainText("Layout changed");
    await expect(builderList).toContainText("Site settings");
    await page.getByTestId("publish-confirm").click();
    await expect(page.getByTestId("publish-done")).toContainText("Published 2 changes");
    expect(state.builderPublishRequests).toHaveLength(1);
    const request = state.builderPublishRequests[0] as { layouts: Record<string, { root: unknown[] }>; kit: { colors: { primary: string } }; baseCommitSha: string };
    expect(Object.keys(request.layouts)).toEqual(["home"]);
    expect(JSON.stringify(request.layouts["home"])).toContain("Recent builds this year");
    expect(request.kit.colors.primary).toBe("#aa0000");
    expect(request.baseCommitSha).toMatch(/^[0-9a-f]{40}$/);
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("draft-status")).toContainText("Nothing to publish");
    await expect(frame.locator(".ae-hdbuilds")).toHaveText("Recent builds this year");
  });

  test("a layout conflict names the element and publishes with the person's choice", async ({ page }) => {
    const state = await openBuilder(page, { builderPublish: "conflict-once" });
    const frame = siteFrame(page);
    await frame.locator(".ae-hdbuilds").dblclick();
    await page.keyboard.press("End");
    await page.keyboard.type("!");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await page.getByTestId("publish-confirm").click();
    const conflict = page.getByTestId("publish-conflict");
    await expect(conflict).toContainText('Both you and someone else changed heading "Recent builds"');
    await expect(page.getByTestId("publish-with-choices")).toBeDisabled();
    await conflict.getByLabel("Keep mine").check();
    await page.getByTestId("publish-with-choices").click();
    await expect(page.getByTestId("publish-done")).toContainText("merged with theirs");
    expect((state.builderPublishRequests[1] as { resolutions: Record<string, string> }).resolutions).toEqual({ "layout:home:hdbuilds": "mine" });
  });
});
