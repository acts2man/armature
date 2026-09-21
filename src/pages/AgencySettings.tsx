/**
 * Agency settings: the portal name, logo and accent colour clients see, plus
 * the agency's staff and their invitations. Owners edit; staff can only look.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { useState, type FormEvent, type ReactNode } from "react";
import { useAuth, type AgencyMembership } from "@/auth/AuthProvider.tsx";
import { Button, Card, Field, Input, LinkButton, Notice, PageHeader, Pill, Select, Spinner, SrOnly } from "@/components/ui.tsx";
import { formatDate, plural } from "@/lib/format.ts";
import { callFunction } from "@/lib/functions.ts";
import { supabase } from "@/lib/supabase.ts";
import { isHexColor } from "@/lib/theme.ts";
import {
  AGENCY_ROLE_LABELS,
  type Agency,
  type AgencyMember,
  type AgencyRole,
  type Invite,
  type Profile,
} from "@/lib/types.ts";
import type { InviteCreateResponse } from "@shared/publishTypes.ts";

const NAME_MAX = 120;

type ProfileLite = Pick<Profile, "id" | "email" | "full_name">;
type StaffRow = { user_id: string; role: AgencyRole; created_at: string; profile: ProfileLite | null };
type PendingInvite = Invite & { expired: boolean };
type CreatedInvite = { url: string; email: string; expires_at: string };

/** Relative luminance of a #rrggbb colour, for picking readable text in the preview. */
function isLightColor(hex: string): boolean {
  const value = hex.replace("#", "");
  const channel = (index: number) => {
    const part = Number.parseInt(value.slice(index, index + 2), 16) / 255;
    return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4) > 0.4;
}

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
  return ((data ?? []) as Invite[]).map((invite) => ({
    ...invite,
    expired: new Date(invite.expires_at).getTime() < now,
  }));
}

