import { describe, expect, it } from "vitest";
import { switchTarget, type SiteOption } from "./siteSwitch.ts";

const connected: SiteOption = { id: "b", name: "Beta", status: "connected" };
const hostingOnly: SiteOption = { id: "h", name: "Hosted", status: "hosting_only" };

describe("switching site keeps the section when the other site has it", () => {
  it("lands on the same section", () => {
    expect(switchTarget("/sites/a/pages", "a", connected, true)).toBe("/sites/b/pages");
    expect(switchTarget("/sites/a/contact", "a", connected, false)).toBe("/sites/b/contact");
    expect(switchTarget("/sites/a/settings", "a", connected, true)).toBe("/sites/b/settings");
  });
  it("drops what is deeper than the section: a page, a request, a settings tab belong to the site being left", () => {
    expect(switchTarget("/sites/a/pages/home", "a", connected, true)).toBe("/sites/b/pages");
    expect(switchTarget("/sites/a/requests/123", "a", connected, false)).toBe("/sites/b/requests");
    expect(switchTarget("/sites/a/settings/services", "a", connected, true)).toBe("/sites/b/settings");
  });
  it("falls back to the dashboard when the section is not in that site's menu", () => {
    expect(switchTarget("/sites/a/pages", "a", hostingOnly, true)).toBe("/sites/h");
    expect(switchTarget("/sites/a/appearance", "a", hostingOnly, true)).toBe("/sites/h");
    expect(switchTarget("/sites/a/settings", "a", connected, false)).toBe("/sites/b");
    expect(switchTarget("/sites/a/history", "a", connected, true)).toBe("/sites/b");
    expect(switchTarget("/sites/a/nothing-here", "a", connected, true)).toBe("/sites/b");
  });
  it("the dashboard, and anywhere outside the site, land on the dashboard", () => {
    expect(switchTarget("/sites/a", "a", connected, true)).toBe("/sites/b");
    expect(switchTarget("/sites/a/", "a", connected, true)).toBe("/sites/b");
    expect(switchTarget("/account", "a", connected, false)).toBe("/sites/b");
  });
});
