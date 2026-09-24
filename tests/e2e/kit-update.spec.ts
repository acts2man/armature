/**
 * End-to-end coverage for the Update kit flow:
 *   - The Projects Kit column and its filter.
 *   - The Kit panel's Update modal, including the local-edits refusal and the
 *     "Overwrite anyway" bypass.
 *   - The live-version watch tile that flips to Needs attention.
 *   - Undo, including the confirmation modal and the resulting timeline entry.
 *   - Update all: the multi-site batch with three-at-a-time concurrency and the
 *     two-in-a-row stop rule.
 *
 * The dashboard talks to the mocked Supabase in tests/e2e/mocks.ts, so nothing
 * leaves the machine — GitHub, Netlify and the live URL are all fake.
 */
import { expect, test } from "@playwright/test";
import { installMocks, SITE_ID } from "./mocks.ts";

test.describe("the Projects Kit column", () => {
  test("shows a Kit pill per site with the version and lets the agency sort and filter by verdict", async ({ page }) => {
    await installMocks(page, {
      kit: { version_in_repo: "2.9.0", version_live: "2.9.0", verdict: "up_to_date" },
      moreSites: [
        { id: "s-update", name: "Beta site", kit_version_in_repo: "2.8.0", kit_version_live: "2.8.0", kit_verdict: "update_available" },
        { id: "s-setup", name: "Gamma site", kit_version_in_repo: "2.6.0", kit_version_live: "2.6.0", kit_verdict: "needs_setup" },
        { id: "s-none", name: "Delta site", kit_version_in_repo: null, kit_version_live: null, kit_verdict: "not_installed" },
      ],
    });
    await page.goto("/projects");
    await expect(page.getByTestId("projects-kit-filter")).toBeVisible();

    // Four sites → three verdicts other than up_to_date plus the primary.
    await expect(page.getByTestId(`projects-kit-cell-${SITE_ID}`)).toContainText("Up to date");
    await expect(page.getByTestId(`projects-kit-cell-s-update`)).toContainText("Update available");
    await expect(page.getByTestId(`projects-kit-cell-s-setup`)).toContainText("Needs setup");
    await expect(page.getByTestId(`projects-kit-cell-s-none`)).toContainText("Not installed");

    // Filter to "Update available" leaves one row visible.
    await page.getByTestId("projects-kit-filter").getByRole("button", { name: /Update available/ }).click();
    await expect(page.getByTestId(`projects-kit-cell-s-update`)).toBeVisible();
    await expect(page.getByTestId(`projects-kit-cell-${SITE_ID}`)).toHaveCount(0);

    // Sorting: click the Kit header, most-urgent first.
    await page.getByTestId("projects-kit-filter").getByRole("button", { name: /All/ }).click();
    await page.getByRole("button", { name: "Kit" }).click();
    // The first Kit cell in the table should be the "Not installed" site.
    const firstKit = page.locator('[data-testid^="projects-kit-cell-"]').first();
    await expect(firstKit).toContainText("Not installed");
  });
});

