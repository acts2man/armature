-- =============================================================================
-- Armature — kit versioning. Track each site's copy of the kit and record every
-- one-click update.
--
-- sites.kit_path: where the kit folder lives in the site's repo (default
-- src/lib/armature-kit). Agency staff can correct it if the site's developer
-- put it somewhere else. Nothing else about the site changes.
--
-- kit_updates: one row per successful "Update kit" run. Kept forever so the
-- Site settings history tab can show what changed and when.
-- =============================================================================

alter table public.sites
  add column if not exists kit_path text not null default 'src/lib/armature-kit'
    check (kit_path ~ '^[A-Za-z0-9._/-]+$' and length(kit_path) between 1 and 200);

create table public.kit_updates (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  from_version text not null check (char_length(from_version) between 0 and 40),
  to_version text not null check (char_length(to_version) between 1 and 40),
  commit_sha text check (commit_sha is null or commit_sha ~ '^[0-9a-f]{7,40}$'),
  commit_url text check (commit_url is null or commit_url ~ '^https://'),
  requested_by uuid references auth.users (id) on delete set null,
  status text not null default 'commit_pushed'
    check (status in ('commit_pushed', 'live_confirmed', 'needs_attention', 'undo')),
  status_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index kit_updates_site_idx on public.kit_updates (site_id, created_at desc);

alter table public.kit_updates enable row level security;
revoke all on public.kit_updates from anon;

-- Agency staff and the site's members can read the history; only agency staff
-- write (the client never calls this table directly, but Armature's update
-- function does via service_role, which bypasses RLS).
create policy "kit_updates: site access read"
  on public.kit_updates for select to authenticated
  using (public.can_access_site(site_id));
create policy "kit_updates: agency staff write"
  on public.kit_updates for all to authenticated
  using (
    public.can_access_site(site_id)
    and public.is_agency_member(public.site_agency_id(site_id))
  )
  with check (
    public.can_access_site(site_id)
    and public.is_agency_member(public.site_agency_id(site_id))
  );

comment on column public.sites.kit_path is 'Path inside the site''s repo where the Armature kit folder lives (default src/lib/armature-kit).';
comment on table public.kit_updates is 'Audit trail of one-click kit updates. Agency staff and site members read; agency staff (and the update-kit function under service_role) write.';
