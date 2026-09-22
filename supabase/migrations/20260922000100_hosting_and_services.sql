-- =============================================================================
-- Armature — hosting-only sites and the services an agency charges for.
--
-- Apply after 20260921000200_armature_storage.sql (docs/SETUP.md, part A).
--
-- 1. A site may exist before its GitHub repository is connected ("hosting only"):
--    the repository columns become nullable, the status enum gains 'hosting_only',
--    and a CHECK keeps every connected / needs_attention site fully described.
-- 2. site_services: one row per site with what the agency charges for hosting,
--    the domain and email. Agency staff only; clients have no access at all.
-- 3. site_billing: a view with each site's yearly total in cents and its next
--    renewal date, computed from site_services. It runs with the caller's own
--    rights, so it is as private as the table.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Hosting-only sites
-- ---------------------------------------------------------------------------
alter type public.site_status add value if not exists 'hosting_only';

alter table public.sites
  alter column repo_owner drop not null,
  alter column repo_name drop not null,
  alter column branch drop not null,
  alter column github_installation_id drop not null;

-- The old constraint treated the three columns as a whole key; a hosting-only
-- site has none of them, so uniqueness applies only once a repository is set.
alter table public.sites drop constraint if exists sites_repo_owner_repo_name_branch_key;
create unique index if not exists sites_repo_branch_unique
  on public.sites (repo_owner, repo_name, branch)
  where repo_owner is not null;

-- Connected and needs_attention sites always carry the whole repository record.
-- (Written in terms of the existing statuses so it is valid in the same
-- transaction that adds 'hosting_only' to the enum.)
alter table public.sites add constraint sites_connected_have_repo check (
  status not in ('connected', 'needs_attention')
  or (
    repo_owner is not null
    and repo_name is not null
    and branch is not null
    and github_installation_id is not null
  )
);

-- ---------------------------------------------------------------------------
-- 2. site_services
-- ---------------------------------------------------------------------------
create table public.site_services (
  site_id uuid primary key references public.sites (id) on delete cascade,

  -- Hosting
  hosting_provider text,
  hosting_annual_fee_cents integer check (hosting_annual_fee_cents is null or hosting_annual_fee_cents >= 0),
  hosting_start_date date,
  hosting_renewal_date date,

  -- Domain
  domain_name text,
  domain_registrar text,
  domain_account_owner text check (domain_account_owner is null or domain_account_owner in ('agency', 'client')),
  domain_renewal_date date,
  domain_annual_fee_cents integer check (domain_annual_fee_cents is null or domain_annual_fee_cents >= 0),

  -- Mailboxes (where the client reads email)
  email_provider text check (
    email_provider is null
    or email_provider in ('google_workspace', 'microsoft_365', 'zoho', 'forwarding', 'other', 'none')
  ),
  email_mailboxes integer check (email_mailboxes is null or email_mailboxes >= 0),
  email_pricing text check (email_pricing is null or email_pricing in ('flat', 'per_mailbox')),
  -- A flat yearly amount, or the yearly price of one mailbox when email_pricing = 'per_mailbox'.
  email_annual_fee_cents integer check (email_annual_fee_cents is null or email_annual_fee_cents >= 0),
  email_managed_by text check (email_managed_by is null or email_managed_by in ('agency', 'client')),

  -- Automatic emails (messages the website sends, such as form notifications)
  transactional_email_provider text check (
    transactional_email_provider is null or transactional_email_provider in ('resend', 'other', 'none')
  ),
  transactional_from_address text,

  -- Agreement
  agreement_accepted_on date,
  notes text not null default '' check (char_length(notes) <= 10000),

  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create trigger site_services_touch
  before update on public.site_services
  for each row execute function public.touch_updated_at();

alter table public.site_services enable row level security;

-- Agency staff of the site's agency, and nobody else: a client member of the
-- site never matches, so prices stay with the agency.
create policy "site_services: staff read"
  on public.site_services for select to authenticated
  using (public.is_agency_member(public.site_agency_id(site_id)));
create policy "site_services: staff insert"
  on public.site_services for insert to authenticated
  with check (public.is_agency_member(public.site_agency_id(site_id)));
create policy "site_services: staff update"
  on public.site_services for update to authenticated
  using (public.is_agency_member(public.site_agency_id(site_id)))
  with check (public.is_agency_member(public.site_agency_id(site_id)));
create policy "site_services: staff delete"
  on public.site_services for delete to authenticated
  using (public.is_agency_member(public.site_agency_id(site_id)));

-- ---------------------------------------------------------------------------
-- 3. site_billing: yearly total and next renewal per site
-- ---------------------------------------------------------------------------
-- yearly_total_cents = hosting + domain + email, where a per-mailbox email price
-- is multiplied by the number of mailboxes. next_renewal_date is the earliest
-- hosting or domain renewal that is today or later; overdue_renewal_date is the
-- earliest one already in the past (null when there is none), so a screen can
-- warn about a lapsed renewal without inventing a future date.
create or replace view public.site_billing
with (security_invoker = true)
as
select
  s.site_id,
  coalesce(s.hosting_annual_fee_cents, 0)
    + coalesce(s.domain_annual_fee_cents, 0)
    + case
        when s.email_pricing = 'per_mailbox' then coalesce(s.email_annual_fee_cents, 0) * coalesce(s.email_mailboxes, 0)
        else coalesce(s.email_annual_fee_cents, 0)
      end as yearly_total_cents,
  (
    select min(d) from unnest(array[s.hosting_renewal_date, s.domain_renewal_date]) as d
    where d is not null and d >= current_date
  ) as next_renewal_date,
  (
    select min(d) from unnest(array[s.hosting_renewal_date, s.domain_renewal_date]) as d
    where d is not null and d < current_date
  ) as overdue_renewal_date
from public.site_services s;

grant select on public.site_billing to authenticated, service_role;
