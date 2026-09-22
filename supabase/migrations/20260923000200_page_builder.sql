-- =============================================================================
-- Armature — the page builder: editing levels, server drafts and templates.
--
-- Apply after 20260923000100_forms.sql (docs/SETUP.md, part A).
--
-- 1. sites.editing_level: what a site's clients may do in the visual editor.
--    'content' (the default, Stage 1: words and pictures), 'style' (content and the
--    Style tab and site settings), 'builder' (everything, including structure).
--    Agency staff always build. Only agency staff change it (the sites update policy).
-- 2. builder_drafts: one draft per site per person, autosaved by the editor. The
--    person reads and writes their own; agency staff of the site's agency may read
--    (to help) and delete; nobody else sees it.
-- 3. builder_templates: saved sections and pages, per site or agency-wide. Agency
--    staff manage them all; a client member of a site reads that site's templates and
--    the agency-wide ones, and may save and delete their own site templates.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Editing levels
-- ---------------------------------------------------------------------------
alter table public.sites
  add column if not exists editing_level text not null default 'content'
  check (editing_level in ('content', 'style', 'builder'));

-- ---------------------------------------------------------------------------
-- 2. Drafts
-- ---------------------------------------------------------------------------
create table public.builder_drafts (
  site_id uuid not null references public.sites (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The serialized editor draft (content fields, layouts, kit, media, pages).
  draft jsonb not null check (jsonb_typeof(draft) = 'object' and octet_length(draft::text) <= 5242880),
  -- The commit the draft was made against, so a restore can tell when the site moved on.
  base_commit text check (base_commit is null or base_commit ~ '^[0-9a-f]{7,40}$'),
  change_count integer not null default 0 check (change_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (site_id, user_id)
);

create trigger builder_drafts_touch
  before update on public.builder_drafts
  for each row execute function public.touch_updated_at();

alter table public.builder_drafts enable row level security;

create policy "builder_drafts: own or agency staff read"
  on public.builder_drafts for select to authenticated
  using (
    (user_id = auth.uid() and public.can_access_site(site_id))
    or public.is_agency_member(public.site_agency_id(site_id))
  );

create policy "builder_drafts: own insert"
  on public.builder_drafts for insert to authenticated
  with check (user_id = auth.uid() and public.can_access_site(site_id));

create policy "builder_drafts: own update"
  on public.builder_drafts for update to authenticated
  using (user_id = auth.uid() and public.can_access_site(site_id))
  with check (user_id = auth.uid() and public.can_access_site(site_id));

create policy "builder_drafts: own or agency staff delete"
  on public.builder_drafts for delete to authenticated
  using (
    (user_id = auth.uid() and public.can_access_site(site_id))
    or public.is_agency_member(public.site_agency_id(site_id))
  );

-- ---------------------------------------------------------------------------
-- 3. Templates
-- ---------------------------------------------------------------------------
create table public.builder_templates (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  -- Null: agency-wide (agency staff only). Set: this site's template.
  site_id uuid references public.sites (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  kind text not null check (kind in ('section', 'page')),
  -- A section: one element tree. A page: { root: Element[], label?, seo?, pageSettings? }.
  content jsonb not null check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 1048576),
  element_count integer not null default 0 check (element_count >= 0),
  first_heading text check (first_heading is null or char_length(first_heading) <= 200),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index builder_templates_agency_idx on public.builder_templates (agency_id, created_at desc);
create index builder_templates_site_idx on public.builder_templates (site_id) where site_id is not null;

-- A site template must belong to the site's own agency.
create or replace function public.builder_templates_check_agency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.site_id is not null and public.site_agency_id(new.site_id) is distinct from new.agency_id then
    raise exception 'a site template must belong to the site''s agency' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger builder_templates_agency
  before insert or update on public.builder_templates
  for each row execute function public.builder_templates_check_agency();

alter table public.builder_templates enable row level security;

create policy "builder_templates: staff and site members read"
  on public.builder_templates for select to authenticated
  using (
    public.is_agency_member(agency_id)
    or (site_id is not null and public.is_site_member(site_id))
    or (site_id is null and public.is_client_of_agency(agency_id))
  );

create policy "builder_templates: staff or site members insert"
  on public.builder_templates for insert to authenticated
  with check (
    created_by = auth.uid()
    and (
      public.is_agency_member(agency_id)
      or (site_id is not null and public.is_site_member(site_id))
    )
  );

create policy "builder_templates: staff update"
  on public.builder_templates for update to authenticated
  using (public.is_agency_member(agency_id))
  with check (public.is_agency_member(agency_id));

create policy "builder_templates: staff or own site template delete"
  on public.builder_templates for delete to authenticated
  using (
    public.is_agency_member(agency_id)
    or (site_id is not null and created_by = auth.uid() and public.is_site_member(site_id))
  );

-- Visitors who are not signed in never reach drafts or templates.
revoke all on public.builder_drafts from anon;
revoke all on public.builder_templates from anon;
