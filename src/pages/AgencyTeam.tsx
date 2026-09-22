/**
 * /agency/team — the agency's own staff and their invitations. Owners invite;
 * staff can look. (Client members are managed on each site's Team tab.)
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { useAuth, type AgencyMembership } from "@/auth/AuthProvider.tsx";
import { IconMail, IconTeam } from "@/components/icons.tsx";
import { Button, EmptyState, Field, Input, Monogram, Notice, PageHeader, Panel, PanelRow, Pill, Select, SkeletonRows, SrOnly, useToast } from "@/components/ui.tsx";
import { formatDate } from "@/lib/format.ts";
import { callFunction } from "@/lib/functions.ts";
import { supabase } from "@/lib/supabase.ts";
import { AGENCY_ROLE_LABELS, type AgencyMember, type AgencyRole, type Invite, type Profile } from "@/lib/types.ts";
import type { InviteCreateResponse } from "@shared/publishTypes.ts";

type ProfileLite = Pick<Profile, "id" | "email" | "full_name">;
type StaffRow = { user_id: string; role: AgencyRole; created_at: string; profile: ProfileLite | null };
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

async function loadAgencyInvites(agencyId: string): Promise<PendingInvite[]> {
  const { data, error } = await supabase
    .from("invites")
    .select("*")
    .eq("agency_id", agencyId)
    .is("site_id", null)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const now = Date.now();
  return ((data ?? []) as Invite[]).map((invite) => ({ ...invite, expired: new Date(invite.expires_at).getTime() < now }));
}

export function InviteLinkNotice({ invite, onDismiss }: { invite: CreatedInvite; onDismiss: () => void }) {
  const toast = useToast();
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const inputId = `invite-link-${invite.email.replace(/[^a-z0-9]/gi, "-")}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(invite.url);
      setCopied("copied");
      toast.show("Invite link copied");
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
          <Button variant="secondary" size="sm" onClick={() => void copy()}>
            {copied === "copied" ? "Copied" : "Copy link"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onDismiss}>
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
        <Input id={inputId} readOnly value={invite.url} onFocus={(event) => event.currentTarget.select()} className="bg-white font-mono text-[13px] text-text" />
      </div>
      {copied === "failed" && <p className="mt-1 text-[13px]">Copying failed; the link is selected, so press Ctrl+C or Cmd+C.</p>}
    </Notice>
  );
}

function StaffInviteForm({ agencyId }: { agencyId: string }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AgencyRole>("staff");
  const [created, setCreated] = useState<CreatedInvite | null>(null);

  const mutation = useMutation({
    mutationFn: async (input: { email: string; role: AgencyRole }) => {
      const result = await callFunction<InviteCreateResponse>("invite-create", { agency_id: agencyId, site_id: null, email: input.email, role: input.role });
      if (!result.ok) throw new Error(result.message);
      return { ...result, email: input.email };
    },
    onSuccess: async (result) => {
      setCreated({ url: result.invite_url, email: result.email, expires_at: result.expires_at, emailed: result.emailed });
      setEmail("");
      await queryClient.invalidateQueries({ queryKey: ["agency-invites", agencyId] });
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
    <Panel title="Invite staff" aside={<span className="text-[12px] text-muted">They get a link that adds them to the agency</span>}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
          <Field label="Email" htmlFor="staff-invite-email">
            <Input id="staff-invite-email" type="email" required autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} disabled={mutation.isPending} />
          </Field>
          <Field label="Role" htmlFor="staff-invite-role">
            <Select id="staff-invite-role" value={role} onChange={(event) => setRole(event.target.value as AgencyRole)} disabled={mutation.isPending}>
              <option value="staff">{AGENCY_ROLE_LABELS.staff}</option>
              <option value="owner">{AGENCY_ROLE_LABELS.owner}</option>
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
    </Panel>
  );
}

function PendingStaffInvites({ agencyId }: { agencyId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["agency-invites", agencyId], queryFn: () => loadAgencyInvites(agencyId) });

  const remove = useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase.from("invites").delete().eq("id", inviteId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agency-invites", agencyId] }),
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
            <span>{AGENCY_ROLE_LABELS[invite.role as AgencyRole] ?? invite.role}</span>
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
    body = (
      <div className="p-5">
        <EmptyState title="No staff found" icon={<IconTeam size={18} />} />
      </div>
    );
  } else {
    body = query.data.map((row) => {
      const name = row.profile?.full_name?.trim() || row.profile?.email?.trim() || "Unknown";
      const email = row.profile?.email?.trim();
      return (
        <PanelRow
          key={row.user_id}
          icon={<Monogram name={name} size="md" />}
          title={name}
          detail={email && email !== name ? email : undefined}
          action={<Pill tone={row.role === "owner" ? "blue" : "grey"}>{AGENCY_ROLE_LABELS[row.role]}</Pill>}
        />
      );
    });
  }

  return (
    <Panel title="Agency staff" aside={query.data ? <span className="text-[12px] text-muted">{query.data.length} {query.data.length === 1 ? "person" : "people"}</span> : undefined}>
      {body}
    </Panel>
  );
}

function pickMembership(agencies: AgencyMembership[], selectedId: string): AgencyMembership | undefined {
  return agencies.find((membership) => membership.agency.id === selectedId) ?? agencies[0];
}

export function AgencyTeam() {
  const { agencies, agencyRole } = useAuth();
  const [selectedId, setSelectedId] = useState(agencies[0]?.agency.id ?? "");
  const membership = pickMembership(agencies, selectedId);

  if (!membership) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Team" description="The people at your agency who can manage client sites." />
        <Notice kind="warning" title="Your account is not staff of any agency">
          Team settings are only available to agency owners and staff.
        </Notice>
      </div>
    );
  }

  const agency = membership.agency;
  const isOwner = (membership.role ?? agencyRole) === "owner";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Team" description="The people at your agency who can manage client sites. Clients are added on each site's Team tab." />
      {agencies.length > 1 && (
        <Field label="Agency" htmlFor="agency-select" className="max-w-sm">
          <Select id="agency-select" value={agency.id} onChange={(event) => setSelectedId(event.target.value)}>
            {agencies.map((item) => (
              <option key={item.agency.id} value={item.agency.id}>
                {item.agency.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <StaffPanel agencyId={agency.id} />
        <div className="flex flex-col gap-5">
          {isOwner ? <StaffInviteForm agencyId={agency.id} /> : <Notice kind="info">Only an agency owner can invite staff.</Notice>}
          <PendingStaffInvites agencyId={agency.id} />
        </div>
      </div>
    </div>
  );
}
