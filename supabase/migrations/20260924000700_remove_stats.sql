-- =============================================================================
-- Armature — remove visitor stats (Troy decided he doesn't want them; may add
-- them back later). This migration:
--   1. Unschedules the armature-rollup-stats cron job if it is present.
--   2. Drops the rollup function and the two stats tables (site_stats_daily
--      and site_stats_events).
--   3. Leaves pg_cron, pg_net, the scheduled-posts cron job and the Vault
--      token from earlier migrations exactly as they are.
-- =============================================================================

-- 1. Unschedule the rollup job if the cron schema exists.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron')
     and to_regclass('cron.job') is not null
  then
    perform cron.unschedule(jobid) from cron.job where jobname = 'armature-rollup-stats';
  end if;
end $$;

-- 2. Drop the rollup function and the tables.
drop function if exists public.rollup_site_stats_daily();
drop table if exists public.site_stats_daily;
drop table if exists public.site_stats_events;

-- 3. armature_settings stays untouched.
comment on table public.armature_settings is 'Kept for future internal knobs. RLS on; every caller role is revoked so only postgres and the service role reach it. Empty by default.';
