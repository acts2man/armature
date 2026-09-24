/**
 * Getting Started — the seven-section guide under /getting-started.
 *
 * Signs in as agency staff, then checks:
 *   - Seven section panels exist by testid.
 *   - Toggling a section reveals its body.
 *   - Ticking "Mark this section done" saves through agency-getting-started
 *     and the pill turns to Done.
 *   - Pasting a YouTube link into "Use my own video" saves and the video-player
 *     node points at that URL (no iframe / real video load needed).
 *   - Without a .webm file, the fallback caption block is shown.
 *   - With a .webm file present, a <video controls> element renders.
 *
 * The agency-getting-started edge function and the .webm URL are intercepted
 * with page.route so the test does not need a real server, and installMocks
 * from tests/e2e/mocks.ts is used for the Supabase side.
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { AGENCY_ID, installMocks, SUPABASE_URL } from "./mocks.ts";

/** A tiny WebM header — enough bytes for the fetch HEAD to return a 200 and the browser to at least try to load it. */
const TINY_WEBM = Buffer.from(
  "1A45DFA3010000000000001F4286810142F7810142F2810442F381084282847765626D4287810442858102",
  "hex",
);

type PatchBody = {
  agency_id: string;
  read?: boolean;
  progress?: Record<string, boolean>;
  video_overrides?: Record<string, string>;
};

/** In-memory row that answers the edge-function route. */
type Row = { agency_id: string; progress: Record<string, boolean>; video_overrides: Record<string, string>; created_at: string; updated_at: string };

async function installGuideFunctionMock(page: Page, initial?: Partial<Row>): Promise<{ row: Row; requests: PatchBody[] }> {
  const now = new Date().toISOString();
  const row: Row = {
    agency_id: initial?.agency_id ?? AGENCY_ID,
    progress: initial?.progress ?? {},
    video_overrides: initial?.video_overrides ?? {},
    created_at: initial?.created_at ?? now,
    updated_at: initial?.updated_at ?? now,
  };
  const requests: PatchBody[] = [];
  const respond = async (route: Route) => {
    const body = (route.request().postDataJSON() ?? {}) as PatchBody;
    requests.push(body);
    if (body.read !== true) {
      if (body.progress) {
        for (const [key, value] of Object.entries(body.progress)) {
          if (value) row.progress[key] = true;
          else delete row.progress[key];
        }
      }
      if (body.video_overrides) {
        for (const [key, value] of Object.entries(body.video_overrides)) {
          if (value && value.length > 0) row.video_overrides[key] = value;
          else delete row.video_overrides[key];
        }
      }
      row.updated_at = new Date().toISOString();
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ ok: true, row }),
    });
  };
  // Register AFTER installMocks so this route wins on reverse-order matching.
  await page.route(`${SUPABASE_URL}/functions/v1/agency-getting-started`, respond);
  return { row, requests };
}

async function goToGuide(page: Page) {
  await page.goto("/getting-started");
  await expect(page.getByTestId("getting-started")).toBeVisible();
}

