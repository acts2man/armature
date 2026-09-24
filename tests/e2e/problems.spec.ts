/**
 * Files a real site wrote that the model does not fully understand: the page still loads,
 * the Pages screen names each problem with a "Show me" link, the editor shows the element
 * and explains, a custom font weight can be typed, and a publish keeps every unread value
 * exactly as it was.
 */
import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { SITE_ID, demoLayouts, editorUrl, installMocks } from "./mocks.ts";

const siteFrame = (page: Page): FrameLocator => page.frameLocator(`iframe[title$="live site"]`);

/** A button whose text is a number: a known element with one value the editor cannot read. */
const ODD_BUTTON = { id: "btnbroke", type: "button", props: { text: 42, link: { href: "/contact/" } }, style: {}, advanced: {}, meta: { createdBy: "hand", updatedAt: "" } };

/** The demo home page with a colour the validator cannot read, a broken element, a bad phone override and a button with a number for its text. */
function layoutsWithProblems(): Record<string, unknown> {
  const home = JSON.parse(JSON.stringify(demoLayouts["home"])) as { root: Record<string, unknown>[] };
  const section = home.root[1] as { children: Record<string, unknown>[] };
  const heading = section.children[0] as { style: Record<string, unknown> };
  heading.style = { ...heading.style, color: "navy-ish", typography: { fontWeight: 650, fontSize: { desktop: { value: 32, unit: "px" }, mobile: "big" } } };
  section.children.splice(1, 0, { id: "BROKEN", type: "heading", props: { text: "Old" }, style: {}, advanced: {}, meta: { createdBy: "hand", updatedAt: "" } }, JSON.parse(JSON.stringify(ODD_BUTTON)) as Record<string, unknown>);
  return { ...demoLayouts, home };
}

async function openEditor(page: Page, url: string) {
  await page.addInitScript(() => {
    window.localStorage.setItem("armature:visual:tour:v1", "done");
    window.localStorage.setItem("armature:builder:tour:v1", "done");
  });
  await page.goto(url);
  await expect(siteFrame(page).locator("h1")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(`iframe[title$="live site"]`)).toHaveCSS("opacity", "1", { timeout: 15_000 });
}

