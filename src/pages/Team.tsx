/**
 * Who can edit a site: the client members, pending invitations, and the agency
 * staff who always have access. Agency staff only; clients see a plain notice.
 * Two ways to add a client: an invite link, or a login the agency creates.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { IconCopy, IconEye, IconEyeOff, IconKey, IconMail, IconSparkle, IconTeam } from "@/components/icons.tsx";
import { useSite } from "@/components/SiteLayout.tsx";
import { Button, EmptyState, Field, Input, Modal, Monogram, Notice, PageHeader, Panel, PanelRow, Pill, Segmented, Select, SkeletonRows, SrOnly, useToast } from "@/components/ui.tsx";
import { formatDate } from "@/lib/format.ts";
import { callFunction } from "@/lib/functions.ts";
import { loginDetailsMessage } from "@/lib/loginMessage.ts";
import { supabase } from "@/lib/supabase.ts";
import { AGENCY_ROLE_LABELS, SITE_ROLE_LABELS, type AgencyMember, type Invite, type Profile, type SiteMember, type SiteRole } from "@/lib/types.ts";
import { MIN_PASSWORD_LENGTH, generateTemporaryPassword, passwordProblem } from "@shared/passwordRules.ts";
import type { ClientCreateResponse, InviteCreateResponse } from "@shared/publishTypes.ts";
import { InviteLinkNotice } from "./AgencyTeam.tsx";

type ProfileLite = Pick<Profile, "id" | "email" | "full_name">;
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

function MembersPanel({ siteId }: { siteId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["site-members", siteId], queryFn: () => loadMembers(siteId) });
  const [removing, setRemoving] = useState<MemberRow | null>(null);

  const remove = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.from("site_members").delete().eq("site_id", siteId).eq("user_id", userId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setRemoving(null);
      return queryClient.invalidateQueries({ queryKey: ["site-members", siteId] });
    },
  });

  let body: ReactNode;
  if (query.isPending) {
    body = <SkeletonRows rows={2} label="Loading members" />;
  } else if (query.isError) {
    body = (
      <div className="p-4">
        <Notice kind="danger" title="Members could not be loaded">
          {query.error.message}
        </Notice>
      </div>
    );
  } else if (query.data.length === 0) {
    body = (
      <div className="p-5">
        <EmptyState title="No client members yet" icon={<IconTeam size={18} />}>
          Invite a client below, or create their login, and they will appear here.
        </EmptyState>
      </div>
    );
  } else {
    body = query.data.map((row) => (
      <PanelRow
        key={row.user_id}
        icon={<Monogram name={personName(row)} />}
        title={personName(row)}
        detail={
          <span className="flex flex-wrap items-center gap-x-2">
            {personEmail(row) && <span className="break-all">{personEmail(row)}</span>}
            <span>Joined {formatDate(row.created_at)}</span>
          </span>
        }
        action={
          <>
            <Pill tone="grey">{SITE_ROLE_LABELS[row.role]}</Pill>
            <Button variant="danger" size="sm" onClick={() => setRemoving(row)}>
              Remove
              <SrOnly> {personName(row)}</SrOnly>
            </Button>
          </>
        }
      />
    ));
  }

  return (
    <Panel title="Members" aside={query.data ? <span className="text-[12px] text-muted">{query.data.length} {query.data.length === 1 ? "person" : "people"}</span> : undefined}>
      {remove.isError && (
        <div className="p-4">
          <Notice kind="danger" title="The member could not be removed">
            {remove.error.message}
          </Notice>
        </div>
      )}
      {body}
      <Modal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove this person?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)} disabled={remove.isPending}>
              Keep them
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => removing && remove.mutate(removing.user_id)}>
              Remove
            </Button>
          </>
        }
      >
        <p className="text-[14px] leading-relaxed text-text">
          {removing ? personName(removing) : "This person"} will no longer be able to edit this site. Their account stays; you can add them back later.
        </p>
      </Modal>
    </Panel>
  );
}

function InvitesPanel({ siteId }: { siteId: string }) {
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
    body = <SkeletonRows rows={1} label="Loading invitations" />;
  } else if (query.isError) {
    body = (
      <div className="p-4">
        <Notice kind="danger" title="Invitations could not be loaded">
          {query.error.message}
        </Notice>
      </div>
    );
  } else if (query.data.length === 0) {
    body = <p className="px-5 py-4 text-[13px] text-muted">No pending invitations.</p>;
  } else {
    body = query.data.map((invite) => (
      <PanelRow
        key={invite.id}
        icon={<IconMail size={18} />}
        title={<span className="break-all">{invite.email}</span>}
        detail={
          <span className="flex flex-wrap items-center gap-2">
            <span>{SITE_ROLE_LABELS[invite.role as SiteRole] ?? invite.role}</span>
            <span>· Expires {formatDate(invite.expires_at)}</span>
            {invite.expired && <Pill tone="danger">Expired</Pill>}
          </span>
        }
        action={
          <Button variant="danger" size="sm" onClick={() => remove.mutate(invite.id)} loading={remove.isPending && remove.variables === invite.id}>
            Delete
            <SrOnly> invite for {invite.email}</SrOnly>
          </Button>
        }
      />
    ));
  }

  return (
    <Panel title="Pending invitations">
      {remove.isError && (
        <div className="p-4">
          <Notice kind="danger" title="The invitation could not be deleted">
            {remove.error.message}
          </Notice>
        </div>
      )}
      {body}
    </Panel>
  );
}

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

function StaffPanel({ agencyId }: { agencyId: string }) {
  const query = useQuery({ queryKey: ["agency-staff", agencyId], queryFn: () => loadStaff(agencyId) });

  let body: ReactNode;
  if (query.isPending) {
    body = <SkeletonRows rows={2} label="Loading agency staff" />;
  } else if (query.isError) {
    body = (
      <div className="p-4">
        <Notice kind="danger" title="Agency staff could not be loaded">
          {query.error.message}
        </Notice>
      </div>
    );
  } else if (query.data.length === 0) {
    body = <p className="px-5 py-4 text-[13px] text-muted">No agency staff found.</p>;
  } else {
    body = query.data.map((row, index) => (
      <PanelRow key={row.user_id || `staff-${index}`} icon={<Monogram name={personName(row)} />} title={personName(row)} detail={personEmail(row)} action={<Pill tone="grey">{AGENCY_ROLE_LABELS[row.role]}</Pill>} />
    ));
  }

  return (
    <Panel title="Agency staff" aside={<span className="text-[12px] text-muted">Always have access</span>}>
      {body}
    </Panel>
  );
}

export function Team() {
  const { site, isStaff } = useSite();
  const { agency } = useAuth();
  const [adding, setAdding] = useState<"invite" | "login">("invite");

  if (!isStaff) {
    return <Notice kind="warning">Only agency staff manage who has access to a site.</Notice>;
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Team" description={`Who can edit ${site.name}, and how new people get in.`} />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <MembersPanel siteId={site.id} />
          <InvitesPanel siteId={site.id} />
          <StaffPanel agencyId={site.agency_id} />
        </div>
        <Panel
          title="Add a client"
          aside={
            <Segmented
              label="How to add them"
              value={adding}
              onChange={setAdding}
              options={[
                { value: "invite", label: "Invite by link" },
                { value: "login", label: "Create client login" },
              ]}
            />
          }
        >
          {adding === "invite" ? (
            <InviteForm siteId={site.id} agencyId={site.agency_id} />
          ) : (
            <CreateClientLoginForm siteId={site.id} agencyId={site.agency_id} portalName={agency?.portal_name?.trim() || "your editing dashboard"} />
          )}
        </Panel>
      </div>
    </div>
  );
}
