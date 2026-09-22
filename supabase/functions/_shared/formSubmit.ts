/**
 * The Form widget's endpoint, without the network: find the form as it is published
 * in the site's repository, validate what the visitor sent against its fields, apply
 * the spam and rate rules, store the entry and email it. Everything outside (the
 * database, GitHub, Resend, the clock) comes in through `FormDeps`, so this is tested
 * with plain fakes.
 */
import { formPropsSchema } from "../../../shared/builder/widgetSchemas.ts";
import type { FormField, FormProps } from "../../../kit/types.ts";
import { ArmatureError } from "./errors.ts";

/** What the kit posts. */
export type FormInput = {
  siteId: string;
  page: string;
  elementId: string;
  values: Record<string, unknown>;
  /** The honeypot: a field people never see. Anything in it means a bot. */
  trap: string;
  /** When the form was shown (ms). A human takes more than a moment to fill it in. */
  startedAt: number;
};

export type FormSite = { id: string; name: string; status: string; agencyId: string };
export type FormEntry = { siteId: string; page: string; elementId: string; formName: string | null; data: Record<string, string | boolean>; ipHash: string; userAgent: string | null };
export type Mail = { to: string[]; from: string; subject: string; text: string; replyTo?: string };

export type FormDeps = {
  site(id: string): Promise<FormSite | null>;
  /** The published layout of a page (the JSON file), or null when there is none. */
  layout(site: FormSite, page: string): Promise<unknown>;
  /** How many entries arrived since `since`, for an IP hash or a whole site. */
  countSince(filter: { ipHash?: string; siteId?: string }, since: Date): Promise<number>;
  insert(entry: FormEntry): Promise<string>;
  setEmailStatus(id: string, status: "sent" | "failed" | "skipped"): Promise<void>;
  /** Where entries go and who they come from (site_services), when the agency set it up. */
  delivery(siteId: string): Promise<{ to: string[]; from: string | null }>;
  /** Sends one email; false when it failed. Absent when email is not configured. */
  send?: (mail: Mail) => Promise<boolean>;
  now(): Date;
};

export const FORM_LIMITS = {
  /** Per visitor (IP hash). */
  perVisitorShort: { count: 5, minutes: 10 },
  perVisitorDay: { count: 20, minutes: 24 * 60 },
  /** Per site, all visitors together. */
  perSiteHour: { count: 300, minutes: 60 },
  /** Faster than this and it was not a person. */
  minFillMs: 2500,
  /** An open page older than this has a stale form. */
  maxAgeMs: 24 * 60 * 60 * 1000,
  textChars: 500,
  longTextChars: 5000,
} as const;

