/**
 * Agency settings: the portal name, logo and accent colour clients see. Owners
 * edit; staff can only look. Staff and invitations live on the Team screen.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { useState, type FormEvent, type ReactNode } from "react";
import { useAuth, type AgencyMembership } from "@/auth/AuthProvider.tsx";
import { IconGlobe } from "@/components/icons.tsx";
import { Button, Field, Input, LinkButton, Notice, PageHeader, Panel, PanelRow, Select, Skeleton, useToast } from "@/components/ui.tsx";
import { plural } from "@/lib/format.ts";
import { supabase } from "@/lib/supabase.ts";
import { isHexColor } from "@/lib/theme.ts";
import type { Agency } from "@/lib/types.ts";

const NAME_MAX = 120;

/** Relative luminance of a #rrggbb colour, for picking readable text in the preview. */
function isLightColor(hex: string): boolean {
  const value = hex.replace("#", "");
  const channel = (index: number) => {
    const part = Number.parseInt(value.slice(index, index + 2), 16) / 255;
    return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4) > 0.4;
}

async function loadSiteCount(agencyId: string): Promise<number> {
  const { count, error } = await supabase.from("sites").select("id", { count: "exact", head: true }).eq("agency_id", agencyId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

const SWATCHES = ["#2B3FD6", "#0F766E", "#A21C5B", "#16202B"];

function BrandingForm({ agency, isOwner }: { agency: Agency; isOwner: boolean }) {
  const { refresh } = useAuth();
  const toast = useToast();
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
      if (!data || data.length === 0) throw new Error("Nothing was saved. Only an agency owner can change these settings.");
      await refresh();
    },
    onSuccess: () => toast.show("Branding saved"),
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
  const previewPortal = portalName.trim() || "Client portal";

  return (
    <Panel title="Branding" aside={!isOwner ? <span className="text-[12px] text-muted">Only an owner can change these</span> : undefined}>
      <form onSubmit={onSubmit} className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_320px]" noValidate>
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Agency name" htmlFor="agency-name" hint="Used on your own screens">
              <Input id="agency-name" required maxLength={NAME_MAX} value={name} onChange={(event) => setName(event.target.value)} disabled={disabled} />
            </Field>
            <Field label="Portal name" htmlFor="agency-portal-name" hint="What clients see instead of the agency name">
              <Input id="agency-portal-name" required maxLength={NAME_MAX} value={portalName} onChange={(event) => setPortalName(event.target.value)} disabled={disabled} />
            </Field>
          </div>
          <Field label="Logo URL" htmlFor="agency-logo-url" hint="A square image at an https:// address. Leave empty to show the portal's initials.">
            <Input id="agency-logo-url" type="url" inputMode="url" placeholder="https://" value={logoUrl} onChange={(event) => setLogoUrl(event.target.value)} disabled={disabled} />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-text">Accent colour</span>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2" role="group" aria-label="Suggested colours">
                {SWATCHES.map((swatch) => {
                  const selected = accent.toLowerCase() === swatch.toLowerCase();
                  return (
                    <button
                      key={swatch}
                      type="button"
                      aria-label={`Use ${swatch}`}
                      aria-pressed={selected}
                      disabled={disabled}
                      onClick={() => {
                        setAccent(swatch);
                        setPickerValue(swatch);
                      }}
                      style={{ backgroundColor: swatch }}
                      className={clsx("h-8 w-8 rounded-full", selected ? "ring-2 ring-accent ring-offset-2 ring-offset-panel" : "shadow-[inset_0_0_0_1px_rgba(22,32,43,0.18)]")}
                    />
                  );
                })}
              </div>
              <label htmlFor="agency-accent-picker" className="sr-only">
                Pick a colour
              </label>
              <input
                id="agency-accent-picker"
                type="color"
                value={pickerValue}
                onChange={(event) => {
                  setAccent(event.target.value);
                  setPickerValue(event.target.value);
                }}
                disabled={disabled}
                className="h-11 w-14 cursor-pointer rounded-control border border-line bg-panel p-1 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <div className="w-36">
                <label htmlFor="agency-accent-hex" className="sr-only">
                  Accent colour as hex
                </label>
                <Input id="agency-accent-hex" value={accent} maxLength={7} spellCheck={false} onChange={(event) => onAccentText(event.target.value)} disabled={disabled} className="font-mono" />
              </div>
            </div>
            {accent && !isHexColor(accent) ? (
              <p className="text-[13px] text-red" role="alert">
                That is not a six-digit hex colour.
              </p>
            ) : (
              <p className="text-[12px] text-muted">Buttons, links and focus rings in the portal use this colour.</p>
            )}
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
          <div>
            <Button type="submit" loading={mutation.isPending} disabled={!isOwner}>
              Save branding
            </Button>
          </div>
        </div>

        {/* Live preview of the client sidebar */}
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold text-text">Preview</span>
          <div aria-hidden="true" className="overflow-hidden rounded-card border border-line">
            <div className="flex flex-col gap-3 bg-ink p-3 text-ink-text">
              <div className="flex items-center gap-3 px-1">
                {logoUrl.trim() && /^https?:\/\//.test(logoUrl.trim()) ? (
                  <img src={logoUrl.trim()} alt="" className="h-9 w-9 rounded-control bg-white object-contain" />
                ) : (
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-control bg-white font-display text-[15px] font-bold text-ink">{previewPortal.slice(0, 2).toUpperCase()}</span>
                )}
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold text-white">{previewPortal}</span>
                  <span className="block text-[12px]">Client portal</span>
                </span>
              </div>
              <span className="flex h-9 items-center rounded-control bg-ink-2 px-3 text-[13px] font-semibold text-white">Dashboard</span>
              <span className="flex h-9 items-center px-3 text-[13px]">Pages</span>
              <span className="flex h-11 items-center justify-center rounded-control text-[14px] font-semibold" style={{ backgroundColor: previewColor, color: isLightColor(previewColor) ? "#16202b" : "#ffffff" }}>
                Edit site visually
              </span>
            </div>
            <div className="flex items-center gap-3 bg-ground p-3">
              <span className="inline-flex h-9 items-center rounded-control px-4 text-[14px] font-semibold" style={{ backgroundColor: previewColor, color: isLightColor(previewColor) ? "#16202b" : "#ffffff" }}>
                Publish
              </span>
              <span className="text-[14px] font-semibold underline underline-offset-2" style={{ color: previewColor }}>
                A link
              </span>
            </div>
          </div>
        </div>
      </form>
    </Panel>
  );
}

