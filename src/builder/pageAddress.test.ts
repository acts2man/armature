import { describe, expect, it } from "vitest";
import { pathProblem, slugFromTitle, storedPath } from "./pageAddress.ts";

describe("page addresses", () => {
  it("makes a slug from a title", () => {
    expect(slugFromTitle("Café & Kitchen — Menu!")).toBe("cafe-kitchen-menu");
    expect(slugFromTitle("   ")).toBe("");
  });
  it("refuses bad or taken addresses, but not the page's own", () => {
    const taken = new Map([["/", "Home"], ["/about", "About"]]);
    expect(pathProblem("/About Us/", taken)).toMatch(/lowercase/);
    expect(pathProblem("/../x/", taken)).toMatch(/lowercase/);
    expect(pathProblem("/about/", taken)).toBe('The page "About" already uses this address.');
    expect(pathProblem("/about/", taken, "About")).toBeNull();
    expect(pathProblem("/our-work/", taken)).toBeNull();
  });
  it("stores addresses with a trailing slash", () => {
    expect(storedPath("/Our-Work")).toBe("/our-work/");
    expect(storedPath("/")).toBe("/");
  });
});
