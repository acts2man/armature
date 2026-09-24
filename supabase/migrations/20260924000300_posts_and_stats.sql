-- =============================================================================
-- Armature — Posts (the blog) and Stats (visitor numbers).
--
-- Posts:
--   - scheduled_posts holds a row per post whose publishedAt is in the future.
--     A pg_cron job fires the run-scheduled-posts edge function every 5 minutes
--     (scheduled separately, in the follow-up migration that enables pg_net and
--     the Vault-based caller token, so this migration stays SQL-only and stores
--     no secrets), which picks any row whose fire_at has arrived and asks
--     builder-publish to rewrite the post file (identical bytes, just committed
--     now so Netlify rebuilds and the site starts showing it). The row is
--     deleted after.
--
-- Stats:
--   - site_stats_events (raw, short-lived): every accepted beacon lands here.
--   - site_stats_daily (long-lived rollup): one row per site per day.
--   - site_stats_ip_hashes (day-rotating salted hash for unique-visitor counting).
--   - A pg_cron job rolls raw events up nightly and prunes raw events older
--     than 30 days.
-- =============================================================================

-- --- Posts scheduled publishing ---------------------------------------------
create table public.scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  post_slug text not null check (post_slug ~ '^[a-z0-9][a-z0-9-]{0,80}$'),
  fire_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  unique (site_id, post_slug)
);
create index scheduled_posts_fire_at_idx on public.scheduled_posts (fire_at);

alter table public.scheduled_posts enable row level security;
revoke all on public.scheduled_posts from anon;

create policy "scheduled_posts: site access read"
  on public.scheduled_posts for select to authenticated
  using (public.can_access_site(site_id));
create policy "scheduled_posts: site access write"
  on public.scheduled_posts for all to authenticated
  using (public.can_access_site(site_id))
  with check (public.can_access_site(site_id));

-- --- Stats: raw events, salted ip hashes, daily rollup -------------------------

create table public.site_stats_events (
  id bigserial primary key,
  site_id uuid not null references public.sites (id) on delete cascade,
  received_at timestamptz not null default now(),
  path text not null check (char_length(path) <= 512),
  referrer_host text check (referrer_host is null or char_length(referrer_host) <= 200),
  device text check (device is null or device in ('mobile', 'tablet', 'desktop', 'bot', 'unknown')),
  screen_bucket text check (screen_bucket is null or screen_bucket in ('xs', 'sm', 'md', 'lg', 'xl')),
  visitor_hash text check (visitor_hash is null or char_length(visitor_hash) <= 64)
);
create index site_stats_events_site_time_idx on public.site_stats_events (site_id, received_at desc);

alter table public.site_stats_events enable row level security;
revoke all on public.site_stats_events from anon;

-- Rows are visible to the site's members and agency staff.
create policy "site_stats_events: site access read"
  on public.site_stats_events for select to authenticated
  using (public.can_access_site(site_id));
-- Only the edge function's service role writes here; deny direct writes.
create policy "site_stats_events: no client writes"
  on public.site_stats_events for insert to authenticated
  with check (false);
create policy "site_stats_events: no client updates"
  on public.site_stats_events for update to authenticated
  using (false);

create table public.site_stats_daily (
  site_id uuid not null references public.sites (id) on delete cascade,
  day date not null,
  visitors integer not null default 0,
  page_views integer not null default 0,
  top_pages jsonb not null default '[]',
  top_referrers jsonb not null default '[]',
  top_devices jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  primary key (site_id, day)
);
create index site_stats_daily_site_day_idx on public.site_stats_daily (site_id, day desc);

alter table public.site_stats_daily enable row level security;
revoke all on public.site_stats_daily from anon;

create policy "site_stats_daily: site access read"
  on public.site_stats_daily for select to authenticated
  using (public.can_access_site(site_id));
create policy "site_stats_daily: no client writes"
  on public.site_stats_daily for insert to authenticated
  with check (false);
create policy "site_stats_daily: no client updates"
  on public.site_stats_daily for update to authenticated
  using (false);

-- The nightly rollup: read yesterday's raw events, compute totals, upsert the day row,
-- then delete raw events older than 30 days. security definer runs it as the owner so
-- the pg_cron job (which runs as postgres) can call it; execute is revoked from every
-- caller role so no client can invoke it via RPC.
create or replace function public.rollup_site_stats_daily()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d date := (now() at time zone 'utc')::date - 1;
begin
  insert into public.site_stats_daily (site_id, day, visitors, page_views, top_pages, top_referrers, top_devices, updated_at)
  select
    site_id,
    d as day,
    count(distinct visitor_hash) filter (where visitor_hash is not null) as visitors,
    count(*) as page_views,
    (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select path, count(*)::int as views
        from public.site_stats_events e2
        where e2.site_id = e.site_id and e2.received_at >= d and e2.received_at < d + interval '1 day'
        group by path
        order by views desc
        limit 20
      ) t
    ) as top_pages,
    (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select coalesce(referrer_host, 'direct') as referrer, count(*)::int as views
        from public.site_stats_events e2
        where e2.site_id = e.site_id and e2.received_at >= d and e2.received_at < d + interval '1 day'
        group by referrer
        order by views desc
        limit 20
      ) t
    ) as top_referrers,
    (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select coalesce(device, 'unknown') as device, count(*)::int as views
        from public.site_stats_events e2
        where e2.site_id = e.site_id and e2.received_at >= d and e2.received_at < d + interval '1 day'
        group by device
        order by views desc
        limit 10
      ) t
    ) as top_devices,
    now()
  from public.site_stats_events e
  where e.received_at >= d and e.received_at < d + interval '1 day'
  group by site_id
  on conflict (site_id, day) do update
    set visitors = excluded.visitors,
        page_views = excluded.page_views,
        top_pages = excluded.top_pages,
        top_referrers = excluded.top_referrers,
        top_devices = excluded.top_devices,
        updated_at = now();

  delete from public.site_stats_events where received_at < now() - interval '30 days';
end
$$;

revoke execute on function public.rollup_site_stats_daily() from public;
revoke execute on function public.rollup_site_stats_daily() from anon, authenticated;

-- --- pg_cron: the nightly rollup only. The scheduled-posts fire schedule ships in
-- the follow-up migration (20260924000400_scheduled_posts_dispatch.sql), which
-- enables pg_net and stores the caller token in Supabase Vault. Nothing about
-- scheduled-post firing depends on this key/value table, so no secrets go here.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'armature-rollup-stats',
      '15 2 * * *',
      'select public.rollup_site_stats_daily()'
    );
  end if;
end $$;

-- A tiny key/value table kept for internal knobs the app or future migrations
-- may need. RLS is on and every caller role is revoked, so only postgres and
-- the service role reach it. It ships empty: no secrets are stored here.
create table if not exists public.armature_settings (
  key text primary key,
  value text not null
);
alter table public.armature_settings enable row level security;
revoke all on public.armature_settings from anon, authenticated;