async function loadSiteCount(agencyId: string): Promise<number> {
  const { count, error } = await supabase
    .from("sites")
    .select("id", { count: "exact", head: true })
    .eq("agency_id", agencyId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

function PersonCell({ row }: { row: StaffRow }) {
  const name = row.profile?.full_name?.trim();
  const email = row.profile?.email?.trim();
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
        Email sending is not set up yet, so copy this link and send it to {invite.email} yourself. It expires on{" "}
        {formatDate(invite.expires_at)}.
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

function BrandingForm({ agency, isOwner }: { agency: Agency; isOwner: boolean }) {
  const { refresh } = useAuth();
  const [name, setName] = useState(agency.name);
  const [portalName, setPortalName] = useState(agency.portal_name);
  const [logoUrl, setLogoUrl] = useState(agency.logo_url ?? "");
  const [accent, setAccent] = useState(agency.accent_color);
  /** The last valid colour, so the picker always has something to show while the text is mid-edit. */
  const [pickerValue, setPickerValue] = useState(agency.accent_color);
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (input: { name: string; portal_name: string; logo_url: string | null; accent_color: string }) => {
      const { data, error } = await supabase.from("agencies").update(input).eq("id", agency.id).select("id");
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) {
        throw new Error("Nothing was saved. Only an agency owner can change these settings.");
      }
      await refresh();
    },
  });

  function onAccentText(value: string) {
    const next = value.startsWith("#") || value.length === 0 ? value : `#${value}`;
    setAccent(next);
    if (isHexColor(next)) setPickerValue(next);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedPortal = portalName.trim();
    const trimmedLogo = logoUrl.trim();
    if (!trimmedName || trimmedName.length > NAME_MAX) {
      setFormError(`The agency name must be between 1 and ${NAME_MAX} characters.`);
      return;
    }
    if (!trimmedPortal || trimmedPortal.length > NAME_MAX) {
      setFormError(`The portal name must be between 1 and ${NAME_MAX} characters.`);
      return;
    }
    if (trimmedLogo && !/^https?:\/\//.test(trimmedLogo)) {
      setFormError("The logo URL must start with http:// or https://.");
      return;
    }
    if (!isHexColor(accent)) {
      setFormError("The accent colour must be a six-digit hex colour, like #2b3fd6.");
      return;
    }
    setFormError(null);
    mutation.mutate({ name: trimmedName, portal_name: trimmedPortal, logo_url: trimmedLogo || null, accent_color: accent });
  }

  const disabled = !isOwner || mutation.isPending;
  const previewColor = isHexColor(accent) ? accent : pickerValue;

  return (
    <Card as="section">
      <h2 className="text-lg font-semibold text-ink">Branding</h2>
      {!isOwner && (
        <Notice kind="info" className="mt-3">
          Only an agency owner can change these settings
        </Notice>
      )}
      <form onSubmit={onSubmit} className="mt-4 space-y-5" noValidate>
        <Field label="Agency name" htmlFor="agency-name">
          <Input
            id="agency-name"
            required
            maxLength={NAME_MAX}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={disabled}
          />
        </Field>
        <Field label="Portal name" htmlFor="agency-portal-name" hint="Shown to clients instead of the agency name">
          <Input
            id="agency-portal-name"
            required
            maxLength={NAME_MAX}
            value={portalName}
            onChange={(event) => setPortalName(event.target.value)}
            disabled={disabled}
          />
        </Field>
        <Field
          label="Logo URL"
          htmlFor="agency-logo-url"
          hint="A square image, https://… . Leave empty to show the portal's initial."
        >
          <Input
            id="agency-logo-url"
            type="url"
            inputMode="url"
            placeholder="https://"
            value={logoUrl}
            onChange={(event) => setLogoUrl(event.target.value)}
            disabled={disabled}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
          <Field label="Accent colour" htmlFor="agency-accent-picker">
            <input
              id="agency-accent-picker"
              type="color"
              value={pickerValue}
              onChange={(event) => {
                setAccent(event.target.value);
                setPickerValue(event.target.value);
              }}
              disabled={disabled}
              className="h-11 w-16 cursor-pointer rounded-lg border border-line bg-panel p-1 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </Field>
          <Field
            label="Accent colour (hex)"
            htmlFor="agency-accent-hex"
            hint="Six hex digits, like #2b3fd6"
            error={accent && !isHexColor(accent) ? "That is not a six-digit hex colour." : null}
          >
            <Input
              id="agency-accent-hex"
              value={accent}
              maxLength={7}
              spellCheck={false}
              onChange={(event) => onAccentText(event.target.value)}
              disabled={disabled}
              className="font-mono"
            />
          </Field>
        </div>

        <div className="rounded-card border border-line bg-ground p-4">
          <p className="text-sm font-medium text-text">Preview</p>
          <p className="mt-1 text-sm text-muted">Buttons and links in the portal will use this colour.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span
              aria-hidden="true"
              className={clsx(
                "inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-[15px] font-medium",
                isLightColor(previewColor) ? "text-ink" : "text-white",
              )}
              style={{ backgroundColor: previewColor }}
            >
              Publish changes
            </span>
            <span aria-hidden="true" className="text-[15px] font-medium underline" style={{ color: previewColor }}>
              A link in this colour
            </span>
          </div>
        </div>

        {formError && (
          <Notice kind="danger" title="Check the form">
            {formError}
          </Notice>
        )}
        {mutation.isError && (
          <Notice kind="danger" title="Settings could not be saved">
            {mutation.error.message}
          </Notice>
        )}
        {mutation.isSuccess && <Notice kind="success">Saved</Notice>}

        <Button type="submit" loading={mutation.isPending} disabled={!isOwner}>
          Save
        </Button>
      </form>
    </Card>
  );
}

