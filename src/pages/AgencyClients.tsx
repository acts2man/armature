/**
 * /agency/clients — every client across the agency's sites in one place: who they are,
 * which sites they can open and when they last signed in. From here the agency adds a
 * client (a login it creates, or an invite link), resets a password, resends or cancels
 * an invite, changes which sites a client can reach, removes them, and opens "View as
 * client" (src/auth/viewAs.ts) to see a site exactly as that person does.
 *
 * Agency staff only (the route is behind RequireStaff; agency staff themselves are under
 * Team). Reads site_members, profiles, invites and sites under RLS: no table of its own.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useAuth, type AgencyMembership } from "@/auth/AuthProvider.tsx";
import { IconCopy, IconEye, IconEyeOff, IconKey, IconMail, IconPlus, IconSparkle, IconUser } from "@/components/icons.tsx";
import { Button, Cell, DataRow, DataTable, EmptyState, Field, Input, LinkButton, Modal, Monogram, Notice, PageHeader, Pill, Segmented, Select, SkeletonRows, SrOnly, useToast } from "@/components/ui.tsx";
import { formatDate, relativeTime } from "@/lib/format.ts";
import { callFunction } from "@/lib/functions.ts";
import { supabase } from "@/lib/supabase.ts";
import { SITE_ROLE_LABELS, type Invite, type Profile, type Site, type SiteMember, type SiteRole } from "@/lib/types.ts";
import { MIN_PASSWORD_LENGTH, generateTemporaryPassword, passwordProblem } from "@shared/passwordRules.ts";
import type { ClientCreateResponse, ClientPasswordResetResponse, InviteCreateResponse } from "@shared/publishTypes.ts";
import { InviteLinkNotice } from "./AgencyTeam.tsx";
import { LoginDetailsCard, type CreatedLogin } from "./Team.tsx";

type ProfileLite = Pick<Profile, "id" | "email" | "full_name" | "last_sign_in_at">;
type ClientSite = { site: Site; role: SiteRole };
type ClientRow = { userId: string; name: string; email: string | null; lastSignIn: string | null | undefined; sites: ClientSite[] };
type InviteRow = Invite & { expired: boolean; siteName: string };
type ClientsData = { sites: Site[]; clients: ClientRow[]; invites: InviteRow[] };
type CreatedInvite = { url: string; email: string; expires_at: string; emailed: boolean };

async function loadProfiles(userIds: string[]): Promise<Map<string, ProfileLite>> {
  const map = new Map<string, ProfileLite>();
  if (userIds.length === 0) return map;
  const { data, error } = await supabase.from("profiles").select("*").in("id", userIds);
  if (error) throw new Error(`Could not load people's names: ${error.message}`);
  for (const profile of (data ?? []) as ProfileLite[]) map.set(profile.id, profile);
  return map;
}

async function loadClients(agencyId: string): Promise<ClientsData> {
  const { data: siteRows, error: sitesError } = await supabase.from("sites").select("*").eq("agency_id", agencyId).order("name");
  if (sitesError) throw new Error(`Could not load the agency's sites: ${sitesError.message}`);
  const sites = (siteRows ?? []) as Site[];
  const byId = new Map(sites.map((site) => [site.id, site]));

  const [membersResult, invitesResult] = await Promise.all([
    supabase.from("site_members").select("*").in("site_id", [...byId.keys()]).order("created_at"),
    supabase.from("invites").select("*").eq("agency_id", agencyId).not("site_id", "is", null).is("accepted_at", null).order("created_at", { ascending: false }),
  ]);
  if (membersResult.error) throw new Error(`Could not load the clients: ${membersResult.error.message}`);
  if (invitesResult.error) throw new Error(`Could not load the invitations: ${invitesResult.error.message}`);

  const members = ((membersResult.data ?? []) as SiteMember[]).filter((member) => byId.has(member.site_id));
  const profiles = await loadProfiles([...new Set(members.map((member) => member.user_id))]);
  const grouped = new Map<string, ClientRow>();
  for (const member of members) {
    const site = byId.get(member.site_id);
    if (!site) continue;
    let row = grouped.get(member.user_id);
    if (!row) {
      const profile = profiles.get(member.user_id) ?? null;
      row = {
        userId: member.user_id,
        name: profile?.full_name?.trim() || profile?.email?.trim() || "Unknown",
        email: profile?.email?.trim() || null,
        lastSignIn: profile?.last_sign_in_at,
        sites: [],
      };
      grouped.set(member.user_id, row);
    }
    row.sites.push({ site, role: member.role });
  }

  const now = Date.now();
  const invites = ((invitesResult.data ?? []) as Invite[])
    .filter((invite) => invite.site_id && byId.has(invite.site_id))
    .map((invite): InviteRow => ({ ...invite, expired: new Date(invite.expires_at).getTime() < now, siteName: byId.get(invite.site_id ?? "")?.name ?? "" }));

  return { sites, clients: [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name)), invites };
}

const clientsKey = (agencyId: string) => ["agency-clients", agencyId] as const;

const rowAction = "inline-flex min-h-8 items-center rounded-sm px-1 text-[12px] font-semibold text-accent underline-offset-2 hover:underline focus-visible:underline disabled:opacity-50";
const rowDanger = "inline-flex min-h-8 items-center rounded-sm px-1 text-[12px] font-semibold text-red underline-offset-2 hover:underline focus-visible:underline disabled:opacity-50";
const Sep = () => (
  <span aria-hidden="true" className="text-line">
    |
  </span>
);

/** The site checkboxes shared by "Add a client" and "Change access". */
function SitePicker({ sites, chosen, onChange, disabled, label, idPrefix }: { sites: Site[]; chosen: Set<string>; onChange: (next: Set<string>) => void; disabled?: boolean; label: string; idPrefix: string }) {
  return (
    <fieldset className="flex flex-col gap-1.5" data-testid="site-picker">
      <legend className="mb-1 text-[13px] font-semibold text-text">{label}</legend>
      {sites.map((site) => {
        const id = `${idPrefix}-${site.id}`;
        return (
          <label key={site.id} htmlFor={id} className="flex items-center gap-2.5 rounded-control px-1 py-1 text-[14px] text-text hover:bg-ground">
            <input
              id={id}
              type="checkbox"
              checked={chosen.has(site.id)}
              disabled={disabled}
              onChange={(event) => {
                const next = new Set(chosen);
                if (event.target.checked) next.add(site.id);
                else next.delete(site.id);
                onChange(next);
              }}
            />
            <span className="truncate">{site.name}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

function AddClientForm({ agencyId, sites, portalName, onDone }: { agencyId: string; sites: Site[]; portalName: string; onDone: () => Promise<unknown> }) {
  const id = useId();
  const [how, setHow] = useState<"login" | "invite">("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<SiteRole>("client_editor");
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(sites[0] ? [sites[0].id] : []));
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [createdLogin, setCreatedLogin] = useState<CreatedLogin | null>(null);
  const [createdInvites, setCreatedInvites] = useState<CreatedInvite[]>([]);

  const login = useMutation({
    mutationFn: async (input: { fullName: string; email: string; siteIds: string[]; role: SiteRole; password: string }) => {
      let first: ClientCreateResponse | null = null;
      const names: string[] = [];
      for (const siteId of input.siteIds) {
        const result = await callFunction<ClientCreateResponse>("client-create", { site_id: siteId, full_name: input.fullName, email: input.email, temporary_password: input.password, role: input.role });
        if (!result.ok) throw new Error(result.message);
        first ??= result;
        names.push(result.site_name);
      }
      if (!first) throw new Error("Choose at least one site.");
      const more = names.slice(1);
      return {
        ...first,
        site_name: names.join(", "),
        message: more.length > 0 ? `${first.message} They can also open ${more.join(", ")}.` : first.message,
        temporaryPassword: input.password,
        fullName: input.fullName,
      };
    },
    onSuccess: async (result) => {
      setCreatedLogin(result);
      setFullName("");
      setEmail("");
      setPassword("");
      setShowPassword(false);
      await onDone();
    },
  });

  const invite = useMutation({
    mutationFn: async (input: { email: string; siteIds: string[]; role: SiteRole }) => {
      const created: CreatedInvite[] = [];
      for (const siteId of input.siteIds) {
        const result = await callFunction<InviteCreateResponse>("invite-create", { agency_id: agencyId, site_id: siteId, email: input.email, role: input.role });
        if (!result.ok) throw new Error(result.message);
        created.push({ url: result.invite_url, email: input.email, expires_at: result.expires_at, emailed: result.emailed });
      }
      return created;
    },
    onSuccess: async (created) => {
      setCreatedInvites(created);
      setEmail("");
      await onDone();
    },
  });

  const busy = login.isPending || invite.isPending;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    const cleanName = fullName.trim();
    const siteIds = sites.filter((site) => chosen.has(site.id)).map((site) => site.id);
    if (!cleanEmail) return;
    if (siteIds.length === 0) {
      setProblem("Choose at least one site.");
      return;
    }
    setProblem(null);
    setCreatedLogin(null);
    setCreatedInvites([]);
    if (how === "invite") {
      invite.mutate({ email: cleanEmail, siteIds, role });
      return;
    }
    if (!cleanName) return;
    const passwordIssue = passwordProblem(password, cleanEmail);
    if (passwordIssue) {
      setProblem(passwordIssue);
      return;
    }
    login.mutate({ fullName: cleanName, email: cleanEmail, siteIds, role, password });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Segmented
        label="How to add them"
        value={how}
        onChange={(value) => {
          setHow(value);
          setProblem(null);
        }}
        options={[
          { value: "login", label: "Create a login" },
          { value: "invite", label: "Send an invite" },
        ]}
      />
      <p className="text-[13px] text-muted">
        {how === "login"
          ? "You create the account and give the client their email and a temporary password. The first time they sign in they must choose their own."
          : "They get a link per site that signs them in and adds them to it. Links expire after seven days."}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {how === "login" && (
          <Field label="Name" htmlFor={`${id}-name`}>
            <Input id={`${id}-name`} required maxLength={120} autoComplete="off" value={fullName} onChange={(event) => setFullName(event.target.value)} disabled={busy} />
          </Field>
        )}
        <Field label="Email" htmlFor={`${id}-email`}>
          <Input id={`${id}-email`} type="email" required autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} />
        </Field>
        <Field label="Role" htmlFor={`${id}-role`}>
          <Select id={`${id}-role`} value={role} onChange={(event) => setRole(event.target.value as SiteRole)} disabled={busy}>
            <option value="client_owner">{SITE_ROLE_LABELS.client_owner}</option>
            <option value="client_editor">{SITE_ROLE_LABELS.client_editor}</option>
          </Select>
        </Field>
      </div>
      <SitePicker sites={sites} chosen={chosen} onChange={setChosen} disabled={busy} label="Sites they can open" idPrefix={`${id}-site`} />
      {how === "login" && (
        <Field
          label="Temporary password"
          htmlFor={`${id}-password`}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters; not the word "password", not their email address, not one character repeated. "Generate" makes a strong one.`}
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
      )}
      {problem && (
        <Notice kind="danger" title="Check the form">
          {problem}
        </Notice>
      )}
      {(login.isError || invite.isError) && (
        <Notice kind="danger" title={how === "login" ? "The login could not be created" : "The invite could not be created"}>
          {login.error?.message ?? invite.error?.message}
        </Notice>
      )}
      {createdLogin && <LoginDetailsCard login={createdLogin} portalName={portalName} onDismiss={() => setCreatedLogin(null)} />}
      {createdInvites.map((created) => (
        <InviteLinkNotice key={created.url} invite={created} onDismiss={() => setCreatedInvites((list) => list.filter((item) => item !== created))} />
      ))}
      <div>
        <Button type="submit" loading={busy} data-testid="add-client-submit">
          {how === "login" ? (
            <>
              <IconKey size={16} /> Create login
            </>
          ) : (
            <>
              <IconMail size={16} /> Create invite
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

function ResetLinkNotice({ reset, onDismiss }: { reset: ClientPasswordResetResponse; onDismiss: () => void }) {
  const toast = useToast();
  const inputId = useId();
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(reset.reset_url);
      setCopied("copied");
      toast.show("Reset link copied");
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
      title="Reset link created"
      action={
        <>
          <Button variant="secondary" size="sm" onClick={() => void copy()}>
            <IconCopy size={16} /> {copied === "copied" ? "Copied" : "Copy link"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Dismiss
          </Button>
        </>
      }
    >
      <p>
        {reset.emailed ? `The link was emailed to ${reset.email}; you can also copy it below.` : `Email sending is not set up yet, so copy this link and send it to ${reset.email} yourself.`} It opens the
        sign-in page, where they choose a new password. It works once, and only for a short while.
      </p>
      <div className="mt-2">
        <label htmlFor={inputId} className="sr-only">
          Reset link
        </label>
        <Input id={inputId} readOnly value={reset.reset_url} onFocus={(event) => event.currentTarget.select()} className="bg-white font-mono text-[13px] text-text" />
      </div>
      {copied === "failed" && <p className="mt-1 text-[13px]">Copying failed; the link is selected, so press Ctrl+C or Cmd+C.</p>}
    </Notice>
  );
}

function pickMembership(agencies: AgencyMembership[], selectedId: string): AgencyMembership | undefined {
  return agencies.find((membership) => membership.agency.id === selectedId) ?? agencies[0];
}

function ClientsScreen({ agencyId, portalName }: { agencyId: string; portalName: string }) {
  const { startViewAs } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: clientsKey(agencyId), queryFn: () => loadClients(agencyId) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: clientsKey(agencyId) });

  const [adding, setAdding] = useState(false);
  const [access, setAccess] = useState<ClientRow | null>(null);
  const [accessChosen, setAccessChosen] = useState<Set<string>>(new Set());
  const [accessRole, setAccessRole] = useState<SiteRole>("client_editor");
  const [removing, setRemoving] = useState<ClientRow | null>(null);
  const [resetting, setResetting] = useState<ClientRow | null>(null);
  const [resent, setResent] = useState<CreatedInvite | null>(null);

  const saveAccess = useMutation({
    mutationFn: async ({ client, chosen, role }: { client: ClientRow; chosen: Set<string>; role: SiteRole }) => {
      const current = new Set(client.sites.map((entry) => entry.site.id));
      const added = [...chosen].filter((siteId) => !current.has(siteId));
      const removed = [...current].filter((siteId) => !chosen.has(siteId));
      if (added.length > 0) {
        const { error } = await supabase.from("site_members").insert(added.map((siteId) => ({ site_id: siteId, user_id: client.userId, role })));
        if (error) throw new Error(error.message);
      }
      if (removed.length > 0) {
        const { error } = await supabase.from("site_members").delete().eq("user_id", client.userId).in("site_id", removed);
        if (error) throw new Error(error.message);
      }
      return { added: added.length, removed: removed.length };
    },
    onSuccess: async ({ added, removed }) => {
      toast.show(added + removed === 0 ? "No change to their access." : "Access changed.");
      setAccess(null);
      await refresh();
    },
    onError: (error) => toast.show(error.message, "danger"),
  });

  const remove = useMutation({
    mutationFn: async (client: ClientRow) => {
      const { error } = await supabase
        .from("site_members")
        .delete()
        .eq("user_id", client.userId)
        .in("site_id", client.sites.map((entry) => entry.site.id));
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.show("Client removed.");
      await refresh();
    },
    onError: (error) => toast.show(error.message, "danger"),
    onSettled: () => setRemoving(null),
  });

  const reset = useMutation({
    mutationFn: async (client: ClientRow) => {
      const result = await callFunction<ClientPasswordResetResponse>("client-password-reset", { user_id: client.userId });
      if (!result.ok) throw new Error(result.message);
      return result;
    },
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
    mutationFn: async (invite: InviteRow) => {
      const result = await callFunction<InviteCreateResponse>("invite-create", { agency_id: agencyId, site_id: invite.site_id, email: invite.email, role: invite.role });
      if (!result.ok) throw new Error(result.message);
      return { url: result.invite_url, email: invite.email, expires_at: result.expires_at, emailed: result.emailed };
    },
    onSuccess: async (created) => {
      setResent(created);
      await refresh();
    },
    onError: (error) => toast.show(error.message, "danger"),
  });

  function viewAs(client: ClientRow) {
    const first = client.sites[0];
    if (!first) return;
    startViewAs({ userId: client.userId, name: client.name, email: client.email, sites: client.sites.map(({ site, role }) => ({ site, role })) });
    navigate(`/sites/${first.site.id}`);
  }

  function openAccess(client: ClientRow) {
    setAccessChosen(new Set(client.sites.map((entry) => entry.site.id)));
    setAccessRole(client.sites[0]?.role ?? "client_editor");
    setAccess(client);
  }

  const busy = saveAccess.isPending || remove.isPending || cancelInvite.isPending || resend.isPending;
  const columns = "minmax(180px,1.6fr) minmax(180px,1.4fr) minmax(160px,1.4fr) 130px 130px";
  const data = query.data;
  const clientCount = data?.clients.length ?? 0;
  const inviteCount = data?.invites.length ?? 0;

  let body: ReactNode;
  if (query.isPending) body = <SkeletonRows rows={3} label="Loading clients" />;
  else if (query.isError)
    body = (
      <div className="p-4">
        <Notice kind="danger" title="Clients could not be loaded">
          {query.error.message}
        </Notice>
      </div>
    );
  else if (data && data.sites.length === 0)
    body = (
      <div className="p-5">
        <EmptyState title="No sites yet" icon={<IconUser size={18} />} action={<LinkButton to="/sites/new">Add a site</LinkButton>}>
          Clients belong to sites. Add a site first, then add the people who sign in to it.
        </EmptyState>
      </div>
    );
  else if (data && clientCount + inviteCount === 0)
    body = (
      <div className="p-5">
        <EmptyState
          title="No clients yet"
          icon={<IconUser size={18} />}
          action={
            <Button onClick={() => setAdding(true)}>
              <IconPlus size={16} /> Add client
            </Button>
          }
        >
          Nobody outside the agency can sign in yet. Add a client to give them their site.
        </EmptyState>
      </div>
    );
  else if (data)
    body = (
      <DataTable columns={columns} head={["Name", "Email", "Sites", "Last login", "Status"]} label="Clients" minWidth={820}>
        {data.clients.map((client) => (
          <DataRow key={client.userId} columns={columns} className="group" data-testid={`client-${client.email ?? client.userId}`}>
            <Cell>
              <span className="flex items-center gap-2.5">
                <Monogram name={client.name} />
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold text-text">{client.name}</span>
                  <span className="-ml-1 flex flex-wrap items-center gap-x-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                    <button type="button" className={rowAction} disabled={busy} onClick={() => viewAs(client)} data-testid={`view-as-${client.email ?? client.userId}`}>
                      View as client
                      <SrOnly> {client.name}</SrOnly>
                    </button>
                    <Sep />
                    <button type="button" className={rowAction} disabled={busy} onClick={() => openAccess(client)} data-testid={`access-${client.email ?? client.userId}`}>
                      Change access
                      <SrOnly> for {client.name}</SrOnly>
                    </button>
                    <Sep />
                    <button type="button" className={rowAction} disabled={busy} onClick={() => setResetting(client)} data-testid={`reset-${client.email ?? client.userId}`}>
                      Reset password
                      <SrOnly> for {client.name}</SrOnly>
                    </button>
                    <Sep />
                    <button type="button" className={rowDanger} disabled={busy} onClick={() => setRemoving(client)} data-testid={`remove-${client.email ?? client.userId}`}>
                      Remove
                      <SrOnly> {client.name}</SrOnly>
                    </button>
                  </span>
                </span>
              </span>
            </Cell>
            <Cell>
              <span className="break-all">{client.email ?? "—"}</span>
            </Cell>
            <Cell>
              <span className="flex flex-wrap gap-1">
                {client.sites.map((entry) => (
                  <span key={entry.site.id} title={`${entry.site.name}: ${SITE_ROLE_LABELS[entry.role]}`}>
                    <Pill tone="grey">{entry.site.name}</Pill>
                  </span>
                ))}
              </span>
            </Cell>
            <Cell muted>{client.lastSignIn ? <span title={formatDate(client.lastSignIn)}>{relativeTime(client.lastSignIn)}</span> : "—"}</Cell>
            <Cell>
              <Pill tone="green">Active</Pill>
            </Cell>
          </DataRow>
        ))}
        {data.invites.map((invite) => (
          <DataRow key={invite.id} columns={columns} className="group" data-testid={`client-invite-${invite.email}`}>
            <Cell>
              <span className="flex items-center gap-2.5">
                <Monogram name={invite.email} />
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold text-muted">Not signed up yet</span>
                  <span className="-ml-1 flex flex-wrap gap-x-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                    <button type="button" className={rowAction} disabled={busy} onClick={() => resend.mutate(invite)} data-testid={`resend-${invite.email}`}>
                      Resend invite
                    </button>
                    <Sep />
                    <button type="button" className={rowDanger} disabled={busy} onClick={() => cancelInvite.mutate(invite.id)} data-testid={`cancel-${invite.email}`}>
                      Cancel invite
                    </button>
                  </span>
                </span>
              </span>
            </Cell>
            <Cell>
              <span className="break-all">{invite.email}</span>
            </Cell>
            <Cell>
              <span title={`${invite.siteName}: ${SITE_ROLE_LABELS[invite.role as SiteRole] ?? invite.role}`}>
                <Pill tone="grey">{invite.siteName}</Pill>
              </span>
            </Cell>
            <Cell muted>—</Cell>
            <Cell>
              <Pill tone={invite.expired ? "danger" : "amber"}>{invite.expired ? "Invite expired" : `Invited, expires ${formatDate(invite.expires_at)}`}</Pill>
            </Cell>
          </DataRow>
        ))}
      </DataTable>
    );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Clients"
        description="Everyone outside the agency who signs in to a site you look after, and which sites they can open. Your own staff are under Team."
        meta={data ? <span>{clientCount} {clientCount === 1 ? "client" : "clients"}{inviteCount > 0 ? `, ${inviteCount} invited` : ""}</span> : undefined}
        action={
          <Button onClick={() => setAdding(true)} disabled={!data || data.sites.length === 0} data-testid="add-client">
            <IconPlus size={16} /> Add client
          </Button>
        }
      />
      {resent && <InviteLinkNotice invite={resent} onDismiss={() => setResent(null)} />}
      <div className="rounded-card border border-line bg-panel">{body}</div>
      <p className="text-[13px] text-muted">
        "View as client" shows a site exactly as that person sees it, with nothing saved; press Exit at the top to come back. Last login shows once the site's database has migration 20260923000300.
      </p>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add a client">
        {data && <AddClientForm agencyId={agencyId} sites={data.sites} portalName={portalName} onDone={refresh} />}
      </Modal>

      <Modal
        open={access !== null}
        onClose={() => setAccess(null)}
        title={access ? `Sites ${access.name} can open` : "Change access"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAccess(null)}>
              Cancel
            </Button>
            <Button loading={saveAccess.isPending} disabled={accessChosen.size === 0} data-testid="access-save" onClick={() => access && saveAccess.mutate({ client: access, chosen: accessChosen, role: accessRole })}>
              Save access
            </Button>
          </>
        }
      >
        {access && data && (
          <div className="flex flex-col gap-4">
            <SitePicker sites={data.sites} chosen={accessChosen} onChange={setAccessChosen} disabled={saveAccess.isPending} label="Tick every site they may open" idPrefix="access-site" />
            <Field label="Role on sites you add" htmlFor="access-role" hint="Their role on sites they already have stays as it is; change it on that site's Users screen.">
              <Select id="access-role" value={accessRole} onChange={(event) => setAccessRole(event.target.value as SiteRole)} disabled={saveAccess.isPending}>
                <option value="client_owner">{SITE_ROLE_LABELS.client_owner}</option>
                <option value="client_editor">{SITE_ROLE_LABELS.client_editor}</option>
              </Select>
            </Field>
            {accessChosen.size === 0 && <p className="text-[13px] text-muted">To take away every site, use Remove instead.</p>}
          </div>
        )}
      </Modal>

      <Modal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove this client?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={remove.isPending} data-testid="remove-confirm" onClick={() => removing && remove.mutate(removing)}>
              Remove client
            </Button>
          </>
        }
      >
        <p className="text-[14px] leading-relaxed text-text">
          {removing?.name} will no longer be able to sign in to {removing?.sites.map((entry) => entry.site.name).join(", ")}. Their account itself is kept; add them again at any time.
        </p>
      </Modal>

      <Modal
        open={resetting !== null}
        onClose={() => {
          setResetting(null);
          reset.reset();
        }}
        title="Reset password"
        footer={
          reset.data ? (
            <Button
              variant="secondary"
              onClick={() => {
                setResetting(null);
                reset.reset();
              }}
            >
              Done
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setResetting(null);
                  reset.reset();
                }}
              >
                Cancel
              </Button>
              <Button loading={reset.isPending} data-testid="reset-confirm" onClick={() => resetting && reset.mutate(resetting)}>
                <IconKey size={16} /> Create reset link
              </Button>
            </>
          )
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-[14px] leading-relaxed text-text">
            This makes a one-time link for {resetting?.name} to choose a new password. Their current password keeps working until they use it. They can also do this themselves with "Forgot your
            password?" on the sign-in page.
          </p>
          {reset.isError && (
            <Notice kind="danger" title="The reset link could not be created">
              {reset.error.message}
            </Notice>
          )}
          {reset.data && <ResetLinkNotice reset={reset.data} onDismiss={() => reset.reset()} />}
        </div>
      </Modal>
    </div>
  );
}

export function AgencyClients() {
  const { agencies, agency } = useAuth();
  const [selectedId, setSelectedId] = useState(agencies[0]?.agency.id ?? "");
  const membership = pickMembership(agencies, selectedId);

  if (!membership) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Clients" description="The people who sign in to the sites your agency looks after." />
        <Notice kind="warning" title="Your account is not staff of any agency">
          Clients are only available to agency owners and staff.
        </Notice>
      </div>
    );
  }

  const current = membership.agency;
  const portalName = (current.id === agency?.id ? agency?.portal_name : current.portal_name)?.trim() || "the client portal";

  return (
    <div className="flex flex-col gap-5">
      {agencies.length > 1 && (
        <Field label="Agency" htmlFor="agency-select" className="max-w-sm">
          <Select id="agency-select" value={current.id} onChange={(event) => setSelectedId(event.target.value)}>
            {agencies.map((item) => (
              <option key={item.agency.id} value={item.agency.id}>
                {item.agency.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <ClientsScreen key={current.id} agencyId={current.id} portalName={portalName} />
    </div>
  );
}
