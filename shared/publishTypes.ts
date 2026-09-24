/**
 * Request and response shapes exchanged between the browser and the edge functions.
 * Shared so the two sides cannot drift. Pure types plus a couple of constants.
 *
 * Every edge function answers HTTP 200 with either `{ ok: true, ... }` or a
 * `Failure`. Nothing is ever signalled by a bare thrown error or an empty body: the
 * editor renders `message` verbatim, which is what keeps every failure visible.
 */
import type { LayoutDoc, SiteKit } from "../kit/types.ts";
import type { Problem } from "../kit/validate.ts";
import type { ContentTree, ContentValue } from "./contentFile.ts";
import type { SiteSchema } from "./schema.ts";

export type FailureCode =
  | "not_configured"
  | "forbidden"
  | "invalid"
  | "conflict"
  | "github_error"
  | "not_found"
  | "rate_limited";

export type Failure = {
  ok: false;
  code: FailureCode;
  message: string;
  /** For conflicts: the human labels of the fields someone else changed. */
  fields?: string[];
  /** Builder publish conflicts: what both sides changed, keyed for a "mine" / "theirs" choice. */
  conflicts?: ConflictItem[];
};

/** One element (or kit value, or page) both the editor and someone else changed. */
export type ConflictItem = { key: string; label: string; page?: string; elementId?: string };

export const isFailure = (value: unknown): value is Failure =>
  typeof value === "object" &&
  value !== null &&
  (value as { ok?: unknown }).ok === false &&
  typeof (value as { message?: unknown }).message === "string";

// --- images -----------------------------------------------------------------

/** Per-image ceiling after the browser has resized it. */
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/** Ceiling for one publish's images combined, so a request never exceeds what the function accepts. */
export const MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024;

/** Longest edge the browser resizes an image to before uploading. */
export const MAX_IMAGE_WIDTH = 2000;

export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

// --- content-get --------------------------------------------------------------

export type ContentGetRequest = { site_id: string; /** A commit to read instead of the branch head (revision previews). */ ref?: string };

export type ContentGetResponse = {
  ok: true;
  schema: SiteSchema;
  content: ContentTree;
  /** Head commit of the branch that this content was read from. */
  commitSha: string;
  branch: string;
  /** "owner/repo" */
  repo: string;
  /** Warnings from the content check, shown but not blocking. */
  warnings: string[];
  /**
   * Site contract v2: every layout under content/layouts/ that is a layout at all, by
   * page slug, as the validator cleaned it (an unreadable setting is left out, an
   * unreadable element is an "unsupported" placeholder). `problems` lists what was left out.
   */
  layouts: Record<string, LayoutDoc>;
  /** content/site-kit.json when present (with anything unreadable filled from the default kit), else null (the default kit applies). */
  siteKit: SiteKit | null;
  /**
   * Every value in the builder files the validator could not read, in plain English and
   * with the raw value, so the editor can show "what and where" and put the value back
   * untouched when it publishes.
   */
  problems: FileProblem[];
  /** Pictures and videos under public/assets/, for the media library. */
  media: MediaFile[];
  /** The site's editing level for clients (agency staff always get the full builder). */
  editingLevel: EditingLevel;
  /** Builder pages in the bin (content/trash/), by slug, ready to restore. */
  trash?: Record<string, LayoutDoc>;
};

/** What the Pages screen asks of a builder page's file: into the bin, back out of it, or gone for good. */
export type TrashAction = "trash" | "restore" | "delete";

export type EditingLevel = "content" | "style" | "builder";

/** A validator problem with the file it came from (`slug` for a page layout). */
export type FileProblem = Problem & { file: string; slug?: string };

export type MediaFile = { path: string; bytes: number; kind: "image" | "video"; alt: string };

/** content/media.json: default alt text per asset path. */
export type MediaMeta = Record<string, { alt: string }>;

// --- content-publish ----------------------------------------------------------