function StaffInviteForm({ agencyId }: { agencyId: string }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AgencyRole>("staff");
  const [created, setCreated] = useState<CreatedInvite | null>(null);

  const mutation = useMutation({
    mutationFn: async (input: { email: string; role: AgencyRole }) => {
      const result = await callFunction<InviteCreateResponse>("invite-create", {
        agency_id: agencyId,
        site_id: null,
        email: input.email,
        role: input.role,
      });
      if (!result.ok) throw new Error(result.message);
      return { ...result, email: input.email };
    },
    onSuccess: async (result) => {
      setCreated({ url: result.invite_url, email: result.email, expires_at: result.expires_at });
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
    <form onSubmit={onSubmit} className="space-y-4">
      <h3 className="text-base font-semibold text-ink">Invite staff</h3>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <Field label="Email" htmlFor="staff-invite-email">
          <Input
            id="staff-invite-email"
            type="email"
            required
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={mutation.isPending}
          />
        </Field>
        <Field label="Role" htmlFor="staff-invite-role">
          <Select
            id="staff-invite-role"
            value={role}
            onChange={(event) => setRole(event.target.value as AgencyRole)}
            disabled={mutation.isPending}
          >
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
      <Button type="submit" loading={mutation.isPending}>
        Create invite
      </Button>
    </form>
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
      <ul className="divide-y divide-line">
        {query.data.map((invite) => (
          <li key={invite.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="break-all font-medium text-text">{invite.email}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                <span>{AGENCY_ROLE_LABELS[invite.role as AgencyRole] ?? invite.role}</span>
                <span>· Expires {formatDate(invite.expires_at)}</span>
                {invite.expired && <Pill tone="danger">Expired</Pill>}
              </p>
            </div>
            <Button
              variant="danger"
              size="sm"
              onClick={() => remove.mutate(invite.id)}
              loading={remove.isPending && remove.variables === invite.id}
            >
              Delete
              <SrOnly> invite for {invite.email}</SrOnly>
            </Button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-base font-semibold text-ink">Pending invitations</h3>
      {remove.isError && (
        <Notice kind="danger" title="The invitation could not be deleted">
          {remove.error.message}
        </Notice>
      )}
      {body}
    </div>
  );
}

function StaffCard({ agencyId, isOwner }: { agencyId: string; isOwner: boolean }) {
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
    body = <p className="text-sm text-muted">No staff found.</p>;
  } else {
    body = (
      <ul className="divide-y divide-line">
        {query.data.map((row) => (
          <li key={row.user_id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <PersonCell row={row} />
            <span className="text-sm text-muted">{AGENCY_ROLE_LABELS[row.role]}</span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Card as="section" className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-ink">Agency staff</h2>
        <div className="mt-2">{body}</div>
      </div>
      {isOwner ? (
        <>
          <StaffInviteForm agencyId={agencyId} />
          <PendingStaffInvites agencyId={agencyId} />
        </>
      ) : (
        <p className="text-sm text-muted">Only an agency owner can invite staff.</p>
      )}
    </Card>
  );
}

function ClientsCard({ agencyId }: { agencyId: string }) {
  const query = useQuery({ queryKey: ["agency-site-count", agencyId], queryFn: () => loadSiteCount(agencyId) });

  let body: ReactNode;
  if (query.isPending) {
    body = <Spinner label="Counting sites" />;
  } else if (query.isError) {
    body = (
      <Notice kind="danger" title="Sites could not be counted">
        {query.error.message}
      </Notice>
    );
  } else {
    body = <p className="text-[15px] text-text">This agency looks after {plural(query.data, "site")}.</p>;
  }

  return (
    <Card as="section">
      <h2 className="text-lg font-semibold text-ink">Clients</h2>
      <div className="mt-2">{body}</div>
      <div className="mt-3">
        <LinkButton to="/fleet" variant="secondary">
          Open the fleet
        </LinkButton>
      </div>
    </Card>
  );
}

function pickMembership(agencies: AgencyMembership[], selectedId: string): AgencyMembership | undefined {
  return agencies.find((membership) => membership.agency.id === selectedId) ?? agencies[0];
}

export function AgencySettings() {
  const { agencies, agencyRole } = useAuth();
  const [selectedId, setSelectedId] = useState(agencies[0]?.agency.id ?? "");
  const membership = pickMembership(agencies, selectedId);

  if (!membership) {
    return (
      <div className="space-y-6">
        <PageHeader title="Agency settings" description="What your clients see when they sign in." />
        <Notice kind="warning" title="Your account is not staff of any agency">
          Agency settings are only available to agency owners and staff.
        </Notice>
      </div>
    );
  }

  const agency = membership.agency;
  const role = membership.role ?? agencyRole;
  const isOwner = role === "owner";

  return (
    <div className="space-y-6">
      <PageHeader title="Agency settings" description="What your clients see when they sign in." />
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
      <BrandingForm key={agency.id} agency={agency} isOwner={isOwner} />
      <StaffCard agencyId={agency.id} isOwner={isOwner} />
      <ClientsCard agencyId={agency.id} />
    </div>
  );
}
