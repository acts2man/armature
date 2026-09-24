/**
 * The proof on the real site: acts2man/treetestprep, branch main, opened in the code
 * engine's editor with GitHub mocked. Every page loads; the hero headline, a paragraph,
 * a button and a picture are edited by clicking them; padding changes on desktop only and
 * font size on the phone only; an element is dragged to a new spot in its section; a
 * heading is inserted; the header menu and footer text are edited; the instructors list
 * reports live data; the publish shows a clean, minimal diff; the edited site still builds.
 * Screenshots land in docs/code-engine/. Open times are written to docs/code-engine/timings.json.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { AGENCY_ID, installMocks, SITE_ID } from "../../../tests/e2e/mocks.ts";
import { ENGINE_URL } from "../../playwright.config.ts";

const SITE_DIR = process.env["ENGINE_SITE_DIR"] ?? "";
const SHOTS = resolve(process.cwd(), "docs", "code-engine");
const PAGES = ["/", "/events/location/", "/exam-information/", "/about-us/", "/meet-your-instructors/", "/contact-us/", "/class-registration-page/"];
const timings: Record<string, number> = {};

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});
test.afterAll(() => {
  const existing = (() => {
    try {
      return JSON.parse(readFileSync(resolve(SHOTS, "timings.json"), "utf8")) as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  writeFileSync(resolve(SHOTS, "timings.json"), JSON.stringify({ ...existing, editor: timings, measuredAt: new Date().toISOString() }, null, 2));
});

async function engine<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${ENGINE_URL}${path}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  return (await response.json()) as T;
}

const read = (file: string) => readFileSync(resolve(SITE_DIR, file), "utf8");

async function openEditor(page: Page, path = "/"): Promise<{ frame: FrameLocator; ms: number }> {
  await installMocks(page, { fixture: "treetestprep", role: "staff" });
  // The fixture's site row points at the kit branch; the engine edits the original code on main.
  const siteRow = { id: SITE_ID, agency_id: AGENCY_ID, name: "Tree Test Prep", repo_owner: "acts2man", repo_name: "treetestprep", branch: "main", live_url: "https://treetestprep.com", github_installation_id: 123, status: "connected", last_published_at: "2026-09-20T15:00:00Z", created_at: "2026-09-01T00:00:00Z" };
  await page.route("**/rest/v1/sites?*", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify([siteRow]) });
  });
  await page.addInitScript((url: string) => {
    localStorage.setItem("armature:engine", "1");
    localStorage.setItem("armature:engine:url", url);
  }, ENGINE_URL);
  const started = Date.now();
  await page.goto(`/sites/${SITE_ID}/engine?page=${encodeURIComponent(path)}`);
  const frame = page.frameLocator('[data-testid="sheet"] iframe');
  await expect(frame.locator("[data-ae]").first()).toBeAttached({ timeout: 180_000 });
  await expect(page.getByTestId("engine-status")).toHaveAttribute("data-phase", "ready", { timeout: 180_000 });
  return { frame, ms: Date.now() - started };
}

async function select(page: Page, frame: FrameLocator, selector: string, nth = 0) {
  const target = frame.locator(selector).nth(nth);
  await target.scrollIntoViewIfNeeded();
  await target.click({ force: true });
  await expect(page.getByTestId("engine-inspector")).toBeVisible();
  await expect(page.getByTestId("element-selection")).toBeVisible();
}

async function setText(page: Page, value: string) {
  const input = page.getByTestId("engine-text-input");
  await expect(input).toBeVisible();
  await input.fill(value);
  await input.press("Enter");
}

async function waitForChange(file: string, needle: string) {
  await expect.poll(() => read(file).includes(needle), { timeout: 20_000 }).toBe(true);
}

test.describe.configure({ mode: "serial" });

test("every public page opens in the editor", async ({ page }) => {
  const first = await openEditor(page, "/");
  timings["firstEditorOpenMs"] = first.ms;
  await page.screenshot({ path: resolve(SHOTS, "01-home-open.png") });
  for (const path of PAGES.slice(1)) {
    const started = Date.now();
    await page.goto(`/sites/${SITE_ID}/engine?page=${encodeURIComponent(path)}`);
    const frame = page.frameLocator('[data-testid="sheet"] iframe');
    await expect(frame.locator("[data-ae]").first()).toBeAttached({ timeout: 120_000 });
    await expect(page.getByTestId("engine-status")).toHaveAttribute("data-phase", "ready", { timeout: 120_000 });
    timings[`open ${path}`] = Date.now() - started;
    await expect(frame.locator("main, header").first()).toBeVisible();
  }
  const status = await engine<{ status: { timings?: Record<string, number> } }>(`/sites/status?site=${SITE_ID}`);
  if (status.status.timings) Object.assign(timings, Object.fromEntries(Object.entries(status.status.timings).map(([key, value]) => [`runner ${key}`, value])));
});

