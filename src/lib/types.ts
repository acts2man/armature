/**
 * Row types for the tables the browser reads through supabase-js (always under
 * row-level security). Keep in step with supabase/migrations.
 */
export type AgencyRole = "owner" | "staff";
export type SiteRole = "client_owner" | "client_editor";
export type SiteStatus = "connected" | "needs_attention";
export type PublishStatus = "committed" | "conflict" | "failed";
export type ChangeRequestStatus = "new" | "in_progress" | "ready_for_review" | "done" | "declined";

export type Agency = {
  id: string;
  name: string;
  portal_name: string;
  logo_url: string | null;
  accent_color: string;
  created_at: string;
};

export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  created_at: string;
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
  repo_owner: string;
  repo_name: string;
  branch: string;
  live_url: string | null;
  github_installation_id: number;
  status: SiteStatus;
  last_published_at: string | null;
  created_at: string;
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

/** Statuses that count as "open" on the fleet and home screens. */
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
