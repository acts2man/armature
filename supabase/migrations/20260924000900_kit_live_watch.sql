-- =============================================================================
-- Armature — the live-version watch after an Update kit or Undo commit.
--
-- After update-kit (or undo-kit-update) pushes a commit, Netlify rebuilds the
-- site. The rebuild takes anywhere from thirty seconds to a few minutes; then
-- the new HTML carries the new data-armature-kit attribute. Until it does, the
-- kit_updates row sits in status 'commit_pushed' (or 'undo_pushed').
--
-- A pg_cron job runs every two minutes and calls the check-kit-live edge
-- function, which:
--   - Picks up every pending kit_updates row created within the last 15 minutes.
--   - Fetches each site's live URL and reads its data-armature-kit.
--   - If it matches the target version, flips the row to 'live_confirmed' (or
--     'undo_confirmed' for undo rows) and updates sites.kit_version_live.
--   - If the row is older than 15 minutes and still not confirmed, flips it to
--     'needs_attention' with a plain-English reason ("The site did not rebuild.
--     Netlify may have failed the build; your old version is still live. Open
--     Netlify to see why.").
--
-- The cron job authenticates with the same Vault-token pattern the scheduled
-- posts dispatcher uses (see 20260924000400_scheduled_posts_dispatch.sql):
--   1. pg_net enabled;
--   2. a random 32-byte token minted once and stored in Supabase Vault;
--   3. a security-definer verifier the function calls via RPC;
--   4. cron.schedule reads the token from Vault at fire time and sends it as
--      X-Armature-Token.
--
-- Everything is guarded, so applying this on a database that lacks pg_cron,
-- pg_net or supabase_vault leaves the feature inert but the migration succeeds.
-- Idempotent: safe to re-apply.
-- =============================================================================

-- 1. pg_net (may fail on the local shim; that just means the watch is inert).
do $$
begin
  begin
    execute 'create extension if not exists pg_net';
  exception when others then
    raise notice 'pg_net is not available in this environment; kit-live watch is inert until it is enabled.';
  end;
end $$;

-- 2. Vault token, minted once.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'vault')
     and to_regclass('vault.secrets') is not null
  then
    if not exists (select 1 from vault.secrets where name = 'armature_check_kit_live_token') then
      perform vault.create_secret(
        encode(gen_random_bytes(32), 'base64'),
        'armature_check_kit_live_token',
        'The token pg_cron sends to check-kit-live; verified against Vault by the function.'
      );
    end if;
  else
    raise notice 'supabase_vault is not available in this environment; kit-live watch will not have a token to send until it is.';
  end if;
end $$;

-- 3. Verifier (service_role only).
create or replace function public.armature_check_kit_live_token(candidate text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  stored text;
begin
  if candidate is null or length(candidate) = 0 then return false; end if;
  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = ''armature_check_kit_live_token'' limit 1'
      into stored;
  exception when undefined_table or invalid_schema_name or undefined_object or undefined_function then
    return false;
  end;
  if stored is null or length(stored) = 0 then return false; end if;
  return candidate = stored;
end;
$fn$;

revoke execute on function public.armature_check_kit_live_token(text) from public;
revoke execute on function public.armature_check_kit_live_token(text) from anon, authenticated;
grant  execute on function public.armature_check_kit_live_token(text) to service_role;

-- 4. Schedule the cron job. Runs every two minutes and calls check-kit-live with
--    the Vault token in a header. Idempotent: any existing job with this name
--    is removed first so the migration can be re-applied cleanly.
do $$
declare
  cron_ok boolean := exists (select 1 from pg_extension where extname = 'pg_cron');
  net_ok  boolean := exists (select 1 from pg_extension where extname = 'pg_net');
begin
  if cron_ok and net_ok then
    perform cron.unschedule(jobid) from cron.job where jobname = 'armature-check-kit-live';
    perform cron.schedule(
      'armature-check-kit-live',
      '*/2 * * * *',
      $body$
      select net.http_post(
        url := public.armature_project_url() || '/functions/v1/check-kit-live',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'X-Armature-Token', (select decrypted_secret from vault.decrypted_secrets where name = 'armature_check_kit_live_token' limit 1)
        ),
        body := '{}'::jsonb
      );
      $body$
    );
  else
    raise notice 'pg_cron or pg_net is missing; armature-check-kit-live was not scheduled. Enable both extensions and re-run this migration.';
  end if;
end $$;
