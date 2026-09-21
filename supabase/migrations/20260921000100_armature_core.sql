-- =============================================================================
-- Armature v0.1 — core schema, helper functions and row-level security.
--
-- Apply this file first, in the Supabase SQL editor (docs/SETUP.md, part A).
-- It is written to run exactly once on a fresh project. Everything an agency or
-- a client can see is decided by the policies at the bottom of this file, and
-- supabase/tests/rls.test.sql proves the isolation rules.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------
create type public.agency_role as enum ('owner', 'staff');
create type public.site_role as enum ('client_owner', 'client_editor');
create type public.site_status as enum ('connected', 'needs_attention');
create type public.publish_status as enum ('committed', 'conflict', 'failed');
create type public.change_request_status as enum (
  'new',
  'in_progress',
  'ready_for_review',
  'done',
  'declined'
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- An agency owns sites and invites clients. Portal branding lives here.
create table public.agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  portal_name text not null check (char_length(portal_name) between 1 and 120),
  logo_url text check (logo_url is null or logo_url ~ '^https?://'),
  accent_color text not null default '#2B3FD6' check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now()
);

-- A readable mirror of auth.users, so team screens can show who has access.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now()
);

create table public.agency_members (
  agency_id uuid not null references public.agencies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.agency_role not null default 'staff',
  created_at timestamptz not null default now(),
  primary key (agency_id, user_id)
);

-- One row per GitHub App installation an agency has linked. An agency can link
-- several (its own GitHub organisation and a client's, for example).
create table public.github_installations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  installation_id bigint not null unique,
  account_login text not null,
  account_type text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  repo_owner text not null check (repo_owner ~ '^[A-Za-z0-9._-]+$'),
  repo_name text not null check (repo_name ~ '^[A-Za-z0-9._-]+$'),
  branch text not null check (char_length(branch) between 1 and 255),
  live_url text check (live_url is null or live_url ~ '^https?://'),
  github_installation_id bigint not null,
  status public.site_status not null default 'connected',
  last_published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (repo_owner, repo_name, branch)
);
create index sites_agency_idx on public.sites (agency_id);

