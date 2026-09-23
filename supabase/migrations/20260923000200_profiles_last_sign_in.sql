-- =============================================================================
-- Armature — "Last login" on the Users screen.
--
-- Apply after 20260923000100_forms.sql (docs/SETUP.md, part A).
--
-- profiles.last_sign_in_at mirrors auth.users.last_sign_in_at, kept in step by a trigger,
-- so the dashboard (which reads profiles under RLS) can show when a person last signed in
-- without any access to the auth schema. Until this migration is applied the column is
-- missing and the Users screen shows "—".
-- =============================================================================

alter table public.profiles
  add column if not exists last_sign_in_at timestamptz;

create or replace function public.sync_profile_last_sign_in()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set last_sign_in_at = new.last_sign_in_at
   where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_signed_in on auth.users;
create trigger on_auth_user_signed_in
  after update of last_sign_in_at on auth.users
  for each row
  when (old.last_sign_in_at is distinct from new.last_sign_in_at)
  execute function public.sync_profile_last_sign_in();

-- Backfill what is already known.
update public.profiles p
   set last_sign_in_at = u.last_sign_in_at
  from auth.users u
 where u.id = p.id
   and p.last_sign_in_at is distinct from u.last_sign_in_at;
