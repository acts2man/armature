-- =============================================================================
-- Row-level security proof for Armature.
--
-- Plain SQL, no pgTAP: every check is an ASSERT inside a DO block, so it runs in
-- the Supabase SQL editor as well as locally (npm run db:test). Everything is
-- wrapped in one transaction and rolled back, so nothing is left behind.
--
-- Cast: agency X (owner, staff) owns site A (client "ca") and site B (client "cb").
--       agency Y (owner) owns site C (client "cc").
-- Proves: a client of site A cannot read site B; a member of agency X cannot read
-- anything belonging to agency Y; nobody can forge publish rows or invites.
-- =============================================================================
begin;

-- ---------------------------------------------------------------------------
-- Fixtures (as the database owner)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a001', 'x-owner@example.com'),
  ('00000000-0000-0000-0000-00000000a002', 'x-staff@example.com'),
  ('00000000-0000-0000-0000-00000000a003', 'client-a@example.com'),
  ('00000000-0000-0000-0000-00000000a004', 'client-b@example.com'),
  ('00000000-0000-0000-0000-00000000b001', 'y-owner@example.com'),
  ('00000000-0000-0000-0000-00000000b002', 'client-c@example.com');

insert into public.agencies (id, name, portal_name) values
  ('00000000-0000-0000-0000-0000000000aa', 'Agency X', 'X Portal'),
  ('00000000-0000-0000-0000-0000000000bb', 'Agency Y', 'Y Portal');

insert into public.agency_members (agency_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000a001', 'owner'),
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000a002', 'staff'),
  ('00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-00000000b001', 'owner');

insert into public.sites (id, agency_id, name, repo_owner, repo_name, branch, github_installation_id) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000aa', 'Site A', 'acme', 'site-a', 'main', 1),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000aa', 'Site B', 'acme', 'site-b', 'main', 1),
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000bb', 'Site C', 'other', 'site-c', 'main', 2);

insert into public.site_members (site_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000a003', 'client_owner'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000a004', 'client_owner'),
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000b002', 'client_owner');

insert into public.publishes (site_id, user_id, page_slug, status, commit_sha) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000a003', 'home', 'committed', 'aaa'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000a004', 'home', 'committed', 'bbb'),
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000b002', 'home', 'failed', null);

