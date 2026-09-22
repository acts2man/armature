/**
 * Request and response shapes exchanged between the browser and the edge functions.
 * Shared so the two sides cannot drift. Pure types plus a couple of constants.
 *
 * Every edge function answers HTTP 200 with either `{ ok: true, ... }` or a
 * `Failure`. Nothing is ever signalled by a bare thrown error or an empty body: the
 * editor renders `message` verbatim, which is what keeps every failure visible.
 */
import type { ContentTree, ContentValue } from "./contentFile.ts";
import type { SiteSchema } from "./schema.ts";

export type FailureCode =
  | "not_configured"
  | "forbidden"
  | "invalid"
  | "conflict"
  | "github_error"
  | "not_found";

export type Failure = {
  ok: false;
  code: FailureCode;
  message: string;
  /** For conflicts: the human labels of the fields someone else changed. */
  fields?: string[];
};

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

export type ContentGetRequest = { site_id: string };

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
};

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
  /** The link the invited person must open. Email delivery is a stub in v0.1. */
  invite_url: string;
  expires_at: string;
  /** True when a real email was sent; false means the link was only logged. */
  emailed: boolean;
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
