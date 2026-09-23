import { expect, test } from "@playwright/test";
import { DEMO_SITE_URL } from "./mocks.ts";

/**
 * The kit's builder CSS must never change how a registered site section renders. The demo
 * site's /section-parity page renders one hand-coded section twice — bare, and the way the
 * builder renders it (inside `.ae-root`, wrapped in `.ae-site-section`, with the whole kit
 * stylesheet applied). The section leans on browser defaults, including a bordered
 * content-box `::before` circle. Both renderings must come out pixel-for-pixel identical.
 */
test.describe("builder CSS never changes how a site section renders", () => {
  test("a registered section renders identically with and without ArmatureSlot wrapping", async ({ page }) => {
    await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());
    await page.goto(`${DEMO_SITE_URL}/section-parity`, { waitUntil: "domcontentloaded" });

    const bare = page.locator("#parity-bare .parity");
    const wrapped = page.locator("#parity-wrapped .parity");
    await expect(bare).toBeVisible();
    await expect(wrapped).toBeVisible();

    // The wrapped copy really goes through the builder path: .ae-root > .ae-site-section,
    // with the kit stylesheet (box-sizing reset and all) injected on the page.
    await expect(page.locator("#parity-wrapped .ae-root .ae-site-section .parity")).toHaveCount(1);
    expect(await page.locator("#parity-wrapped style[data-armature-page='parity']").count()).toBeGreaterThan(0);

    // The bordered circle relies on the browser default (content-box). The kit's reset must
    // not reach it, so it stays 26px content + 2px border in both contexts — never the 22px
    // it shrank to when the reset leaked in.
    const beforeBox = (selector: string) =>
      page.locator(selector).evaluate((el) => {
        const step = el.querySelector(".parity-step");
        if (!step) throw new Error("missing .parity-step");
        const s = getComputedStyle(step, "::before");
        return { width: s.width, height: s.height, boxSizing: s.boxSizing };
      });
    const bareBox = await beforeBox("#parity-bare .parity");
    const wrappedBox = await beforeBox("#parity-wrapped .parity");
    expect(wrappedBox).toEqual(bareBox);
    expect(wrappedBox).toEqual({ width: "26px", height: "26px", boxSizing: "content-box" });

    // ...and the whole section is pixel-for-pixel identical. The two copies are stacked at
    // the same absolute coordinate, so we screenshot each with the other hidden: same
    // position, same sub-pixel alignment, so any pixel difference is a real CSS leak.
    const setHidden = (selector: string, hidden: boolean) =>
      page.locator(selector).evaluate((el, h) => {
        (el as HTMLElement).style.visibility = h ? "hidden" : "visible";
      }, hidden);

    await setHidden("#parity-wrapped", true);
    const bareShot = await bare.screenshot();
    await setHidden("#parity-wrapped", false);
    await setHidden("#parity-bare", true);
    const wrappedShot = await wrapped.screenshot();
    await setHidden("#parity-bare", false);

    expect(Buffer.compare(bareShot, wrappedShot)).toBe(0);
  });
});
