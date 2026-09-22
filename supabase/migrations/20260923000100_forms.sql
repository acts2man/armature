-- =============================================================================
-- Armature — the page builder's Form widget.
--
-- Apply after 20260922000100_hosting_and_services.sql (docs/SETUP.md, part A).
--
-- 1. site_services.form_recipients: where a site's form entries are emailed (up to
--    ten addresses). Agency staff set it; clients never see site_services.
-- 2. form_submissions: every entry a visitor sends. Written only by the form-submit
--    edge function with the service role (there is no insert policy at all). Agency
--    staff and the site's client members read them and mark them read; only agency
--    staff delete. The visitor's IP address is never stored: only a salted SHA-256
--    of it, used for rate limits.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Where entries are emailed
-- ---------------------------------------------------------------------------
alter table public.site_services
  add column if not exists form_recipients text[] not null default '{}';

alter table public.site_services add constraint site_services_form_recipients_valid check (
  cardinality(form_recipients) <= 10
  and array_to_string(form_recipients, ',') !~ '[[:space:]]'
  and (
    cardinality(form_recipients) = 0
    or array_to_string(form_recipients, ',') ~ '^[^@,]+@[^@,]+\.[^@,]+(,[^@,]+@[^@,]+\.[^@,]+)*$'
  )
);

-- ---------------------------------------------------------------------------
-- 2. Entries
-- ---------------------------------------------------------------------------
create table public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  page_slug text not null check (page_slug ~ '^[a-z0-9][a-z0-9-]*$' and char_length(page_slug) <= 100),
  element_id text not null check (element_id ~ '^[a-z0-9]{8}$'),
  form_name text check (form_name is null or char_length(form_name) <= 120),
  -- Field name -> value, as the form defined them (validated before insert).
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 65536),
  -- A salted SHA-256 of the visitor's IP address, for rate limits. Never the address.
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  email_status text not null default 'skipped' check (email_status in ('sent', 'failed', 'skipped')),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index form_submissions_site_created_idx on public.form_submissions (site_id, created_at desc);
create index form_submissions_rate_idx on public.form_submissions (ip_hash, created_at desc);

alter table public.form_submissions enable row level security;

create policy "form_submissions: staff and members read"
  on public.form_submissions for select to authenticated
  using (public.can_access_site(site_id));

-- Marking an entry read is the only change anyone makes (column grant below).
create policy "form_submissions: staff and members mark read"
  on public.form_submissions for update to authenticated
  using (public.can_access_site(site_id))
  with check (public.can_access_site(site_id));

create policy "form_submissions: staff delete"
  on public.form_submissions for delete to authenticated
  using (public.is_agency_member(public.site_agency_id(site_id)));

-- No insert policy: visitors reach the table only through the form-submit function.
revoke all on public.form_submissions from anon;
revoke insert, update on public.form_submissions from authenticated;
grant select, delete on public.form_submissions to authenticated;
grant update (read_at) on public.form_submissions to authenticated;