test("click and edit the home hero headline, a paragraph, a button and a picture", async ({ page }) => {
  const { frame } = await openEditor(page, "/");
  await select(page, frame, "h1#hero-title");
  await expect(page.getByTestId("engine-text-input")).toHaveValue("Become An ISA Certified Arborist");
  await page.screenshot({ path: resolve(SHOTS, "02-hero-headline-selected.png") });
  await setText(page, "Become a Certified Arborist This Autumn");
  await waitForChange("src/lib/pageDefaults.ts", 'title: "Become a Certified Arborist This Autumn"');
  await expect(frame.locator("h1#hero-title")).toHaveText("Become a Certified Arborist This Autumn");

  await select(page, frame, ".hero-copy p");
  await expect(page.getByTestId("engine-text-input")).toHaveValue(/Take your tree care career/);
  await setText(page, "Take your tree care career further by becoming an ISA Certified Arborist.");
  await waitForChange("src/lib/pageDefaults.ts", 'body: "Take your tree care career further');
  await expect(frame.locator(".hero-copy p").first()).toHaveText("Take your tree care career further by becoming an ISA Certified Arborist.");

  await select(page, frame, "a.hero-button");
  await expect(page.getByTestId("engine-text-input")).toHaveValue("Register for the course");
  await setText(page, "Register now");
  await waitForChange("src/lib/pageDefaults.ts", 'cta: { label: "Register now"');
  await expect(frame.locator("a.hero-button")).toHaveText("Register now");
  await page.screenshot({ path: resolve(SHOTS, "03-button-edited.png") });

  await select(page, frame, "img.credential");
  await expect(page.getByTestId("engine-alt-input")).toHaveValue("ISA Certified Arborist credential badge");
  await page.getByTestId("engine-alt-input").fill("The ISA Certified Arborist badge");
  await page.getByTestId("engine-alt-input").press("Enter");
  await waitForChange("src/lib/pageDefaults.ts", 'badge_alt: "The ISA Certified Arborist badge"');
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  await page.getByTestId("engine-replace-picture").setInputFiles({ name: "new-badge.png", mimeType: "image/png", buffer: png });
  await waitForChange("src/lib/pageDefaults.ts", 'badge: "/assets/new-badge.png"');
  await expect(frame.locator("img.credential")).toHaveAttribute("src", "/assets/new-badge.png");
  await page.screenshot({ path: resolve(SHOTS, "04-picture-replaced.png") });
});

test("padding on desktop only, font size on the phone only", async ({ page }) => {
  const { frame } = await openEditor(page, "/");
  await select(page, frame, ".hero-inner");
  await page.getByTestId("inspector-tab-style").click();
  const paddingTop = page.getByTestId("engine-style-padding-top");
  await paddingTop.fill("23");
  await paddingTop.press("Enter");
  await expect.poll(() => read("src/styles/globals.css")).toMatch(/@media \(min-width: 1024px\) \{ \.ae-[a-f0-9]{6}\.ae-[a-f0-9]{6}\.ae-[a-f0-9]{6} \{ padding-top: 23px; \} \}/);
  await expect(frame.locator(".hero-inner")).toHaveCSS("padding-top", "23px");
  await page.screenshot({ path: resolve(SHOTS, "05-padding-desktop.png") });

  await page.getByTestId("engine-device-phone").click();
  await select(page, frame, "h1#hero-title");
  await page.getByTestId("inspector-tab-style").click();
  const fontSize = page.getByTestId("engine-style-font-size");
  await fontSize.fill("24");
  await fontSize.press("Enter");
  await expect.poll(() => read("src/styles/globals.css")).toMatch(/@media \(max-width: 767px\) \{ \.ae-[a-f0-9]{6}\.ae-[a-f0-9]{6}\.ae-[a-f0-9]{6} \{ font-size: 24px; \} \}/);
  await expect(frame.locator("h1#hero-title")).toHaveCSS("font-size", "24px");
  await page.screenshot({ path: resolve(SHOTS, "06-font-size-phone.png") });
  await page.getByTestId("engine-device-desktop").click();
  await expect(frame.locator("h1#hero-title")).not.toHaveCSS("font-size", "24px");
  // The desktop padding rule only applies at desktop width.
  expect(read("src/styles/globals.css").match(/armature:start/g)).toHaveLength(1);
});