export type FieldUpdate = { section: string; field: string; value: ContentValue };

export type ImageUpload = {
  section: string;
  field: string;
  filename: string;
  contentType: string;
  /** Base64 of the file bytes, without a data: prefix. */
  dataBase64: string;
};

export type PublishRequest = {
  site_id: string;
  slug: string;
  /** Commit sha the editor loaded its content from. */
  baseCommitSha: string;
  fields: FieldUpdate[];
  images: ImageUpload[];
};

export type PublishResponse = {
  ok: true;
  commitSha: string;
  commitUrl: string;
  /** "section.field" keys written. */
  fields: string[];
  /** Public URLs of images added by this publish. */
  images: string[];
};

// --- content-publish-batch (the visual editor) ----------------------------------

/**
 * A picture for one field, or for one item of a list field when `index` and
 * `itemKey` are present. The function writes the committed path into that item.
 */
export type BatchImageUpload = ImageUpload & { index?: number; itemKey?: string };

export type BatchPageUpdate = { slug: string; fields: FieldUpdate[]; images: BatchImageUpload[] };

/** Every changed field and picture across every page, published as ONE commit. */
export type PublishBatchRequest = {
  site_id: string;
  /** Commit sha the editor loaded its content from. */
  baseCommitSha: string;
  pages: BatchPageUpdate[];
};

export type PublishBatchResponse = {
  ok: true;
  commitSha: string;
  commitUrl: string;
  /** "slug.section.field" keys written. */
  fields: string[];
  /** Public URLs of images added by this publish. */
  images: string[];
  /** Slugs of the pages the commit touched, in request order. */
  slugs: string[];
};

// --- site-embed-check (the visual editor's "why won't the site load" diagnostic) ---

export type EmbedCheckRequest = { site_id: string };

export type EmbedCheckResponse = {
  ok: true;
  url: string;
  /** False when the live URL could not be fetched at all; `error` says why. */
  reachable: boolean;
  status: number | null;
  /** The X-Frame-Options header the site sends, if any. */
  xFrameOptions: string | null;
  /** The frame-ancestors directive of the site's Content-Security-Policy, if any. */
  frameAncestors: string | null;
  error?: string;
};

// --- site-diagnose / site-connect --------------------------------------------

export type CheckStatus = "ok" | "fail" | "skipped";

export type ConnectionCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  /** Safe to display. Never a secret value. */
  detail: string;
  /** Plain-English next step, present when the check did not pass. */
  fix?: string;
};

export type ConnectionReport = {
  /** True only when every check passed. Distinct from the envelope's `ok`. */
  allPassed: boolean;
  checks: ConnectionCheck[];
};

export type DiagnoseRequest = { site_id: string };
export type DiagnoseResponse = { ok: true } & ConnectionReport;

export type SiteConnectRequest = {
  agency_id: string;
  repo_owner: string;
  repo_name: string;
  branch: string;
  name?: string;
  live_url?: string;
  /** An existing hosting-only site to connect the repository to, instead of creating a new site. */
  site_id?: string;
};

export type SiteConnectResponse = {
  ok: true;
  allPassed: boolean;
  checks: ConnectionCheck[];
  /** Present only when every check passed and the site row was created. */
  site?: { id: string; name: string };
};

// --- github-setup ---------------------------------------------------------------

export type GithubSetupRequest =
  | { action: "install_url"; agency_id: string }
  | { action: "record_installation"; agency_id: string; installation_id: number }
  | { action: "list_installations"; agency_id: string };

export type GithubInstallationSummary = {
  installation_id: number;
  account_login: string;
  account_type: string;
};

export type GithubSetupResponse =
  | { ok: true; action: "install_url"; url: string }
  | { ok: true; action: "record_installation"; installation: GithubInstallationSummary }
  | { ok: true; action: "list_installations"; installations: GithubInstallationSummary[] };

// --- invites --------------------------------------------------------------------

export type InviteRole = "owner" | "staff" | "client_owner" | "client_editor";

