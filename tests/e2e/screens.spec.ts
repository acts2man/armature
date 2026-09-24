/**
 * Every screen an agency person or a client touches, as staff and as client, at a wide
 * desktop and at a phone width: it renders, throws nothing, and never scrolls sideways.
 * Screenshots go to AUDIT_SHOTS when set (the audit in docs/AUDIT.md was read from them).
 */
import { expect, test, type Page } from "@playwright/test";
import { SITE_ID, installMocks } from "./mocks.ts";

const shots = process.env["AUDIT_SHOTS"];
const STAFF_ROUTES = ["/", "/projects", "/fleet", "/sites/new", "/agency/requests", "/agency/clients", "/agency/settings", "/agency/team", "/account", "/github/setup", `/sites/${SITE_ID}`, `/sites/${SITE_ID}/pages`, `/sites/${SITE_ID}/pages?view=trash`, `/sites/${SITE_ID}/media`, `/sites/${SITE_ID}/contact`, `/sites/${SITE_ID}/contact?tab=settings`, `/sites/${SITE_ID}/appearance`, `/sites/${SITE_ID}/appearance/header`, `/sites/${SITE_ID}/appearance/footer`, `/sites/${SITE_ID}/appearance/menus`, `/sites/${SITE_ID}/pages/home`, `/sites/${SITE_ID}/pages/shared`, `/sites/${SITE_ID}/requests`, `/sites/${SITE_ID}/requests/new`, `/sites/${SITE_ID}/users`, `/sites/${SITE_ID}/team`, `/sites/${SITE_ID}/history`, `/sites/${SITE_ID}/settings`, `/sites/${SITE_ID}/settings/services`, `/sites/${SITE_ID}/settings/editing`, `/sites/${SITE_ID}/settings/history`, `/sites/${SITE_ID}/nothing-here`, "/nothing-here"];
const CLIENT_ROUTES = ["/", "/account", `/sites/${SITE_ID}`, `/sites/${SITE_ID}/pages`, `/sites/${SITE_ID}/media`, `/sites/${SITE_ID}/contact`, `/sites/${SITE_ID}/contact?tab=settings`, `/sites/${SITE_ID}/appearance`, `/sites/${SITE_ID}/appearance/menus`, `/sites/${SITE_ID}/pages/home`, `/sites/${SITE_ID}/requests`, `/sites/${SITE_ID}/requests/new`, `/sites/${SITE_ID}/users`, `/sites/${SITE_ID}/team`, `/sites/${SITE_ID}/history`, `/sites/${SITE_ID}/settings`, "/projects", "/fleet", "/github/setup", "/agency/clients"];
const WIDTHS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
];

async function visit(page: Page, route: string, role: "staff" | "client", width: (typeof WIDTHS)[number]) {
  const errors: string[] = [];
  const onError = (error: Error) => errors.push(String(error).slice(0, 200));
  const onConsole = (message: { type: () => string; text: () => string }) => {
    if (message.type() === "error" && !/favicon|net::ERR|Failed to load resource/.test(message.text())) errors.push(message.text().slice(0, 200));
  };
  page.on("pageerror", onError);
  page.on("console", onConsole);
  await page.setViewportSize({ width: width.width, height: width.height });
  await page.goto(route);
  await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => undefined);
  await page.waitForTimeout(400);
  const heading = (await page.locator("h1").first().textContent({ timeout: 1500 }).catch(() => "")) ?? "";
  const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
  const armature = role === "client" ? await page.locator("body").evaluate((body) => /\bArmature\b/.test(body.innerText)) : false;
  if (shots) await page.screenshot({ path: `${shots}/${role}-${width.name}-${route.replace(/[^a-z0-9]+/gi, "_") || "root"}.png`, fullPage: true });
  page.off("pageerror", onError);
  page.off("console", onConsole);
  return { heading: heading.trim(), overflow, errors, armature };
}

for (const role of ["staff", "client"] as const) {
  for (const width of WIDTHS) {
    test(`${role} at ${width.name}: every screen renders without errors or sideways scroll`, async ({ page }) => {
      test.setTimeout(300_000);
      await installMocks(page, { role });
      const report: string[] = [];
      const problems: string[] = [];
      for (const route of role === "staff" ? STAFF_ROUTES : CLIENT_ROUTES) {
        const result = await visit(page, route, role, width);
        report.push(`${route}: "${result.heading}" overflow=${result.overflow}${result.errors.length ? ` errors=${JSON.stringify(result.errors)}` : ""}${result.armature ? " ARMATURE-VISIBLE" : ""}`);
        if (result.errors.length) problems.push(`${route}: ${result.errors.join(" | ")}`);
        if (result.overflow > 1) problems.push(`${route}: scrolls sideways by ${result.overflow}px`);
        if (result.armature) problems.push(`${route}: a client can see the word Armature`);
        // Agency-only screens send a client to their site rather than rendering.
        if (role === "client" && route.startsWith("/agency/") && result.heading === "Clients") problems.push(`${route}: a client reached an agency screen`);
      }
      console.log(`\n[${role} ${width.name}]\n${report.join("\n")}`);
      expect(problems, problems.join("\n")).toEqual([]);
    });
  }
}
