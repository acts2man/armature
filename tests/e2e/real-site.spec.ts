/**
 * The editor against the first real converted site: acts2man/treetestprep (branch
 * armature/git-content), running with its own dev server next to the dashboard, with
 * Supabase mocked and GitHub never touched. The site's files are the fixture in
 * tests/fixtures/treetestprep (its content/ folder as committed).
 *
 * Needs the site: run with REAL_SITE_DIR=<clone of the repository> (playwright.config.ts
 * starts `bun run dev` there on port 5175). The clone's src/lib/armature.ts must allow
 * http://localhost:5173 in ARMATURE_EDITOR_ORIGINS — a local-only edit. Without the
 * site these tests skip, which is what CI does.
 */
import { expect, test, type FrameLocator, type Locator, type Page } from "@playwright/test";
import { REAL_SITE_URL, SITE_ID, editorUrl, installMocks, realLayouts, realSchema } from "./mocks.ts";

test.skip(!process.env["REAL_SITE_DIR"] && !process.env["REAL_SITE_URL"], "needs the real site: REAL_SITE_DIR=<clone of acts2man/treetestprep at armature/git-content>");

type Node = { id: string; type: string; label?: string; props: Record<string, unknown>; children?: Node[] };
type Layout = { pageSlug: string; path: string; root: Node[] };
const layouts = realLayouts as Record<string, Layout>;
const schema = realSchema as { pages: { slug: string; label: string; path: string }[] };
const slugs = Object.keys(layouts).sort();
const count = (nodes: Node[]): number => nodes.reduce((sum, node) => sum + 1 + count(node.children ?? []), 0);

