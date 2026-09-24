/**
 * agency-getting-started — save and load per-agency Getting Started state.
 *
 * The /getting-started page in the dashboard ticks sections off and lets an
 * agency paste its own walkthrough URL per section. Both live in
 * public.agency_getting_started; the row belongs to the whole agency, so a
 * staff member on any machine sees the same ticks and the same custom videos.
 *
 * POST body:
 *   { agency_id, read: true }
 *     — returns the row (or an empty one when nothing is stored yet).
 *   { agency_id, progress?: { "<section>": boolean }, video_overrides?: { "<section>": "<url>" } }
 *     — merges the patch into the row, upserting when the row does not exist.
 *
 * Only agency members (owner or staff) may read or write their own row; RLS
 * enforces this, and requireAgencyMember checks it before we touch the table
 * so a caller with no agency access gets a plain-English forbidden error.
 */
import { requireAgencyMember, resolveCaller } from "../_shared/auth.ts";
import { denoEnv } from "../_shared/env.ts";
import { ArmatureError } from "../_shared/errors.ts";
import { readJsonBody, requireUuid, serveJson } from "../_shared/http.ts";
import {
  emptyRow,
  mergePatch,
  parsePatch,
  type ProgressPatch,
  type Row,
  type VideoOverridePatch,
} from "../_shared/agencyGettingStarted.ts";

type Response = { ok: true; row: Row };

Deno.serve(
  serveJson(async (req): Promise<Response> => {
    const env = denoEnv();
    const body = await readJsonBody(req);
    const agencyId = requireUuid(body, "agency_id");
    const isRead = body["read"] === true;

    const caller = await resolveCaller(req, env);
    await requireAgencyMember(caller.supabase, agencyId, caller.userId);

    // Load the current row (if any). RLS restricts this to agency members.
    const existing = await caller.supabase
      .from("agency_getting_started")
      .select("agency_id, progress, video_overrides, created_at, updated_at")
      .eq("agency_id", agencyId)
      .maybeSingle();
    if (existing.error) {
      throw new ArmatureError("github_error", `Could not read Getting Started state: ${existing.error.message}`);
    }
    const before = existing.data as Row | null;

    if (isRead) {
      return { ok: true, row: before ?? emptyRow(agencyId) };
    }

    // Validate and merge the incoming patch. parsePatch surfaces plain-English
    // messages for every bad shape; anything past this line has been checked.
    const patch = parsePatch(body);
    const merged = mergePatch(before as { progress?: ProgressPatch; video_overrides?: VideoOverridePatch } | null, patch);

    const upsert = await caller.supabase
      .from("agency_getting_started")
      .upsert(
        {
          agency_id: agencyId,
          progress: merged.progress,
          video_overrides: merged.video_overrides,
        },
        { onConflict: "agency_id" },
      )
      .select("agency_id, progress, video_overrides, created_at, updated_at")
      .single();
    if (upsert.error) {
      throw new ArmatureError("github_error", `Could not save Getting Started state: ${upsert.error.message}`);
    }
    return { ok: true, row: upsert.data as Row };
  }),
);
