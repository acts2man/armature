/**
 * Row types for the tables the browser reads through supabase-js (always under
 * row-level security). Keep in step with supabase/migrations.
 */
export type AgencyRole = "owner" | "staff";
export type SiteRole = "client_owner" | "client_editor";
export type SiteStatus = "connected" | "needs_attention" | "hosting_only" | "needs_setup";
export type PublishStatus = "committed" | "conflict" | "failed";
export type ChangeRequestStatus = "new" | "in_progress" | "ready_for_review" | "done" | "declined";

export type Agency = {
  id: string;
  name: string;
  portal_name: string;
  logo_url: string | null;
  accent_color: string;
  created_at: string;
  /** From-name / from-address for outgoing email through Resend (migration 20260924000100; optional feature). */
  email_from_name?: string | null;
  email_from_address?: string | null;
  email_reply_to?: string | null;
  email_last_test_at?: string | null;
  email_last_test_error?: string | null;
};

export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  created_at: string;
  /** When the person last signed in (migration 20260923000300; null or missing before it is applied). */
  last_sign_in_at?: string | null;
};

export type AgencyMember = {
  agency_id: string;
  user_id: string;
  role: AgencyRole;
  created_at: string;
};

export type Site = {
  id: string;
  agency_id: string;
  name: string;
  /** Null until a repository is connected (a hosting-only site). */
  repo_owner: string | null;
  repo_name: string | null;
  branch: string | null;
  live_url: string | null;
  github_installation_id: number | null;
  status: SiteStatus;
  last_published_at: string | null;
  created_at: string;
  /** What clients may do in the visual editor (agency staff always get the full builder). */
  editing_level?: "content" | "style" | "builder";
  /** Where the Armature kit folder lives inside the site's repository. */
  kit_path?: string;
  /**
   * The head SHA of the connected branch at the moment site-connect saved this
   * site as needs_setup (migration 20260924001100). undo-site-setup reads it
   * to restore the tree to that snapshot as one revert commit. Null on a site
   * saved before this snapshot was added, or already fully connected on save.
   */
  pre_setup_commit_sha?: string | null;
  /**
   * Snapshot of the last kit-status probe (migration 20260924000800). Populated
   * by every call to the `kit-status` edge function so the Projects Kit column
   * can render without hitting GitHub on every render. Null / missing before
   * the first probe.
   */
  kit_version_in_repo?: string | null;
  kit_version_live?: string | null;
  kit_verdict?: KitVerdict | null;
  kit_probed_at?: string | null;
};

export type KitVerdict = "not_installed" | "needs_setup" | "update_available" | "up_to_date";

/** One row in public.kit_updates. Agency staff and site members can read; only staff writes. */
export type KitUpdateRow = {
  id: string;
  site_id: string;
  from_version: string;
  to_version: string;
  commit_sha: string | null;
  commit_url: string | null;
  previous_commit_sha: string | null;
  requested_by: string | null;
  status: "commit_pushed" | "live_confirmed" | "needs_attention" | "undo" | "undo_pushed" | "undo_confirmed";
  status_detail: string | null;
  live_checked_at: string | null;
  live_version_seen: string | null;
  attempts: number;
  needs_attention_reason: string | null;
  created_at: string;
  updated_at: string;
};

/** What the agency charges a site for. Agency staff only; clients cannot read it. */
export type SiteServices = {
  site_id: string;
  hosting_provider: string | null;
  hosting_annual_fee_cents: number | null;
  hosting_start_date: string | null;
  hosting_renewal_date: string | null;
  domain_name: string | null;
  domain_registrar: string | null;
  domain_account_owner: "agency" | "client" | null;
  domain_renewal_date: string | null;
  domain_annual_fee_cents: number | null;
  email_provider: "google_workspace" | "microsoft_365" | "zoho" | "forwarding" | "other" | "none" | null;
  email_mailboxes: number | null;
  email_pricing: "flat" | "per_mailbox" | null;
  /** A flat yearly amount, or the yearly price of one mailbox when email_pricing is per_mailbox. */
  email_annual_fee_cents: number | null;
  email_managed_by: "agency" | "client" | null;
  transactional_email_provider: "resend" | "other" | "none" | null;
  transactional_from_address: string | null;
  agreement_accepted_on: string | null;
  /** Where the site's form entries are emailed (up to ten addresses). */
  form_recipients?: string[];
  notes: string;
  updated_at: string | null;
  updated_by: string | null;
};

/** The site_billing view: yearly total and the renewal that matters, per site. */
export type SiteBilling = {
  site_id: string;
  yearly_total_cents: number;
  next_renewal_date: string | null;
  overdue_renewal_date: string | null;
};

export type SiteMember = {
  site_id: string;
  user_id: string;
  role: SiteRole;
  created_at: string;
};

export type Invite = {
  id: string;
  agency_id: string;
  site_id: string | null;
  email: string;
  role: AgencyRole | SiteRole;
  expires_at: string;
  accepted_at: string | null;
  created_by: string | null;
  created_at: string;
};

export type Publish = {
  id: string;
  site_id: string;
  user_id: string | null;
  page_slug: string;
  fields_changed: string[];
  commit_sha: string | null;
  commit_url: string | null;
  status: PublishStatus;
  error: string | null;
  created_at: string;
};

export type ChangeRequest = {
  id: string;
  site_id: string;
  created_by: string | null;
  title: string;
  details: string;
  status: ChangeRequestStatus;
  agency_note: string;
  created_at: string;
  updated_at: string;
};

/** An entry a visitor sent through the site's Form widget (written only by the form-submit function). */
export type FormSubmission = {
  id: string;
  site_id: string;
  page_slug: string;
  element_id: string;
  form_name: string | null;
  /** Field name -> value, as the form defined them. */
  data: Record<string, unknown>;
  email_status: "sent" | "failed" | "skipped";
  user_agent?: string | null;
  read_at: string | null;
  created_at: string;
};

export type ChangeRequestAttachment = {
  id: string;
  request_id: string;
  storage_path: string;
  created_at: string;
};

export const CHANGE_REQUEST_STATUSES: ChangeRequestStatus[] = [
  "new",
  "in_progress",
  "ready_for_review",
  "done",
  "declined",
];

export const CHANGE_REQUEST_STATUS_LABELS: Record<ChangeRequestStatus, string> = {
  new: "New",
  in_progress: "In progress",
  ready_for_review: "Ready for review",
  done: "Done",
  declined: "Declined",
};

/** Statuses that count as "open" on the Projects and home screens. */
export const OPEN_CHANGE_REQUEST_STATUSES: ChangeRequestStatus[] = ["new", "in_progress", "ready_for_review"];

export const SITE_ROLE_LABELS: Record<SiteRole, string> = {
  client_owner: "Client owner",
  client_editor: "Client editor",
};

export const AGENCY_ROLE_LABELS: Record<AgencyRole, string> = {
  owner: "Agency owner",
  staff: "Agency staff",
};

export const PUBLISH_STATUS_LABELS: Record<PublishStatus, string> = {
  committed: "Published",
  conflict: "Conflict",
  failed: "Failed",
};

/** The storage bucket for change-request screenshots (private; read via signed URLs). */
export const ATTACHMENTS_BUCKET = "change-request-attachments";
