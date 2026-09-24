/**
 * "Hosting & services": what the agency charges a site for, in five sections
 * (Hosting, Domain, Email, Automatic emails, Agreement), with an edit drawer.
 * Agency staff only: the site_services table is invisible to clients, so this
 * panel must only ever be rendered on the agency's side.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { IconPencil } from "@/components/icons.tsx";
import { Button, Drawer, EmptyState, Field, Input, Notice, Panel, Pill, Select, SkeletonRows, Textarea, useToast } from "@/components/ui.tsx";
import { formatDate, plural, relativeTime } from "@/lib/format.ts";
import { centsToInput, formatCents, inputToCents } from "@/lib/money.ts";
import {
  AUTOMATIC_EMAIL_HELP,
  EMAIL_PROVIDER_LABELS,
  OWNER_LABELS,
  TRANSACTIONAL_PROVIDER_LABELS,
  emptyServices,
  renewalState,
  servicesQueryKey,
  yearlyTotalCents,
  yearlyTotalSummary,
} from "@/lib/services.ts";
import { supabase } from "@/lib/supabase.ts";
import type { SiteServices } from "@/lib/types.ts";

async function loadServices(siteId: string): Promise<SiteServices | null> {
  const { data, error } = await supabase.from("site_services").select("*").eq("site_id", siteId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SiteServices | null) ?? null;
}

function Fact({ label, children, wide }: { label: string; children?: ReactNode; wide?: boolean }) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className={empty ? "text-[13px] text-muted" : "text-[13px] font-medium text-text"}>{empty ? "Not set" : children}</dd>
    </div>
  );
}

function RenewalFact({ label, date }: { label: string; date: string | null }) {
  if (!date) return <Fact label={label} />;
  const state = renewalState(date, null) ?? renewalState(null, date);
  return (
    <Fact label={label}>
      <span className="flex flex-wrap items-center gap-1.5">
        {formatDate(date)}
        {state?.state === "soon" && <Pill tone="amber">{state.days === 0 ? "Today" : `in ${plural(state.days, "day")}`}</Pill>}
        {state?.state === "past" && <Pill tone="danger">{plural(-state.days, "day")} ago</Pill>}
      </span>
    </Fact>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-4 last:border-b-0 sm:px-5">
      <h3 className="mb-2 font-sans text-[13px] font-bold tracking-normal text-text">{title}</h3>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

function ServicesFacts({ services }: { services: SiteServices }) {
  const email = services.email_provider;
  return (
    <>
      <Section title="Hosting">
        <Fact label="Provider">{services.hosting_provider}</Fact>
        <Fact label="Yearly fee">{services.hosting_annual_fee_cents !== null ? formatCents(services.hosting_annual_fee_cents) : null}</Fact>
        <Fact label="Started">{services.hosting_start_date ? formatDate(services.hosting_start_date) : null}</Fact>
        <RenewalFact label="Renews" date={services.hosting_renewal_date} />
      </Section>
      <Section title="Domain">
        <Fact label="Domain name">{services.domain_name}</Fact>
        <Fact label="Registrar">{services.domain_registrar}</Fact>
        <Fact label="Account owner">{services.domain_account_owner ? OWNER_LABELS[services.domain_account_owner] : null}</Fact>
        <Fact label="Yearly fee">{services.domain_annual_fee_cents !== null ? formatCents(services.domain_annual_fee_cents) : null}</Fact>
        <RenewalFact label="Renews" date={services.domain_renewal_date} />
      </Section>
      <Section title="Email">
        <Fact label="Provider">{email ? EMAIL_PROVIDER_LABELS[email] : null}</Fact>
        <Fact label="Mailboxes">{services.email_mailboxes !== null ? String(services.email_mailboxes) : null}</Fact>
        <Fact label="Pricing">
          {services.email_annual_fee_cents !== null
            ? services.email_pricing === "per_mailbox"
              ? `${formatCents(services.email_annual_fee_cents)} per mailbox a year`
              : `${formatCents(services.email_annual_fee_cents)} a year, flat`
            : null}
        </Fact>
        <Fact label="Managed by">{services.email_managed_by ? OWNER_LABELS[services.email_managed_by] : null}</Fact>
      </Section>
      <Section title="Automatic emails">
        <Fact label="Provider">{services.transactional_email_provider ? TRANSACTIONAL_PROVIDER_LABELS[services.transactional_email_provider] : null}</Fact>
        <Fact label="Sent from">{services.transactional_from_address}</Fact>
        <div className="sm:col-span-2 text-[12px] leading-relaxed text-muted">{AUTOMATIC_EMAIL_HELP}</div>
      </Section>
      <Section title="Agreement">
        <Fact label="Accepted on">{services.agreement_accepted_on ? formatDate(services.agreement_accepted_on) : null}</Fact>
        <Fact label="Last updated">{services.updated_at ? relativeTime(services.updated_at) : null}</Fact>
        <Fact label="Notes" wide>
          {services.notes.trim() ? <span className="whitespace-pre-wrap break-words font-normal">{services.notes}</span> : null}
        </Fact>
      </Section>
    </>
  );
}

// --- the edit drawer ------------------------------------------------------------------

type Draft = {
  hosting_provider: string;
  hosting_fee: string;
  hosting_start_date: string;
  hosting_renewal_date: string;
  domain_name: string;
  domain_registrar: string;
  domain_account_owner: "" | "agency" | "client";
  domain_renewal_date: string;
  domain_fee: string;
  email_provider: "" | NonNullable<SiteServices["email_provider"]>;
  email_mailboxes: string;
  email_pricing: "flat" | "per_mailbox";
  email_fee: string;
  email_managed_by: "" | "agency" | "client";
  transactional_email_provider: "" | NonNullable<SiteServices["transactional_email_provider"]>;
  transactional_from_address: string;
  agreement_accepted_on: string;
  notes: string;
};

function toDraft(services: SiteServices): Draft {
  return {
    hosting_provider: services.hosting_provider ?? "",
    hosting_fee: centsToInput(services.hosting_annual_fee_cents),
    hosting_start_date: services.hosting_start_date ?? "",
    hosting_renewal_date: services.hosting_renewal_date ?? "",
    domain_name: services.domain_name ?? "",
    domain_registrar: services.domain_registrar ?? "",
    domain_account_owner: services.domain_account_owner ?? "",
    domain_renewal_date: services.domain_renewal_date ?? "",
    domain_fee: centsToInput(services.domain_annual_fee_cents),
    email_provider: services.email_provider ?? "",
    email_mailboxes: services.email_mailboxes !== null ? String(services.email_mailboxes) : "",
    email_pricing: services.email_pricing ?? "flat",
    email_fee: centsToInput(services.email_annual_fee_cents),
    email_managed_by: services.email_managed_by ?? "",
    transactional_email_provider: services.transactional_email_provider ?? "",
    transactional_from_address: services.transactional_from_address ?? "",
    agreement_accepted_on: services.agreement_accepted_on ?? "",
    notes: services.notes,
  };
}

const text = (value: string): string | null => (value.trim() ? value.trim() : null);

/** Draft → row, or a list of problems. Money is parsed from dollars into cents. */
function fromDraft(siteId: string, draft: Draft): { row: Omit<SiteServices, "updated_at" | "updated_by">; problems: string[] } {
  const problems: string[] = [];
  const money = (label: string, value: string): number | null => {
    const cents = inputToCents(value);
    if (cents === undefined) {
      problems.push(`${label}: enter a dollar amount, like 200 or 18.50.`);
      return null;
    }
    return cents;
  };
  const mailboxes = draft.email_mailboxes.trim() === "" ? null : Number(draft.email_mailboxes);
  if (mailboxes !== null && (!Number.isInteger(mailboxes) || mailboxes < 0)) problems.push("Mailboxes: enter a whole number.");
  if (draft.transactional_from_address.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(draft.transactional_from_address.trim())) {
    problems.push("Sent from: that does not look like an email address.");
  }
  return {
    row: {
      site_id: siteId,
      hosting_provider: text(draft.hosting_provider),
      hosting_annual_fee_cents: money("Hosting fee", draft.hosting_fee),
      hosting_start_date: text(draft.hosting_start_date),
      hosting_renewal_date: text(draft.hosting_renewal_date),
      domain_name: text(draft.domain_name),
      domain_registrar: text(draft.domain_registrar),
      domain_account_owner: draft.domain_account_owner || null,
      domain_renewal_date: text(draft.domain_renewal_date),
      domain_annual_fee_cents: money("Domain fee", draft.domain_fee),
      email_provider: draft.email_provider || null,
      email_mailboxes: mailboxes !== null && Number.isInteger(mailboxes) && mailboxes >= 0 ? mailboxes : null,
      email_pricing: draft.email_pricing,
      email_annual_fee_cents: money("Email fee", draft.email_fee),
      email_managed_by: draft.email_managed_by || null,
      transactional_email_provider: draft.transactional_email_provider || null,
      transactional_from_address: text(draft.transactional_from_address),
      agreement_accepted_on: text(draft.agreement_accepted_on),
      notes: draft.notes.trim(),
    },
    problems,
  };
}