insert into public.change_requests (id, site_id, created_by, title) values
  ('00000000-0000-0000-0000-00000000c00a', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000a003', 'Request on A'),
  ('00000000-0000-0000-0000-00000000c00b', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000a004', 'Request on B'),
  ('00000000-0000-0000-0000-00000000c00c', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000b002', 'Request on C');

insert into public.invites (agency_id, site_id, email, role, token_hash, expires_at, created_by) values
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000000a', 'new-a@example.com', 'client_editor', 'hash-a', now() + interval '7 days', '00000000-0000-0000-0000-00000000a001'),
  ('00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-00000000000c', 'new-c@example.com', 'client_editor', 'hash-c', now() + interval '7 days', '00000000-0000-0000-0000-00000000b001');

insert into public.github_installations (agency_id, installation_id, account_login, account_type, created_by) values
  ('00000000-0000-0000-0000-0000000000aa', 1, 'acme', 'Organization', '00000000-0000-0000-0000-00000000a001'),
  ('00000000-0000-0000-0000-0000000000bb', 2, 'other', 'User', '00000000-0000-0000-0000-00000000b001');

-- The trigger on auth.users should have created a profile for everyone.
do $$ begin
  assert (select count(*) from public.profiles) = 6, 'profiles are created by the auth.users trigger';
end $$;

-- ---------------------------------------------------------------------------
-- 1. Client of site A ("ca")
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a003","role":"authenticated","email":"client-a@example.com"}', true);
set local role authenticated;

do $$ begin
  assert (select count(*) from public.sites) = 1, 'client A sees exactly one site';
  assert (select name from public.sites) = 'Site A', 'client A sees site A only';
  assert (select count(*) from public.sites where id = '00000000-0000-0000-0000-00000000000b') = 0, 'client A cannot read site B';
  assert (select count(*) from public.sites where id = '00000000-0000-0000-0000-00000000000c') = 0, 'client A cannot read site C';

  assert (select count(*) from public.agencies) = 1, 'client A sees only the agency that owns their site';
  assert (select portal_name from public.agencies) = 'X Portal', 'client A sees agency X branding';

  assert (select count(*) from public.agency_members) = 0, 'client A cannot list agency staff';
  assert (select count(*) from public.github_installations) = 0, 'client A cannot see GitHub installations';
  assert (select count(*) from public.invites) = 0, 'client A cannot see invites';

  assert (select count(*) from public.site_members) = 1, 'client A sees only site A memberships';
  assert (select count(*) from public.publishes) = 1, 'client A sees only site A publishes';
  assert (select commit_sha from public.publishes) = 'aaa', 'client A sees the site A publish';
  assert (select count(*) from public.change_requests) = 1, 'client A sees only site A change requests';

  -- Profiles: self and agency X staff, never client B or anyone in agency Y.
  assert (select count(*) from public.profiles where id = '00000000-0000-0000-0000-00000000a003') = 1, 'client A sees own profile';
  assert (select count(*) from public.profiles where id = '00000000-0000-0000-0000-00000000a002') = 1, 'client A sees agency X staff profile';
  assert (select count(*) from public.profiles where id = '00000000-0000-0000-0000-00000000a004') = 0, 'client A cannot see client B profile';
  assert (select count(*) from public.profiles where id = '00000000-0000-0000-0000-00000000b001') = 0, 'client A cannot see agency Y owner profile';
end $$;

-- Client A can file a request on site A...
insert into public.change_requests (site_id, created_by, title)
values ('00000000-0000-0000-0000-00000000000a', auth.uid(), 'Another request on A');

-- ...but not on site B, and cannot pretend to be someone else.
do $$ begin
  begin
    insert into public.change_requests (site_id, created_by, title)
    values ('00000000-0000-0000-0000-00000000000b', auth.uid(), 'Forged request on B');
    raise exception 'client A was able to file a change request on site B';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.change_requests (site_id, created_by, title)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000a002', 'Spoofed author');
    raise exception 'client A was able to file a request as someone else';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.publishes (site_id, user_id, page_slug, status, commit_sha)
    values ('00000000-0000-0000-0000-00000000000a', auth.uid(), 'home', 'committed', 'forged');
    raise exception 'client A was able to forge a publish row';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.site_members (site_id, user_id, role)
    values ('00000000-0000-0000-0000-00000000000b', auth.uid(), 'client_owner');
    raise exception 'client A was able to add themselves to site B';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Updates a client is not allowed to make simply affect zero rows.
update public.change_requests set status = 'done' where id = '00000000-0000-0000-0000-00000000c00a';
do $$ begin
  assert (select status from public.change_requests where id = '00000000-0000-0000-0000-00000000c00a') = 'new',
    'client A cannot change a request status';
end $$;
update public.agencies set accent_color = '#000000';
do $$ begin
  assert (select accent_color from public.agencies) = '#2B3FD6', 'client A cannot change agency settings';
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- 2. Agency X staff
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a002","role":"authenticated","email":"x-staff@example.com"}', true);
set local role authenticated;

do $$ begin
  assert (select count(*) from public.sites) = 2, 'agency X staff see both agency X sites';
  assert (select count(*) from public.sites where agency_id = '00000000-0000-0000-0000-0000000000bb') = 0, 'agency X staff cannot read agency Y sites';
  assert (select count(*) from public.agencies) = 1, 'agency X staff see one agency';
  assert (select count(*) from public.agencies where id = '00000000-0000-0000-0000-0000000000bb') = 0, 'agency X staff cannot read agency Y';
  assert (select count(*) from public.agency_members) = 2, 'agency X staff see agency X members only';
  assert (select count(*) from public.publishes) = 2, 'agency X staff see publishes for A and B only';
  assert (select count(*) from public.change_requests) = 3, 'agency X staff see requests on A (2) and B (1)';
  assert (select count(*) from public.change_requests where site_id = '00000000-0000-0000-0000-00000000000c') = 0, 'agency X staff cannot see site C requests';
  assert (select count(*) from public.invites) = 1, 'agency X staff see agency X invites only';
  assert (select count(*) from public.github_installations) = 1, 'agency X staff see agency X installations only';
  assert (select count(*) from public.site_members) = 2, 'agency X staff see members of A and B';
  assert (select count(*) from public.profiles where id = '00000000-0000-0000-0000-00000000a004') = 1, 'agency X staff can see client B profile';
  assert (select count(*) from public.profiles where id = '00000000-0000-0000-0000-00000000b002') = 0, 'agency X staff cannot see client C profile';
end $$;

-- Staff can work a change request.
update public.change_requests set status = 'in_progress', agency_note = 'On it'
where id = '00000000-0000-0000-0000-00000000c00a';
do $$ begin
  assert (select status from public.change_requests where id = '00000000-0000-0000-0000-00000000c00a') = 'in_progress',
    'agency staff can update a change request';
end $$;

-- Staff can add a site to their agency but not to agency Y.
insert into public.sites (agency_id, name, repo_owner, repo_name, branch, github_installation_id)
values ('00000000-0000-0000-0000-0000000000aa', 'Site D', 'acme', 'site-d', 'main', 1);
do $$ begin
  begin
    insert into public.sites (agency_id, name, repo_owner, repo_name, branch, github_installation_id)
    values ('00000000-0000-0000-0000-0000000000bb', 'Intruder', 'acme', 'intruder', 'main', 1);
    raise exception 'agency X staff were able to create a site inside agency Y';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.invites (agency_id, site_id, email, role, token_hash, expires_at, created_by)
    values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000000c', 'x@example.com', 'client_editor', 'hash-x', now() + interval '1 day', auth.uid());
    raise exception 'agency X staff were able to invite someone to agency Y site C';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.agency_members (agency_id, user_id, role)
    values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000a004', 'staff');
    raise exception 'agency staff (not owner) were able to add agency members';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Staff are not owners: agency settings stay put.
update public.agencies set portal_name = 'Renamed';
do $$ begin
  assert (select portal_name from public.agencies) = 'X Portal', 'agency staff cannot change agency settings';
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- 3. Agency X owner
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated","email":"x-owner@example.com"}', true);
set local role authenticated;

update public.agencies set portal_name = 'X Portal Renamed', accent_color = '#123456';
do $$ begin
  assert (select portal_name from public.agencies where id = '00000000-0000-0000-0000-0000000000aa') = 'X Portal Renamed',
    'agency owner can change agency settings';
  assert (select count(*) from public.agencies) = 1, 'agency X owner still sees exactly one agency';
end $$;
insert into public.agency_members (agency_id, user_id, role)
values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000a004', 'staff');
do $$ begin
  assert (select count(*) from public.agency_members) = 3, 'agency owner can add staff';
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- 4. Agency Y owner sees nothing of agency X
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000b001","role":"authenticated","email":"y-owner@example.com"}', true);
set local role authenticated;

do $$ begin
  assert (select count(*) from public.sites) = 1, 'agency Y owner sees one site';
  assert (select name from public.sites) = 'Site C', 'agency Y owner sees site C';
  assert (select count(*) from public.agencies) = 1 and (select name from public.agencies) = 'Agency Y', 'agency Y owner sees agency Y only';
  assert (select count(*) from public.publishes) = 1, 'agency Y owner sees site C publishes only';
  assert (select count(*) from public.change_requests) = 1, 'agency Y owner sees site C requests only';
  assert (select count(*) from public.invites) = 1, 'agency Y owner sees agency Y invites only';
  assert (select count(*) from public.agency_members where agency_id = '00000000-0000-0000-0000-0000000000aa') = 0, 'agency Y owner cannot list agency X members';
  assert (select count(*) from public.profiles where id = '00000000-0000-0000-0000-00000000a001') = 0, 'agency Y owner cannot see agency X owner profile';
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- 5. Anonymous callers see nothing at all
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
set local role anon;
do $$ begin
  begin
    perform count(*) from public.sites;
    raise exception 'anon was able to query sites';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 6. Storage paths: the site id in the folder decides access
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a003","role":"authenticated","email":"client-a@example.com"}', true);
set local role authenticated;
insert into storage.objects (bucket_id, name, owner)
values ('change-request-attachments', '00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-00000000c00a/shot.webp', auth.uid());
do $$ begin
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('change-request-attachments', '00000000-0000-0000-0000-00000000000b/00000000-0000-0000-0000-00000000c00b/shot.webp', auth.uid());
    raise exception 'client A was able to upload into site B folder';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('change-request-attachments', 'not-a-uuid/shot.webp', auth.uid());
    raise exception 'client A was able to upload outside a site folder';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from storage.objects) = 1, 'client A reads only site A attachments';
end $$;
reset role;

-- The trigger on publishes stamps the site.
do $$ begin
  assert (select last_published_at from public.sites where id = '00000000-0000-0000-0000-00000000000a') is not null,
    'a committed publish stamps sites.last_published_at';
  assert (select last_published_at from public.sites where id = '00000000-0000-0000-0000-00000000000c') is null,
    'a failed publish does not stamp the site';
end $$;

select 'rls.test.sql: all assertions passed' as result;
rollback;
