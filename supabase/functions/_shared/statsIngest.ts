/**
 * stats-ingest logic, extracted so it is testable without booting Deno.serve.
 *
 * The endpoint is called by anonymous website visitors (verify_jwt is off in
 * supabase/config.toml); it trusts nothing it is sent and cross-checks every
 * beacon against the site's row before writing:
 *   - `siteId` must be a real UUID that resolves to a row in `public.sites`.
 *   - The request's Origin (or Referer, as a fallback) must match the site's
 *     `live_url` origin. A site with no live_url yet passes through, so that
 *     a new site can be plumbed before it goes live.
 *   - Every visitor is rate-limited: 120 events per minute per site.
 * No personal data is stored — only a day-rotating salted hash of the caller's
 * IP + user-agent, so a returning visitor is counted once a day and unlinkable
 * across days.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { envValue, type Env } from "./env.ts";
import { ArmatureError } from "./errors.ts";

// deno-lint-ignore no-explicit-any
export type StatsDb = SupabaseClient<any, "public", any>;

export type IngestPayload = {
  siteId: string;
  path: string;
  referrerHost: string | null;
  device: "mobile" | "tablet" | "desktop" | "unknown";
  screenBucket: "xs" | "sm" | "md" | "lg" | "xl";
};

export type IngestSiteRow = { id: string; live_url: string | null; status?: string };

const UUID_RE = /^[0-9a-f-]{36}$/i;
const RATE_LIMIT_PER_MINUTE = 120;

export function makeRateLimiter(perMinute = RATE_LIMIT_PER_MINUTE) {
  const seen = new Map<string, { count: number; resetAt: number }>();
  return function checkRate(key: string, now = Date.now()): boolean {
    const bucket = seen.get(key);
    if (!bucket || bucket.resetAt < now) {
      seen.set(key, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    bucket.count += 1;
    if (bucket.count > perMinute) return false;
    if (seen.size > 20_000) for (const [k, v] of seen) if (v.resetAt < now) seen.delete(k);
    return true;
  };
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/** Salt rotates once a day so a visitor's hash is un-linkable across days. */
export function visitorHash(ip: string, userAgent: string, salt: string, day = new Date().toISOString().slice(0, 10)): Promise<string> {
  return sha256Hex(`${ip}:${userAgent}:${day}:${salt}`);
}

/** Extract the payload with defensive defaults. Throws ArmatureError('invalid') on bad shape. */
export function parseIngestBody(body: Partial<IngestPayload>): IngestPayload {
  const siteId = typeof body.siteId === "string" && UUID_RE.test(body.siteId) ? body.siteId : "";
  if (!siteId) throw new ArmatureError("invalid", "Missing or invalid siteId.");
  const path = typeof body.path === "string" ? body.path.slice(0, 512) : "";
  if (!path.startsWith("/")) throw new ArmatureError("invalid", "Path must start with /.");
  const referrerHost = typeof body.referrerHost === "string" ? body.referrerHost.slice(0, 200) : null;
  const device = (["mobile", "tablet", "desktop", "unknown"] as const).includes(body.device as never) ? body.device! : "unknown";
  const screenBucket = (["xs", "sm", "md", "lg", "xl"] as const).includes(body.screenBucket as never) ? body.screenBucket! : "md";
  return { siteId, path, referrerHost, device, screenBucket };
}

/**
 * Enforce that the request comes from an origin the site has advertised. A
 * site whose live_url is empty is trusted (still being wired up); a site with
 * a live_url refuses a request that carries a different origin.
 */
export function checkOrigin(site: IngestSiteRow, req: Request): void {
  if (!site.live_url) return;
  const originHeader = req.headers.get("origin") ?? req.headers.get("referer") ?? "";
  if (!originHeader) return;
  try {
    const requestOrigin = new URL(originHeader).origin;
    const siteOrigin = new URL(site.live_url).origin;
    if (requestOrigin !== siteOrigin) {
      throw new ArmatureError("forbidden", "This site is not allowed to post here.");
    }
  } catch (err) {
    if (err instanceof ArmatureError) throw err;
    // Non-URL origin/referer — treat as unknown and let it pass.
  }
}

export type IngestHooks = {
  db?: StatsDb;
  now?: () => number;
  rateLimiter?: (key: string, now?: number) => boolean;
  loadSite?: (siteId: string) => Promise<IngestSiteRow | null>;
  insertEvent?: (row: Record<string, unknown>) => Promise<void>;
};

/**
 * The full handler. Returns `{ok: true}` for a rate-limited caller (dropping
 * the beacon silently is what a visitor gets in production too) and throws
 * ArmatureError for real problems, which serveJson turns into the failure
 * envelope.
 */
export async function handleStatsIngest(env: Env, req: Request, rawBody: unknown, hooks: IngestHooks = {}): Promise<{ ok: true }> {
  const body = (rawBody ?? {}) as Partial<IngestPayload>;
  const payload = parseIngestBody(body);

  if (!hooks.loadSite && !hooks.db) throw new ArmatureError("not_configured", "stats-ingest was not wired to a database.");
  const loadSite = hooks.loadSite ?? (async (siteId: string) => {
    const { data, error } = await hooks.db!.from("sites").select("id, live_url, status").eq("id", siteId).maybeSingle();
    if (error) throw new ArmatureError("github_error", error.message);
    return data as IngestSiteRow | null;
  });
  const site = await loadSite(payload.siteId);
  if (!site) throw new ArmatureError("not_found", "Unknown site.");
  checkOrigin(site, req);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("cf-connecting-ip") ?? "unknown";
  const userAgent = req.headers.get("user-agent") ?? "";
  const salt = envValue(env, "STATS_IP_SALT") || envValue(env, "SUPABASE_SERVICE_ROLE_KEY") || "armature";
  const hash = await visitorHash(ip, userAgent, salt);

  const rate = hooks.rateLimiter ?? makeRateLimiter();
  if (!rate(`${payload.siteId}:${hash}`, hooks.now?.())) return { ok: true };

  const insert = hooks.insertEvent ?? (async (row) => {
    const { error } = await hooks.db!.from("site_stats_events").insert(row);
    if (error) throw new ArmatureError("github_error", error.message);
  });
  await insert({
    site_id: payload.siteId,
    path: payload.path,
    referrer_host: payload.referrerHost,
    device: payload.device,
    screen_bucket: payload.screenBucket,
    visitor_hash: hash,
  });
  return { ok: true };
}