test.describe("values the editor cannot read", () => {
  test("the Pages screen lists each problem in plain English, and Show me opens the editor on that element", async ({ page }) => {
    await installMocks(page, { layouts: layoutsWithProblems() });
    await page.addInitScript(() => {
      window.localStorage.setItem("armature:builder:tour:v1", "done");
    });
    await page.goto(`/sites/${SITE_ID}/pages`);
    const box = page.getByTestId("file-problems");
    await expect(box).toBeVisible();
    const items = box.locator("li");
    await expect(items).toHaveCount(4);
    await expect(box).toContainText('Home: the heading\'s Style › Color is "navy-ish", which is not a colour');
    await expect(box).toContainText("kept as it is in the file");
    await expect(box).toContainText('Style › Typography › Font size › on phone is "big"');
    await expect(box).toContainText('could not be read: its element id "BROKEN"');
    await expect(box).toContainText("Unsupported element");
    // A known element with one unreadable value is named as ignored, not as unsupported.
    await expect(items.filter({ hasText: "Content › Text is 42" })).toContainText("the button's Content › Text is 42, which is not text up to 300 characters. It is ignored");
    await expect(items.filter({ hasText: "Content › Text is 42" })).not.toContainText("Unsupported");
    await items.filter({ hasText: "navy-ish" }).getByTestId("show-me").click();
    await expect(page).toHaveURL(/\/visual\?page=home&element=hdbuilds$/);
    await expect(siteFrame(page).locator("h1")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("edit-title")).toHaveText("Edit Heading", { timeout: 15_000 });
    const note = page.getByTestId("element-problems");
    await expect(note).toContainText("2 settings could not be read");
    await expect(note).toContainText("Style › Color is \"navy-ish\"");
    // The rest of the element's settings still apply on the page.
    await expect(siteFrame(page).locator(".ae-hdbuilds")).toHaveCSS("font-weight", "650");
    await expect(siteFrame(page).locator(".ae-hdbuilds")).toHaveCSS("font-size", "32px");
  });

  test("only a genuinely unreadable element shows as Unsupported; one with a bad value renders with it ignored; a publish keeps every unread value", async ({ page }) => {
    const state = await installMocks(page, { layouts: layoutsWithProblems() });
    await openEditor(page, editorUrl("home"));
    const frame = siteFrame(page);
    const placeholder = frame.locator(".ae-unsupported");
    await expect(placeholder).toHaveCount(1);
    await expect(placeholder).toHaveText("Unsupported element: heading");
    // The button with a number for its text is a real button on the page, with an empty label.
    const button = frame.locator(".ae-btnbroke");
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute("data-ae-type", "button");
    await button.click();
    await expect(page.getByTestId("edit-title")).toHaveText("Edit Button");
    await expect(page.getByTestId("element-problems")).toContainText("One setting could not be read");
    await expect(page.getByTestId("element-problems")).toContainText("Content › Text is 42");
    await placeholder.click();
    await expect(page.getByTestId("edit-title")).toHaveText("Unsupported element");
    await expect(page.getByTestId("unsupported-note")).toContainText('its element id "BROKEN" is not eight lowercase letters or digits');
    await expect(page.getByTestId("unsupported-note")).toContainText("a publish keeps it in the file exactly as it is");
    // Change something else on the heading (its unread colour must survive), then publish.
    await frame.locator(".ae-hdbuilds").click();
    await expect(page.getByTestId("edit-title")).toHaveText("Edit Heading");
    await page.getByTestId("inspector-tab-advanced").click();
    const padding = page.getByLabel("Padding top");
    await padding.fill("30");
    await padding.press("Tab");
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await page.getByTestId("publish-confirm").click();
    await expect(page.getByTestId("publish-done")).toBeVisible();
    type Node = { id: string; type: string; style?: Record<string, unknown>; props?: Record<string, unknown>; children?: Node[] };
    const request = state.builderPublishRequests[0] as { layouts: Record<string, { root: Node[] }> };
    const section = request.layouts["home"]?.root[1];
    const heading = section?.children?.find((child) => child.id === "hdbuilds");
    // The colour and the phone override go back exactly as they were; the raw broken element too.
    expect(heading?.style?.["color"]).toBe("navy-ish");
    expect(heading?.style?.["typography"]).toEqual({ fontWeight: 650, fontSize: { desktop: { value: 32, unit: "px" }, mobile: "big" } });
    expect(section?.children?.[1]).toEqual({ id: "BROKEN", type: "heading", props: { text: "Old" }, style: {}, advanced: {}, meta: { createdBy: "hand", updatedAt: "" } });
    // The button's number goes back too, untouched.
    expect(section?.children?.[2]).toEqual(ODD_BUTTON);
  });

  test("the Weight control keeps its list and takes a custom number", async ({ page }) => {
    await installMocks(page, {});
    await openEditor(page, editorUrl("home"));
    const frame = siteFrame(page);
    const heading = frame.locator(".ae-hdbuilds");
    await heading.click();
    await page.getByTestId("inspector-tab-style").click();
    const typography = page.getByTestId("group-typography");
    await typography.getByTestId("edit-typography").click();
    const popover = typography.getByTestId("popover-typography");
    const weight = popover.getByLabel("Weight", { exact: true });
    await weight.selectOption("700");
    await expect(heading).toHaveCSS("font-weight", "700");
    await weight.selectOption("Custom…");
    const custom = popover.getByTestId("custom-weight");
    await custom.fill("650");
    await expect(heading).toHaveCSS("font-weight", "650");
    await expect(weight).toHaveValue("__custom__");
    // A listed value chosen again closes the custom entry.
    await weight.selectOption("400");
    await expect(custom).toHaveCount(0);
    await expect(heading).toHaveCSS("font-weight", "400");
  });
});
