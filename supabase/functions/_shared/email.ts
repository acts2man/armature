/**
 * A tiny helper for sending outgoing email through Resend. Every function that emails
 * (invite-create, client-password-reset, form-submit and email-test) uses this so the
 * "Resend is optional" contract holds in one place:
 *
 *   - No RESEND_API_KEY in the Supabase secrets? Return { sent: false, reason: "no-key" }.
 *   - No email_from_address on the agency? Return { sent: false, reason: "no-from" }.
 *   - Resend rejected the send? Return { sent: false, reason: "send-failed", error }.
 *   - Sent? Return { sent: true }.
 *
 * The caller then decides what to do — most functions just add a plain-English hint to the
 * response so the dashboard shows the link with a copy button instead of pretending an
 * email went out.
 *
 * Nothing here throws for a delivery problem: a failed send is a signal, not a request
 * error. Only obviously bad input (a from address that is not an address, an empty
 * body) throws.
 */
import { adminClient } from "./auth.ts";
import { denoEnv, envValue, type Env } from "./env.ts";

export type Recipient = { email: string; name?: string };
export type SendMail = {
  to: Recipient[] | string[];
  subject: string;
  text: string;
  /** Optional plain-HTML body (Resend will use it when present). */
  html?: string;
  /** Overrides the agency's Reply-To. */
  replyTo?: string;
};

export type SendResult =
  | { sent: true; id?: string; from: string }
  | { sent: false; reason: "no-key"; hint: string }
  | { sent: false; reason: "no-from"; hint: string }
  | { sent: false; reason: "no-recipient"; hint: string }
  | { sent: false; reason: "send-failed"; hint: string; error: string };

export type AgencyEmailSettings = {
  from_name: string | null;
  from_address: string | null;
  reply_to: string | null;
};

export async function loadAgencyEmail(env: Env, agencyId: string): Promise<AgencyEmailSettings | null> {
  const { data, error } = await adminClient(env).from("agencies").select("email_from_name, email_from_address, email_reply_to").eq("id", agencyId).maybeSingle();
  if (error || !data) return null;
  const row = data as { email_from_name: string | null; email_from_address: string | null; email_reply_to: string | null };
  return { from_name: row.email_from_name, from_address: row.email_from_address, reply_to: row.email_reply_to };
}

/**
 * Send a message on behalf of an agency. Recipients are always addresses of clients or
 * agency staff themselves; the agency's from address and Reply-To are how the recipient
 * knows who sent it. `overrideSettings` is for tests and for callers that already have
 * the settings on hand; without it the agency row is looked up.
 */
export async function sendAgencyEmail(env: Env, agencyId: string, mail: SendMail, overrideSettings?: AgencyEmailSettings | null): Promise<SendResult> {
  const key = envValue(env, "RESEND_API_KEY");
  if (!key) return { sent: false, reason: "no-key", hint: "Email sending is not turned on. Copy the link below to the person yourself." };
  const settings = overrideSettings ?? (await loadAgencyEmail(env, agencyId));
  if (!settings?.from_address) return { sent: false, reason: "no-from", hint: "This agency has no email address set up under Settings › Email sending. Copy the link below to the person yourself." };
  const to = normalizeRecipients(mail.to);
  if (to.length === 0) return { sent: false, reason: "no-recipient", hint: "No recipient address." };
  const fromName = settings.from_name || "Your website";
  const from = `${fromName} <${settings.from_address}>`;
  const body: Record<string, unknown> = { from, to, subject: mail.subject, text: mail.text };
  if (mail.html) body["html"] = mail.html;
  const replyTo = mail.replyTo || settings.reply_to;
  if (replyTo) body["reply_to"] = replyTo;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      return { sent: false, reason: "send-failed", hint: "Email could not be sent. Copy the link below to the person yourself.", error: text.slice(0, 500) };
    }
    const json = (await response.json().catch(() => null)) as { id?: string } | null;
    return { sent: true, from, ...(json?.id ? { id: json.id } : {}) };
  } catch (error) {
    return { sent: false, reason: "send-failed", hint: "Email could not be sent. Copy the link below to the person yourself.", error: error instanceof Error ? error.message : String(error) };
  }
}

function normalizeRecipients(input: SendMail["to"]): string[] {
  const out: string[] = [];
  for (const entry of input) {
    if (typeof entry === "string") {
      if (isEmail(entry)) out.push(entry);
    } else if (entry && typeof entry === "object" && isEmail(entry.email)) {
      out.push(entry.name ? `${entry.name.replace(/[<>]/g, "")} <${entry.email}>` : entry.email);
    }
  }
  return out;
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const isEmail = (value: unknown): value is string => typeof value === "string" && EMAIL_PATTERN.test(value);

/** Convenience for callers that only have the current env in scope. */
export const currentEnv = (): Env => denoEnv();
