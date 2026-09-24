-- =============================================================================
-- Armature — the "needs_setup" site status.
--
-- Before this migration a site could only be saved once its repository was
-- fully wired up (schema.json, pages.json and the kit all present). That meant
-- a new client's repo could not be connected at all until a one-time setup was
-- done, and the setup step lived outside Armature.
--
-- The needs_setup status closes that gap: a repository whose GitHub App checks
-- all pass but whose Armature files are missing is saved with status
-- 'needs_setup' so the agency can see it under Projects, open its Dashboard,
-- and use the in-app Set up this site flow (which now works on a test-copy
-- branch, then Go live merges it into the connected branch). Once the setup
-- lands on the connected branch, kit-status flips the site to 'connected'.
--
-- Idempotent: safe to run more than once.
-- =============================================================================

alter type public.site_status add value if not exists 'needs_setup';

-- The connected-have-repo constraint added in 20260922000100_hosting_and_services.sql
-- has to know about the new status too, so a needs_setup site is refused if it
-- has no repository (the flow only ever creates one via site-connect, which
-- always carries the repo record).
alter table public.sites drop constraint if exists sites_connected_have_repo;
alter table public.sites add constraint sites_connected_have_repo check (
  status not in ('connected', 'needs_attention', 'needs_setup')
  or (
    repo_owner is not null
    and repo_name is not null
    and branch is not null
    and github_installation_id is not null
  )
);
