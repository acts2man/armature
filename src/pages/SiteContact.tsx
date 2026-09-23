/**
 * /sites/:siteId/contact — the inbox for everything the site's forms send in. A list with
 * unread dots (sender, form, page, date), a filter by form and by unread, and the open
 * entry with every field it carried; mark read or unread, Reply (a mailto: link to the
 * sender), Delete (agency staff only) and Export CSV of what is shown. The Settings tab
 * (agency staff only) sets where entries are emailed (site_services.form_recipients).
 */
import { clsx } from "clsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, NavLink, useSearchParams } from "react-router";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { IconCheck, IconExternal, IconInbox, IconMail, IconTrash, IconX } from "@/components/icons.tsx";
import { useSite } from "@/components/SiteLayout.tsx";
import { Button, Drawer, EmptyState, Field, IconButton, Input, LinkButton, Modal, Notice, PageHeader, Pill, Segmented, Select, SkeletonRows, SrOnly, TabBar, tabClass, useToast } from "@/components/ui.tsx";
import { useMessageActions, useMessages } from "@/hooks/useMessages.ts";
import { useWide } from "@/hooks/useWide.ts";
import { formatDateTime, relativeTime } from "@/lib/format.ts";
import { formLabel, isUnread, messagePreview, replyLink, senderEmail, senderLabel, submissionsToCsv } from "@/lib/messages.ts";
import { supabase } from "@/lib/supabase.ts";
import type { FormSubmission } from "@/lib/types.ts";

const valueText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(valueText).filter(Boolean).join(", ");
  return JSON.stringify(value);
};

const EMAIL_STATUS: Record<FormSubmission["email_status"], { label: string; tone: "green" | "amber" | "grey" }> = {
  sent: { label: "Emailed", tone: "green" },
  failed: { label: "Email failed", tone: "amber" },
  skipped: { label: "Not emailed", tone: "grey" },
};

