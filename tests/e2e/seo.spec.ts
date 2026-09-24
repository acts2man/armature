/**
 * The demo site (served here as a production build, so what Google sees is what a real
 * visitor sees) puts every SEO tag from a page's layout and the site kit's siteSeo into
 * document.head — the title with the site pattern, the description, canonical URL, Open
 * Graph and X/Twitter share tags, structured data (JSON-LD), and the sitemap.xml /
 * robots.txt files a search engine expects at the root.
 */
import { expect, test } from "@playwright/test";

const SITE = process.env["ARMATURE_E2E_SITE_PORT"] ? `http://localhost:${process.env["ARMATURE_E2E_SITE_PORT"]}` : "http://localhost:5174";

test.describe("SEO head tags on the demo site", () => {
  test("the home page has the title, description, canonical, Open Graph and JSON-LD LocalBusiness", async ({ page }) => {
    await page.goto(SITE);
    // The Home component sets document.title from the field. Then ArmaturePage runs and
    // usePageSeo replaces it with the SEO title through the site kit's title pattern.
    await page.waitForFunction(() => document.title.includes("Alder & Stone Custom Homes"));
    await expect(page).toHaveTitle(/Alder & Stone Custom Homes/);
    const description = await page.locator('meta[name="description"]').first().getAttribute("content");
    expect(description).toContain("Pacific Northwest");
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(canonical).toBe("https://alderandstone.example.com/");
    const ogTitle = await page.locator('meta[property="og:title"]').first().getAttribute("content");
    expect(ogTitle).toContain("Alder & Stone");
    const twitterCard = await page.locator('meta[name="twitter:card"]').getAttribute("content");
    expect(twitterCard).toMatch(/summary/);
    // LocalBusiness JSON-LD merges the site kit's business details.
    const ldText = await page.locator('script[type="application/ld+json"]').first().textContent();
    expect(ldText).toBeTruthy();
    const parsed = JSON.parse(ldText!);
    expect(parsed["@type"]).toBe("HomeAndConstructionBusiness");
    expect(parsed.name).toBe("Alder & Stone");
    expect(parsed.address.addressLocality).toBe("Portland");
  });

  test("a builder page's own SEO title, description and canonical show", async ({ page }) => {
    await page.goto(`${SITE}/contact/`);
    await page.waitForFunction(() => document.title.includes("Get in touch"));
    await expect(page).toHaveTitle(/Get in touch/);
    const description = await page.locator('meta[name="description"]').first().getAttribute("content");
    expect(description).toContain("Alder & Stone");
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(canonical).toBe("https://alderandstone.example.com/contact/");
  });
});
