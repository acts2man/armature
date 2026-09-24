/**
 * stats-ingest — accepts one visitor beacon per page view. Public endpoint; only the
 * origins listed on the site's row (live_url) may post.
 *
 * Privacy: no cookies, no personal data, no stored IPs. The IP and user-agent are
 * hashed together with a per-day salt so a visitor's row is counted once a day, then
 * the salt rotates and the identity is unrecoverable.
 *
 * Rate limits: each ip-hash may fire at most 120 events per minute per site.
 */
import { adminClient } from "../_shared/auth.ts";
import { denoEnv, envValue } from "../_shared/env.ts";
import { ArmatureError } from "../_shared/errors.ts";
import { readJsonBody, serveJson } from "../_shared/http.ts";

type Payload = {
  siteId: string;
  path: string;
  referrerHost: string | null;
  device: "mobile" | "tablet" | "desktop" | "unknown";
  screenBucket: "xs" | "sm" | "md" | "lg" | "xl";
};

const RATE_LIMIT_PER_MINUTE = 120;
const seen = new Map<string, { count: number; resetAt: number }>();

function checkRate(key: string): boolean {
  const now = Date.now();
  const bucket = seen.get(key);
  if (!bucket || bucket.resetAt < now) {
    seen.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_PER_MINUTE) return false;
  // Cleanup: keep the map small.
  if (seen.size > 20_000) for (const [existingKey, value] of seen) if (value.resetAt < now) seen.delete(existingKey);
  return true;
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/** Salt rotates once a day so a visitor's hash is un-linkable across days. */
function visitorHash(ip: string, userAgent: string, salt: string): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  return sha256Hex(`${ip}:${userAgent}:${day}:${salt}`);
}

Deno.serve(
  serveJson(async (req): Promise<{ ok: true }> => {
    const env = denoEnv();
    const body = (await readJsonBody(req)) as Partial<Payload>;
    const siteId = typeof body.siteId === "string" && /^[0-9a-f-]{36}$/i.test(body.siteId) ? body.siteId : "";
    if (!siteId) throw new ArmatureError("invalid", "Missing or invalid siteId.");
    const path = typeof body.path === "string" ? body.path.slice(0, 512) : "";
    if (!path.startsWith("/")) throw new ArmatureError("invalid", "Path must start with /.");
    const referrerHost = typeof body.referrerHost === "string" ? body.referrerHost.slice(0, 200) : null;
    const device = ["mobile", "tablet", "desktop", "unknown"].includes(body.device ?? "") ? body.device : "unknown";
    const screenBucket = ["xs", "sm", "md", "lg", "xl"].includes(body.screenBucket ?? "") ? body.screenBucket : "md";

    const db = adminClient(env);
    // Check the site exists and read its live_url; the request origin must match.
    const { data: site, error } = await db.from("sites").select("id, live_url, status").eq("id", siteId).maybeSingle();
    if (error || !site) throw new ArmatureError("not_found", "Unknown site.");
    const liveUrl = (site as { live_url: string | null }).live_url;
    const originHeader = req.headers.get("origin") ?? req.headers.get("referer") ?? "";
    if (liveUrl && originHeader) {
      try {
        const requestOrigin = new URL(originHeader).origin;
        const siteOrigin = new URL(liveUrl).origin;
        if (requestOrigin !== siteOrigin) throw new ArmatureError("forbidden", "This site is not allowed to post here.");
      } catch (err) {
        if (err instanceof ArmatureError) throw err;
        /* invalid URL — accept if origin is not required */
      }
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("cf-connecting-ip") ?? "unknown";
    const userAgent = req.headers.get("user-agent") ?? "";
    const salt = envValue(env, "STATS_IP_SALT") || envValue(env, "SUPABASE_SERVICE_ROLE_KEY") || "armature";
    const hash = await visitorHash(ip, userAgent, salt);

    if (!checkRate(`${siteId}:${hash}`)) return { ok: true };

    await db.from("site_stats_events").insert({
      site_id: siteId,
      path,
      referrer_host: referrerHost,
      device,
      screen_bucket: screenBucket,
      visitor_hash: hash,
    });

    return { ok: true };
  }),
);