export type InviteCreateRequest = {
  agency_id: string;
  /** Null for an agency (staff) invite. */
  site_id: string | null;
  email: string;
  role: InviteRole;
};

export type InviteCreateResponse = {
  ok: true;
  invite_id: string;
  /** The link the invited person must open. */
  invite_url: string;
  expires_at: string;
  /** True when a real email was sent through Resend under the agency's from address. */
  emailed: boolean;
  /** Plain-English hint when the email was not sent (missing key, missing address, or send failed). */
  email_hint?: string | null;
};

export type InviteAcceptRequest = { token: string };

export type InviteAcceptResponse = {
  ok: true;
  site_id: string | null;
  agency_id: string;
  role: InviteRole;
};

// --- client-create ---------------------------------------------------------------

export type SiteRole = "client_owner" | "client_editor";

export type ClientCreateRequest = {
  site_id: string;
  full_name: string;
  email: string;
  /** Only ever sent; never returned or logged. */
  temporary_password: string;
  role: SiteRole;
};

export type ClientCreateResponse = {
  ok: true;
  /** "created": a new account with the temporary password. "already_existed": their own password still applies. */
  outcome: "created" | "already_existed";
  email: string;
  site_name: string;
  /** Where the client signs in: APP_URL + /signin. */
  sign_in_url: string;
  /** A plain-English sentence for the agency about what happened. */
  message: string;
};

// --- password-set -------------------------------------------------------------------

export type PasswordSetRequest = { password: string };

export type PasswordSetResponse = { ok: true };

// --- client-password-reset ------------------------------------------------------------

/** Agency staff ask for a password reset link for one of their clients (the Clients screen). */
export type ClientPasswordResetRequest = { user_id: string };

export type ClientPasswordResetResponse = {
  ok: true;
  email: string;
  /** The recovery link the client opens; it lands on the sign-in page to choose a new password. */
  reset_url: string;
  /** True when a real email was sent through Resend under the agency's from address. */
  emailed: boolean;
  /** Plain-English hint when the email was not sent. */
  email_hint?: string | null;
};

// --- builder-publish (the page builder) -------------------------------------------

/**
 * Everything a page builder draft changes, published as ONE commit: content fields and
 * their pictures (as content-publish-batch), layouts (null deletes a page's layout),
 * the site kit and media metadata. Pictures added in the editor travel inside the
 * layouts as data: URLs; the function commits each under public/assets/uploads/.
 */
export type BuilderPublishRequest = {
  site_id: string;
  baseCommitSha: string;
  pages: BatchPageUpdate[];
  layouts: Record<string, unknown>;
  kit: unknown;
  media: unknown;
  /** Choices for earlier conflicts: key -> "mine" | "theirs". */
  resolutions: Record<string, "mine" | "theirs">;
  /** Builder pages to move into or out of the bin, by slug (the file moves as it is). */
  trash?: Record<string, TrashAction>;
  /** New pages copied from existing builder pages on the server, by the new slug (so nothing in the file is lost in the copy). */
  copies?: Record<string, PageCopy>;
  /** Pictures for the media library, as prepared in the browser (a data: URL each), with the name to keep. */
  uploads?: MediaUpload[];
  /** Pictures to remove from the site ("/assets/…" paths). */
  deleteAssets?: string[];
};

export type MediaUpload = { name: string; data: string };

export type PageCopy = { from: string; label: string; path: string };

export type BuilderPublishResponse = {
  ok: true;
  commitSha: string;
  commitUrl: string;
  fields: string[];
  images: string[];
  slugs: string[];
  /** Page slugs whose layout was written or removed. */
  layouts: string[];
  /** Page slugs moved into or out of the bin, or deleted from it. */
  trash?: string[];
  /** Pictures removed from the site. */
  deleted?: string[];
  kit: boolean;
  media: boolean;
  /** True when someone else had published in between and the draft was merged onto it. */
  merged: boolean;
};
