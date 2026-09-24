/**
 * Live-version watch after an Update kit or Undo commit.
 *
 * The pg_cron job (see 20260924000900_kit_live_watch.sql) fires every two
 * minutes, calling check-kit-live with a Vault-minted token. For every
 * kit_updates row still in `commit_pushed` or `undo_pushed` and created
 * within the last fifteen minutes, this module fetches the site's live URL,
 * reads the data-armature-kit attribute, and updates the row:
 *   - the target version showed up → `live_confirmed` (or `undo_confirmed`)
 *   - the row is older than 15 minutes and still no match → `needs_attention`
 *     with a plain-English reason
 *   - anything else → increment `attempts` and try again next tick
 *
 * When the live version matches, sites.kit_version_live is also refreshed so
 * the Projects Kit column reflects reality without a separate probe.
 *
 * All the moving parts are functions (no globals) so it stays testable without
 * Deno.serve. `fetchImpl` is injectable; `now` is injectable.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { adminClient } from "./auth.ts";
import { type Env } from "./env.ts";

export const KIT_LIVE_TOKEN_HEADER = "x-armature-token";
export const KIT_LIVE_WINDOW_MS = 15 * 60 * 1000;

// deno-lint-ignore no-explicit-any
export type KitLiveDb = SupabaseClient<any, "public", any>;

export type PendingRow = {
  id: string;
  site_id: string;
  to_version: string;
  status: "commit_pushed" | "undo_pushed";
  created_at: string;
  attempts: number;
};

export type SiteLiveRow = { id: string; live_url: string | null };

export type KitLiveOutcome = { id: string; verdict: "confirmed" | "attention" | "still_waiting"; live: string | null; reason?: string };

const LIVE_ATTR_RE = /data-armature-kit\s*=\s*["']([^"']+)["']/i;

const NEEDS_ATTENTION_REASON =
  "The site didn't rebuild. Netlify may have failed the build; your old version is still live. Open Netlify to see why.";

export function parseLiveKitVersion(html: string): string | null {
  const match = html.match(LIVE_ATTR_RE);
  return match?.[1] ?? null;
}

/** Read the token header (either casing). Empty when missing. */
export function tokenFromRequest(req: Request): string {
  return (req.headers.get(KIT_LIVE_TOKEN_HEADER) ?? req.headers.get("X-Armature-Token") ?? "").trim();
}

/** Ask the database whether the token matches the Vault secret. */
export async function verifyToken(db: KitLiveDb, candidate: string): Promise<boolean> {
  if (!candidate) return false;
  const { data, error } = await db.rpc("armature_check_kit_live_token", { candidate });
  if (error) {
    console.error("[check-kit-live] token check failed:", error.message);
    return false;
  }
  return data === true;
}

export type FetchLiveOptions = {
  liveUrl: string;
  fetchImpl?: typeof fetch;
};

export async function fetchLiveKitVersion({ liveUrl, fetchImpl }: FetchLiveOptions): Promise<string | null> {
  try {
    const impl = fetchImpl ?? fetch;
    const response = await impl(liveUrl, { redirect: "follow", headers: { "user-agent": "armature-kit-live-watch" } });
    if (!response.ok) return null;
    const html = await response.text();
    return parseLiveKitVersion(html);
  } catch {
    return null;
  }
}

export function classify(
  row: PendingRow,
  live: string | null,
  now: number,
): { verdict: "confirmed" | "attention" | "still_waiting"; nextStatus: PendingRow["status"] | "live_confirmed" | "undo_confirmed" | "needs_attention"; reason: string | null } {
  if (live === row.to_version) {
    return {
      verdict: "confirmed",
      nextStatus: row.status === "undo_pushed" ? "undo_confirmed" : "live_confirmed",
      reason: null,
    };
  }
  const ageMs = now - new Date(row.created_at).getTime();
  if (ageMs >= KIT_LIVE_WINDOW_MS) {
    return { verdict: "attention", nextStatus: "needs_attention", reason: NEEDS_ATTENTION_REASON };
  }
  return { verdict: "still_waiting", nextStatus: row.status, reason: null };
}

