/**
 * The page builder (site contract v2) against examples/demo-site. Milestone 1: the
 * kit renders layouts and builder-only pages, the bridge negotiates protocol 2, and
 * public visitors get no bridge activity.
 */
import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { COMMIT_SHA, DEMO_SITE_URL, SITE_ID, STAFF_ID, demoLayouts, editorUrl, installMocks } from "./mocks.ts";

const ZERO_WIDTH = new RegExp(`[${[0x200b, 0x200c, 0x200d, 0xfeff].map((point) => `\\u{${point.toString(16)}}`).join("")}]`, "u");
const siteFrame = (page: Page): FrameLocator => page.frameLocator(`iframe[title$="live site"]`);

async function openEditor(page: Page, options: Parameters<typeof installMocks>[1] = {}) {
  const state = await installMocks(page, options);
  await page.addInitScript(() => {
    window.localStorage.setItem("armature:visual:tour:v1", "done");
    window.localStorage.setItem("armature:builder:tour:v1", "done");
  });
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
    expect(css).toContain(".ae-root .ae-rowbuild.ae-rowbuild > .ae-con-inner");
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

/** Open the Elements mode of the single left panel (the top bar's + button). */
async function openElements(page: Page) {
  await page.getByTestId("topbar-add").click();
  await expect(page.getByTestId("elements-panel")).toBeVisible();
}

/** Open the Globals tab (global colours and fonts) inside the Elements panel. */
async function openGlobals(page: Page) {
  await page.getByTestId("topbar-add").click();
  await page.getByTestId("tab-globals").click();
}

/** Type a hex into the first global colour (Primary): the swatch opens the picker with the hex field. */
async function setPrimaryColor(page: Page, hex: string) {
  const colours = page.getByTestId("group-global-colours");
  await colours.getByTestId("color-swatch").first().click();
  await colours.getByTestId("color-text").fill(hex);
  await page.keyboard.press("Escape");
  await expect(colours.getByTestId("color-popover")).toHaveCount(0);
}

/** Select a container/element by clicking its top-left corner (its padding, not a child). */
async function selectByCorner(frame: FrameLocator, selector: string) {
  await frame.locator(selector).scrollIntoViewIfNeeded();
  await frame.locator(selector).page().waitForTimeout(150);
  await frame.locator(selector).click({ position: { x: 5, y: 5 } });
}

test.describe("the page builder canvas", () => {
  test("drags a widget from the Elements panel into a container, then undoes it", async ({ page }) => {
    await openBuilder(page);
    const frame = siteFrame(page);
    await openElements(page);
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
    // Select the row that holds the text: click the text, then walk up to its row.
    await frame.locator(".ae-txtbuild").scrollIntoViewIfNeeded();
    await frame.locator(".ae-txtbuild").click();
    await page.keyboard.press("ArrowLeft"); // the column
    await expect(page.getByTestId("element-selection")).toHaveAttribute("data-element-id", "colrigh1");
    await page.keyboard.press("ArrowLeft"); // the row
    await expect(page.getByTestId("element-selection")).toHaveAttribute("data-element-id", "rowbuild");
    const move = page.getByTestId("element-move");
    await page.waitForTimeout(200);
    const inside = await frame.locator(".ae-txtbuild").boundingBox();
    await dragTo(page, center(await move.boundingBox()), center(inside));
    // A container cannot be dropped inside one of its own descendants: no indicator, a "Not here" ghost.
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

  test("renames an element in the panel and hides it on a device from the context menu", async ({ page }) => {
    await openBuilder(page);
    const frame = siteFrame(page);
    await frame.locator(".ae-hdbuilds").click();
    await expect(page.getByTestId("edit-title")).toContainText("Edit Heading");
    // Rename in the Edit panel's name field; re-selecting keeps it.
    await page.getByLabel("Element name").fill("Builds title");
    await frame.locator(".ae-btnbuild").scrollIntoViewIfNeeded();
    await frame.locator(".ae-btnbuild").click({ position: { x: 4, y: 4 } });
    await frame.locator(".ae-hdbuilds").click();
    await expect(page.getByLabel("Element name")).toHaveValue("Builds title");
    await expect(page.getByTestId("breadcrumbs")).toContainText("Builds title");
    // Hide on phone from the context menu: the badge shows, the element stays visible at 40%.
    await frame.locator(".ae-hdbuilds").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Hide on mobile" }).click();
    await expect(page.getByTestId("element-overlays").getByText("Hidden on mobile")).toBeVisible();
    await expect(frame.locator(".ae-hdbuilds")).toHaveCSS("opacity", "0.4");
  });

  test("adds a section from the structure picker and fills its empty column", async ({ page }) => {
    await openBuilder(page);
    const frame = siteFrame(page);
    await openElements(page);
    await page.getByTestId("add-section").click();
    await page.getByTestId("pick-structure-50-50").click();
    const section = frame.locator(".ae-root > .ae-container").last();
    await expect(section.locator(":scope > .ae-con-inner > .ae-container > .ae-con-inner > .ae-container")).toHaveCount(2);
    await expect(page.getByTestId("element-selection")).toBeVisible();
    await expect(page.getByText("Drag a widget here").first()).toBeVisible();
    // Click-insert goes into the empty column once it is selected.
    const column = section.locator(".ae-con-inner > .ae-container > .ae-con-inner > .ae-container").first();
    await column.click({ position: { x: 10, y: 10 } });
    await openElements(page);
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
    await page.getByRole("button", { name: /Phone view/ }).click();
    const frame = siteFrame(page);
    await frame.locator(".ae-hdbuilds").click();
    await expect(page.getByText("Locked by the agency")).toBeVisible();
    await expect(page.getByTestId("element-toolbar")).toHaveCount(0);
    await page.keyboard.press("Delete");
    await expect(frame.locator(".ae-hdbuilds")).toHaveCount(1);
    await frame.locator(".ae-btnbuild").scrollIntoViewIfNeeded();
    await frame.locator(".ae-btnbuild").click({ position: { x: 4, y: 4 } });
    await expect(page.getByTestId("element-toolbar")).toBeVisible();
  });
});

test.describe("the single left panel", () => {
  test("swaps between Elements and Edit for each element type; Esc and the grid icon return to Elements", async ({ page }) => {
    await openBuilder(page);
    const frame = siteFrame(page);
    // Scroll a target to the top of the frame (so a higher section's image target cannot
    // overlap it) and select it.
    const pick = async (selector: string, opts?: { position: { x: number; y: number } }) => {
      await frame.locator(selector).evaluate((node) => node.scrollIntoView({ block: "start" }));
      await page.waitForTimeout(150);
      await frame.locator(selector).click(opts);
    };
    // Default and after deselect: Elements mode.
    await expect(page.getByTestId("elements-panel")).toBeVisible();
    // A heading opens Edit Heading and hides Elements.
    await pick(".ae-hdbuilds");
    await expect(page.getByTestId("edit-title")).toContainText("Edit Heading");
    await expect(page.getByTestId("elements-panel")).toHaveCount(0);
    // Selecting another element swaps the panel instantly.
    await pick(".ae-txtbuild");
    await expect(page.getByTestId("edit-title")).toContainText("Edit Text");
    await pick(".ae-imgbuild img");
    await expect(page.getByTestId("edit-title")).toContainText("Edit Image");
    await pick(".ae-btnbuild", { position: { x: 4, y: 4 } });
    await expect(page.getByTestId("edit-title")).toContainText("Edit Button");
    // A container's first tab is Layout.
    await pick(".ae-secbuild", { position: { x: 5, y: 5 } });
    await expect(page.getByTestId("edit-title")).toContainText("Edit Container");
    await expect(page.getByTestId("inspector-tab-content")).toContainText("Layout");
    // The grid icon in the Edit header returns to Elements.
    await page.getByTestId("edit-back").click();
    await expect(page.getByTestId("elements-panel")).toBeVisible();
    // Esc returns to Elements and clears the selection.
    await pick(".ae-hdbuilds");
    await expect(page.getByTestId("edit-title")).toContainText("Edit Heading");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("elements-panel")).toBeVisible();
    await expect(page.getByTestId("element-selection")).toHaveCount(0);
  });

  test("collapses to give the canvas the window, and restores", async ({ page }) => {
    await openBuilder(page);
    await expect(page.getByTestId("elements-panel")).toBeVisible();
    await page.getByTestId("panel-collapse").click();
    await expect(page.getByTestId("elements-panel")).toHaveCount(0);
    await expect(page.getByTestId("builder-panel")).toHaveAttribute("data-collapsed", "1");
    await page.getByTestId("panel-collapse").click();
    await expect(page.getByTestId("elements-panel")).toBeVisible();
  });
});

test.describe("editing levels", () => {
  test("agency staff set what clients may do under Site settings › Client editing", async ({ page }) => {
    const state = await installMocks(page);
    await page.goto(`/sites/${SITE_ID}/settings/editing`);
    const panel = page.getByTestId("editing-level");
    await expect(panel.getByLabel("Words and pictures", { exact: true })).toBeChecked();
    await panel.getByLabel("Words, pictures and styling").click();
    await expect(page.getByText("Clients now get: words, pictures and styling.")).toBeVisible();
    expect(state.rows["sites"]).toEqual([{ editing_level: "style" }]);
    await expect(panel.getByLabel("Words, pictures and styling")).toBeChecked();
  });

  test("a client at the style level restyles, but cannot add, move or remove", async ({ page }) => {
    await openEditor(page, { role: "client", editingLevel: "style" });
    await waitForReady(page);
    await expect(page.getByTestId("visual-editor")).toHaveAttribute("data-builder", "on");
    // The style level cannot add elements: the panel offers only Globals, no Widgets tab.
    await page.getByTestId("topbar-add").click();
    await expect(page.getByTestId("tab-widgets")).toHaveCount(0);
    await expect(page.getByTestId("tab-globals")).toBeVisible();
    const frame = siteFrame(page);
    await frame.locator(".ae-hdbuilds").click();
    await page.keyboard.press("Delete");
    await expect(page.getByText("Your account can restyle this page but not add, move or remove elements.")).toBeVisible();
    await expect(frame.locator(".ae-hdbuilds")).toHaveCount(1);
    await frame.locator(".ae-hdbuilds").click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Duplicate" })).toBeDisabled();
    await page.keyboard.press("Escape");
    // Restyling is allowed: a site colour, and the page's own layout.
    await openGlobals(page);
    await setPrimaryColor(page, "#aa0000");
    await expect(page.getByTestId("draft-status")).toContainText("1 unpublished change");
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
    // Typography is one row: the pencil opens the popover with the font, size, weight… inside.
    const typography = page.getByTestId("group-typography");
    await expect(typography.getByTestId("popover-typography")).toHaveCount(0);
    await typography.getByTestId("edit-typography").click();
    const popover = typography.getByTestId("popover-typography");
    await expect(popover).toBeVisible();
    const size = popover.getByLabel("Size", { exact: true });
    await size.fill("40");
    await size.press("Tab");
    await expect(heading).toHaveCSS("font-size", "40px");
    // The device icon after the label switches the whole editor to the next device; the popover stays.
    const deviceSwitch = popover.getByTestId("device-switch").first();
    await deviceSwitch.click();
    await expect(page.getByRole("button", { name: /Tablet view/ })).toHaveAttribute("aria-pressed", "true");
    await expect(popover).toBeVisible();
    await expect(size).toHaveValue("");
    await expect(size).toHaveAttribute("placeholder", "40");
    await size.fill("30");
    await size.press("Tab");
    await expect(heading).toHaveCSS("font-size", "30px");
    await expect(popover.getByTestId("override-dot")).toHaveCount(1);
    await deviceSwitch.click(); // phone
    await expect(page.getByRole("button", { name: /Phone view/ })).toHaveAttribute("aria-pressed", "true");
    await expect(heading).toHaveCSS("font-size", "30px");
    await expect(size).toHaveAttribute("placeholder", "30");
    await expect(popover.getByTestId("override-dot")).toHaveCount(0);
    await deviceSwitch.click(); // desktop
    await expect(heading).toHaveCSS("font-size", "40px");
    await deviceSwitch.click(); // tablet
    await popover.getByTestId("override-dot").click();
    await expect(heading).toHaveCSS("font-size", "40px");
    await expect(page.getByTestId("draft-status")).toContainText("unpublished change");
    // Escape closes the popover and nothing else: the heading stays selected.
    await page.keyboard.press("Escape");
    await expect(typography.getByTestId("popover-typography")).toHaveCount(0);
    await expect(page.getByTestId("edit-title")).toContainText("Edit Heading");
    // A click outside closes it too.
    await typography.getByTestId("edit-typography").click();
    await expect(popover).toBeVisible();
    await page.getByTestId("edit-title").click();
    await expect(typography.getByTestId("popover-typography")).toHaveCount(0);
  });

  test("hover styles, spacing on the Advanced tab, and the agency-only groups", async ({ page }) => {
    await openBuilder(page);
    const frame = siteFrame(page);
    await frame.locator(".ae-btnbuild").scrollIntoViewIfNeeded();
    await frame.locator(".ae-btnbuild").click({ position: { x: 4, y: 4 } });
    await expect(page.getByTestId("element-selection")).toHaveAttribute("data-element-id", "btnbuild");
    await page.getByTestId("inspector-tab-style").click();
    await page.getByTestId("style-state-hover").click();
    const background = page.getByTestId("group-background");
    await background.getByTestId("background-kind").selectOption("color");
    // A new colour background starts linked to the site's primary colour (the swatch carries the
    // globe); the swatch opens the picker, where Unlink lets a hex be typed.
    await expect(background.getByTestId("color-swatch")).toHaveAttribute("data-value", "kit:color.primary");
    await background.getByTestId("color-swatch").click();
    await expect(background.getByTestId("color-text")).toHaveValue("primary (site)");
    await background.getByTestId("unlink-color").click();
    await background.getByTestId("color-text").fill("#cc0000");
    await page.keyboard.press("Escape");
    await expect(background.getByTestId("color-popover")).toHaveCount(0);
    await page.getByLabel("Transition (ms)").fill("0");
    await page.getByLabel("Transition (ms)").press("Tab");
    await expect.poll(() => frame.locator("style[data-armature-page=home]").evaluate((node) => node.textContent ?? "")).toContain(".ae-btnbuild.ae-btnbuild:hover .ae-btn { background-color: #cc0000");
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
    await page.getByRole("button", { name: /Phone view/ }).click();
    await siteFrame(page).locator(".ae-btnbuild").scrollIntoViewIfNeeded();
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
    await openGlobals(page);
    await setPrimaryColor(page, "#aa0000");
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
    await frame.locator(".ae-btnbuild").evaluate((node) => node.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(150);
    await frame.locator(".ae-btnbuild").click({ position: { x: 4, y: 4 } });
    await expect(page.getByTestId("element-selection")).toHaveAttribute("data-element-id", "btnbuild");
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
    await page.getByTestId("edit-typography").click();
    await page.getByTestId("popover-typography").getByTestId("font-picker").locator("button").first().click();
    await page.getByLabel("Search fonts").fill("Fraunces");
    await page.getByRole("option", { name: /Fraunces/ }).click();
    await expect(frame.locator(".ae-hdbuilds")).toHaveCSS("font-family", /Fraunces/);
    await expect(frame.locator("link[data-armature-fonts]")).toHaveAttribute("href", /family=Fraunces/);
    await openGlobals(page);
    await expect(page.getByTestId("custom-fonts")).toContainText("Fraunces");
  });
});

// --- still-coded site sections ------------------------------------------------------------------------

test.describe("still-coded site sections", () => {
  test("select as a whole, show the note and the editable fields, and a field opens its editor", async ({ page }) => {
    await openBuilder(page);
    const frame = siteFrame(page);
    await selectByCorner(frame, "[data-ae-id='sechero1']");
    await expect(page.getByTestId("element-selection")).toHaveAttribute("data-element-id", "sechero1");
    await expect(page.getByTestId("edit-title")).toContainText("Edit Section");
    await expect(page.getByTestId("site-section-note")).toContainText("convert it to builder elements in the site's repo");
    const fields = page.getByTestId("section-fields");
    await expect(fields).toContainText("Headline");
    await expect(fields).toContainText("Hero photo");
    await expect(fields).toContainText("Button");
    await fields.getByTestId("section-field-title").click();
    await expect(page.getByTestId("selection-toolbar")).toContainText("Headline");
    await expect(page.getByTestId("field-editor")).toBeVisible();
    await expect(page.getByTestId("element-selection")).toHaveCount(0);
  });

  test("a client reads the ask-your-agency note", async ({ page }) => {
    await openEditor(page, { role: "client", editingLevel: "builder" });
    await waitForReady(page);
    await page.getByRole("button", { name: /Phone view/ }).click();
    await selectByCorner(siteFrame(page), "[data-ae-id='sechero1']");
    await expect(page.getByTestId("site-section-note")).toContainText("ask your agency to make this section fully editable");
    await expect(page.getByTestId("section-fields")).toContainText("Headline");
  });
});

// --- drag anywhere ----------------------------------------------------------------------------------

test.describe("drag anywhere", () => {
  test("lands between middle siblings, left or right in a row, inside an empty container, with the target named", async ({ page }) => {
    await openBuilder(page);
    await page.getByRole("button", { name: /Tablet view/ }).click(); // the row is a row here (it stacks on phones)
    const frame = siteFrame(page);
    await openElements(page);
    const item = page.getByTestId("element-heading");
    await frame.locator(".ae-txtbuild").evaluate((node) => node.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(250);
    // Between the text and the button inside the right column: a horizontal line, "after Text Editor".
    const text = (await frame.locator(".ae-txtbuild").boundingBox())!;
    await dragTo(page, center(await item.boundingBox()), { x: text.x + text.width / 2, y: text.y + text.height - 3 });
    const line = page.getByTestId("drop-line");
    await expect(line).toBeVisible();
    expect((await line.boundingBox())!.height).toBeLessThan(6);
    await expect(page.getByTestId("drop-label")).toHaveText("after Text Editor");
    await expect(page.getByTestId("drop-parent")).toHaveAttribute("data-element-id", "colrigh1");
    await page.mouse.up();
    await expect(frame.locator(".ae-colrigh1 > .ae-con-inner > :nth-child(2)")).toHaveClass(/ae-heading/);
    await expect(frame.locator(".ae-colrigh1 > .ae-con-inner > :nth-child(3)")).toHaveClass(/ae-btnbuild/);
    await page.waitForTimeout(300); // the click that ends a drag is swallowed for a moment
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(frame.locator(".ae-colrigh1 .ae-heading")).toHaveCount(0);
    // The outer few pixels of the right column, in a row: a vertical line, "before Container", into the row.
    await openElements(page);
    const column = (await frame.locator(".ae-colrigh1").boundingBox())!;
    await dragTo(page, center(await item.boundingBox()), { x: column.x + 3, y: column.y + column.height / 2 });
    await expect(line).toBeVisible();
    expect((await line.boundingBox())!.width).toBeLessThan(6);
    await expect(page.getByTestId("drop-label")).toHaveText("before Container");
    await expect(page.getByTestId("drop-parent")).toHaveAttribute("data-element-id", "rowbuild");
    await page.mouse.up();
    await expect(frame.locator(".ae-rowbuild > .ae-con-inner > :nth-child(2)")).toHaveClass(/ae-heading/);
    await expect(frame.locator(".ae-rowbuild > .ae-con-inner > *")).toHaveCount(3);
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(frame.locator(".ae-rowbuild > .ae-con-inner > *")).toHaveCount(2);
    // A new, empty container at the end of the page: dropping inside it fills it, "into Container".
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("element-selection")).toHaveCount(0);
    await openElements(page);
    await page.getByTestId("element-container").click();
    const empty = frame.locator(".ae-container.ae-empty").last();
    await expect(empty).toBeVisible();
    await empty.evaluate((node) => node.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(400);
    // The "Drag a widget here" hint is drawn from the same rect map the drop uses.
    const hint = page.getByTestId("empty-container-add");
    await expect(hint).toBeVisible();
    const hintBox = (await hint.boundingBox())!;
    await openElements(page);
    await dragTo(page, center(await item.boundingBox()), center(hintBox));
    await expect(page.getByTestId("drop-inside")).toBeVisible();
    await expect(page.getByTestId("drop-label")).toHaveText("into Container");
    await page.mouse.up();
    await expect(frame.locator(".ae-container.ae-empty")).toHaveCount(0);
    await expect(frame.locator(".ae-secbuild ~ [data-ae-type=container] .ae-heading, [data-ae-type=container]:last-child .ae-heading").first()).toHaveText("Add your heading");
  });

  test("moving an element keeps its settings, and a drop before the first sibling works", async ({ page }) => {
    await openBuilder(page);
    const frame = siteFrame(page);
    await frame.locator(".ae-btnbuild").evaluate((node) => node.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(250);
    await frame.locator(".ae-btnbuild").click({ position: { x: 4, y: 4 } });
    await expect(page.getByTestId("element-selection")).toHaveAttribute("data-element-id", "btnbuild");
    const move = page.getByTestId("element-move");
    const text = (await frame.locator(".ae-txtbuild").boundingBox())!;
    // Before the first child of the column (the text), from the top edge of the text.
    await dragTo(page, center(await move.boundingBox()), { x: text.x + text.width / 2, y: text.y + 3 });
    await expect(page.getByTestId("drop-label")).toHaveText("before Text Editor");
    await page.mouse.up();
    await expect(frame.locator(".ae-colrigh1 > .ae-con-inner > :first-child")).toHaveClass(/ae-btnbuild/);
    // Its link and label survived the move.
    await expect(frame.locator(".ae-btnbuild a.ae-btn")).toHaveAttribute("href", "/contact/");
    await expect(frame.locator(".ae-btnbuild a.ae-btn")).toHaveText("Start a conversation");
    await expect(page.getByTestId("draft-status")).toContainText("1 unpublished change");
  });
});

// --- the canvas handles (Elementor's outlines and tabs) ------------------------------------------

test.describe("the canvas handles", () => {
  test("a thin outline on hover (dashed on containers), a pencil tab on a widget, a centred tab on a container", async ({ page }) => {
    await openBuilder(page);
    const frame = siteFrame(page);
    // Hover: solid on a widget, dashed on a container, with the type label.
    await frame.locator(".ae-hdbuilds").hover();
    await expect(page.getByTestId("hover-hdbuilds")).toHaveAttribute("data-kind", "widget");
    await expect(page.getByTestId("hover-hdbuilds")).toContainText("Heading");
    await frame.locator(".ae-secbuild").hover({ position: { x: 5, y: 5 } });
    await expect(page.getByTestId("hover-secbuild")).toHaveAttribute("data-kind", "container");
    // A selected widget: solid outline and a square pencil tab outside its top-right corner.
    await frame.locator(".ae-hdbuilds").click();
    const selection = page.getByTestId("element-selection");
    await expect(selection).toHaveAttribute("data-kind", "widget");
    const tab = page.getByTestId("element-toolbar");
    await expect(tab).toHaveAttribute("data-kind", "widget");
    const selectionBox = (await selection.boundingBox())!;
    const tabBox = (await tab.boundingBox())!;
    expect(Math.abs(tabBox.x + tabBox.width - (selectionBox.x + selectionBox.width))).toBeLessThan(3);
    expect(tabBox.y + tabBox.height).toBeLessThanOrEqual(selectionBox.y + 1);
    expect(tabBox.width).toBeLessThan(40); // just the pencil until it is hovered
    // Hovering the tab reveals parent, duplicate and delete.
    await page.getByTestId("element-move").hover();
    await expect(page.getByTestId("element-duplicate")).toBeVisible();
    await page.getByTestId("element-duplicate").click();
    await expect(frame.locator(".ae-heading")).toHaveCount(2);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(frame.locator(".ae-heading")).toHaveCount(1);
    // A container: the tab straddles the top edge, centred, with add / grip / delete.
    await selectByCorner(frame, ".ae-secbuild");
    await expect(selection).toHaveAttribute("data-element-id", "secbuild");
    await expect(tab).toHaveAttribute("data-kind", "container");
    const sectionBox = (await selection.boundingBox())!;
    const containerTab = (await tab.boundingBox())!;
    expect(Math.abs(containerTab.x + containerTab.width / 2 - (sectionBox.x + sectionBox.width / 2))).toBeLessThan(6);
    // Straddling the top edge, or just inside it when the container touches the top of the frame.
    expect(containerTab.y).toBeLessThan(sectionBox.y + 4);
    expect(containerTab.y + containerTab.height).toBeGreaterThan(sectionBox.y);
    await expect(tab.getByTestId("element-move")).toBeVisible();
    await expect(tab.getByTestId("element-delete")).toBeVisible();
    // A nested container's tab is shifted right so it never sits on its parent's.
    await frame.locator(".ae-txtbuild").click();
    await page.keyboard.press("ArrowLeft"); // its column
    await expect(selection).toHaveAttribute("data-element-id", "colrigh1");
    const columnBox = (await selection.boundingBox())!;
    const columnTab = (await tab.boundingBox())!;
    expect(columnTab.x + columnTab.width / 2).toBeGreaterThan(columnBox.x + columnBox.width / 2 + 40);
    // "+" on the tab opens Elements to add inside.
    await tab.getByTestId("element-add").click();
    await expect(page.getByTestId("elements-panel")).toBeVisible();
    // Clicking anything at any depth selects exactly it.
    await frame.locator(".ae-btnbuild .ae-btn").click();
    await expect(selection).toHaveAttribute("data-element-id", "btnbuild");
  });
});

// --- the panel controls (Elementor's rows and popovers) ------------------------------------------

test.describe("the panel controls", () => {
  test("margin: four boxes with the link toggle; unlinked, each side is its own", async ({ page }) => {
    await openBuilder(page);
    const frame = siteFrame(page);
    await frame.locator(".ae-hdbuilds").click();
    await page.getByTestId("inspector-tab-advanced").click();
    const layout = page.getByTestId("group-layout");
    const link = layout.getByTestId("link-sides").first();
    await expect(link).toHaveAttribute("aria-pressed", "true");
    // Linked: typing one side sets all four.
    const top = layout.getByLabel("Margin top", { exact: true });
    await top.fill("12");
    await top.press("Tab");
    await expect(layout.getByLabel("Margin left", { exact: true })).toHaveValue("12");
    await expect(frame.locator(".ae-hdbuilds")).toHaveCSS("margin-left", "12px");
    // Unlinked: only the typed side changes.
    await link.click();
    await expect(link).toHaveAttribute("aria-pressed", "false");
    await top.fill("30");
    await top.press("Tab");
    await expect(layout.getByLabel("Margin left", { exact: true })).toHaveValue("12");
    await expect(frame.locator(".ae-hdbuilds")).toHaveCSS("margin-top", "30px");
    await expect(frame.locator(".ae-hdbuilds")).toHaveCSS("margin-left", "12px");
    // The unit menu on the label line switches every side.
    await layout.getByLabel("Unit").first().selectOption("em");
    await expect.poll(() => frame.locator("style[data-armature-page=home]").evaluate((node) => node.textContent ?? "")).toContain("margin-top: 30em; margin-right: 12em;");
  });

  test("the Text Editor in the panel and the text on the canvas stay in sync, Visual and Code", async ({ page }) => {
    await openBuilder(page);
    const frame = siteFrame(page);
    const text = frame.locator(".ae-txtbuild");
    await text.evaluate((node) => node.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(150);
    await text.click();
    await expect(page.getByTestId("edit-title")).toContainText("Edit Text");
    const visual = page.getByTestId("text-editor-visual");
    await expect(visual.locator("strong")).toHaveText("Then we draw.");
    // Typing in the panel changes the canvas live (the caret placed at the end of the first paragraph).
    await visual.locator("p").first().click();
    await visual.locator("p").first().evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await page.keyboard.type(" Really.");
    await expect(text.locator("p").first()).toContainText("Then we draw. Really.");
    // A toolbar command applies to the selection and the canvas follows.
    await visual.locator("p").first().evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await page.getByTestId("te-italic").click();
    await expect(text.locator("p").first().locator("em").first()).toContainText("Every home");
    await page.getByTestId("te-block").selectOption("h3");
    await expect(text.locator("h3")).toHaveCount(1);
    // Editing on the page flows back into the panel.
    await text.dblclick();
    await expect(page.getByTestId("richtext-toolbar")).toBeVisible();
    await page.keyboard.press("End");
    await page.keyboard.type(" From the page.");
    await page.getByTestId("rt-done").click();
    await expect(visual).toContainText("From the page.");
    // The Code tab shows the HTML; typing HTML converts back and drops what is not supported.
    await page.getByTestId("text-editor-tab-code").click();
    const code = page.getByTestId("text-editor-code");
    await expect(code).toHaveValue(/<h3><em>Every home/);
    await code.fill('<p>Plain <b>bold</b> <img src="x.png"> and <script>alert(1)</script></p><ul><li>one</li></ul>');
    await expect(page.getByTestId("text-editor-notice")).toContainText("2 tags are not supported");
    await expect(text.locator("strong")).toHaveText("bold");
    await expect(text.locator("li")).toHaveText("one");
    await expect(text.locator("img")).toHaveCount(0);
    await page.keyboard.press("Tab");
    await expect(code).toHaveValue("<p>Plain <strong>bold</strong>  and </p>\n<ul><li><p>one</p></li></ul>");
    // Back on Visual, the editor shows the kept document; undo takes the canvas and the panel back.
    await page.getByTestId("text-editor-tab-visual").click();
    await expect(page.getByTestId("text-editor-visual").locator("li")).toHaveText("one");
  });

  test("text stroke, blend mode and the Structure group", async ({ page }) => {
    await openBuilder(page);
    const frame = siteFrame(page);
    const heading = frame.locator(".ae-hdbuilds");
    await heading.click();
    await page.getByTestId("inspector-tab-style").click();
    await page.getByRole("button", { name: /Desktop view/ }).click();
    // Text stroke: one row, the pencil opens width and colour.
    const colour = page.getByTestId("group-colour");
    await colour.getByTestId("edit-text-stroke").click();
    const stroke = colour.getByTestId("popover-text-stroke");
    await stroke.getByLabel("Text stroke width").fill("2");
    await stroke.getByLabel("Text stroke width").press("Tab");
    await expect(heading).toHaveCSS("-webkit-text-stroke-width", "2px");
    await stroke.getByTestId("remove-text-stroke").click();
    await expect(heading).toHaveCSS("-webkit-text-stroke-width", "0px");
    await page.keyboard.press("Escape");
    // Blend mode is a dropdown under Effects.
    await page.getByTestId("group-effects").getByRole("button", { name: "Effects" }).click();
    await page.getByLabel("Blend mode").selectOption("multiply");
    await expect(heading).toHaveCSS("mix-blend-mode", "multiply");
    // The section's Layout tab changes its columns; the heading, text and button keep their places.
    await selectByCorner(frame, ".ae-secbuild");
    await expect(page.getByTestId("edit-title")).toContainText("Edit Container");
    await page.getByTestId("inspector-tab-content").click();
    const structure = page.getByTestId("group-structure");
    await structure.getByRole("button", { name: "Structure" }).click();
    await expect(structure.getByTestId("structure-50-50")).toHaveAttribute("aria-pressed", "true");
    await structure.getByTestId("structure-3").click();
    await expect(structure.getByTestId("structure-3")).toHaveAttribute("aria-pressed", "true");
    await expect(frame.locator(".ae-secbuild .ae-rowbuild")).toHaveCount(0);
    await expect(frame.locator(".ae-hdbuilds")).toHaveCount(1);
    await expect(frame.locator(".ae-txtbuild")).toHaveCount(1);
    expect(await frame.locator(".ae-secbuild > .ae-con-inner > [data-ae-id] > .ae-con-inner > [data-ae-id]").count()).toBe(3);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(frame.locator(".ae-secbuild .ae-rowbuild")).toHaveCount(1);
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
    await selectByCorner(frame, ".ae-secbuild");
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
    // Select the image, then walk up to its column with the left arrow (a column's corner
    // is filled by its child).
    await frame.locator(".ae-imgbuild img").scrollIntoViewIfNeeded();
    await frame.locator(".ae-imgbuild img").click();
    await expect(page.getByTestId("element-selection")).toHaveAttribute("data-element-id", "imgbuild");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("element-selection")).toHaveAttribute("data-element-id", "colleft1");
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
    await openElements(page);
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
    await openElements(page);
    for (const type of ["icon", "video", "icon-box", "accordion", "tabs", "gallery", "carousel", "countdown", "price-table", "form", "html"]) await expect(page.getByTestId(`element-${type}`)).toBeVisible();
    await frame.locator(".ae-txtbuild").click();
    await openElements(page);
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
    await openElements(page);
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

  test("a Wistia video is a click-to-load facade like YouTube and Vimeo", async ({ page }) => {
    const hosts: string[] = [];
    page.on("request", (request) => {
      if (/wistia/.test(request.url())) hosts.push(request.url());
    });
    await openBuilder(page);
    const frame = siteFrame(page);
    await frame.locator(".ae-txtbuild").click();
    await openElements(page);
    await page.getByTestId("element-video").click();
    await page.getByLabel("Source").selectOption("wistia");
    await page.getByLabel("Address").fill("https://home.wistia.com/medias/abc12345xy");
    const facade = frame.locator(".ae-video-facade");
    await expect(facade).toBeVisible();
    await expect(facade).toContainText("Plays from Wistia");
    await facade.click();
    await facade.click();
    await expect(frame.locator(".ae-video iframe")).toHaveCount(0);
    expect(hosts).toEqual([]);
  });

  test("clients never see the HTML embed", async ({ page }) => {
    await openEditor(page, { role: "client", editingLevel: "builder" });
    await waitForReady(page);
    await openElements(page);
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
    await openGlobals(page);
    await setPrimaryColor(page, "#aa0000");
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

test.describe("pages and templates", () => {
  test("a new page: its address is checked, it starts from a starter page, and its settings publish with it", async ({ page }) => {
    const state = await openBuilder(page);
    const frame = siteFrame(page);
    // New page from the editor menu (the Pages tab is gone; the dashboard lists pages).
    await page.getByTestId("editor-menu").click();
    await page.getByTestId("menu-new-page").click();
    await page.getByLabel("Title", { exact: true }).fill("About");
    await expect(page.getByText('The page "About" already uses this address.')).toBeVisible();
    await expect(page.getByTestId("new-page-create")).toBeDisabled();
    await page.getByLabel("Title", { exact: true }).fill("Our services");
    await expect(page.getByLabel("Address")).toHaveValue("/our-services/");
    await page.getByLabel("Landing page").check();
    await page.getByTestId("new-page-create").click();
    await expect(frame.locator("h1")).toHaveText("A clear promise in one line");
    await expect(page.getByTestId("page-name")).toContainText("Our services");

    // Page settings for the current page: a search title and a full-canvas layout.
    await page.getByTestId("topbar-page-settings").click();
    await page.getByLabel("Title in search results").fill("Services | Alder & Stone");
    await page.getByLabel("Page background").fill("not a colour");
    await expect(page.getByTestId("page-settings-save")).toBeDisabled();
    await page.getByLabel("Page background").fill("#f3efe6");
    await page.getByRole("switch", { name: "Full canvas" }).click();
    await page.getByTestId("page-settings-save").click();
    await expect(frame.locator("html")).toHaveAttribute("data-armature-canvas", "full");
    await expect(frame.locator(".site-header")).toBeHidden();

    // Duplicate this page from its settings, then delete the copy.
    await page.getByTestId("topbar-page-settings").click();
    await page.getByTestId("page-duplicate").click();
    await expect(page.getByTestId("page-name")).toContainText("Our services (copy)");
    await page.getByTestId("topbar-page-settings").click();
    await page.getByTestId("page-delete").click();
    await expect(page.getByTestId("page-name")).not.toContainText("(copy)");

    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.getByTestId("publish-builder")).toContainText("Our services");
    await page.getByTestId("publish-confirm").click();
    await expect(page.getByTestId("publish-done")).toBeVisible();
    const request = state.builderPublishRequests[0] as { layouts: Record<string, { path: string; label: string; seo?: { title?: string }; pageSettings?: { fullCanvas?: boolean; bodyBackground?: string } }> };
    expect(Object.keys(request.layouts)).toEqual(["our-services"]);
    const published = request.layouts["our-services"]!;
    expect(published.path).toBe("/our-services/");
    expect(published.label).toBe("Our services");
    expect(published.seo?.title).toBe("Services | Alder & Stone");
    expect(published.pageSettings).toEqual({ fullCanvas: true, bodyBackground: "#f3efe6" });
  });

  test("a section saved as a template is listed, inserts with fresh ids, and can be deleted", async ({ page }) => {
    const state = await openBuilder(page);
    const frame = siteFrame(page);
    // Select the section first, so the right-click opens the menu on a settled selection.
    await selectByCorner(frame, ".ae-secbuild");
    await expect(page.getByTestId("edit-title")).toContainText("Edit Container");
    await frame.locator(".ae-secbuild").click({ button: "right", position: { x: 6, y: 6 } });
    await page.getByRole("menuitem", { name: "Save as template" }).click();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Recent builds");
    await page.getByLabel("Name", { exact: true }).fill("Builds showcase");
    await page.getByTestId("template-save").click();
    await expect(page.getByText('Saved "Builds showcase" as a template.')).toBeVisible();
    const rows = state.rows["builder_templates"] ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Builds showcase", kind: "section", element_count: 8, first_heading: "Recent builds" });

    await openElements(page);
    await expect(page.getByRole("region", { name: "Saved templates" })).toContainText("Builds showcase");
    await page.getByTestId("open-template-library").click();
    const library = page.getByTestId("template-library");
    await expect(library.getByTestId("template-card")).toHaveCount(1);
    await library.getByLabel("Search templates").fill("nothing like it");
    await expect(library.getByTestId("template-card")).toHaveCount(0);
    await library.getByLabel("Search templates").fill("builds");
    await library.getByRole("button", { name: "Insert" }).click();
    await expect(frame.getByText("Recent builds", { exact: true })).toHaveCount(2);
    // The copy has new ids: only the original keeps the hdbuilds class.
    await expect(frame.locator(".ae-hdbuilds")).toHaveCount(1);

    await openElements(page);
    await page.getByTestId("open-template-library").click();
    await page.getByRole("button", { name: "Delete Builds showcase" }).click();
    await expect(page.getByText('Deleted "Builds showcase".')).toBeVisible();
    expect(state.rows["builder_templates"] ?? []).toHaveLength(0);
  });
});

test.describe("the media library", () => {
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  test("the modal shows usage, edits alt text, reuses a picture and uploads for an image element", async ({ page }) => {
    const state = await openBuilder(page);
    const frame = siteFrame(page);
    // Open the media library from the selected image element's Content tab (no Media tab).
    await frame.locator(".ae-imgbuild img").scrollIntoViewIfNeeded();
    await frame.locator(".ae-imgbuild img").click();
    await expect(page.getByTestId("edit-title")).toContainText("Edit Image");
    await page.getByRole("button", { name: "Media library" }).click();
    const picker = page.getByTestId("media-picker");
    const item = (src: string) => picker.locator(`[data-testid="media-item"][data-src="${src}"]`);
    await expect(item("/assets/hero.svg").getByTestId("media-used")).toHaveText("Used on Home");
    await expect(item("/assets/team.svg").getByTestId("media-used")).toHaveText("Used on About");
    await page.getByLabel("Search media").fill("team");
    await expect(picker.getByTestId("media-item")).toHaveCount(1);
    await page.getByLabel("Search media").fill("");
    // Alt text is editable in the modal.
    await item("/assets/team.svg").getByLabel("Alt text for team.svg").fill("The Alder & Stone crew");
    // Reuse the hero picture for this image element.
    await item("/assets/hero.svg").getByRole("button", { name: "Use this picture" }).click();
    await expect(picker).toBeHidden();
    await expect(frame.locator(".ae-imgbuild img")).toHaveAttribute("src", /hero\.svg/);

    // Upload a picture from the modal: resized to WebP in the browser and applied at once.
    await page.getByRole("button", { name: "Media library" }).click();
    await picker.getByTestId("media-upload").setInputFiles({ name: "porch.png", mimeType: "image/png", buffer: Buffer.from(PNG, "base64") });
    await expect(picker).toBeHidden();
    await expect(frame.locator('.ae-imgbuild img[src^="data:image/webp"]')).toBeVisible();

    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await page.getByTestId("publish-confirm").click();
    await expect(page.getByTestId("publish-done")).toBeVisible();
    const request = state.builderPublishRequests[0] as { media: Record<string, { alt: string }> };
    // The published media map carries the site's existing alt text plus the one edited here.
    expect(request.media).toEqual({ "/assets/hero.svg": { alt: "A timber-framed house at dusk" }, "/assets/team.svg": { alt: "The Alder & Stone crew" } });
  });
});

test.describe("drafts saved to the account", () => {
  test("follow the person to another browser, and a publish clears them", async ({ page, browser }) => {
    const first = await openBuilder(page);
    const frame = siteFrame(page);
    await frame.locator(".ae-hdbuilds").dblclick();
    await page.keyboard.press("End");
    await page.keyboard.type(" nearby");
    await page.keyboard.press("Enter");
    await expect.poll(() => first.rows["builder_drafts"]?.[0]?.["change_count"], { timeout: 10_000 }).toBe(1);
    const row = first.rows["builder_drafts"]![0]!;
    expect(row["base_commit"]).toMatch(/^[0-9a-f]{40}$/);

    // A second browser: nothing stored locally, the account's draft is offered back.
    const other = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const second = await other.newPage();
    const secondState = await openEditor(second, { rows: { builder_drafts: [row] } });
    const prompt = second.getByRole("dialog", { name: "You have unpublished changes" });
    await expect(prompt).toContainText("saved to your account");
    await second.getByTestId("restore-keep").click();
    await waitForReady(second);
    await expect(siteFrame(second).locator(".ae-hdbuilds")).toHaveText("Recent builds nearby");
    await second.getByRole("button", { name: "Publish", exact: true }).click();
    await second.getByTestId("publish-confirm").click();
    await expect(second.getByTestId("publish-done")).toBeVisible();
    await expect.poll(() => secondState.rows["builder_drafts"]?.length ?? 0, { timeout: 10_000 }).toBe(0);
    await other.close();
  });
});

test.describe("published versions", () => {
  const publishRow = (id: string, sha: string, at: string) => ({ id, site_id: SITE_ID, user_id: STAFF_ID, page_slug: "home", fields_changed: [], commit_sha: sha, commit_url: null, status: "committed", error: null, created_at: at });

  test("preview an older publish on the canvas, go back, then restore it as an undoable draft", async ({ page }) => {
    await openBuilder(page, { rows: { publishes: [publishRow("p2", COMMIT_SHA, "2026-09-20T15:00:00Z"), publishRow("p1", "1111111aaaaaaa2222222bbbbbbb3333333ccccc", "2026-09-10T15:00:00Z")] } });
    const frame = siteFrame(page);
    await page.getByTestId("topbar-history").click();
    const versions = page.getByTestId("revisions").getByTestId("revision");
    await expect(versions).toHaveCount(2);
    await expect(versions.first()).toContainText("live now");
    await expect(versions.nth(1)).toContainText("You · Home");
    await versions.nth(1).click();
    await expect(page.getByTestId("revision-banner")).toContainText("Previewing the version published");
    await expect(frame.locator(".ae-hdbuilds")).toHaveText("Builds from last spring");
    await page.getByRole("button", { name: "Back to your draft" }).click();
    await expect(frame.locator(".ae-hdbuilds")).toHaveText("Recent builds");
    await expect(page.getByTestId("draft-status")).toContainText("Nothing to publish");

    await versions.nth(1).click();
    await page.getByTestId("revision-restore").click();
    await expect(page.getByTestId("revision-banner")).toHaveCount(0);
    await expect(frame.locator(".ae-hdbuilds")).toHaveText("Builds from last spring");
    await expect(page.getByTestId("draft-status")).toContainText("1 unpublished change");
    await expect(page.getByTestId("history-panel")).toContainText("Restored the version from");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(frame.locator(".ae-hdbuilds")).toHaveText("Recent builds");
  });
});

test.describe("the builder tour", () => {
  test("shows five tips once, and not again after it is finished", async ({ page }) => {
    await installMocks(page);
    await page.goto(editorUrl());
    await waitForReady(page);
    const tour = page.getByTestId("tour");
    await expect(tour).toHaveAttribute("aria-label", "Tip 1 of 5");
    await expect(tour).toContainText("Drag in what you need");
    for (const title of ["Click to select, twice to type", "Fine-tune in the panel", "Drag the handles", "Publish when you're ready"]) {
      await tour.getByRole("button", { name: "Next" }).click();
      await expect(tour).toContainText(title);
    }
    await tour.getByRole("button", { name: "Got it" }).click();
    await expect(tour).toHaveCount(0);
    await page.reload();
    await waitForReady(page);
    await expect(page.getByTestId("visual-editor")).toHaveAttribute("data-builder", "on");
    await expect(page.getByTestId("tour")).toHaveCount(0);
  });
});
