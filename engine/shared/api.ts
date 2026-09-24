/**
 * The HTTP contract between the editor (browser) and the engine server (Node). JSON in,
 * JSON out, CORS open to the dashboard origin. Every response is `{ ok: true, ... }` or
 * `{ ok: false, message }` with HTTP 200, so the editor always has something to show.
 *
 *   POST /sites/open        OpenRequest  → OpenResponse   (starts the preview; poll /sites/status while not ready)
 *   GET  /sites/status?site=<id>          → OpenResponse   (current phase and, when ready, the preview URL)
 *   POST /sites/close       { site }      → { ok }
 *   POST /nodes/resolve     ResolveRequest → ResolveResponse
 *   POST /edits/apply       ApplyRequest  → EditResult
 *   POST /edits/undo        { site }      → EditResult
 *   POST /edits/redo        { site }      → EditResult
 *   GET  /changes?site=<id>               → ChangesResponse
 *   POST /publish           PublishBody   → PublishResult
 *   GET  /health                          → { ok: true, version }
 */
import type { ChangedFile, EditOp, NodeRef, OpenResponse, PublishRequest, ResolvedNode, SiteInfo } from "./types.ts";

export type { OpenResponse };

export type OpenRequest = {
  /** The dashboard's site id (any stable string). */
  site: string;
  /** "owner/repo" */
  repo: string;
  branch: string;
  /** Per-site public env values the preview needs (VITE_SUPABASE_URL, …). */
  env?: Record<string, string>;
  /** A GitHub installation token for private repositories (optional in the proof of concept). */
  token?: string;
};

export type ResolveRequest = { site: string; ref: NodeRef; /** The route being edited, to name shared components relative to its page. */ page?: string };
export type ResolveResponse = { ok: true; node: ResolvedNode } | { ok: false; message: string };

export type ApplyRequest = { site: string; op: EditOp };

export type ChangesResponse = { ok: true; files: ChangedFile[]; diff: string; headCommit: string } | { ok: false; message: string };

export type PublishBody = PublishRequest & { site: string };

export type SiteStatus = OpenResponse & { site: SiteInfo | null };

export const DEFAULT_ENGINE_URL = "http://localhost:4400";