export type PollHooks = {
  now?: () => number;
  fetchImpl?: typeof fetch;
};

/**
 * Fetch every pending row, poll the live URL, update rows and return per-row
 * outcomes. Rows for sites without a `live_url` are marked `needs_attention`
 * immediately with a clear reason — Armature can't watch what it can't see.
 */
export async function pollPendingKitUpdates(db: KitLiveDb, hooks: PollHooks = {}): Promise<KitLiveOutcome[]> {
  const now = hooks.now?.() ?? Date.now();
  const fetchImpl = hooks.fetchImpl ?? fetch;
  const cutoffIso = new Date(now - KIT_LIVE_WINDOW_MS).toISOString();

  const { data, error } = await db
    .from("kit_updates")
    .select("id, site_id, to_version, status, created_at, attempts")
    .in("status", ["commit_pushed", "undo_pushed"])
    .gte("created_at", new Date(now - KIT_LIVE_WINDOW_MS * 2).toISOString())
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw new Error(`could not read pending kit_updates: ${error.message}`);
  const rows = (data ?? []) as PendingRow[];

  const outcomes: KitLiveOutcome[] = [];
  for (const row of rows) {
    const { data: siteRow } = await db.from("sites").select("id, live_url").eq("id", row.site_id).maybeSingle();
    const site = siteRow as SiteLiveRow | null;
    if (!site || !site.live_url) {
      const reason =
        "The site has no live URL saved yet, so Armature can't check the live version. Set the live URL under Site settings → Connection and press Check kit again.";
      await db
        .from("kit_updates")
        .update({
          status: "needs_attention",
          needs_attention_reason: reason,
          live_checked_at: new Date(now).toISOString(),
          attempts: row.attempts + 1,
        })
        .eq("id", row.id);
      outcomes.push({ id: row.id, verdict: "attention", live: null, reason });
      continue;
    }

    const live = await fetchLiveKitVersion({ liveUrl: site.live_url, fetchImpl });
    const verdict = classify(row, live, now);
    const updates: Record<string, unknown> = {
      attempts: row.attempts + 1,
      live_checked_at: new Date(now).toISOString(),
      live_version_seen: live,
      status: verdict.nextStatus,
    };
    if (verdict.reason) updates.needs_attention_reason = verdict.reason;
    await db.from("kit_updates").update(updates).eq("id", row.id);

    if (verdict.verdict === "confirmed" && live) {
      await db
        .from("sites")
        .update({ kit_version_live: live, kit_probed_at: new Date(now).toISOString() })
        .eq("id", row.site_id);
    }

    outcomes.push({ id: row.id, verdict: verdict.verdict, live, reason: verdict.reason ?? undefined });
  }

  // Rows older than the window that somehow slipped through (query skipped them because their
  // status was already changed): nothing to do — the initial WHERE excluded them.
  void cutoffIso;
  return outcomes;
}

export type HandlerHooks = PollHooks & { db?: KitLiveDb };

/**
 * Full request handler. Answers `{ ok: true, checked: [] }` without touching
 * anything when the token doesn't match, so an attacker probing the endpoint
 * learns nothing about pending updates.
 */
export async function handleCheckKitLiveRequest(env: Env, req: Request, hooks: HandlerHooks = {}): Promise<{ ok: true; checked: KitLiveOutcome[] }> {
  const db = hooks.db ?? adminClient(env);
  const candidate = tokenFromRequest(req);
  const allowed = await verifyToken(db, candidate);
  if (!allowed) {
    console.warn("[check-kit-live] rejected caller without a valid X-Armature-Token");
    return { ok: true, checked: [] };
  }
  const checked = await pollPendingKitUpdates(db, hooks);
  return { ok: true, checked };
}
