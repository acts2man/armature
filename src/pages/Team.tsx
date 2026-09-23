/**
 * Who can edit a site: the client members, pending invitations, and the agency
 * staff who always have access. Agency staff only; clients see a plain notice.
 * Two ways to add a client: an invite link, or a login the agency creates.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { IconCopy, IconEye, IconEyeOff, IconKey, IconMail, IconPlus, IconSparkle } from "@/components/icons.tsx";
import { useSite } from "@/components/SiteLayout.tsx";
import { Button, Cell, DataRow, DataTable, Field, Input, Modal, Monogram, Notice, PageHeader, Pill, Segmented, Select, SkeletonRows, SrOnly, useToast } from "@/components/ui.tsx";
import { formatDate, relativeTime } from "@/lib/format.ts";
import { callFunction } from "@/lib/functions.ts";
import { loginDetailsMessage } from "@/lib/loginMessage.ts";
import { supabase } from "@/lib/supabase.ts";
import { AGENCY_ROLE_LABELS, SITE_ROLE_LABELS, type AgencyMember, type Invite, type Profile, type SiteMember, type SiteRole } from "@/lib/types.ts";
import { MIN_PASSWORD_LENGTH, generateTemporaryPassword, passwordProblem } from "@shared/passwordRules.ts";
import type { ClientCreateResponse, InviteCreateResponse } from "@shared/publishTypes.ts";
import { InviteLinkNotice } from "./AgencyTeam.tsx";

type ProfileLite = Pick<Profile, "id" | "email" | "full_name" | "last_sign_in_at">;
type Person = { user_id: string; profile: ProfileLite | null; created_at: string };
type MemberRow = Person & { role: SiteRole };
type StaffRow = Person & { role: AgencyMember["role"] };
type PendingInvite = Invite & { expired: boolean };
type CreatedInvite = { url: string; email: string; expires_at: string; emailed: boolean };
type CreatedLogin = ClientCreateResponse & { temporaryPassword: string; fullName: string };
type SiteOption = { id: string; name: string };

async function loadProfiles(userIds: string[]): Promise<Map<string, ProfileLite>> {
  const map = new Map<string, ProfileLite>();
  if (userIds.length === 0) return map;
  const { data, error } = await supabase.from("profiles").select("*").in("id", userIds);
  if (error) throw new Error(`Could not load people's names: ${error.message}`);
  for (const profile of (data ?? []) as ProfileLite[]) map.set(profile.id, profile);
  return map;
}

async function loadMembers(siteId: string): Promise<MemberRow[]> {
  const { data, error } = await supabase.from("site_members").select("*").eq("site_id", siteId).order("created_at");
  if (error) throw new Error(error.message);
  const members = (data ?? []) as SiteMember[];
  const profiles = await loadProfiles(members.map((member) => member.user_id));
  return members.map((member) => ({ user_id: member.user_id, role: member.role, created_at: member.created_at, profile: profiles.get(member.user_id) ?? null }));
}

async function loadInvites(siteId: string): Promise<PendingInvite[]> {
  const { data, error } = await supabase.from("invites").select("*").eq("site_id", siteId).is("accepted_at", null).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const now = Date.now();
  return ((data ?? []) as Invite[]).map((invite) => ({ ...invite, expired: new Date(invite.expires_at).getTime() < now }));
}

async function loadStaff(agencyId: string): Promise<StaffRow[]> {
  const { data, error } = await supabase.from("agency_members").select("*").eq("agency_id", agencyId).order("created_at");
  if (error) throw new Error(error.message);
  const staff = (data ?? []) as AgencyMember[];
  const profiles = await loadProfiles(staff.map((member) => member.user_id));
  return staff.map((member) => ({ user_id: member.user_id, role: member.role, created_at: member.created_at, profile: profiles.get(member.user_id) ?? null }));
}

async function loadAgencySites(agencyId: string): Promise<SiteOption[]> {
  const { data, error } = await supabase.from("sites").select("id, name").eq("agency_id", agencyId).order("name");
  if (error) throw new Error(`Could not load the agency's sites: ${error.message}`);
  return (data ?? []) as SiteOption[];
}

const personName = (person: Person): string => person.profile?.full_name?.trim() || person.profile?.email?.trim() || "Unknown";
const personEmail = (person: Person): string | undefined => {
  const email = person.profile?.email?.trim();
  return email && email !== personName(person) ? email : undefined;
};

function InviteForm({ siteId, agencyId }: { siteId: string; agencyId: string }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<SiteRole>("client_editor");
  const [created, setCreated] = useState<CreatedInvite | null>(null);

  const mutation = useMutation({
    mutationFn: async (input: { email: string; role: SiteRole }) => {
      const result = await callFunction<InviteCreateResponse>("invite-create", { agency_id: agencyId, site_id: siteId, email: input.email, role: input.role });
      if (!result.ok) throw new Error(result.message);
      return { ...result, email: input.email };
    },
    onSuccess: async (result) => {
      setCreated({ url: result.invite_url, email: result.email, expires_at: result.expires_at, emailed: result.emailed });
      setEmail("");
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["site-invites", siteId] }), queryClient.invalidateQueries({ queryKey: ["site-users", siteId] })]);
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
    <form onSubmit={onSubmit} className="flex flex-col gap-4 p-4 sm:p-5">
      <p className="text-[13px] text-muted">They get a link that signs them in and adds them to this site. It expires after seven days.</p>
      <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
        <Field label="Email" htmlFor="invite-email">
          <Input id="invite-email" type="email" required autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} disabled={mutation.isPending} />
        </Field>
        <Field label="Role" htmlFor="invite-role">
          <Select id="invite-role" value={role} onChange={(event) => setRole(event.target.value as SiteRole)} disabled={mutation.isPending}>
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
      <div>
        <Button type="submit" loading={mutation.isPending}>
          <IconMail size={16} /> Create invite
        </Button>
      </div>
    </form>
  );
}

function LoginDetailsCard({ login, portalName, onDismiss }: { login: CreatedLogin; portalName: string; onDismiss: () => void }) {
  const toast = useToast();
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const textId = `login-details-${login.email.replace(/[^a-z0-9]/gi, "-")}`;
  const message = loginDetailsMessage({ portalName, signInUrl: login.sign_in_url, email: login.email, temporaryPassword: login.temporaryPassword });

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied("copied");
      toast.show("Login details copied");
    } catch {
      const area = document.getElementById(textId);
      if (area instanceof HTMLTextAreaElement) {
        area.focus();
        area.select();
      }
      setCopied("failed");
    }
  }

  if (login.outcome === "already_existed") {
    return (
      <Notice
        kind="success"
        title={`${login.fullName} was given access to ${login.site_name}`}
        action={
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Dismiss
          </Button>
        }
      >
        <p>{login.message}</p>
        <p className="mt-2">
          They sign in at <span className="break-all">{login.sign_in_url}</span> with {login.email} and the password they already have. If they have forgotten it, "Forgot your password?" on
          the sign-in page emails them a reset link.
        </p>
      </Notice>
    );
  }

  return (
    <div className="rounded-card border border-green/25 bg-green-soft p-4 text-text" role="status">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-green">Login created for {login.fullName}</p>
          <p className="mt-1 text-[13px] text-green">{login.message}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => void copy()}>
            <IconCopy size={16} /> {copied === "copied" ? "Copied" : "Copy login details"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </div>
      <dl className="mt-3 grid gap-x-4 gap-y-1.5 rounded-[10px] bg-panel p-3 text-[14px] sm:grid-cols-[auto_1fr]">
        <dt className="font-semibold">Sign-in link</dt>
        <dd className="break-all">{login.sign_in_url}</dd>
        <dt className="font-semibold">Email</dt>
        <dd className="break-all">{login.email}</dd>
        <dt className="font-semibold">Temporary password</dt>
        <dd className="break-all font-mono">{login.temporaryPassword}</dd>
      </dl>
      <p className="mt-3 text-[13px] font-semibold text-green">Send these to {login.fullName} now: the password will not be shown again.</p>
      <div className="mt-2">
        <label htmlFor={textId} className="sr-only">
          Ready-to-send login message
        </label>
        <textarea
          id={textId}
          readOnly
          rows={3}
          value={message}
          onFocus={(event) => event.currentTarget.select()}
          className="block w-full rounded-control border border-line bg-panel px-3 py-2 text-[13px] leading-relaxed text-text"
        />
      </div>
      {copied === "failed" && <p className="mt-1 text-[13px]">Copying failed; the message is selected, so press Ctrl+C or Cmd+C.</p>}
    </div>
  );
}

function CreateClientLoginForm({ siteId, agencyId, portalName }: { siteId: string; agencyId: string; portalName: string }) {
  const id = useId();
  const queryClient = useQueryClient();
  const sites = useQuery({ queryKey: ["agency-sites", agencyId], queryFn: () => loadAgencySites(agencyId) });
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [targetSiteId, setTargetSiteId] = useState(siteId);
  const [role, setRole] = useState<SiteRole>("client_editor");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedLogin | null>(null);

  const mutation = useMutation({
    mutationFn: async (input: { fullName: string; email: string; siteId: string; role: SiteRole; password: string }) => {
      const result = await callFunction<ClientCreateResponse>("client-create", {
        site_id: input.siteId,
        full_name: input.fullName,
        email: input.email,
        temporary_password: input.password,
        role: input.role,
      });
      if (!result.ok) throw new Error(result.message);
      return { ...result, temporaryPassword: input.password, fullName: input.fullName, targetSiteId: input.siteId };
    },
    onSuccess: async (result) => {
      setCreated(result);
      setFullName("");
      setEmail("");
      setPassword("");
      setShowPassword(false);
      await queryClient.invalidateQueries({ queryKey: ["site-members", result.targetSiteId] });
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    const cleanName = fullName.trim();
    if (!cleanName || !cleanEmail) return;
    const passwordIssue = passwordProblem(password, cleanEmail);
    if (passwordIssue) {
      setProblem(passwordIssue);
      return;
    }
    setProblem(null);
    setCreated(null);
    mutation.mutate({ fullName: cleanName, email: cleanEmail, siteId: targetSiteId, role, password });
  }

  const busy = mutation.isPending;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 p-4 sm:p-5">
      <p className="text-[13px] text-muted">You create the account and give the client their email and a temporary password. The first time they sign in they must choose their own.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor={`${id}-name`}>
          <Input id={`${id}-name`} required maxLength={120} autoComplete="off" value={fullName} onChange={(event) => setFullName(event.target.value)} disabled={busy} />
        </Field>
        <Field label="Email" htmlFor={`${id}-email`}>
          <Input id={`${id}-email`} type="email" required autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} />
        </Field>
        <Field label="Site" htmlFor={`${id}-site`} error={sites.isError ? sites.error.message : null}>
          <Select id={`${id}-site`} value={targetSiteId} onChange={(event) => setTargetSiteId(event.target.value)} disabled={busy || sites.isPending}>
            {(sites.data ?? []).map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
            {!sites.data?.some((site) => site.id === siteId) && <option value={siteId}>This site</option>}
          </Select>
        </Field>
        <Field label="Role" htmlFor={`${id}-role`}>
          <Select id={`${id}-role`} value={role} onChange={(event) => setRole(event.target.value as SiteRole)} disabled={busy}>
            <option value="client_owner">{SITE_ROLE_LABELS.client_owner}</option>
            <option value="client_editor">{SITE_ROLE_LABELS.client_editor}</option>
          </Select>
        </Field>
      </div>
      <Field
        label="Temporary password"
        htmlFor={`${id}-password`}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters; not the word "password", not their email address, not one character repeated. "Generate" makes a strong one.`}
        error={problem}
      >
        <div className="flex flex-wrap gap-2">
          <Input
            id={`${id}-password`}
            type={showPassword ? "text" : "password"}
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            spellCheck={false}
            className="min-w-0 flex-1 font-mono"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setProblem(null);
            }}
            disabled={busy}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setPassword(generateTemporaryPassword());
              setShowPassword(true);
              setProblem(null);
            }}
          >
            <IconSparkle size={16} /> Generate
          </Button>
          <Button type="button" variant="secondary" disabled={busy} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}>
            {showPassword ? <IconEyeOff size={16} /> : <IconEye size={16} />} {showPassword ? "Hide" : "Show"}
          </Button>
        </div>
      </Field>
      {mutation.isError && (
        <Notice kind="danger" title="The login could not be created">
          {mutation.error.message}
        </Notice>
      )}
      {created && <LoginDetailsCard login={created} portalName={portalName} onDismiss={() => setCreated(null)} />}
      <div>
        <Button type="submit" loading={busy}>
          <IconKey size={16} /> Create login
        </Button>
      </div>
    </form>
  );
}

type UserRow =
  | { kind: "member"; key: string; name: string; email: string | undefined; role: SiteRole; lastSignIn: string | null | undefined; userId: string; created_at: string }
  | { kind: "staff"; key: string; name: string; email: string | undefined; role: AgencyMember["role"]; lastSignIn: string | null | undefined }
  | { kind: "invite"; key: string; email: string; role: SiteRole; invite: PendingInvite };

const ROLE_WORDS: Record<SiteRole, string> = { client_owner: "Owner: edits, publishes and manages the site's people", client_editor: "Editor: edits and publishes" };

async function loadUsers(siteId: string, agencyId: string): Promise<UserRow[]> {
  const [members, invites, staff] = await Promise.all([loadMembers(siteId), loadInvites(siteId), loadStaff(agencyId)]);
  return [
    ...members.map((row): UserRow => ({ kind: "member", key: `m-${row.user_id}`, name: personName(row), email: personEmail(row) ?? row.profile?.email ?? undefined, role: row.role, lastSignIn: row.profile?.last_sign_in_at, userId: row.user_id, created_at: row.created_at })),
    ...invites.map((invite): UserRow => ({ kind: "invite", key: `i-${invite.id}`, email: invite.email, role: invite.role as SiteRole, invite })),
    ...staff.map((row, index): UserRow => ({ kind: "staff", key: `s-${row.user_id || index}`, name: personName(row), email: personEmail(row) ?? row.profile?.email ?? undefined, role: row.role, lastSignIn: row.profile?.last_sign_in_at })),
  ];
}

const rowAction = "inline-flex min-h-8 items-center rounded-sm px-1 text-[12px] font-semibold text-accent underline-offset-2 hover:underline focus-visible:underline disabled:opacity-50";
const rowDanger = "inline-flex min-h-8 items-center rounded-sm px-1 text-[12px] font-semibold text-red underline-offset-2 hover:underline focus-visible:underline disabled:opacity-50";
const Sep = () => (
  <span aria-hidden="true" className="text-line">
    |
  </span>
);

export function Team() {
  const { site, isStaff } = useSite();
  const { agency } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState<"invite" | "login" | null>(null);
  const [removing, setRemoving] = useState<Extract<UserRow, { kind: "member" }> | null>(null);
  const [resent, setResent] = useState<CreatedInvite | null>(null);
  const query = useQuery({ queryKey: ["site-users", site.id], queryFn: () => loadUsers(site.id, site.agency_id) });
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ["site-users", site.id] }), queryClient.invalidateQueries({ queryKey: ["site-invites", site.id] }), queryClient.invalidateQueries({ queryKey: ["site-members", site.id] })]);

  const changeRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: SiteRole }) => {
      const { error } = await supabase.from("site_members").update({ role }).eq("site_id", site.id).eq("user_id", userId);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.show("Role changed.");
      await refresh();
    },
    onError: (error) => toast.show(error.message, "danger"),
  });
  const remove = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.from("site_members").delete().eq("site_id", site.id).eq("user_id", userId);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.show("Access removed.");
      await refresh();
    },
    onError: (error) => toast.show(error.message, "danger"),
  });
  const cancelInvite = useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase.from("invites").delete().eq("id", inviteId);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.show("Invite cancelled.");
      await refresh();
    },
    onError: (error) => toast.show(error.message, "danger"),
  });
  const resend = useMutation({
    mutationFn: async (invite: PendingInvite) => {
      const result = await callFunction<InviteCreateResponse>("invite-create", { agency_id: site.agency_id, site_id: site.id, email: invite.email, role: invite.role });
      if (!result.ok) throw new Error(result.message);
      return { url: result.invite_url, email: invite.email, expires_at: result.expires_at, emailed: result.emailed };
    },
    onSuccess: async (created) => {
      setResent(created);
      await refresh();
    },
    onError: (error) => toast.show(error.message, "danger"),
  });

  const busy = changeRole.isPending || remove.isPending || cancelInvite.isPending || resend.isPending;
  const columns = "minmax(160px,1.6fr) minmax(180px,1.6fr) minmax(120px,1fr) 130px 130px";
  const rows = query.data ?? [];
  const people = rows.filter((row) => row.kind !== "invite").length;

  let body: ReactNode;
  if (query.isPending) body = <SkeletonRows rows={3} label="Loading users" />;
  else if (query.isError)
    body = (
      <div className="p-4">
        <Notice kind="danger" title="Users could not be loaded">
          {query.error.message}
        </Notice>
      </div>
    );
  else
    body = (
      <DataTable columns={columns} head={["Name", "Email", "Role", "Last login", "Status"]} label="Users" minWidth={760}>
        {rows.map((row) => {
          if (row.kind === "invite") {
            const expired = row.invite.expired;
            return (
              <DataRow key={row.key} columns={columns} className="group" data-testid={`user-${row.email}`}>
                <Cell>
                  <span className="flex items-center gap-2.5">
                    <Monogram name={row.email} />
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-semibold text-muted">Not signed up yet</span>
                      {isStaff && (
                        <span className="-ml-1 flex flex-wrap gap-x-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                          <button type="button" className={rowAction} disabled={busy} onClick={() => resend.mutate(row.invite)} data-testid={`resend-${row.email}`}>
                            Resend invite
                          </button>
                          <Sep />
                          <button type="button" className={rowDanger} disabled={busy} onClick={() => cancelInvite.mutate(row.invite.id)} data-testid={`cancel-${row.email}`}>
                            Cancel invite
                          </button>
                        </span>
                      )}
                    </span>
                  </span>
                </Cell>
                <Cell>
                  <span className="break-all">{row.email}</span>
                </Cell>
                <Cell muted>{SITE_ROLE_LABELS[row.role] ?? row.role}</Cell>
                <Cell muted>—</Cell>
                <Cell>
                  <Pill tone={expired ? "danger" : "amber"}>{expired ? "Invite expired" : `Invited, expires ${formatDate(row.invite.expires_at)}`}</Pill>
                </Cell>
              </DataRow>
            );
          }
          const staffRow = row.kind === "staff";
          return (
            <DataRow key={row.key} columns={columns} className="group" data-testid={`user-${row.email ?? row.key}`}>
              <Cell>
                <span className="flex items-center gap-2.5">
                  <Monogram name={row.name} />
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-semibold text-text">{row.name}</span>
                    {isStaff && row.kind === "member" && (
                      <span className="-ml-1 flex flex-wrap items-center gap-x-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                        <label className="inline-flex items-center gap-1 text-[12px] font-semibold text-accent">
                          <span>Change role</span>
                          <Select value={row.role} onChange={(event) => changeRole.mutate({ userId: row.userId, role: event.target.value as SiteRole })} disabled={busy} className="h-8 w-36 text-[12px]" aria-label={`Role for ${row.name}`} data-testid={`role-${row.email ?? row.userId}`}>
                            <option value="client_owner">{SITE_ROLE_LABELS.client_owner}</option>
                            <option value="client_editor">{SITE_ROLE_LABELS.client_editor}</option>
                          </Select>
                        </label>
                        <Sep />
                        <button type="button" className={rowDanger} disabled={busy} onClick={() => setRemoving(row)} data-testid={`remove-${row.email ?? row.userId}`}>
                          Remove
                          <SrOnly> {row.name}</SrOnly>
                        </button>
                      </span>
                    )}
                  </span>
                </span>
              </Cell>
              <Cell>
                <span className="break-all">{row.email ?? "—"}</span>
              </Cell>
              <Cell muted>
                <span title={staffRow ? "Agency staff always have access" : ROLE_WORDS[row.role as SiteRole]}>{staffRow ? AGENCY_ROLE_LABELS[row.role as AgencyMember["role"]] : SITE_ROLE_LABELS[row.role as SiteRole]}</span>
              </Cell>
              <Cell muted>{row.lastSignIn ? <span title={formatDate(row.lastSignIn)}>{relativeTime(row.lastSignIn)}</span> : "—"}</Cell>
              <Cell>
                <Pill tone="green">Active</Pill>
              </Cell>
            </DataRow>
          );
        })}
      </DataTable>
    );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Users"
        description={isStaff ? `Who can sign in to edit ${site.name}, and how new people get in.` : `Who can sign in to edit ${site.name}. ${agency?.portal_name?.trim() || "The agency"} adds and removes people; ask them to invite someone.`}
        meta={query.data ? <span>{people} {people === 1 ? "person" : "people"}{rows.length - people > 0 ? `, ${rows.length - people} invited` : ""}</span> : undefined}
        action={
          isStaff ? (
            <Button onClick={() => setAdding("invite")} data-testid="add-user">
              <IconPlus size={16} /> Add User
            </Button>
          ) : undefined
        }
      />
      {resent && <InviteLinkNotice invite={resent} onDismiss={() => setResent(null)} />}
      <div className="rounded-card border border-line bg-panel">{body}</div>
      {isStaff && (
        <p className="text-[13px] text-muted">
          Roles in plain words: an <strong>owner</strong> edits, publishes and manages the site's people; an <strong>editor</strong> edits and publishes. Agency staff always have access. Last login shows once the site's database has migration 20260923000200.
        </p>
      )}

      {isStaff && (
        <Modal
          open={adding !== null}
          onClose={() => setAdding(null)}
          title="Add a user"
        >
          <div className="flex flex-col gap-4">
            <Segmented
              label="How to add them"
              value={adding ?? "invite"}
              onChange={(value) => setAdding(value)}
              options={[
                { value: "invite", label: "Send an invite" },
                { value: "login", label: "Create a login" },
              ]}
            />
            <div className="-mx-5 border-t border-line">
              {adding === "login" ? <CreateClientLoginForm siteId={site.id} agencyId={site.agency_id} portalName={agency?.portal_name?.trim() || "the client portal"} /> : <InviteForm siteId={site.id} agencyId={site.agency_id} />}
            </div>
          </div>
        </Modal>
      )}

      <Modal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove this person?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={remove.isPending} data-testid="remove-confirm" onClick={() => removing && remove.mutate(removing.userId, { onSettled: () => setRemoving(null) })}>
              Remove access
            </Button>
          </>
        }
      >
        <p className="text-[14px] leading-relaxed text-text">{removing?.name} will no longer be able to sign in to {site.name}. Their account itself is kept; invite them again at any time.</p>
      </Modal>
    </div>
  );
}