function ClientsPanel({ agencyId }: { agencyId: string }) {
  const query = useQuery({ queryKey: ["agency-site-count", agencyId], queryFn: () => loadSiteCount(agencyId) });
  let body: ReactNode;
  if (query.isPending) body = <Skeleton className="w-40" />;
  else if (query.isError) body = <span className="text-red">{query.error.message}</span>;
  else body = `This agency looks after ${plural(query.data, "site")}. Client members are managed on each site's Team tab.`;
  return (
    <Panel title="Clients">
      <PanelRow
        icon={<IconGlobe size={18} />}
        title="Client sites"
        detail={body}
        action={
          <LinkButton to="/fleet" variant="secondary" size="sm">
            Open the fleet
          </LinkButton>
        }
      />
    </Panel>
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
      <div className="flex flex-col gap-5">
        <PageHeader title="Settings" description="What your clients see when they sign in." />
        <Notice kind="warning" title="Your account is not staff of any agency">
          Agency settings are only available to agency owners and staff.
        </Notice>
      </div>
    );
  }

  const agency = membership.agency;
  const isOwner = (membership.role ?? agencyRole) === "owner";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Settings" description="What your clients see when they sign in: the portal name, logo and accent colour." />
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
      <ClientsPanel agencyId={agency.id} />
    </div>
  );
}