test.describe("the getting-started guide", () => {
  test("shows seven section panels, and toggling a section reveals its body", async ({ page }) => {
    await installMocks(page);
    await installGuideFunctionMock(page);
    await goToGuide(page);

    for (const key of ["agency-setup", "add-site", "set-up-site", "give-access", "editing-publishing", "keep-updated", "troubleshoot"]) {
      await expect(page.getByTestId(`gs-toggle-${key}`), key).toBeVisible();
    }

    // Section 1 opens by default when nothing is done yet.
    await expect(page.getByTestId("gs-body-agency-setup")).toBeVisible();
    // Section 2's body starts hidden.
    await expect(page.getByTestId("gs-body-add-site")).toHaveCount(0);
    await page.getByTestId("gs-toggle-add-site").click();
    await expect(page.getByTestId("gs-body-add-site")).toBeVisible();
    // Toggling again collapses.
    await page.getByTestId("gs-toggle-add-site").click();
    await expect(page.getByTestId("gs-body-add-site")).toHaveCount(0);
  });

  test("ticking 'Mark this section done' saves through agency-getting-started and shows the Done pill", async ({ page }) => {
    await installMocks(page);
    const state = await installGuideFunctionMock(page);
    await goToGuide(page);

    await page.getByTestId("gs-check-add-site").click();
    // The pill turns to Done.
    const toggle = page.getByTestId("gs-toggle-add-site");
    await expect(toggle).toContainText("Done");
    // The overall progress line advances to "1 of 7 done".
    await expect(page.getByText("1 of 7 done")).toBeVisible();
    // The edge function saw one save.
    await expect.poll(() => state.requests.filter((request) => request.progress).length).toBeGreaterThan(0);
    const saved = state.requests.find((request) => request.progress?.["add-site"] === true);
    expect(saved, "expected an agency-getting-started save with progress add-site=true").toBeTruthy();
  });

  test("pasting a YouTube link into 'Use my own video' saves and the video-player node uses it", async ({ page }) => {
    await installMocks(page);
    const state = await installGuideFunctionMock(page);
    await goToGuide(page);
    await page.getByTestId("gs-toggle-add-site").click();
    const url = "https://youtu.be/abc123";
    await page.getByTestId("gs-video-add-site").fill(url);
    // Save button next to the input.
    await page.getByRole("button", { name: "Save" }).first().click();

    await expect(page.getByTestId("gs-video-player-add-site")).toBeVisible();
    await expect(page.getByTestId("gs-video-player-add-site").getByRole("link", { name: /Open your walkthrough/ })).toHaveAttribute("href", url);

    await expect.poll(() => state.requests.find((request) => request.video_overrides?.["add-site"] === url)).toBeTruthy();
  });

  test("refuses a URL that is not on the video allow-list", async ({ page }) => {
    await installMocks(page);
    await installGuideFunctionMock(page);
    await goToGuide(page);
    await page.getByTestId("gs-toggle-add-site").click();
    await page.getByTestId("gs-video-add-site").fill("https://example.com/notallowed.mp4");
    await page.getByRole("button", { name: "Save" }).first().click();
    await expect(page.getByText(/not YouTube, Vimeo, Loom or Wistia/)).toBeVisible();
  });

  test("without a .webm file, the fallback caption block shows", async ({ page }) => {
    await installMocks(page);
    await installGuideFunctionMock(page);
    // Deny every .webm HEAD/GET so the UI stays on the fallback.
    await page.route(/\/guide-videos\/.+\.webm$/, (route) => route.fulfill({ status: 404, body: "" }));
    await goToGuide(page);

    await expect(page.getByTestId("gs-video-fallback-agency-setup")).toBeVisible();
    await expect(page.getByTestId("gs-video-fallback-agency-setup")).toContainText("Walkthrough coming");
    await expect(page.getByTestId("gs-video-fallback-agency-setup")).toContainText("Captions describe");
  });

  test("with a .webm file available for a section, the player mounts a <video controls>", async ({ page }) => {
    await installMocks(page);
    await installGuideFunctionMock(page);
    // Serve a tiny webm for the troubleshoot section only. Every other section falls back.
    await page.route(/\/guide-videos\/.+\.webm$/, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/guide-videos/troubleshoot.webm")) {
        await route.fulfill({ status: 200, contentType: "video/webm", body: TINY_WEBM });
      } else {
        await route.fulfill({ status: 404, body: "" });
      }
    });
    await goToGuide(page);
    // Open the troubleshoot section.
    await page.getByTestId("gs-toggle-troubleshoot").click();
    const player = page.getByTestId("gs-video-player-troubleshoot");
    await expect(player).toBeVisible();
    // The player element is a <video> tag with controls.
    await expect(player).toHaveJSProperty("tagName", "VIDEO");
    await expect(player).toHaveAttribute("controls", "");
    // Every other section still has the fallback.
    await expect(page.getByTestId("gs-video-fallback-agency-setup")).toBeVisible();
  });
});