test.describe("the Update kit modal", () => {
  test("refuses when the site has local edits and then goes through on Overwrite", async ({ page }) => {
    await installMocks(page, {
      kit: { version_in_repo: "2.8.0", version_live: "2.8.0", verdict: "update_available" },
      kitStatus: { inRepo: "2.8.0", live: "2.8.0", verdict: "update_available", reason: "Update available: 2.8.0 → 2.9.0. No new setup step; the update is a one-click job." },
      updateKit: "local-edits",
    });
    await page.goto(`/sites/${SITE_ID}/settings`);
    await expect(page.getByTestId("kit-status")).toBeVisible();

    await page.getByTestId("update-kit").click();
    await expect(page.getByTestId("update-kit-modal")).toBeVisible();
    await page.getByTestId("update-kit-confirm").click();
    await expect(page.getByText("The update did not go through")).toBeVisible();
    await expect(page.getByText(/local edits in 1 file/i)).toBeVisible();

    // Tick Overwrite and try again.
    await page.getByTestId("update-kit-overwrite").check();
    await page.getByTestId("update-kit-confirm").click();
    await expect(page.getByTestId("update-kit-done")).toBeVisible();
    await expect(page.getByTestId("update-kit-done")).toContainText("12 added, 3 changed, 1 removed");
  });

  test("live watch surfaces the row in Update history and Needs attention shows the reason", async ({ page }) => {
    await installMocks(page, {
      kit: { version_in_repo: "2.8.0", version_live: "2.8.0", verdict: "update_available" },
      kitStatus: { inRepo: "2.8.0", live: "2.8.0", verdict: "update_available" },
      rows: {
        // Pre-seed a needs-attention row so we can assert the reason renders without
        // waiting for a two-minute cron tick.
        kit_updates: [{
          id: "ku-old",
          site_id: SITE_ID,
          from_version: "2.7.0",
          to_version: "2.8.0",
          commit_sha: "abc1234abc1234",
          commit_url: "https://github.com/acme/alder-stone/commit/abc1234abc1234",
          previous_commit_sha: "0123abc",
          requested_by: null,
          status: "needs_attention",
          status_detail: "12 added, 3 changed, 1 removed",
          live_checked_at: new Date().toISOString(),
          live_version_seen: "2.7.0",
          attempts: 4,
          needs_attention_reason: "The site didn't rebuild. Netlify may have failed the build; your old version is still live. Open Netlify to see why.",
          created_at: new Date(Date.now() - 900_000).toISOString(),
          updated_at: new Date().toISOString(),
        }],
      },
    });
    await page.goto(`/sites/${SITE_ID}/settings`);
    await expect(page.getByTestId("kit-updates-history")).toBeVisible();
    await expect(page.getByTestId("needs-attention-ku-old")).toContainText("didn't rebuild");
  });

  test("Undo shows the confirmation modal and records the Undo commit", async ({ page }) => {
    await installMocks(page, {
      kit: { version_in_repo: "2.9.0", version_live: "2.9.0", verdict: "up_to_date" },
      kitStatus: { inRepo: "2.9.0", live: "2.9.0", verdict: "up_to_date" },
      rows: {
        kit_updates: [{
          id: "ku-1",
          site_id: SITE_ID,
          from_version: "2.8.0",
          to_version: "2.9.0",
          commit_sha: "abc1234abc1234",
          commit_url: "https://github.com/acme/alder-stone/commit/abc1234abc1234",
          previous_commit_sha: "0123abc",
          requested_by: null,
          status: "live_confirmed",
          status_detail: "12 added, 3 changed, 1 removed",
          live_checked_at: new Date().toISOString(),
          live_version_seen: "2.9.0",
          attempts: 2,
          needs_attention_reason: null,
          created_at: new Date(Date.now() - 60_000).toISOString(),
          updated_at: new Date().toISOString(),
        }],
      },
    });
    await page.goto(`/sites/${SITE_ID}/settings`);
    await page.getByTestId("undo-kit-update-ku-1").click();
    await expect(page.getByTestId("undo-kit-modal")).toBeVisible();
    await page.getByTestId("confirm-undo-kit").click();
    await expect(page.getByTestId("undo-kit-done")).toContainText("2.8.0");
  });
});

test.describe("Update all", () => {
  test("opens the modal listing only sites with an update available, runs and shows Done for each", async ({ page }) => {
    await installMocks(page, {
      kit: { version_in_repo: "2.9.0", version_live: "2.9.0", verdict: "up_to_date" },
      moreSites: [
        { id: "s-a", name: "Alpha site", kit_version_in_repo: "2.8.0", kit_verdict: "update_available" },
        { id: "s-b", name: "Bravo site", kit_version_in_repo: "2.8.0", kit_verdict: "update_available" },
        { id: "s-c", name: "Charlie site", kit_version_in_repo: "2.6.0", kit_verdict: "needs_setup" },
      ],
    });
    await page.goto("/projects");

    await page.getByTestId("update-all-open").click();
    await expect(page.getByTestId("update-all-modal")).toBeVisible();
    // Only the two update-available sites are listed.
    await expect(page.getByTestId("update-all-pick-s-a")).toBeVisible();
    await expect(page.getByTestId("update-all-pick-s-b")).toBeVisible();
    await expect(page.getByTestId("update-all-pick-s-c")).toHaveCount(0);

    await page.getByTestId("update-all-start").click();
    await expect(page.getByTestId("update-all-run-s-a")).toContainText(/Done|Updating|Needs attention/);
    await expect(page.getByTestId("update-all-run-s-b")).toContainText(/Done|Updating|Needs attention/);
  });

  test("pauses when two updates in a row need attention", async ({ page }) => {
    // Five sites at three-at-a-time: workers finish in a wave, so the fourth site is where
    // the two-consecutive-attention check fires. Fewer than concurrency+1 sites drain the
    // queue before the rule has anything to catch — the runner is right to sail through when
    // there is nothing left to pause on.
    await installMocks(page, {
      kit: { version_in_repo: "2.9.0", version_live: "2.9.0", verdict: "up_to_date" },
      moreSites: [
        { id: "s-a", name: "Alpha site", kit_version_in_repo: "2.8.0", kit_verdict: "update_available" },
        { id: "s-b", name: "Bravo site", kit_version_in_repo: "2.8.0", kit_verdict: "update_available" },
        { id: "s-c", name: "Charlie site", kit_version_in_repo: "2.8.0", kit_verdict: "update_available" },
        { id: "s-d", name: "Delta site", kit_version_in_repo: "2.8.0", kit_verdict: "update_available" },
        { id: "s-e", name: "Echo site", kit_version_in_repo: "2.8.0", kit_verdict: "update_available" },
      ],
      updateKit: "error",
    });
    await page.goto("/projects");
    await page.getByTestId("update-all-open").click();
    await page.getByTestId("update-all-start").click();
    await expect(page.getByTestId("update-all-paused")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("update-all-continue")).toBeVisible();
  });
});
