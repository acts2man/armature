/**
 * The visitor beacon in the kit: bot / DNT / GPC / prerender detection, the payload
 * shape, and (via a fake window) that sendBeacon is called only when the visitor is
 * a real person on a real page.
 */
import { describe, expect, it, vi } from "vitest";
import { buildBeaconPayload, sendBeacon, shouldSkipBeacon } from "../../kit/stats.ts";

type FakeWin = { navigator: Partial<Navigator> & { sendBeacon?: (url: string, data: BodyInit) => boolean; doNotTrack?: string; globalPrivacyControl?: boolean }; location: { pathname: string; search: string; host: string; origin?: string }; document: { referrer: string; visibilityState?: string } | null; innerWidth: number; addEventListener?: () => void; removeEventListener?: () => void };

function makeWindow(over: Partial<FakeWin> = {}): FakeWin {
  return {
    navigator: { userAgent: "Mozilla/5.0 Chrome/120", doNotTrack: undefined, globalPrivacyControl: false, ...over.navigator } as FakeWin["navigator"],
    location: { pathname: "/about/", search: "", host: "example.com", origin: "https://example.com", ...over.location } as FakeWin["location"],
    document: { referrer: "", visibilityState: "visible", ...over.document } as FakeWin["document"],
    innerWidth: 1200,
    ...over,
  };
}

describe("shouldSkipBeacon", () => {
  it("skips bots by user agent", () => {
    expect(shouldSkipBeacon(makeWindow({ navigator: { userAgent: "Googlebot/2.1" } }) as unknown as Window)).toBe(true);
  });
  it("skips visitors with DNT or Global Privacy Control", () => {
    expect(shouldSkipBeacon(makeWindow({ navigator: { userAgent: "Chrome", doNotTrack: "1" } }) as unknown as Window)).toBe(true);
    expect(shouldSkipBeacon(makeWindow({ navigator: { userAgent: "Chrome", globalPrivacyControl: true } }) as unknown as Window)).toBe(true);
  });
  it("skips the editor preview iframe (?armature=edit)", () => {
    expect(shouldSkipBeacon(makeWindow({ location: { pathname: "/", search: "?armature=edit", host: "x" } }) as unknown as Window)).toBe(true);
  });
  it("skips a prerendered document", () => {
    expect(shouldSkipBeacon(makeWindow({ document: { referrer: "", visibilityState: "prerender" } }) as unknown as Window)).toBe(true);
  });
  it("counts a normal visitor", () => {
    expect(shouldSkipBeacon(makeWindow() as unknown as Window)).toBe(false);
  });
});

describe("buildBeaconPayload", () => {
  const siteId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  it("puts the path, siteId, device and screen bucket in the payload", () => {
    const payload = buildBeaconPayload(makeWindow() as unknown as Window, siteId);
    expect(payload).toMatchObject({ siteId, path: "/about/", device: "desktop", screenBucket: "lg" });
  });
  it("does not report a same-origin referrer", () => {
    const payload = buildBeaconPayload(makeWindow({ document: { referrer: "https://example.com/other/" }, location: { pathname: "/", search: "", host: "example.com" } }) as unknown as Window, siteId);
    expect(payload?.referrerHost).toBeNull();
  });
  it("reports the referrer's host on a cross-origin arrival", () => {
    const payload = buildBeaconPayload(makeWindow({ document: { referrer: "https://google.com/search?q=stuff" } }) as unknown as Window, siteId);
    expect(payload?.referrerHost).toBe("google.com");
  });
  it("buckets phones and tablets", () => {
    expect(buildBeaconPayload(makeWindow({ navigator: { userAgent: "iPhone" }, innerWidth: 380 }) as unknown as Window, siteId)?.device).toBe("mobile");
    expect(buildBeaconPayload(makeWindow({ navigator: { userAgent: "iPad" }, innerWidth: 900 }) as unknown as Window, siteId)?.device).toBe("tablet");
  });
});

describe("sendBeacon", () => {
  const siteId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  it("calls navigator.sendBeacon with the JSON payload for a real visitor", () => {
    const sent: { url: string; body: string }[] = [];
    const beacon = vi.fn((url: string, data: BodyInit) => {
      sent.push({ url, body: String(data) });
      return true;
    });
    const win = makeWindow({ navigator: { userAgent: "Chrome", sendBeacon: beacon } }) as unknown as Window;
    sendBeacon(win, { endpoint: "https://api.example.com/ingest", siteId });
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(sent[0]?.url).toBe("https://api.example.com/ingest");
  });
  it("does not call sendBeacon for a bot", () => {
    const beacon = vi.fn(() => true);
    const win = makeWindow({ navigator: { userAgent: "Googlebot", sendBeacon: beacon } }) as unknown as Window;
    sendBeacon(win, { endpoint: "https://api.example.com/ingest", siteId });
    expect(beacon).not.toHaveBeenCalled();
  });
});