function EntryDetail({ entry, siteId, siteName, isStaff, onRead, onDelete, onClose, busy }: { entry: FormSubmission; siteId: string; siteName: string; isStaff: boolean; onRead: (read: boolean) => void; onDelete: () => void; onClose: () => void; busy: boolean }) {
  const email = senderEmail(entry.data);
  const reply = replyLink(entry, siteName);
  const unread = isUnread(entry);
  return (
    <article className="flex flex-col gap-4" data-testid="entry-detail" aria-label={`Message from ${senderLabel(entry.data)}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-sans text-[17px] font-bold tracking-normal text-text" data-testid="entry-sender">
            {senderLabel(entry.data)}
          </h2>
          {email && (
            <a href={`mailto:${email}`} className="break-all text-[13px] text-muted underline-offset-2 hover:underline">
              {email}
            </a>
          )}
        </div>
        <IconButton label="Close message" size="sm" onClick={onClose} className="shell:hidden">
          <IconX size={18} />
        </IconButton>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
        <span title={formatDateTime(entry.created_at)}>{formatDateTime(entry.created_at)}</span>
        <span>·</span>
        <span>{formLabel(entry)}</span>
        <span>·</span>
        <Link to={`/sites/${siteId}/visual?page=${encodeURIComponent(entry.page_slug)}&element=${encodeURIComponent(entry.element_id)}`} className="underline-offset-2 hover:underline">
          Page: {entry.page_slug}
        </Link>
        <Pill tone={EMAIL_STATUS[entry.email_status].tone}>{EMAIL_STATUS[entry.email_status].label}</Pill>
      </div>
      <div className="flex flex-wrap gap-2">
        {reply ? (
          <LinkButton to={reply} external size="sm" className="!inline-flex" >
            <IconMail size={15} /> Reply
          </LinkButton>
        ) : (
          <Button size="sm" disabled title="This entry has no email address to reply to">
            <IconMail size={15} /> Reply
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={() => onRead(unread)} disabled={busy} data-testid="entry-toggle-read">
          {unread ? "Mark as read" : "Mark as unread"}
        </Button>
        {isStaff && (
          <Button variant="danger" size="sm" onClick={onDelete} disabled={busy} data-testid="entry-delete">
            <IconTrash size={15} /> Delete
          </Button>
        )}
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-3 rounded-card border border-line bg-panel p-4 text-[14px] sm:grid-cols-[minmax(120px,180px)_minmax(0,1fr)]" data-testid="entry-fields">
        {Object.entries(entry.data).map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-[13px] font-semibold text-muted">{key}</dt>
            <dd className="whitespace-pre-wrap break-words text-text">{valueText(value) || <span className="text-muted">—</span>}</dd>
          </div>
        ))}
      </dl>
      {entry.user_agent && <p className="text-[12px] text-muted">Sent from: {entry.user_agent}</p>}
    </article>
  );
}

function Inbox() {
  const { site, isStaff } = useSite();
  const [params, setParams] = useSearchParams();
  const wide = useWide();
  const query = useMessages(site.id);
  const { markRead, remove } = useMessageActions(site.id);
  const [form, setForm] = useState("all");
  const [only, setOnly] = useState<"all" | "unread">("all");
  const [confirmDelete, setConfirmDelete] = useState<FormSubmission | null>(null);
  const selectedId = params.get("entry");
  const busy = markRead.isPending || remove.isPending;

  const entries = useMemo(() => query.data ?? [], [query.data]);
  const forms = useMemo(() => [...new Set(entries.map((entry) => formLabel(entry)))].sort(), [entries]);
  const shown = entries.filter((entry) => (form === "all" || formLabel(entry) === form) && (only === "all" || isUnread(entry)));
  const selected = entries.find((entry) => entry.id === selectedId) ?? null;
  const unreadCount = entries.filter(isUnread).length;

  // Opening an entry marks it read, as in any inbox.
  const openedUnread = selected && isUnread(selected) ? selected.id : null;
  useEffect(() => {
    if (openedUnread) markRead.mutate({ ids: [openedUnread], read: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openedUnread]);

  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("entry", id);
    else next.delete("entry");
    setParams(next, { replace: true });
  };

  const exportCsv = () => {
    const csv = submissionsToCsv(shown);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${site.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-messages-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const detail = selected && (
    <EntryDetail
      key={selected.id}
      entry={selected}
      siteId={site.id}
      siteName={site.name}
      isStaff={isStaff}
      busy={busy}
      onRead={(read) => markRead.mutate({ ids: [selected.id], read })}
      onDelete={() => setConfirmDelete(selected)}
      onClose={() => open(null)}
    />
  );

  let list: ReactNode;
  if (query.isPending) list = <SkeletonRows rows={4} label="Loading messages" />;
  else if (query.isError)
    list = (
      <div className="p-4">
        <Notice kind="danger" title="Messages could not be loaded">
          {query.error.message}
        </Notice>
      </div>
    );
  else if (entries.length === 0)
    list = (
      <div className="p-5">
        <EmptyState title="No messages yet" icon={<IconInbox size={18} />}>
          When someone fills in a form on the site, their message lands here{isStaff ? " and is emailed to the addresses under Settings" : ""}.
        </EmptyState>
      </div>
    );
  else if (shown.length === 0)
    list = (
      <div className="p-5">
        <EmptyState title={only === "unread" ? "Nothing unread" : "No messages from that form"} icon={<IconCheck size={18} />}>
          {only === "unread" ? "You have read everything." : "Choose another form, or all forms."}
        </EmptyState>
      </div>
    );
  else
    list = (
      <ul data-testid="inbox-list">
        {shown.map((entry) => {
          const unread = isUnread(entry);
          const active = entry.id === selectedId;
          return (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => open(entry.id)}
                aria-current={active ? "true" : undefined}
                data-testid={`entry-${entry.id}`}
                data-unread={unread ? "yes" : "no"}
                className={clsx("flex w-full items-start gap-3 border-b border-line px-4 py-3 text-left last:border-b-0", active ? "bg-blue-soft" : "hover:bg-ground")}
              >
                <span className="mt-2 flex h-2.5 w-2.5 shrink-0 items-center justify-center" aria-hidden="true">
                  {unread && <span className="h-2 w-2 rounded-full bg-accent" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className={clsx("truncate text-[14px] text-text", unread ? "font-bold" : "font-semibold")}>
                      {senderLabel(entry.data)}
                      {unread && <SrOnly> (unread)</SrOnly>}
                    </span>
                    <span className="shrink-0 text-[12px] text-muted">{relativeTime(entry.created_at)}</span>
                  </span>
                  <span className="block truncate text-[12px] text-muted">
                    {formLabel(entry)} · {entry.page_slug}
                  </span>
                  <span className="block truncate text-[13px] text-muted">{messagePreview(entry.data, 90)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label="Show"
            value={only}
            onChange={setOnly}
            options={[
              { value: "all", label: "All" },
              { value: "unread", label: unreadCount > 0 ? `Unread (${unreadCount})` : "Unread" },
            ]}
          />
          <label className="flex items-center gap-2 text-[13px] text-muted">
            <span>Form</span>
            <Select value={form} onChange={(event) => setForm(event.target.value)} className="h-10 w-48" data-testid="inbox-form-filter">
              <option value="all">All forms</option>
              {forms.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </label>
          <span className="text-[13px] text-muted" data-testid="inbox-count">
            {shown.length} {shown.length === 1 ? "message" : "messages"}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {unreadCount > 0 && (
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => markRead.mutate({ ids: entries.filter(isUnread).map((entry) => entry.id), read: true })} data-testid="inbox-mark-all-read">
              Mark all as read
            </Button>
          )}
          <Button variant="secondary" size="sm" disabled={shown.length === 0} onClick={exportCsv} data-testid="inbox-export">
            <IconExternal size={15} /> Export CSV
          </Button>
        </div>
      </div>

      <div className={clsx("grid items-start gap-5", wide && selected && "grid-cols-[minmax(300px,380px)_minmax(0,1fr)]")}>
        <div className="rounded-card border border-line bg-panel">{list}</div>
        {wide && detail && <div className="rounded-card border border-line bg-panel p-5">{detail}</div>}
      </div>
      {!wide && (
        <Drawer open={!!detail} onClose={() => open(null)} title="Message">
          <div className="p-4">{detail}</div>
        </Drawer>
      )}

      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Delete this message?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              data-testid="entry-delete-confirm"
              onClick={() => {
                if (!confirmDelete) return;
                remove.mutate(confirmDelete.id, {
                  onSuccess: () => open(null),
                  onSettled: () => setConfirmDelete(null),
                });
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-[14px] leading-relaxed text-text">The message from {confirmDelete ? senderLabel(confirmDelete.data) : "this sender"} is removed for everyone. This cannot be undone.</p>
      </Modal>
    </div>
  );
}

// --- settings: where entries are emailed -----------------------------------------------------------

const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;
const MAX_RECIPIENTS = 10;

function RecipientsSettings() {
  const { site } = useSite();
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const inputId = useId();
  const query = useQuery({
    queryKey: ["site-services", site.id, "recipients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("site_services").select("form_recipients").eq("site_id", site.id).maybeSingle();
      if (error) throw new Error(error.message);
      return ((data as { form_recipients?: string[] } | null)?.form_recipients ?? []) as string[];
    },
  });
  const [draft, setDraft] = useState<string[] | null>(null);
  const [adding, setAdding] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const recipients = draft ?? query.data ?? [];
  const changed = draft !== null && JSON.stringify(draft) !== JSON.stringify(query.data ?? []);

  const save = useMutation({
    mutationFn: async (list: string[]) => {
      const { error } = await supabase.from("site_services").upsert({ site_id: site.id, form_recipients: list, updated_by: user?.id ?? null }, { onConflict: "site_id" });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.show("Recipients saved.");
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ["site-services", site.id] });
    },
  });

  const add = (event: FormEvent) => {
    event.preventDefault();
    const email = adding.trim().toLowerCase();
    if (!EMAIL.test(email)) return setProblem("That does not look like an email address.");
    if (recipients.includes(email)) return setProblem("That address is already on the list.");
    if (recipients.length >= MAX_RECIPIENTS) return setProblem(`Up to ${MAX_RECIPIENTS} addresses can receive entries.`);
    setProblem(null);
    setDraft([...recipients, email]);
    setAdding("");
  };

  return (
    <div className="flex max-w-2xl flex-col gap-5" data-testid="recipients-settings">
      <Notice kind="info" title="Every entry is kept here whatever happens">
        Entries land in the inbox even when no address is set. They are emailed to the addresses below when the site's sending service is set up under Site settings › Hosting &amp; services.
      </Notice>
      {query.isError && (
        <Notice kind="danger" title="The recipients could not be loaded">
          {query.error.message}
        </Notice>
      )}
      {save.isError && (
        <Notice kind="danger" title="The recipients could not be saved">
          {save.error.message}
        </Notice>
      )}
      <div className="rounded-card border border-line bg-panel">
        <div className="flex min-h-12 items-center justify-between gap-3 border-b border-line px-5">
          <h2 className="font-sans text-[15px] font-bold tracking-normal text-text">Email recipients</h2>
          <span className="text-[12px] text-muted">
            {recipients.length} of {MAX_RECIPIENTS}
          </span>
        </div>
        {query.isPending ? (
          <SkeletonRows rows={2} label="Loading recipients" />
        ) : recipients.length === 0 ? (
          <p className="px-5 py-4 text-[13px] text-muted">No addresses yet. Entries stay in the inbox only.</p>
        ) : (
          <ul data-testid="recipients-list">
            {recipients.map((email) => (
              <li key={email} className="flex min-h-12 items-center justify-between gap-3 border-b border-line px-5 text-[14px] last:border-b-0">
                <span className="break-all">{email}</span>
                <Button variant="secondary" size="sm" onClick={() => setDraft(recipients.filter((item) => item !== email))} data-testid={`remove-${email}`}>
                  Remove
                  <SrOnly> {email}</SrOnly>
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={add} className="flex flex-wrap items-end gap-2 border-t border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <Field label="Add an address" htmlFor={inputId} error={problem}>
              <Input id={inputId} type="text" inputMode="email" autoComplete="off" value={adding} onChange={(event) => setAdding(event.target.value)} placeholder="name@example.com" data-testid="recipient-input" />
            </Field>
          </div>
          <Button type="submit" variant="secondary" disabled={!adding.trim() || recipients.length >= MAX_RECIPIENTS} data-testid="recipient-add">
            Add
          </Button>
        </form>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => save.mutate(recipients)} disabled={!changed} loading={save.isPending} data-testid="recipients-save">
          Save recipients
        </Button>
        {changed && (
          <Button variant="secondary" onClick={() => setDraft(null)}>
            Discard changes
          </Button>
        )}
      </div>
    </div>
  );
}

export function SiteContact() {
  const { site, isStaff } = useSite();
  const [params] = useSearchParams();
  const tab = isStaff && params.get("tab") === "settings" ? "settings" : "inbox";
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Contact" description={`Everything ${site.name}'s forms send in.`} />
      {isStaff && (
        <div className="border-b border-line">
          <TabBar label="Contact">
            <NavLink to="?" end className={() => tabClass({ isActive: tab === "inbox" })} aria-current={tab === "inbox" ? "page" : undefined} data-testid="contact-tab-inbox">
              Inbox
            </NavLink>
            <NavLink to="?tab=settings" className={() => tabClass({ isActive: tab === "settings" })} aria-current={tab === "settings" ? "page" : undefined} data-testid="contact-tab-settings">
              Settings
            </NavLink>
          </TabBar>
        </div>
      )}
      {tab === "settings" ? <RecipientsSettings /> : <Inbox />}
    </div>
  );
}