create table public.site_members (
  site_id uuid not null references public.sites (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.site_role not null default 'client_editor',
  created_at timestamptz not null default now(),
  primary key (site_id, user_id)
);
create index site_members_user_idx on public.site_members (user_id);

-- Invites hold only a hash of the token. The token itself is in the emailed link.
create table public.invites (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  site_id uuid references public.sites (id) on delete cascade,
  email text not null check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  role text not null check (role in ('owner', 'staff', 'client_owner', 'client_editor')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint invites_role_matches_target check (
    (site_id is null and role in ('owner', 'staff'))
    or (site_id is not null and role in ('client_owner', 'client_editor'))
  )
);
create index invites_agency_idx on public.invites (agency_id, created_at desc);

-- One row per publish attempt, written by the content-publish function.
create table public.publishes (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  page_slug text not null,
  fields_changed text[] not null default '{}',
  commit_sha text,
  commit_url text,
  status public.publish_status not null,
  error text,
  created_at timestamptz not null default now()
);
create index publishes_site_idx on public.publishes (site_id, created_at desc);

create table public.change_requests (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  details text not null default '' check (char_length(details) <= 10000),
  status public.change_request_status not null default 'new',
  agency_note text not null default '' check (char_length(agency_note) <= 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index change_requests_site_idx on public.change_requests (site_id, created_at desc);

create table public.change_request_attachments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.change_requests (id) on delete cascade,
  storage_path text not null,
  created_at timestamptz not null default now()
);
create index change_request_attachments_request_idx
  on public.change_request_attachments (request_id);

-- ---------------------------------------------------------------------------
-- Grants. Signed-in users reach tables only through the policies below; the
-- anonymous key can reach nothing.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

-- ---------------------------------------------------------------------------
-- Membership helpers. SECURITY DEFINER so a policy can ask "is this user a
-- member?" without recursing into the very table it is protecting.
-- ---------------------------------------------------------------------------
create or replace function public.is_agency_member(p_agency_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.agency_members m
    where m.agency_id = p_agency_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_agency_owner(p_agency_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.agency_members m
    where m.agency_id = p_agency_id and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

create or replace function public.is_site_member(p_site_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.site_members m
    where m.site_id = p_site_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.site_agency_id(p_site_id uuid)
returns uuid
language sql stable security definer
set search_path = public
as $$
  select s.agency_id from public.sites s where s.id = p_site_id;
$$;

-- Agency staff of the site's agency, or a client member of the site.
create or replace function public.can_access_site(p_site_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.is_site_member(p_site_id)
      or public.is_agency_member(public.site_agency_id(p_site_id));
$$;

-- True when the caller is a client member of any site belonging to the agency.
create or replace function public.is_client_of_agency(p_agency_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.sites s
    join public.site_members m on m.site_id = s.id
    where s.agency_id = p_agency_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.request_site_id(p_request_id uuid)
returns uuid
language sql stable security definer
set search_path = public
as $$
  select r.site_id from public.change_requests r where r.id = p_request_id;
$$;

-- Whether the caller may see another person's profile row: themselves, anyone in
-- the same agency, anyone on the same site, and agency staff <-> the clients of
-- that agency's sites. Nobody outside those relationships.
create or replace function public.shares_context_with(p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select p_user_id = auth.uid()
    or exists (
      select 1 from public.agency_members a
      join public.agency_members b on a.agency_id = b.agency_id
      where a.user_id = auth.uid() and b.user_id = p_user_id
    )
    or exists (
      select 1 from public.site_members a
      join public.site_members b on a.site_id = b.site_id
      where a.user_id = auth.uid() and b.user_id = p_user_id
    )
    or exists (
      select 1 from public.site_members sm
      join public.sites s on s.id = sm.site_id
      join public.agency_members am on am.agency_id = s.agency_id
      where (sm.user_id = p_user_id and am.user_id = auth.uid())
         or (sm.user_id = auth.uid() and am.user_id = p_user_id)
    );
$$;

-- A uuid cast that returns null instead of raising, for storage path checks.
create or replace function public.try_uuid(p_value text)
returns uuid
language plpgsql immutable
as $$
begin
  return p_value::uuid;
exception when others then
  return null;
end;
$$;

revoke all on function public.is_agency_member(uuid) from public;
revoke all on function public.is_agency_owner(uuid) from public;
revoke all on function public.is_site_member(uuid) from public;
revoke all on function public.site_agency_id(uuid) from public;
revoke all on function public.can_access_site(uuid) from public;
revoke all on function public.is_client_of_agency(uuid) from public;
revoke all on function public.request_site_id(uuid) from public;
revoke all on function public.shares_context_with(uuid) from public;
revoke all on function public.try_uuid(text) from public;
grant execute on function public.is_agency_member(uuid) to authenticated, service_role;
grant execute on function public.is_agency_owner(uuid) to authenticated, service_role;
grant execute on function public.is_site_member(uuid) to authenticated, service_role;
grant execute on function public.site_agency_id(uuid) to authenticated, service_role;
grant execute on function public.can_access_site(uuid) to authenticated, service_role;
grant execute on function public.is_client_of_agency(uuid) to authenticated, service_role;
grant execute on function public.request_site_id(uuid) to authenticated, service_role;
grant execute on function public.shares_context_with(uuid) to authenticated, service_role;
grant execute on function public.try_uuid(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Keep profiles in step with auth.users.
create or replace function public.handle_auth_user_change()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name);
  return new;
end;
$$;

create trigger on_auth_user_change
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function public.handle_auth_user_change();

-- change_requests.updated_at
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger change_requests_touch
  before update on public.change_requests
  for each row execute function public.touch_updated_at();

-- A committed publish stamps the site.
create or replace function public.record_site_publish()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.status = 'committed' then
    update public.sites set last_published_at = new.created_at where id = new.site_id;
  end if;
  return new;
end;
$$;

create trigger publishes_record_site
  after insert on public.publishes
  for each row execute function public.record_site_publish();

-- ---------------------------------------------------------------------------
-- First-run helper: turn an existing sign-up into the first agency owner.
-- Run from the SQL editor only (docs/SETUP.md, part E). Not callable by users.
-- ---------------------------------------------------------------------------
create or replace function public.bootstrap_agency(
  p_agency_name text,
  p_owner_email text,
  p_portal_name text default null
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_agency uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(p_owner_email) limit 1;
  if v_user is null then
    raise exception 'No account with the email %. Sign up in the dashboard first, then run this again.', p_owner_email;
  end if;
  insert into public.agencies (name, portal_name)
  values (p_agency_name, coalesce(p_portal_name, p_agency_name))
  returning id into v_agency;
  insert into public.agency_members (agency_id, user_id, role) values (v_agency, v_user, 'owner');
  insert into public.profiles (id, email)
  select id, email from auth.users where id = v_user
  on conflict (id) do nothing;
  return v_agency;
end;
$$;
revoke all on function public.bootstrap_agency(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.agencies enable row level security;
alter table public.profiles enable row level security;
alter table public.agency_members enable row level security;
alter table public.github_installations enable row level security;
alter table public.sites enable row level security;
alter table public.site_members enable row level security;
alter table public.invites enable row level security;
alter table public.publishes enable row level security;
alter table public.change_requests enable row level security;
alter table public.change_request_attachments enable row level security;

-- agencies: members see their agency; clients see the agency of a site they
-- belong to (for portal branding); only owners change settings.
create policy "agencies: members and clients read"
  on public.agencies for select to authenticated
  using (public.is_agency_member(id) or public.is_client_of_agency(id));
create policy "agencies: owners update"
  on public.agencies for update to authenticated
  using (public.is_agency_owner(id))
  with check (public.is_agency_owner(id));

-- profiles
create policy "profiles: shared context read"
  on public.profiles for select to authenticated
  using (public.shares_context_with(id));
create policy "profiles: own update"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- agency_members: visible inside the agency; managed by owners.
create policy "agency_members: members read"
  on public.agency_members for select to authenticated
  using (public.is_agency_member(agency_id));
create policy "agency_members: owners insert"
  on public.agency_members for insert to authenticated
  with check (public.is_agency_owner(agency_id));
create policy "agency_members: owners update"
  on public.agency_members for update to authenticated
  using (public.is_agency_owner(agency_id))
  with check (public.is_agency_owner(agency_id));
create policy "agency_members: owners delete"
  on public.agency_members for delete to authenticated
  using (public.is_agency_owner(agency_id));

-- github_installations: agency staff only.
create policy "github_installations: members read"
  on public.github_installations for select to authenticated
  using (public.is_agency_member(agency_id));
create policy "github_installations: members insert"
  on public.github_installations for insert to authenticated
  with check (public.is_agency_member(agency_id) and created_by = auth.uid());
create policy "github_installations: owners delete"
  on public.github_installations for delete to authenticated
  using (public.is_agency_owner(agency_id));

-- sites: agency staff see all of theirs; clients see only sites they belong to.
create policy "sites: staff and members read"
  on public.sites for select to authenticated
  using (public.is_agency_member(agency_id) or public.is_site_member(id));
create policy "sites: staff insert"
  on public.sites for insert to authenticated
  with check (public.is_agency_member(agency_id));
create policy "sites: staff update"
  on public.sites for update to authenticated
  using (public.is_agency_member(agency_id))
  with check (public.is_agency_member(agency_id));
create policy "sites: owners delete"
  on public.sites for delete to authenticated
  using (public.is_agency_owner(agency_id));

-- site_members: agency staff and fellow members of the same site can read;
-- agency staff manage. (Invite acceptance inserts through the service role.)
create policy "site_members: staff and members read"
  on public.site_members for select to authenticated
  using (public.is_agency_member(public.site_agency_id(site_id)) or public.is_site_member(site_id));
create policy "site_members: staff insert"
  on public.site_members for insert to authenticated
  with check (public.is_agency_member(public.site_agency_id(site_id)));
create policy "site_members: staff update"
  on public.site_members for update to authenticated
  using (public.is_agency_member(public.site_agency_id(site_id)))
  with check (public.is_agency_member(public.site_agency_id(site_id)));
create policy "site_members: staff delete"
  on public.site_members for delete to authenticated
  using (public.is_agency_member(public.site_agency_id(site_id)));

-- invites: agency staff only. Acceptance runs through the service role.
create policy "invites: staff read"
  on public.invites for select to authenticated
  using (public.is_agency_member(agency_id));
create policy "invites: staff insert"
  on public.invites for insert to authenticated
  with check (
    public.is_agency_member(agency_id)
    and created_by = auth.uid()
    and (site_id is null or public.site_agency_id(site_id) = agency_id)
  );
create policy "invites: staff delete"
  on public.invites for delete to authenticated
  using (public.is_agency_member(agency_id));

-- publishes: readable by anyone who can edit the site. Rows are written only by
-- the content-publish function through the service role, so the history cannot
-- be forged from a browser.
create policy "publishes: site access read"
  on public.publishes for select to authenticated
  using (public.can_access_site(site_id));

-- change_requests: anyone on the site can read and file; agency staff update.
create policy "change_requests: site access read"
  on public.change_requests for select to authenticated
  using (public.can_access_site(site_id));
create policy "change_requests: site access insert"
  on public.change_requests for insert to authenticated
  with check (public.can_access_site(site_id) and created_by = auth.uid());
create policy "change_requests: staff update"
  on public.change_requests for update to authenticated
  using (public.is_agency_member(public.site_agency_id(site_id)))
  with check (public.is_agency_member(public.site_agency_id(site_id)));

-- change_request_attachments: follow the request.
create policy "change_request_attachments: site access read"
  on public.change_request_attachments for select to authenticated
  using (public.can_access_site(public.request_site_id(request_id)));
create policy "change_request_attachments: site access insert"
  on public.change_request_attachments for insert to authenticated
  with check (public.can_access_site(public.request_site_id(request_id)));
