/**
 * Add a site — the repository dropdown.
 *
 * Guards the pagination fix (previously only 100 repositories loaded):
 *   - A repo from "page 3" (index 250, when the mock returns 275) shows up in
 *     the searchable list and can be clicked to fill the input.
 *   - The count reads "275 repositories".
 *   - Anywhere-in-name matching filters by a substring in the middle of the
 *     repository name.
 *   - The "Don't see it?" hint only appears when the typed repository is truly
 *     absent from the fetched set.
 */
import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks.ts";

const TOTAL = 275;

function fakeRepos(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    installation_id: 123,
    account_login: "acts2man",
    owner: "acts2man",
    name: `armature-repo-${String(index + 1).padStart(3, "0")}`,
    full_name: `acts2man/armature-repo-${String(index + 1).padStart(3, "0")}`,
    private: index % 5 === 0,
    default_branch: "main",
  }));
}

test.describe("Add a site › repository picker", () => {
  test("shows a repository from page 3, matches substrings anywhere, and reports the count", async ({ page }) => {
    await installMocks(page, {
      githubSetup: {
        installations: [{ installation_id: 123, account_login: "acts2man", account_type: "Organization" }],
        repositories: fakeRepos(TOTAL),
      },
    });
    await page.goto("/sites/new");

    await expect(page.getByTestId("repo-list-count")).toContainText(`${TOTAL} repositories`);

    // Open the combobox and type a substring found in the middle of a page-3 name.
    await page.getByTestId("add-site-repo-input").click();
    await page.getByTestId("add-site-repo-input").fill("repo-260");
    await expect(page.getByTestId("add-site-repo-listbox")).toBeVisible();
    const target = "acts2man/armature-repo-260";
    await page.getByTestId(`repo-option-${target.replace("/", "--")}`).click();
    await expect(page.getByTestId("add-site-repo-input")).toHaveValue(target);
  });

  test("shows the page-cap warning when the server reports it hit the cap", async ({ page }) => {
    await installMocks(page, {
      githubSetup: {
        installations: [{ installation_id: 123, account_login: "acts2man", account_type: "Organization" }],
        repositories: fakeRepos(100),
        pageCapHit: true,
        pageCap: 3,
      },
    });
    await page.goto("/sites/new");
    await expect(page.getByText(/Only the first 300 repositories are shown/i)).toBeVisible();
  });

  test("only shows the 'Don't see it?' hint when the typed repo is not in the fetched set", async ({ page }) => {
    await installMocks(page, {
      githubSetup: {
        installations: [{ installation_id: 123, account_login: "acts2man", account_type: "Organization" }],
        repositories: fakeRepos(TOTAL),
      },
    });
    await page.goto("/sites/new");
    await page.getByTestId("add-site-repo-input").fill("acts2man/armature-repo-042");
    await expect(page.getByTestId("repo-not-listed")).toHaveCount(0);
    await page.getByTestId("add-site-repo-input").fill("acts2man/nowhere-else");
    await expect(page.getByTestId("repo-not-listed")).toBeVisible();
  });
});
