/**
 * The direct-to-connected-branch setup flow, from the pasted prompt to Undo setup.
 *
 * Covers:
 *   - The Needs setup card's prompt talks about the connected branch and BEFORE /
 *     AFTER verification — never a test-copy branch, Preview or Go live.
 *   - The old Preview / Go live UI is gone (no button, no branch-status polling).
 *   - Undo setup, under Site settings, shows a confirmation modal, calls
 *     undo-site-setup, and surfaces the resulting commit.
 *   - A site with no pre-setup snapshot sees the "no snapshot" fallback copy.
 */
import { expect, test } from "@playwright/test";
import { installMocks, SITE_ID } from "./mocks.ts";

test.describe("Needs setup — direct-to-branch prompt", () => {
  test("names the connected branch and the BEFORE / AFTER verification, and never mentions armature/setup or Go live", async ({ page }) => {
    // A site that hasn't been set up yet: no kit, needs_setup status, no live version.
    await installMocks(page, {
      moreSites: [{ id: "s-fresh", name: "Fresh site", status: "needs_setup", kit_verdict: "not_installed", kit_version_in_repo: null, kit_version_live: null }],
      kit: { verdict: "not_installed", version_in_repo: null, version_live: null },
    });
    await page.goto(`/sites/${SITE_ID}`);

    // The card renders when a site is needs_setup — here we forced it via the primary site.
    // Move to the site whose status is needs_setup to see the card.
    // (installMocks flags the primary site as needs_setup via `kit.verdict = "not_installed"` but keeps
    // its base status; the card renders whenever site.status is needs_setup.)
    // For coverage we assert the prompt text directly by opening a needs_setup site.
    await page.goto(`/sites/s-fresh`);
    await expect(page.getByTestId("needs-setup-card")).toBeVisible();

    const prompt = await page.getByTestId("needs-setup-prompt").inputValue();
    expect(prompt).toContain("directly on main");
    expect(prompt).toContain(".armature-verify/before/");
    expect(prompt).toContain(".armature-verify/after/");
    expect(prompt).toContain("DO NOT PUSH");
    expect(prompt).toContain("Undo setup");
    expect(prompt).not.toContain("armature/setup");
    expect(prompt).not.toContain("Go live");
    expect(prompt).not.toContain("Preview");
    // The old test-branch UI is gone — no Go-live button, no branch polling.
    await expect(page.getByTestId("go-live")).toHaveCount(0);
    await expect(page.getByTestId("setup-not-pushed")).toHaveCount(0);
  });
});

test.describe("Undo setup on Site settings", () => {
  test("does not offer Undo setup when there is no pre-setup snapshot", async ({ page }) => {
    await installMocks(page, { preSetupCommitSha: null });
    await page.goto(`/sites/${SITE_ID}/settings`);
    await expect(page.getByTestId("undo-setup-card")).toBeVisible();
    await expect(page.getByTestId("undo-setup-none")).toBeVisible();
    await expect(page.getByTestId("open-undo-setup")).toHaveCount(0);
  });

  test("with a snapshot, opens the modal and records the revert commit", async ({ page }) => {
    await installMocks(page, { preSetupCommitSha: "abc1234abc1234abc1234abc1234abc1234abc12" });
    await page.goto(`/sites/${SITE_ID}/settings`);
    await expect(page.getByTestId("open-undo-setup")).toBeVisible();
    await page.getByTestId("open-undo-setup").click();
    await expect(page.getByTestId("undo-setup-modal")).toBeVisible();
    await page.getByTestId("confirm-undo-setup").click();
    await expect(page.getByTestId("undo-setup-done")).toContainText("4 file");
    await expect(page.getByTestId("undo-setup-done")).toContainText("12 deleted");
  });

  test("surfaces the server's 'no snapshot' error even if the panel offered the button (a race)", async ({ page }) => {
    await installMocks(page, { preSetupCommitSha: "abc1234", undoSiteSetup: "no-snapshot" });
    await page.goto(`/sites/${SITE_ID}/settings`);
    await page.getByTestId("open-undo-setup").click();
    await page.getByTestId("confirm-undo-setup").click();
    await expect(page.getByText(/pre-setup snapshot/i)).toBeVisible();
  });
});