test("drag an element to a new spot within its section, and insert a heading", async ({ page }) => {
  const { frame } = await openEditor(page, "/");
  await select(page, frame, ".week-nine");
  const handle = page.getByTestId("element-move");
  const target = frame.locator("h2").first();
  const targetBox = await target.boundingBox();
  const sheetBox = await page.getByTestId("sheet").boundingBox();
  const scale = Number(await page.getByTestId("canvas").getAttribute("data-scale"));
  if (!targetBox || !sheetBox) throw new Error("no boxes");
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error("no handle");
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  // Above the section's heading: the drop line should appear before the h2.
  const x = sheetBox.x + (targetBox.x + targetBox.width / 2) * scale;
  const y = sheetBox.y + (targetBox.y + 4) * scale;
  await page.mouse.move(x, y, { steps: 12 });
  await expect(page.getByTestId("drop-line")).toBeVisible();
  await page.screenshot({ path: resolve(SHOTS, "07-drag-in-progress.png") });
  await page.mouse.up();
  await expect.poll(() => {
    const code = read("src/pages/Home.tsx");
    return code.indexOf('className="week-nine"') < code.indexOf("<h2>{copy.text(\"course\", \"heading\")}</h2>");
  }).toBe(true);

  await select(page, frame, "h2", 0);
  await page.getByTestId("engine-tile-heading").click();
  await waitForChange("src/pages/Home.tsx", ">New heading</h2>");
  await expect(frame.locator("h2", { hasText: "New heading" })).toBeVisible();
  await page.screenshot({ path: resolve(SHOTS, "08-heading-inserted.png") });
});

test("header menu and footer text edit with a shared note", async ({ page }) => {
  const { frame } = await openEditor(page, "/");
  await select(page, frame, "nav.nav-links a", 1);
  await expect(page.getByTestId("engine-text-input")).toHaveValue("Course Overview");
  await expect(page.getByTestId("engine-note").filter({ hasText: /every page|appears on/ })).toBeVisible();
  await page.screenshot({ path: resolve(SHOTS, "09-header-menu-selected.png") });
  await setText(page, "The Course");
  await waitForChange("src/lib/pageDefaults.ts", '{ label: "The Course", href: "/events/location/" }');
  await expect(frame.locator("nav.nav-links a").nth(1)).toHaveText("The Course");

  await select(page, frame, ".footer-bottom p", 0);
  await expect(page.getByTestId("engine-text-input")).toHaveValue(/Tree Test Prep. All Rights Reserved/);
  await setText(page, "© 2026 Tree Test Prep. Every right reserved.");
  await waitForChange("src/lib/pageDefaults.ts", 'copyright: "© 2026 Tree Test Prep. Every right reserved."');
  await page.screenshot({ path: resolve(SHOTS, "10-footer-edited.png") });
});

test("the instructors list says it comes from live data", async ({ page }) => {
  const { frame } = await openEditor(page, "/meet-your-instructors/");
  await select(page, frame, ".instructor-list");
  const note = page.getByTestId("engine-note").filter({ hasText: /live data/ });
  await expect(note).toBeVisible();
  await expect(note).toHaveAttribute("data-kind", "live-data");
  await page.screenshot({ path: resolve(SHOTS, "11-live-data-note.png") });
});

test("publish (GitHub mocked) shows a clean, minimal diff and the site still builds", async ({ page }) => {
  await openEditor(page, "/");
  await page.getByTestId("engine-publish").click();
  const dialog = page.getByTestId("engine-publish-dialog");
  await expect(dialog).toBeVisible();
  const files = await page.getByTestId("engine-changed-files").innerText();
  expect(files).toContain("src/lib/pageDefaults.ts");
  expect(files).toContain("src/pages/Home.tsx");
  expect(files).toContain("src/styles/globals.css");
  expect(files).toContain("public/assets/new-badge.png");
  const diff = await page.getByTestId("engine-diff").innerText();
  writeFileSync(resolve(SHOTS, "publish-diff.patch"), diff);
  // Minimal: only the edited lines change; nothing else in those files is reformatted.
  const removed = diff.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---"));
  const added = diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++"));
  expect(removed.length).toBeLessThanOrEqual(12);
  expect(added.length).toBeLessThanOrEqual(24);
  expect(diff).not.toContain("import ");
  await page.screenshot({ path: resolve(SHOTS, "12-publish-dialog.png") });
  await dialog.getByRole("button", { name: /^Publish/ }).click();
  await expect(page.getByTestId("engine-commit-link")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: resolve(SHOTS, "13-published.png") });
  const changes = await engine<{ files: unknown[] }>(`/changes?site=${SITE_ID}`);
  expect(changes.files).toHaveLength(0);

  const build = spawnSync("npx", ["vite", "build"], { cwd: SITE_DIR, encoding: "utf8", timeout: 600_000, env: { ...process.env, CI: "1" } });
  writeFileSync(resolve(SHOTS, "build-output.txt"), `${build.stdout}\n${build.stderr}`.slice(-6000));
  expect(build.status, build.stderr.slice(-2000)).toBe(0);
});
