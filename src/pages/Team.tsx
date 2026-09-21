/**
 * Who can edit a site: the client members, pending invitations, and the agency
 * staff who always have access. Agency staff only; clients see a plain notice.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { useSite } from "@/components/SiteLayout.tsx";
import { Button, Card, EmptyState, Field, Input, Notice, PageHeader, Pill, Select, Spinner, SrOnly } from "@/components/ui.tsx";
import { formatDate } from "@/lib/format.ts";
import { callFunction } from "@/lib/functions.ts";
import { supabase } from "@/lib/supabase.ts";
import {
  AGENCY_ROLE_LABELS,
  SITE_ROLE_LABELS,
  type AgencyMember,
  type Invite,
  type Profile,
  type SiteMember,
  type SiteRole,
} from "@/lib/types.ts";
import type { InviteCreateResponse } from "@shared/publishTypes.ts";

type ProfileLite = Pick<Profile, "id" | "email" | "full_name">;
type Person = { user_id: string; profile: ProfileLite | null; created_at: string };
type MemberRow = Person & { role: SiteRole };
type StaffRow = Person & { role: AgencyMember["role"] };
type PendingInvite = Invite & { expired: boolean };
type CreatedInvite = { url: string; email: string; expires_at: string; emailed: boolean };

async function loadProfiles(userIds: string[]): Promise<Map<string, ProfileLite>> {
  const map = new Map<string, ProfileLite>();
  if (userIds.length === 0) return map;
  const { data, error } = await supabase.from("profiles").select("id, email, full_name").in("id", userIds);
  if (error) throw new Error(`Could not load people's names: ${error.message}`);
  for (const profile of (data ?? []) as ProfileLite[]) map.set(profile.id, profile);
  return map;
}

async function loadMembers(siteId: string): Promise<MemberRow[]> {
  const { data, error } = await supabase.from("site_members").select("*").eq("site_id", siteId).order("created_at");
  if (error) throw new Error(error.message);
  const members = (data ?? []) as SiteMember[];
  const profiles = await loadProfiles(members.map((member) => member.user_id));
  return members.map((member) => ({
    user_id: member.user_id,
    role: member.role,
    created_at: member.created_at,
    profile: profiles.get(member.user_id) ?? null,
  }));
}

async function loadInvites(siteId: string): Promise<PendingInvite[]> {
  const { data, error } = await supabase
    .from("invites")
    .select("*")
    .eq("site_id", siteId)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const now = Date.now();
  return ((data ?? []) as Invite[]).map((invite) => ({
    ...invite,
    expired: new Date(invite.expires_at).getTime() < now,
  }));
}

async function loadStaff(agencyId: string): Promise<StaffRow[]> {
  const { data, error } = await supabase.from("agency_members").select("*").eq("agency_id", agencyId).order("created_at");
  if (error) throw new Error(error.message);
  const staff = (data ?? []) as AgencyMember[];
  const profiles = await loadProfiles(staff.map((member) => member.user_id));
  return staff.map((member) => ({
    user_id: member.user_id,
    role: member.role,
    created_at: member.created_at,
    profile: profiles.get(member.user_id) ?? null,
  }));
}

function PersonCell({ person }: { person: Person }) {
  const name = person.profile?.full_name?.trim();
  const email = person.profile?.email?.trim();
  if (!name && !email) return <span className="text-muted">—</span>;
  return (
    <div className="min-w-0">
      <p className="font-medium text-text">{name || email}</p>
      {name && email && <p className="break-all text-xs text-muted">{email}</p>}
    </div>
  );
}

function InviteLinkNotice({ invite, onDismiss }: { invite: CreatedInvite; onDismiss: () => void }) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const inputId = `invite-link-${invite.email.replace(/[^a-z0-9]/gi, "-")}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(invite.url);
      setCopied("copied");
    } catch {
      const input = document.getElementById(inputId);
      if (input instanceof HTMLInputElement) {
        input.focus();
        input.select();
      }
      setCopied("failed");
    }
  }

  return (
    <Notice
      kind="success"
      title="Invite created"
      action={
        <>
          <Button variant="secondary" onClick={() => void copy()}>
            {copied === "copied" ? "Copied" : "Copy link"}
          </Button>
          <Button variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        </>
      }
    >
      <p>
        {invite.emailed
          ? `The link was emailed to ${invite.email}; you can also copy it below.`
          : `Email sending is not set up yet, so copy this link and send it to ${invite.email} yourself.`}{" "}
        It expires on {formatDate(invite.expires_at)}.
      </p>
      <div className="mt-2">
        <label htmlFor={inputId} className="sr-only">
          Invite link
        </label>
        <Input id={inputId} readOnly value={invite.url} onFocus={(event) => event.currentTarget.select()} />
      </div>
      {copied === "failed" && <p className="mt-1 text-sm">Copying failed; the link is selected, so press Ctrl+C or Cmd+C.</p>}
    </Notice>
  );
}

function MembersSection({ siteId }: { siteId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["site-members", siteId], queryFn: () => loadMembers(siteId) });

  const remove = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.from("site_members").delete().eq("site_id", siteId).eq("user_id", userId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["site-members", siteId] }),
  });

  function confirmRemove(row: MemberRow) {
    const who = row.profile?.email ?? row.profile?.full_name ?? "this person";
    if (window.confirm(`Remove ${who} from this site? They will no longer be able to edit it.`)) {
      remove.mutate(row.user_id);
    }
  }

  let body: ReactNode;
  if (query.isPending) {
    body = <Spinner label="Loading members" />;
  } else if (query.isError) {
    body = (
      <Notice kind="danger" title="Members could not be loaded">
        {query.error.message}
      </Notice>
    );
  } else if (query.data.length === 0) {
    body = <EmptyState title="No client members yet">Invite a client below and they will appear here once they accept.</EmptyState>;
  } else {
    body = (
      <>
        <div className="hidden overflow-x-auto rounded-card border border-line bg-panel sm:block">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                <th scope="col" className="px-4 py-3 font-medium">
                  Person
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Role
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Joined
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  <SrOnly>Actions</SrOnly>
                </th>
              </tr>
            </thead>
            <tbody>
              {query.data.map((row) => (
                <tr key={row.user_id} className="border-b border-line align-middle last:border-b-0">
                  <td className="px-4 py-3">
                    <PersonCell person={row} />
                  </td>
                  <td className="px-4 py-3 text-text">{SITE_ROLE_LABELS[row.role]}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted">{formatDate(row.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="danger" onClick={() => confirmRemove(row)} loading={remove.isPending && remove.variables === row.user_id}>
                      Remove
                      <SrOnly> {row.profile?.email ?? row.user_id}</SrOnly>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="space-y-3 sm:hidden">
          {query.data.map((row) => (
            <li key={row.user_id}>
              <Card as="article">
                <PersonCell person={row} />
                <p className="mt-2 text-sm text-muted">
                  {SITE_ROLE_LABELS[row.role]} · Joined {formatDate(row.created_at)}
                </p>
                <Button
                  variant="danger"
                  className="mt-3 w-full"
                  onClick={() => confirmRemove(row)}
                  loading={remove.isPending && remove.variables === row.user_id}
                >
                  Remove
                  <SrOnly> {row.profile?.email ?? row.user_id}</SrOnly>
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-ink">Members</h2>
      {remove.isError && (
        <Notice kind="danger" title="The member could not be removed">
          {remove.error.message}
        </Notice>
      )}
      {body}
    </section>
  );
}

function InvitesSection({ siteId }: { siteId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["site-invites", siteId], queryFn: () => loadInvites(siteId) });

  const remove = useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase.from("invites").delete().eq("id", inviteId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["site-invites", siteId] }),
  });

  let body: ReactNode;
  if (query.isPending) {
    body = <Spinner label="Loading invitations" />;
  } else if (query.isError) {
    body = (
      <Notice kind="danger" title="Invitations could not be loaded">
        {query.error.message}
      </Notice>
    );
  } else if (query.data.length === 0) {
    body = <p className="text-sm text-muted">No pending invitations.</p>;
  } else {
    body = (
      <ul className="space-y-3">
        {query.data.map((invite) => (
          <li key={invite.id}>
            <Card as="article" className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="break-all font-medium text-text">{invite.email}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                  <span>{SITE_ROLE_LABELS[invite.role as SiteRole] ?? invite.role}</span>
                  <span>· Expires {formatDate(invite.expires_at)}</span>
                  {invite.expired && <Pill tone="danger">Expired</Pill>}
                </p>
              </div>
              <Button
                variant="danger"
                onClick={() => remove.mutate(invite.id)}
                loading={remove.isPending && remove.variables === invite.id}
              >
                Delete
                <SrOnly> invite for {invite.email}</SrOnly>
              </Button>
            </Card>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-ink">Pending invitations</h2>
      {remove.isError && (
        <Notice kind="danger" title="The invitation could not be deleted">
          {remove.error.message}
        </Notice>
      )}
      {body}
    </section>
  );
}

function InviteForm({ siteId, agencyId }: { siteId: string; agencyId: string }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<SiteRole>("client_editor");
  const [created, setCreated] = useState<CreatedInvite | null>(null);

  const mutation = useMutation({
    mutationFn: async (input: { email: string; role: SiteRole }) => {
      const result = await callFunction<InviteCreateResponse>("invite-create", {
        agency_id: agencyId,
        site_id: siteId,
        email: input.email,
        role: input.role,
      });
      if (!result.ok) throw new Error(result.message);
      return { ...result, email: input.email };
    },
    onSuccess: async (result) => {
      setCreated({ url: result.invite_url, email: result.email, expires_at: result.expires_at, emailed: result.emailed });
      setEmail("");
      await queryClient.invalidateQueries({ queryKey: ["site-invites", siteId] });
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setCreated(null);
    mutation.mutate({ email: trimmed, role });
  }

  return (
    <Card as="section">
      <h2 className="text-lg font-semibold text-ink">Invite a client</h2>
      <p className="mt-1 text-sm text-muted">They get a link that signs them in and adds them to this site.</p>
      <form onSubmit={onSubmit} className="mt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <Field label="Email" htmlFor="invite-email">
            <Input
              id="invite-email"
              type="email"
              required
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={mutation.isPending}
            />
          </Field>
          <Field label="Role" htmlFor="invite-role">
            <Select
              id="invite-role"
              value={role}
              onChange={(event) => setRole(event.target.value as SiteRole)}
              disabled={mutation.isPending}
            >
              <option value="client_owner">{SITE_ROLE_LABELS.client_owner}</option>
              <option value="client_editor">{SITE_ROLE_LABELS.client_editor}</option>
            </Select>
          </Field>
        </div>
        {mutation.isError && (
          <Notice kind="danger" title="The invite could not be created">
            {mutation.error.message}
          </Notice>
        )}
        {created && <InviteLinkNotice invite={created} onDismiss={() => setCreated(null)} />}
        <Button type="submit" loading={mutation.isPending}>
          Create invite
        </Button>
      </form>
    </Card>
  );
}

function StaffSection({ agencyId }: { agencyId: string }) {
  const query = useQuery({ queryKey: ["agency-staff", agencyId], queryFn: () => loadStaff(agencyId) });

  let body: ReactNode;
  if (query.isPending) {
    body = <Spinner label="Loading agency staff" />;
  } else if (query.isError) {
    body = (
      <Notice kind="danger" title="Agency staff could not be loaded">
        {query.error.message}
      </Notice>
    );
  } else if (query.data.length === 0) {
    body = <p className="text-sm text-muted">No agency staff found.</p>;
  } else {
    body = (
      <ul className="divide-y divide-line">
        {query.data.map((row) => (
          <li key={row.user_id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <PersonCell person={row} />
            <span className="text-sm text-muted">{AGENCY_ROLE_LABELS[row.role]}</span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Card as="section">
      <h2 className="text-lg font-semibold text-ink">Agency staff (always have access)</h2>
      <div className="mt-2">{body}</div>
    </Card>
  );
}

export function Team() {
  const { site, isStaff } = useSite();

  if (!isStaff) {
    return <Notice kind="warning">Only agency staff manage who has access to a site.</Notice>;
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Team" description={`Who can edit ${site.name}, and pending invitations.`} />
      <MembersSection siteId={site.id} />
      <InvitesSection siteId={site.id} />
      <InviteForm siteId={site.id} agencyId={site.agency_id} />
      <StaffSection agencyId={site.agency_id} />
    </div>
  );
}