const ID = /^[a-z0-9]{8}$/;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;
const TEL = /^[+()\-.\s\d]{5,40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Read the kit's request body into a FormInput, or explain what is wrong. */
export function parseFormInput(body: Record<string, unknown>): FormInput {
  const siteId = typeof body["site_id"] === "string" ? body["site_id"] : "";
  const page = typeof body["page"] === "string" ? body["page"] : "";
  const elementId = typeof body["element_id"] === "string" ? body["element_id"] : "";
  if (!UUID.test(siteId) || !SLUG.test(page) || page.length > 100 || !ID.test(elementId)) throw new ArmatureError("invalid", "This form could not be sent. Reload the page and try again.");
  const values = body["values"];
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new ArmatureError("invalid", "This form could not be sent. Reload the page and try again.");
  return {
    siteId,
    page,
    elementId,
    values: values as Record<string, unknown>,
    trap: typeof body["trap"] === "string" ? body["trap"] : "",
    startedAt: typeof body["started_at"] === "number" ? body["started_at"] : 0,
  };
}

type Found = { props: FormProps } | null;

/** The form element in a published layout, validated with the shared schema. */
export function findForm(layout: unknown, elementId: string): Found {
  const walk = (elements: unknown): Found => {
    if (!Array.isArray(elements)) return null;
    for (const element of elements) {
      if (!element || typeof element !== "object") continue;
      const record = element as { id?: unknown; type?: unknown; props?: unknown; children?: unknown };
      if (record.id === elementId && record.type === "form") {
        const parsed = formPropsSchema.safeParse(record.props);
        return parsed.success ? { props: parsed.data } : null;
      }
      const inner = walk(record.children);
      if (inner) return inner;
    }
    return null;
  };
  return layout && typeof layout === "object" ? walk((layout as { root?: unknown }).root) : null;
}

/** One field's value checked against its definition: the stored value, or a message for the visitor. */
export function checkField(field: FormField, raw: unknown): { value?: string | boolean; error?: string } {
  const label = field.label || field.name;
  if (field.type === "checkbox" || field.type === "consent") {
    const checked = raw === true || raw === "on" || raw === "true";
    if (field.required && !checked) return { error: field.type === "consent" ? "Please tick this box to continue." : `Please tick "${label}".` };
    return { value: checked };
  }
  const text = typeof raw === "string" ? raw.replace(/\r\n/g, "\n").trim() : typeof raw === "number" ? String(raw) : "";
  if (!text) return field.required ? { error: `Please fill in "${label}".` } : { value: "" };
  const max = field.type === "textarea" ? FORM_LIMITS.longTextChars : FORM_LIMITS.textChars;
  if (text.length > max) return { error: `"${label}" is too long (at most ${max} characters).` };
  if (field.type !== "textarea" && (text.includes("\n") || text.includes(String.fromCharCode(0)))) return { error: `"${label}" must be one line.` };
  switch (field.type) {
    case "email":
      return EMAIL.test(text) ? { value: text } : { error: "Please enter a valid email address." };
    case "tel":
      return TEL.test(text) ? { value: text } : { error: "Please enter a valid phone number." };
    case "number":
      return Number.isFinite(Number(text)) ? { value: text } : { error: `"${label}" must be a number.` };
    case "date":
      return DATE.test(text) && !Number.isNaN(Date.parse(text)) ? { value: text } : { error: `"${label}" must be a date.` };
    case "select":
    case "radio": {
      const options = (field.options ?? []).map((option) => option.trim()).filter(Boolean);
      return options.includes(text) ? { value: text } : { error: `Please choose one of the options for "${label}".` };
    }
    default:
      return { value: text };
  }
}

/** Every field checked; unknown keys are dropped, never stored. */
export function validateValues(form: FormProps, values: Record<string, unknown>): { data: Record<string, string | boolean>; errors: Record<string, string> } {
  const data: Record<string, string | boolean> = {};
  const errors: Record<string, string> = {};
  for (const field of form.fields) {
    const result = checkField(field, values[field.name]);
    if (result.error) errors[field.name] = result.error;
    else if (result.value !== undefined) data[field.name] = result.value;
  }
  return { data, errors };
}

/** A salted SHA-256 of the visitor's address: enough to count, useless to identify. */
export async function hashIp(ip: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The notification email: every field on its own line, reply-to the visitor when they gave an address. */
export function buildMail(site: FormSite, form: FormProps, page: string, data: Record<string, string | boolean>, delivery: { to: string[]; from: string }): Mail {
  const name = form.name || "Form";
  const lines = form.fields.map((field) => {
    const value = data[field.name];
    const shown = typeof value === "boolean" ? (value ? "Yes" : "No") : value || "(empty)";
    return `${field.label || field.name}:\n${shown}`;
  });
  const emailField = form.fields.find((field) => field.type === "email" && typeof data[field.name] === "string" && data[field.name]);
  const replyTo = emailField ? String(data[emailField.name]) : undefined;
  return {
    to: delivery.to,
    from: delivery.from,
    subject: `New entry: ${name} on ${site.name}`.slice(0, 200),
    text: [`A visitor sent the "${name}" form on the ${page} page of ${site.name}.`, "", ...lines.flatMap((line) => [line, ""])].join("\n"),
    replyTo,
  };
}

export type FormResult = { ok: true; message: string; redirect?: string } | { ok: false; code: "invalid"; message: string; fieldErrors: Record<string, string> };

export async function handleFormSubmit(input: FormInput, meta: { ipHash: string; userAgent: string | null }, deps: FormDeps): Promise<FormResult> {
  const now = deps.now();
  // Bots: the hidden field is filled, or the form was sent faster than anyone types.
  // They get the success answer (so they learn nothing) and nothing is stored.
  const elapsed = now.getTime() - input.startedAt;
  if (input.trap.trim() !== "" || elapsed < FORM_LIMITS.minFillMs) return { ok: true, message: "Thanks, we got it." };
  if (elapsed > FORM_LIMITS.maxAgeMs) throw new ArmatureError("invalid", "This page has been open a long time. Reload it and send the form again.");

  const site = await deps.site(input.siteId);
  if (!site || site.status === "hosting_only") throw new ArmatureError("invalid", "This form is not accepting entries.");
  const form = findForm(await deps.layout(site, input.page), input.elementId);
  if (!form) throw new ArmatureError("invalid", "This form has changed since the page loaded. Reload the page and try again.");

  const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
  const [short, day, siteHour] = await Promise.all([
    deps.countSince({ ipHash: meta.ipHash }, minutesAgo(FORM_LIMITS.perVisitorShort.minutes)),
    deps.countSince({ ipHash: meta.ipHash }, minutesAgo(FORM_LIMITS.perVisitorDay.minutes)),
    deps.countSince({ siteId: site.id }, minutesAgo(FORM_LIMITS.perSiteHour.minutes)),
  ]);
  if (short >= FORM_LIMITS.perVisitorShort.count || day >= FORM_LIMITS.perVisitorDay.count) throw new ArmatureError("rate_limited", "You've sent this form several times already. Please wait a few minutes and try again.");
  if (siteHour >= FORM_LIMITS.perSiteHour.count) throw new ArmatureError("rate_limited", "This form is busy right now. Please try again in a little while.");

  const { data, errors } = validateValues(form.props, input.values);
  if (Object.keys(errors).length > 0) return { ok: false, code: "invalid", message: "Please check the highlighted fields.", fieldErrors: errors };

  const id = await deps.insert({ siteId: site.id, page: input.page, elementId: input.elementId, formName: form.props.name ?? null, data, ipHash: meta.ipHash, userAgent: meta.userAgent ? meta.userAgent.slice(0, 300) : null });

  const delivery = await deps.delivery(site.id);
  if (deps.send && delivery.to.length > 0 && delivery.from) {
    let sent = false;
    try {
      sent = await deps.send(buildMail(site, form.props, input.page, data, { to: delivery.to, from: delivery.from }));
    } catch {
      sent = false;
    }
    await deps.setEmailStatus(id, sent ? "sent" : "failed");
  }
  return { ok: true, message: form.props.success || "Thanks, we got it.", redirect: form.props.redirect || undefined };
}
