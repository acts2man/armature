-- =============================================================================
-- Armature — per-agency Getting Started progress and video overrides.
--
-- Before this migration, the /getting-started guide kept its ticked-off state
-- and any 'Use my own video' link in localStorage. That meant every browser
-- started over, and a staff member on a second laptop saw no progress.
--
-- This table stores both per agency, so every member of an agency sees the
-- same progress and the same overrides. The columns are jsonb keyed by the
-- section key (one of the seven known keys in src/lib/gettingStartedContent.ts);
-- the edge function agency-getting-started validates the keys before writing.
--
-- RLS: only members of the agency can read or write their own row. Nothing
-- else in the app depends on this table, so a fresh project without the
-- migration still runs (the UI falls back to localStorage).
-- =============================================================================

create table public.agency_getting_started (
  agency_id uuid primary key references public.agencies (id) on delete cascade,
  -- { "<section-key>": true, ... } — only sections marked done are stored.
  progress jsonb not null default '{}'::jsonb check (jsonb_typeof(progress) = 'object'),
  -- { "<section-key>": "<url>" } — only overridden sections are stored.
  video_overrides jsonb not null default '{}'::jsonb check (jsonb_typeof(video_overrides) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.agency_getting_started is
  'Per-agency Getting Started guide state: which sections are marked done, and any custom video URL that replaces the default walkthrough for a section.';
comment on column public.agency_getting_started.progress is
  'JSON object keyed by section key (one of the seven known keys). true means the agency has marked that section done.';
comment on column public.agency_getting_started.video_overrides is
  'JSON object keyed by section key with a YouTube / Vimeo / Loom / Wistia URL the agency has pasted in the "Use my own video" field.';

-- Keep updated_at fresh on every write, without depending on the edge
-- function to remember to send it.
create or replace function public.touch_agency_getting_started()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger agency_getting_started_touch
before update on public.agency_getting_started
for each row execute function public.touch_agency_getting_started();

alter table public.agency_getting_started enable row level security;
revoke all on public.agency_getting_started from anon;

-- Every member of the agency (owner or staff) may read and write their
-- agency's row. Nobody else sees it.
create policy "agency_getting_started: agency member read"
  on public.agency_getting_started for select to authenticated
  using (public.is_agency_member(agency_id));

create policy "agency_getting_started: agency member insert"
  on public.agency_getting_started for insert to authenticated
  with check (public.is_agency_member(agency_id));

create policy "agency_getting_started: agency member update"
  on public.agency_getting_started for update to authenticated
  using (public.is_agency_member(agency_id))
  with check (public.is_agency_member(agency_id));

create policy "agency_getting_started: agency member delete"
  on public.agency_getting_started for delete to authenticated
  using (public.is_agency_member(agency_id));