const siteFrame = (page: Page): FrameLocator => page.frameLocator(`iframe[title$="live site"]`);
const center = (box: { x: number; y: number; width: number; height: number } | null) => {
  if (!box) throw new Error("element has no box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
async function settled(locator: Locator) {
  await expect(locator).toBeVisible();
  let last = await locator.boundingBox();
  for (let i = 0; i < 10; i++) {
    await locator.page().waitForTimeout(80);
    const next = await locator.boundingBox();
    if (last && next && Math.abs(last.x - next.x) < 1 && Math.abs(last.y - next.y) < 1) return center(next);
    last = next;
  }
  return center(last);
}

async function openReal(page: Page, slug: string, options: Parameters<typeof installMocks>[1] = {}) {
  const state = await installMocks(page, { fixture: "treetestprep", ...options });
  await page.addInitScript(() => {
    window.localStorage.setItem("armature:visual:tour:v1", "done");
    window.localStorage.setItem("armature:builder:tour:v1", "done");
  });
  await page.goto(editorUrl(slug));
  await expect(page.getByTestId("visual-editor")).toHaveAttribute("data-builder", "on", { timeout: 30_000 });
  await expect(siteFrame(page).locator("html")).toHaveAttribute("data-armature-mode", "edit", { timeout: 30_000 });
  await expect(page.locator(`iframe[title$="live site"]`)).toHaveCSS("opacity", "1", { timeout: 15_000 });
  return state;
}

/** Phone view renders the frame at scale 1, so pointer positions map straight onto it. */
async function phoneView(page: Page) {
  await page.getByRole("button", { name: /Phone view/ }).click();
  await expect(page.getByTestId("canvas")).toHaveAttribute("data-scale", "1.000");
}

async function selectByCorner(page: Page, selector: string) {
  const frame = siteFrame(page);
  await frame.locator(selector).scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await frame.locator(selector).click({ position: { x: 5, y: 5 } });
}

test.describe("the real site in the editor", () => {
  test("the site itself renders every page from its layouts with nothing unsupported", async ({ page }) => {
    await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|fast\.wistia\.net|.*\.supabase\.co)\//, (route) => route.abort());
    for (const slug of slugs) {
      const layout = layouts[slug]!;
      await page.goto(`${REAL_SITE_URL}${layout.path}`, { waitUntil: "domcontentloaded" });
      await expect(page.locator(".ae-root [data-ae-id]").first()).toBeVisible({ timeout: 20_000 });
      const ids = await page.locator(".ae-root [data-ae-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-ae-id")));
      const expected = new Set<string>();
      const collect = (nodes: Node[]) => nodes.forEach((node) => (expected.add(node.id), collect(node.children ?? [])));
      collect(layout.root);
      for (const id of expected) expect(ids, `${slug}: element ${id}`).toContain(id);
      expect(await page.locator(".ae-unsupported").count(), slug).toBe(0);
      expect(await page.locator("html").getAttribute("data-armature-mode")).toBeNull();
    }
  });

  test("every page loads in the editor with all of its content", async ({ page }) => {
    await installMocks(page, { fixture: "treetestprep" });
    await page.addInitScript(() => {
      window.localStorage.setItem("armature:builder:tour:v1", "done");
    });
    for (const slug of slugs) {
      const layout = layouts[slug]!;
      await page.goto(editorUrl(slug));
      await expect(page.getByTestId("visual-editor")).toHaveAttribute("data-builder", "on", { timeout: 30_000 });
      const frame = siteFrame(page);
      await expect(frame.locator("html")).toHaveAttribute("data-armature-mode", "edit", { timeout: 30_000 });
      await expect(page.getByTestId("page-name")).toContainText(schema.pages.find((item) => item.slug === slug)?.label ?? slug);
      const expected = count(layout.root);
      await expect.poll(async () => frame.locator(".ae-root [data-ae-id]").count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(expected);
      expect(await frame.locator(".ae-unsupported").count(), slug).toBe(0);
      // The words are there: every heading's text is on the page.
      const headings: string[] = [];
      const collect = (nodes: Node[]) => nodes.forEach((node) => (node.type === "heading" && headings.push(String(node.props["text"])), collect(node.children ?? [])));
      collect(layout.root);
      for (const text of headings.slice(0, 6)) await expect(frame.locator(".ae-root")).toContainText(text.slice(0, 40));
    }
  });

  test("every element on every page selects and shows Content, Style and Advanced", async ({ page }) => {
    test.setTimeout(600_000);
    await installMocks(page, { fixture: "treetestprep" });
    await page.addInitScript(() => {
      window.localStorage.setItem("armature:builder:tour:v1", "done");
    });
    const selection = page.getByTestId("element-selection");
    const inspector = page.getByTestId("element-inspector");
    let visited = 0;
    const check = async (node: Node) => {
      await expect(selection, `${node.type} ${node.id}`).toHaveAttribute("data-element-id", node.id);
      await expect(page.getByTestId("edit-title")).toBeVisible();
      await page.getByTestId("inspector-tab-style").click();
      await expect(inspector).toHaveAttribute("data-tab", "style");
      await expect(inspector.locator("[data-testid^='group-']").first()).toBeVisible();
      await page.getByTestId("inspector-tab-advanced").click();
      await expect(inspector).toHaveAttribute("data-tab", "advanced");
      await expect(inspector.getByLabel("Padding top")).toBeVisible();
      await page.getByTestId("inspector-tab-content").click();
      await expect(inspector).toHaveAttribute("data-tab", "content");
      visited += 1;
    };
    // Arrow keys walk the tree: down = next sibling, right = first child, left = parent.
    const walk = async (nodes: Node[]) => {
      for (let index = 0; index < nodes.length; index++) {
        const node = nodes[index]!;
        await check(node);
        if (node.children && node.children.length > 0) {
          await page.keyboard.press("ArrowRight");
          await walk(node.children);
          await page.keyboard.press("ArrowLeft");
          await expect(selection).toHaveAttribute("data-element-id", node.id);
        }
        if (index < nodes.length - 1) await page.keyboard.press("ArrowDown");
      }
    };
    for (const slug of slugs) {
      const layout = layouts[slug]!;
      await page.goto(editorUrl(slug));
      await expect(page.getByTestId("visual-editor")).toHaveAttribute("data-builder", "on", { timeout: 30_000 });
      await expect(siteFrame(page).locator("html")).toHaveAttribute("data-armature-mode", "edit", { timeout: 30_000 });
      await expect(page.locator(`iframe[title$="live site"]`)).toHaveCSS("opacity", "1", { timeout: 15_000 });
      // Select something in the first root element, then walk up to the root itself (a container with no
      // padding cannot be clicked past its first child, so the left arrow does the last step).
      await selectByCorner(page, `[data-ae-id='${layout.root[0]!.id}']`);
      for (let step = 0; step < 12; step++) {
        if ((await selection.getAttribute("data-element-id")) === layout.root[0]!.id) break;
        await page.keyboard.press("ArrowLeft");
        await page.waitForTimeout(80);
      }
      await walk(layout.root);
    }
    expect(visited).toBe(slugs.reduce((sum, slug) => sum + count(layouts[slug]!.root), 0));
  });

  test("drag between elements, resize an image, change padding, a phone-only override, a Globals change", async ({ page }) => {
    await openReal(page, "home");
    const frame = siteFrame(page);

    // Drag (desktop view; on phones the site's own CSS turns the video column into
    // `display: contents`): the course button moves above the course heading with the move handle.
    // A live site shifts as its pictures and video load, so the drag waits for the target to
    // settle and tries again when the drop does not land.
    const firstInCopy = frame.locator(".ae-hmccopy0 > .ae-con-inner > :first-child");
    for (let attempt = 0; attempt < 3; attempt++) {
      await selectByCorner(page, ".ae-hmcbtn00");
      await expect(page.getByTestId("element-selection")).toHaveAttribute("data-element-id", "hmcbtn00");
      const move = await settled(page.getByTestId("element-move"));
      const heading = await settled(frame.locator(".ae-hmch2000"));
      const headingBox = await frame.locator(".ae-hmch2000").boundingBox();
      await page.mouse.move(move.x, move.y);
      await page.mouse.down();
      await page.mouse.move(move.x + 6, move.y + 6);
      // Aim at the heading's upper third: its top few pixels belong to its container's "drop beside me" band.
      await page.mouse.move(heading.x, (headingBox?.y ?? heading.y) + (headingBox?.height ?? 0) / 3, { steps: 8 });
      await expect(page.getByTestId("drag-ghost")).toBeVisible();
      const label = await page.getByTestId("drop-label").textContent().catch(() => "");
      if (!/before Heading/.test(label ?? "")) {
        await page.keyboard.press("Escape");
        await page.mouse.up();
        continue;
      }
      await page.mouse.up();
      if (/ae-hmcbtn00/.test((await firstInCopy.getAttribute("class")) ?? "")) break;
      await page.waitForTimeout(300);
      if (/ae-hmcbtn00/.test((await firstInCopy.getAttribute("class")) ?? "")) break;
    }
    await expect(firstInCopy).toHaveClass(/ae-hmcbtn00/);
    await expect(page.getByTestId("history-steps")).toHaveText("1");
    await page.keyboard.press("Escape");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.getByTestId("history-steps")).toHaveText("0");
    await expect(frame.locator(".ae-hmccopy0 > .ae-con-inner > :first-child")).toHaveClass(/ae-hmch2000/);
    await phoneView(page);

    // Resize: the credential badge picture narrows with its width handle.
    const img = frame.locator(".ae-hmcreden img");
    await img.scrollIntoViewIfNeeded();
    await img.click();
    await expect(page.getByTestId("element-selection")).toHaveAttribute("data-element-id", "hmcreden");
    const w0 = (await img.boundingBox())?.width ?? 0;
    const handle = await settled(page.getByTestId("handle-image-width"));
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(handle.x - 60, handle.y, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => Math.round((await img.boundingBox())?.width ?? 0)).toBeLessThan(w0 - 30);

    // Padding on the hero, on the phone. The hero has no padding of its own on phones, so the
    // corner click lands on its inner container; the left arrow selects the parent.
    await selectByCorner(page, ".ae-hmhero00");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("element-selection")).toHaveAttribute("data-element-id", "hmhero00");
    await page.getByTestId("inspector-tab-advanced").click();
    const top = page.getByRole("textbox", { name: "Padding top" });
    await top.fill("33");
    await top.press("Tab");
    await expect(frame.locator(".ae-hmhero00")).toHaveCSS("padding-top", "33px");

    // A phone-only font size on the hero headline: the desktop value is untouched.
    await frame.locator(".ae-hmheroh1").click();
    await expect(page.getByTestId("element-selection")).toHaveAttribute("data-element-id", "hmheroh1");
    await page.getByTestId("inspector-tab-style").click();
    const typography = page.getByTestId("group-typography");
    await typography.getByTestId("edit-typography").click();
    const size = typography.getByTestId("popover-typography").getByLabel("Size", { exact: true });
    await size.fill("28");
    await size.press("Tab");
    await expect(frame.locator(".ae-hmheroh1")).toHaveCSS("font-size", "28px");
    await page.getByRole("button", { name: /Desktop view/ }).click();
    await expect(frame.locator(".ae-hmheroh1")).toHaveCSS("font-size", "39px");

    // Globals: the primary colour reaches the site's stylesheet.
    await page.getByTestId("topbar-add").click();
    await page.getByTestId("tab-globals").click();
    const colours = page.getByTestId("group-global-colours");
    await colours.getByTestId("color-swatch").first().click();
    await colours.getByTestId("color-text").fill("#aa0000");
    await page.keyboard.press("Escape");
    await expect.poll(() => frame.locator("style[data-armature-page=home]").evaluate((node) => node.textContent ?? "")).toContain("--ae-color-primary: #aa0000");
    await expect(page.getByTestId("draft-status")).toContainText("unpublished");
  });

  test("save draft, reload and restore, then publish with GitHub mocked", async ({ page }) => {
    const state = await openReal(page, "home");
    const frame = siteFrame(page);
    await frame.locator(".ae-hmheroh1").dblclick();
    await page.keyboard.press("End");
    await page.keyboard.type(" today");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("draft-status")).toContainText("Draft saved · 1 unpublished change");
    await page.reload();
    const prompt = page.getByRole("dialog", { name: "You have unpublished changes" });
    await expect(prompt).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("restore-keep").click();
    await expect(siteFrame(page).locator("html")).toHaveAttribute("data-armature-mode", "edit", { timeout: 30_000 });
    await expect(siteFrame(page).locator(".ae-hmheroh1")).toContainText("today", { timeout: 15_000 });
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.getByTestId("publish-builder")).toContainText("Home");
    await page.getByTestId("publish-confirm").click();
    await expect(page.getByTestId("publish-done")).toBeVisible();
    const request = state.builderPublishRequests[0] as { layouts: Record<string, Layout>; kit: unknown; baseCommitSha: string };
    expect(Object.keys(request.layouts)).toEqual(["home"]);
    expect(request.kit).toBeNull();
    const hero = request.layouts["home"]!.root[0]!.children![0]!.children![0]!;
    expect(String(hero.props["text"])).toMatch(/today$/);
    // Everything else on the page went out exactly as the file holds it.
    const original = layouts["home"]!;
    expect(request.layouts["home"]!.root.slice(1)).toEqual(original.root.slice(1));
    await expect(page.getByTestId("draft-status")).toContainText("Nothing to publish");
  });

  test("the Pages list shows every page with its Edit visually link, and no warning box", async ({ page }) => {
    await installMocks(page, { fixture: "treetestprep" });
    await page.goto(`/sites/${SITE_ID}/pages`);
    await expect(page.getByText("Choose a page to edit.")).toBeVisible();
    for (const item of schema.pages.filter((entry) => entry.slug !== "shared")) {
      await expect(page.getByTestId(`edit-visually-${item.slug}`)).toHaveAttribute("href", `/sites/${SITE_ID}/visual?page=${item.slug}`);
    }
    expect(await page.getByTestId("file-problems").count()).toBe(0);
    await expect(page.getByText("acts2man/treetestprep on armature/git-content")).toBeVisible();
  });
});
