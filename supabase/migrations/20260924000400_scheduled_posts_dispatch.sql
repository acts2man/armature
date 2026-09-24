-- =============================================================================
-- Armature — scheduled posts dispatch, without ever storing the service role key.
--
-- The pg_cron job that fires scheduled posts every 5 minutes used to authenticate
-- itself by sending the project's service_role_key as an Authorization header,
-- which required the key to sit in a plain table. That is out.
--
-- Instead:
--   1. Enable pg_net so Postgres can reach edge functions.
--   2. Mint a random 32-byte token once, stored ENCRYPTED in Supabase Vault
--      (never in a plain table). The migration only reads the value it just
--      minted so no secret is exposed in the SQL editor.
--   3. Register a security-definer verifier the edge function calls via RPC.
--      Only service_role has execute; the function itself compares the caller's
--      token against the Vault value and returns a boolean.
--   4. Schedule a cron job that reads the token from Vault at fire time and
--      calls run-scheduled-posts, sending the token in the X-Armature-Token
--      header. The edge function turns off gateway JWT verification and rejects
--      any request that does not carry the correct token.
--
-- The function URL is built from the project's own URL via a helper. Supabase
-- Pro projects expose `app.settings.supabase_url` as a database GUC; on projects
-- where Vault seeds a `project_url` (or `supabase_url`) secret, the helper reads
-- that instead. Nothing is pasted by hand; the migration works with SQL alone.
-- =============================================================================

-- 1. Enable pg_net (guarded so a runtime without it — e.g. the local shim used by
--    db-test.sh — does not fail the whole migration; the schedule block below is
--    then also inert).
do $$
begin
  begin
    execute 'create extension if not exists pg_net';
  exception when others then
    raise notice 'pg_net is not available in this environment; scheduled-posts dispatch is inert until it is enabled.';
  end;
end $$;

-- 2. Mint the random Vault token once, if Vault is present. Idempotent: a second
--    run of the migration keeps the existing value.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'vault')
     and to_regclass('vault.secrets') is not null
  then
    if not exists (select 1 from vault.secrets where name = 'armature_scheduled_posts_token') then
      perform vault.create_secret(
        encode(gen_random_bytes(32), 'base64'),
        'armature_scheduled_posts_token',
        'The token pg_cron sends to run-scheduled-posts; verified by the function against Vault.'
      );
    end if;
  else
    raise notice 'supabase_vault is not available in this environment; scheduled-posts dispatch will not have a token to send until it is.';
  end if;
end $$;

-- 3. The token verifier. security definer so it reads Vault as the owner; only
--    service_role may call it, and the edge function does so via RPC.
create or replace function public.armature_check_scheduled_posts_token(candidate text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  stored text;
begin
  if candidate is null or length(candidate) = 0 then return false; end if;
  -- Vault might not be installed on the local db-test shim; guard the lookup so
  -- the function can be created and revoke/grant executed without erroring.
  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = ''armature_scheduled_posts_token'' limit 1'
      into stored;
  exception when undefined_table or invalid_schema_name or undefined_object or undefined_function then
    return false;
  end;
  if stored is null or length(stored) = 0 then return false; end if;
  return candidate = stored;
end;
$fn$;

revoke execute on function public.armature_check_scheduled_posts_token(text) from public;
revoke execute on function public.armature_check_scheduled_posts_token(text) from anon, authenticated;
grant  execute on function public.armature_check_scheduled_posts_token(text) to service_role;

-- 4. The project URL helper. Reads Supabase's own GUC first, then a Vault entry
--    that many Pro projects seed automatically when Cron is enabled. If neither
--    is available the function raises with a one-line fix; the migration itself
--    does not fail, so applying it is safe even before the URL is discoverable.
create or replace function public.armature_project_url()
returns text
language plpgsql
stable
as $fn$
declare
  url text;
begin
  url := nullif(current_setting('app.settings.supabase_url', true), '');
  if url is null or url = '' then
    url := nullif(current_setting('supabase.settings.supabase_url', true), '');
  end if;
  if (url is null or url = '')
     and exists (select 1 from pg_namespace where nspname = 'vault')
     and to_regclass('vault.decrypted_secrets') is not null
  then
    begin
      execute 'select decrypted_secret from vault.decrypted_secrets where name in (''project_url'', ''supabase_url'') limit 1'
        into url;
    exception when undefined_table or invalid_schema_name then
      url := null;
    end;
  end if;
  if url is null or url = '' then
    raise exception 'armature_project_url(): the Supabase project URL is not available. Set it once with `select vault.create_secret(''https://<project-ref>.supabase.co'', ''project_url'')` (a one-line fix, using Vault so nothing is stored in a plain table).';
  end if;
  return rtrim(url, '/');
end;
$fn$;

revoke execute on function public.armature_project_url() from public;
grant  execute on function public.armature_project_url() to service_role, authenticated;

-- 5. Schedule the cron job. Runs every 5 minutes and calls run-scheduled-posts
--    with the Vault token in a header. Idempotent: any existing job with this
--    name is removed first so the migration can be re-applied cleanly.
do $$
declare
  cron_ok boolean := exists (select 1 from pg_extension where extname = 'pg_cron');
  net_ok  boolean := exists (select 1 from pg_extension where extname = 'pg_net');
begin
  if cron_ok and net_ok then
    perform cron.unschedule(jobid) from cron.job where jobname = 'armature-run-scheduled-posts';
    perform cron.schedule(
      'armature-run-scheduled-posts',
      '*/5 * * * *',
      $body$
      select net.http_post(
        url := public.armature_project_url() || '/functions/v1/run-scheduled-posts',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'X-Armature-Token', (select decrypted_secret from vault.decrypted_secrets where name = 'armature_scheduled_posts_token' limit 1)
        ),
        body := '{}'::jsonb
      );
      $body$
    );
  else
    raise notice 'pg_cron or pg_net is missing; armature-run-scheduled-posts was not scheduled. Enable both extensions and re-run this migration.';
  end if;
end $$;