function DrawerSection({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-line px-4 py-4 last:border-b-0">
      <div>
        <h3 className="font-sans text-[13px] font-bold tracking-normal text-text">{title}</h3>
        {help && <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{help}</p>}
      </div>
      {children}
    </section>
  );
}

function ServicesDrawer({ siteId, siteName, services, open, onClose }: { siteId: string; siteName: string; services: SiteServices; open: boolean; onClose: () => void }) {
  const id = useId();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => toDraft(services));
  const [problems, setProblems] = useState<string[]>([]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const mutation = useMutation({
    mutationFn: async (row: Omit<SiteServices, "updated_at" | "updated_by">) => {
      const { error } = await supabase.from("site_services").upsert({ ...row, updated_by: user?.id ?? null }, { onConflict: "site_id" });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.show("Hosting & services saved");
      await Promise.all([queryClient.invalidateQueries({ queryKey: servicesQueryKey(siteId) }), queryClient.invalidateQueries({ queryKey: ["projects"] })]);
      onClose();
    },
  });

  // The live preview mirrors what the site_billing view will compute.
  const preview = {
    hosting_annual_fee_cents: inputToCents(draft.hosting_fee) ?? null,
    domain_annual_fee_cents: inputToCents(draft.domain_fee) ?? null,
    email_pricing: draft.email_pricing,
    email_annual_fee_cents: inputToCents(draft.email_fee) ?? null,
    email_mailboxes: draft.email_mailboxes.trim() === "" ? null : Number(draft.email_mailboxes) || 0,
  };

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { row, problems: found } = fromDraft(siteId, draft);
    setProblems(found);
    if (found.length > 0) return;
    mutation.mutate(row);
  }

  const busy = mutation.isPending;
  const money = (label: string, key: "hosting_fee" | "domain_fee" | "email_fee", hint?: string) => (
    <Field label={label} htmlFor={`${id}-${key}`} hint={hint}>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-muted">$</span>
        <Input id={`${id}-${key}`} inputMode="decimal" value={draft[key]} onChange={(event) => set(key, event.target.value)} disabled={busy} className="pl-7" placeholder="0" />
      </div>
    </Field>
  );

  return (
    <Drawer open={open} onClose={onClose} title={`Hosting & services: ${siteName}`}>
      <form onSubmit={onSubmit} className="flex h-full flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <DrawerSection title="Hosting">
            <Field label="Provider" htmlFor={`${id}-hosting_provider`}>
              <Input id={`${id}-hosting_provider`} value={draft.hosting_provider} onChange={(event) => set("hosting_provider", event.target.value)} disabled={busy} placeholder="Netlify, Vercel…" />
            </Field>
            {money("Yearly hosting fee", "hosting_fee")}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Started" htmlFor={`${id}-hosting_start_date`}>
                <Input id={`${id}-hosting_start_date`} type="date" value={draft.hosting_start_date} onChange={(event) => set("hosting_start_date", event.target.value)} disabled={busy} />
              </Field>
              <Field label="Renews on" htmlFor={`${id}-hosting_renewal_date`}>
                <Input id={`${id}-hosting_renewal_date`} type="date" value={draft.hosting_renewal_date} onChange={(event) => set("hosting_renewal_date", event.target.value)} disabled={busy} />
              </Field>
            </div>
          </DrawerSection>

          <DrawerSection title="Domain">
            <Field label="Domain name" htmlFor={`${id}-domain_name`}>
              <Input id={`${id}-domain_name`} value={draft.domain_name} onChange={(event) => set("domain_name", event.target.value)} disabled={busy} placeholder="example.com" spellCheck={false} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Registrar" htmlFor={`${id}-domain_registrar`}>
                <Input id={`${id}-domain_registrar`} value={draft.domain_registrar} onChange={(event) => set("domain_registrar", event.target.value)} disabled={busy} placeholder="Cloudflare, GoDaddy…" />
              </Field>
              <Field label="Account owner" htmlFor={`${id}-domain_account_owner`}>
                <Select id={`${id}-domain_account_owner`} value={draft.domain_account_owner} onChange={(event) => set("domain_account_owner", event.target.value as Draft["domain_account_owner"])} disabled={busy}>
                  <option value="">Not set</option>
                  <option value="agency">The agency</option>
                  <option value="client">The client</option>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {money("Yearly domain fee", "domain_fee")}
              <Field label="Renews on" htmlFor={`${id}-domain_renewal_date`}>
                <Input id={`${id}-domain_renewal_date`} type="date" value={draft.domain_renewal_date} onChange={(event) => set("domain_renewal_date", event.target.value)} disabled={busy} />
              </Field>
            </div>
          </DrawerSection>

          <DrawerSection title="Email" help="Mailboxes are where the client reads email.">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Provider" htmlFor={`${id}-email_provider`}>
                <Select id={`${id}-email_provider`} value={draft.email_provider} onChange={(event) => set("email_provider", event.target.value as Draft["email_provider"])} disabled={busy}>
                  <option value="">Not set</option>
                  {(Object.keys(EMAIL_PROVIDER_LABELS) as NonNullable<SiteServices["email_provider"]>[]).map((key) => (
                    <option key={key} value={key}>
                      {EMAIL_PROVIDER_LABELS[key]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Mailboxes" htmlFor={`${id}-email_mailboxes`}>
                <Input id={`${id}-email_mailboxes`} inputMode="numeric" value={draft.email_mailboxes} onChange={(event) => set("email_mailboxes", event.target.value)} disabled={busy} placeholder="0" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pricing" htmlFor={`${id}-email_pricing`}>
                <Select id={`${id}-email_pricing`} value={draft.email_pricing} onChange={(event) => set("email_pricing", event.target.value as Draft["email_pricing"])} disabled={busy}>
                  <option value="flat">Flat amount a year</option>
                  <option value="per_mailbox">Per mailbox a year</option>
                </Select>
              </Field>
              {money(draft.email_pricing === "per_mailbox" ? "Price per mailbox" : "Yearly email fee", "email_fee")}
            </div>
            <Field label="Managed by" htmlFor={`${id}-email_managed_by`}>
              <Select id={`${id}-email_managed_by`} value={draft.email_managed_by} onChange={(event) => set("email_managed_by", event.target.value as Draft["email_managed_by"])} disabled={busy}>
                <option value="">Not set</option>
                <option value="agency">The agency</option>
                <option value="client">The client</option>
              </Select>
            </Field>
          </DrawerSection>

          <DrawerSection title="Automatic emails" help={AUTOMATIC_EMAIL_HELP}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Provider" htmlFor={`${id}-transactional_email_provider`}>
                <Select
                  id={`${id}-transactional_email_provider`}
                  value={draft.transactional_email_provider}
                  onChange={(event) => set("transactional_email_provider", event.target.value as Draft["transactional_email_provider"])}
                  disabled={busy}
                >
                  <option value="">Not set</option>
                  <option value="resend">Resend</option>
                  <option value="other">Other</option>
                  <option value="none">None</option>
                </Select>
              </Field>
              <Field label="Sent from" htmlFor={`${id}-transactional_from_address`}>
                <Input
                  id={`${id}-transactional_from_address`}
                  type="email"
                  value={draft.transactional_from_address}
                  onChange={(event) => set("transactional_from_address", event.target.value)}
                  disabled={busy}
                  placeholder="hello@example.com"
                />
              </Field>
            </div>
          </DrawerSection>

          <DrawerSection title="Agreement">
            <Field label="Accepted on" htmlFor={`${id}-agreement_accepted_on`}>
              <Input id={`${id}-agreement_accepted_on`} type="date" value={draft.agreement_accepted_on} onChange={(event) => set("agreement_accepted_on", event.target.value)} disabled={busy} />
            </Field>
            <Field label="Notes" htmlFor={`${id}-notes`} hint="For the agency only. Clients never see this panel.">
              <Textarea id={`${id}-notes`} value={draft.notes} onChange={(event) => set("notes", event.target.value)} disabled={busy} maxLength={10000} className="min-h-20" />
            </Field>
          </DrawerSection>
        </div>

        <div className="flex flex-col gap-3 border-t border-line bg-ground px-4 py-3">
          <p className="text-[13px] leading-relaxed text-text" aria-live="polite">
            <span className="font-semibold">Yearly total: </span>
            {yearlyTotalSummary(preview)}
          </p>
          {problems.length > 0 && (
            <Notice kind="danger" title="Check the form">
              {problems.join("\n")}
            </Notice>
          )}
          {mutation.isError && (
            <Notice kind="danger" title="The services could not be saved">
              {mutation.error.message}
            </Notice>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Save
            </Button>
          </div>
        </div>
      </form>
    </Drawer>
  );
}

// --- the panel ----------------------------------------------------------------------------

export function SiteServicesPanel({ siteId, siteName }: { siteId: string; siteName: string }) {
  const query = useQuery({ queryKey: servicesQueryKey(siteId), queryFn: () => loadServices(siteId) });
  const [editing, setEditing] = useState(false);

  const services = query.data ?? null;
  const total = services ? yearlyTotalCents(services) : null;

  let body: ReactNode;
  if (query.isPending) {
    body = <SkeletonRows rows={3} label="Loading hosting and services" />;
  } else if (query.isError) {
    body = (
      <div className="p-4">
        <Notice kind="danger" title="Hosting and services could not be loaded">
          {query.error.message}
        </Notice>
      </div>
    );
  } else if (!services) {
    body = (
      <div className="p-5">
        <EmptyState
          title="No services recorded yet"
          action={
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <IconPencil size={16} /> Add hosting & services
            </Button>
          }
        >
          Record what you charge for hosting, the domain and email, and the renewal dates, so Projects can total it up and warn you before something lapses.
        </EmptyState>
      </div>
    );
  } else {
    body = <ServicesFacts services={services} />;
  }

  return (
    <>
      <Panel
        title="Hosting & services"
        aside={
          <>
            {total !== null && <span className="text-[13px] font-semibold text-text">{formatCents(total)} / year</span>}
            {!query.isPending && (
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                <IconPencil size={16} /> Edit
              </Button>
            )}
          </>
        }
      >
        {body}
      </Panel>
      {editing && <ServicesDrawer key={services?.updated_at ?? "new"} siteId={siteId} siteName={siteName} services={services ?? emptyServices(siteId)} open onClose={() => setEditing(false)} />}
    </>
  );
}
