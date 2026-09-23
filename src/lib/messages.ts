/**
 * Reading a form entry (a `form_submissions` row) for people: who sent it, how to reach
 * them, and a one-line preview, from whatever field names the site's form used. The
 * Dashboard's "New messages" and the Contact inbox share these; the CSV export lives here too.
 */
import type { FormSubmission } from "./types.ts";

const NAME_KEYS = ["name", "full_name", "fullname", "your_name", "yourname", "contact_name"];
const EMAIL_KEYS = ["email", "e-mail", "email_address", "emailaddress", "your_email", "youremail", "contact_email"];
const MESSAGE_KEYS = ["message", "comments", "comment", "details", "enquiry", "inquiry", "question", "questions", "notes", "description", "how_can_we_help"];

const normalise = (key: string): string => key.trim().toLowerCase().replace(/[\s-]+/g, "_");

function textOf(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(", ");
  return "";
}

function find(data: Record<string, unknown>, keys: string[]): string | null {
  const entries = Object.entries(data);
  for (const wanted of keys) {
    const hit = entries.find(([key]) => normalise(key) === wanted);
    if (hit) {
      const text = textOf(hit[1]);
      if (text) return text;
    }
  }
  return null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The sender's name, if the form asked for one. */
export function senderName(data: Record<string, unknown>): string | null {
  const direct = find(data, NAME_KEYS);
  if (direct) return direct;
  const first = find(data, ["first_name", "firstname", "given_name"]);
  const last = find(data, ["last_name", "lastname", "surname", "family_name"]);
  return [first, last].filter(Boolean).join(" ") || null;
}

/** The sender's email address: a field named like one, else the first value that looks like one. */
export function senderEmail(data: Record<string, unknown>): string | null {
  const direct = find(data, EMAIL_KEYS);
  if (direct && EMAIL.test(direct)) return direct;
  for (const value of Object.values(data)) {
    const text = textOf(value);
    if (EMAIL.test(text)) return text;
  }
  return null;
}

/** "Sam Alder", else their email, else "Someone". */
export function senderLabel(data: Record<string, unknown>): string {
  return senderName(data) ?? senderEmail(data) ?? "Someone";
}

/** The message itself, else the longest text the form carried. */
export function messagePreview(data: Record<string, unknown>, max = 140): string {
  const direct = find(data, MESSAGE_KEYS);
  let text = direct ?? "";
  if (!text) {
    const name = senderName(data);
    const email = senderEmail(data);
    const rest = Object.values(data)
      .map(textOf)
      .filter((value) => value && value !== name && value !== email)
      .sort((a, b) => b.length - a.length);
    text = rest[0] ?? "";
  }
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1).trimEnd()}…` : oneLine;
}

export const isUnread = (submission: Pick<FormSubmission, "read_at">): boolean => !submission.read_at;

/** "Contact form", else the page it sits on, for a list row. */
export function formLabel(submission: Pick<FormSubmission, "form_name" | "page_slug">): string {
  const name = submission.form_name?.trim();
  if (name) return name;
  return submission.page_slug === "home" ? "Home page form" : `${submission.page_slug} page form`;
}

/** A mailto: link back to the sender, with the subject filled in. */
export function replyLink(submission: Pick<FormSubmission, "data" | "form_name" | "page_slug">, siteName: string): string | null {
  const email = senderEmail(submission.data);
  if (!email) return null;
  const subject = `Re: your message to ${siteName}${submission.form_name?.trim() ? ` (${submission.form_name.trim()})` : ""}`;
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}`;
}

/** Every field name across a set of entries, in first-seen order, for the CSV's columns. */
export function fieldNames(submissions: Pick<FormSubmission, "data">[]): string[] {
  const names: string[] = [];
  for (const submission of submissions) for (const key of Object.keys(submission.data)) if (!names.includes(key)) names.push(key);
  return names;
}

const csvCell = (value: unknown): string => {
  const text = textOf(value);
  // A leading = + - @ would be run as a formula by a spreadsheet: neutralise it.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Entries as a CSV file (UTF-8 with a byte-order mark so Excel reads accents), newest first as given. */
export function submissionsToCsv(submissions: Pick<FormSubmission, "created_at" | "form_name" | "page_slug" | "read_at" | "data">[]): string {
  const fields = fieldNames(submissions);
  const head = ["Received", "Form", "Page", "Read", ...fields];
  const rows = submissions.map((submission) => [submission.created_at, submission.form_name ?? "", submission.page_slug, submission.read_at ? "yes" : "no", ...fields.map((field) => submission.data[field] ?? "")]);
  return `\uFEFF${[head, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
