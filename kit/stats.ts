/**
 * The visitor-counting beacon. Off by default; on with one config line:
 *
 *   createArmatureKit({
 *     stats: { endpoint: "https://<project>.supabase.co/functions/v1/stats-ingest", siteId: "..." },
 *   });
 *
 * No cookies, no personal data, no stored IP. Skips bots, the editor preview and
 * prerendering, and respects Do Not Track / Global Privacy Control.
 */

const BOT_UA = /bot|crawler|spider|slurp|prerender|headless|preview|lighthouse/i;

export type StatsConfig = { endpoint: string; siteId: string };

export type BeaconPayload = {
  siteId: string;
  path: string;
  referrerHost: string | null;
  device: "mobile" | "tablet" | "desktop" | "unknown";
  screenBucket: "xs" | "sm" | "md" | "lg" | "xl";
  userAgent: string;
};

const bucketFor = (width: number): BeaconPayload["screenBucket"] => {
  if (width < 480) return "xs";
  if (width < 768) return "sm";
  if (width < 1200) return "md";
  if (width < 1600) return "lg";
  return "xl";
};

const deviceFor = (ua: string, width: number): BeaconPayload["device"] => {
  if (BOT_UA.test(ua)) return "unknown";
  if (/tablet|ipad/i.test(ua)) return "tablet";
  if (/mobile|iphone|android/i.test(ua) || width < 768) return "mobile";
  return "desktop";
};

/** True when the visitor has asked not to be tracked (DNT or GPC), or looks like a bot. */
export function shouldSkipBeacon(win: Window): boolean {
  const nav = win.navigator;
  if (!nav) return true;
  const dnt = (nav as unknown as { doNotTrack?: string; msDoNotTrack?: string }).doNotTrack === "1" || (nav as unknown as { msDoNotTrack?: string }).msDoNotTrack === "1";
  const gpc = (nav as unknown as { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
  if (dnt || gpc) return true;
  if (BOT_UA.test(nav.userAgent || "")) return true;
  // The editor's preview iframe sets ?armature=edit — skip so an editor's clicks never count.
  if (typeof win.location !== "undefined" && new URLSearchParams(win.location.search).has("armature")) return true;
  // Prerendering (Google's Speed Kit, browsers' link prerender).
  const doc = win.document;
  if (doc && ((doc as unknown as { prerendering?: boolean }).prerendering === true || (doc as unknown as { visibilityState?: string }).visibilityState === "prerender")) return true;
  return false;
}

/** Build the payload the beacon sends. */
export function buildBeaconPayload(win: Window, siteId: string): BeaconPayload | null {
  if (!win.location) return null;
  const nav = win.navigator;
  const ua = nav.userAgent ?? "";
  const width = win.innerWidth ?? 0;
  let referrerHost: string | null = null;
  if (win.document?.referrer) {
    try {
      const url = new URL(win.document.referrer);
      // Same-origin navigations don't count as a referrer.
      if (url.host && url.host !== win.location.host) referrerHost = url.host;
    } catch {
      /* ignore invalid */
    }
  }
  return {
    siteId,
    path: win.location.pathname + win.location.search,
    referrerHost,
    device: deviceFor(ua, width),
    screenBucket: bucketFor(width),
    userAgent: ua,
  };
}

/** Send the payload via sendBeacon or a fire-and-forget fetch. Silent on failure. */
export function sendBeacon(win: Window, config: StatsConfig): void {
  if (typeof win === "undefined") return;
  if (shouldSkipBeacon(win)) return;
  const payload = buildBeaconPayload(win, config.siteId);
  if (!payload) return;
  const body = JSON.stringify(payload);
  const nav = win.navigator as unknown as { sendBeacon?: (url: string, data: BodyInit) => boolean };
  try {
    if (typeof nav.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      nav.sendBeacon(config.endpoint, blob);
      return;
    }
  } catch {
    /* fall back */
  }
  try {
    void fetch(config.endpoint, { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true, mode: "cors", credentials: "omit" });
  } catch {
    /* silent */
  }
}

/** Install a beacon that fires on load and on client-side navigations. */
export function installStatsBeacon(config: StatsConfig): () => void {
  if (typeof window === "undefined") return () => undefined;
  const win = window as Window;
  const fire = () => sendBeacon(win, config);
  fire();
  const onNav = () => fire();
  win.addEventListener("popstate", onNav);
  win.addEventListener("armature:navigated", onNav);
  return () => {
    win.removeEventListener("popstate", onNav);
    win.removeEventListener("armature:navigated", onNav);
  };
}
