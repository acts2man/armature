/**
 * Rules for a site's services and billing: the yearly total, the renewal that
 * matters next, the status label a site gets, and the labels for the fixed
 * choices. Mirrors the site_billing view so the edit drawer can preview the
 * total before it is saved. Pure module.
 */
import { formatCents } from "./money.ts";
import type { PillTone } from "@/components/ui.tsx";
import type { Site, SiteServices } from "./types.ts";

export const RENEWAL_SOON_DAYS = 30;

export const servicesQueryKey = (siteId: string) => ["site-services", siteId] as const;

export const AUTOMATIC_EMAIL_HELP = "Automatic emails are messages the website sends (form notifications). Mailboxes are where the client reads email.";

export type ServicesInput = Pick<
  SiteServices,
  "hosting_annual_fee_cents" | "domain_annual_fee_cents" | "email_pricing" | "email_annual_fee_cents" | "email_mailboxes"
>;

/** hosting + domain + email, where a per-mailbox price is multiplied by the mailbox count. */
export function yearlyTotalCents(services: ServicesInput): number {
  const hosting = services.hosting_annual_fee_cents ?? 0;
  const domain = services.domain_annual_fee_cents ?? 0;
  const email =
    services.email_pricing === "per_mailbox" ? (services.email_annual_fee_cents ?? 0) * (services.email_mailboxes ?? 0) : (services.email_annual_fee_cents ?? 0);
  return hosting + domain + email;
}

/** "$200 hosting + $18 domain + 4 mailboxes × $30 = $338 / year", listing only the parts that are set. */
export function yearlyTotalSummary(services: ServicesInput): string {
  const parts: string[] = [];
  if (services.hosting_annual_fee_cents) parts.push(`${formatCents(services.hosting_annual_fee_cents)} hosting`);
  if (services.domain_annual_fee_cents) parts.push(`${formatCents(services.domain_annual_fee_cents)} domain`);
  if (services.email_pricing === "per_mailbox") {
    if (services.email_annual_fee_cents && services.email_mailboxes) {
      parts.push(`${services.email_mailboxes} ${services.email_mailboxes === 1 ? "mailbox" : "mailboxes"} × ${formatCents(services.email_annual_fee_cents)}`);
    }
  } else if (services.email_annual_fee_cents) {
    parts.push(`${formatCents(services.email_annual_fee_cents)} email`);
  }
  const total = `${formatCents(yearlyTotalCents(services))} / year`;
  return parts.length === 0 ? `Nothing billed yet: ${total}` : `${parts.join(" + ")} = ${total}`;
}

/** Days from today until an ISO date (negative when past). Whole days, local time. */
export function daysUntil(isoDate: string, today: Date = new Date()): number {
  const target = new Date(`${isoDate}T00:00:00`);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

export type RenewalState = { date: string; days: number; state: "past" | "soon" | "later" };

/**
 * Which renewal to show: the next future one if there is one, else the lapsed
 * one. `soon` means within RENEWAL_SOON_DAYS.
 */
export function renewalState(next: string | null, overdue: string | null, today: Date = new Date()): RenewalState | null {
  const date = next ?? overdue;
  if (!date) return null;
  const days = daysUntil(date, today);
  return { date, days, state: days < 0 ? "past" : days <= RENEWAL_SOON_DAYS ? "soon" : "later" };
}

export type SiteStatusLabel = "Live" | "Onboarding" | "Needs attention" | "Hosting only";

/**
 * Hosting-only sites say so; a connected site that has never published is still
 * onboarding; a connected site that has published is live.
 */
export function siteStatusLabel(site: Pick<Site, "status" | "last_published_at">): SiteStatusLabel {
  if (site.status === "hosting_only") return "Hosting only";
  if (site.status === "needs_attention") return "Needs attention";
  return site.last_published_at ? "Live" : "Onboarding";
}

export const SITE_STATUS_TONES: Record<SiteStatusLabel, PillTone> = {
  Live: "green",
  Onboarding: "blue",
  "Needs attention": "amber",
  "Hosting only": "grey",
};

export const isHostingOnly = (site: Pick<Site, "status">): boolean => site.status === "hosting_only";

export const EMAIL_PROVIDER_LABELS: Record<NonNullable<SiteServices["email_provider"]>, string> = {
  google_workspace: "Google Workspace",
  microsoft_365: "Microsoft 365",
  zoho: "Zoho Mail",
  forwarding: "Email forwarding",
  other: "Other",
  none: "No mailboxes",
};

export const TRANSACTIONAL_PROVIDER_LABELS: Record<NonNullable<SiteServices["transactional_email_provider"]>, string> = {
  resend: "Resend",
  other: "Other",
  none: "None",
};

export const OWNER_LABELS: Record<"agency" | "client", string> = { agency: "The agency", client: "The client" };

/** An empty services record for a site that has none yet. */
export function emptyServices(siteId: string): SiteServices {
  return {
    site_id: siteId,
    hosting_provider: null,
    hosting_annual_fee_cents: null,
    hosting_start_date: null,
    hosting_renewal_date: null,
    domain_name: null,
    domain_registrar: null,
    domain_account_owner: null,
    domain_renewal_date: null,
    domain_annual_fee_cents: null,
    email_provider: null,
    email_mailboxes: null,
    email_pricing: null,
    email_annual_fee_cents: null,
    email_managed_by: null,
    transactional_email_provider: null,
    transactional_from_address: null,
    agreement_accepted_on: null,
    notes: "",
    updated_at: null,
    updated_by: null,
  };
}
