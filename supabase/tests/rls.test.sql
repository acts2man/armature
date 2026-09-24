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
-- anything belonging to agency Y; nobody can forge publish rows or invites; and
-- site_services (what the agency charges) is invisible to clients and to other
-- agencies. Site D is hosting-only (no repository) to exercise those rules too.
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

-- A hosting-only site: no repository yet.
insert into public.sites (id, agency_id, name, status, live_url) values
  ('00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-0000000000aa', 'Site D (hosting only)', 'hosting_only', 'https://d.example.com');

-- The shape rules for sites: a connected site must carry its repository, and a
-- repository can be connected only once, while hosting-only sites are unlimited.
do $$ begin
  begin
    insert into public.sites (agency_id, name, status) values ('00000000-0000-0000-0000-0000000000aa', 'Half connected', 'connected');
    raise exception 'a connected site without a repository was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.sites (agency_id, name, repo_owner, repo_name, branch, github_installation_id)
    values ('00000000-0000-0000-0000-0000000000aa', 'Duplicate of A', 'acme', 'site-a', 'main', 1);
    raise exception 'the same repository and branch was connected twice';
  exception when unique_violation then null;
  end;
  insert into public.sites (agency_id, name, status) values ('00000000-0000-0000-0000-0000000000aa', 'Another hosting-only', 'hosting_only');
end $$;
delete from public.sites where name = 'Another hosting-only';

insert into public.site_services (site_id, hosting_provider, hosting_annual_fee_cents, hosting_renewal_date,
  domain_name, domain_annual_fee_cents, domain_renewal_date, email_provider, email_mailboxes, email_pricing, email_annual_fee_cents) values
  ('00000000-0000-0000-0000-00000000000a', 'Netlify', 20000, current_date + 40, 'site-a.example.com', 1800, current_date + 10, 'google_workspace', 4, 'per_mailbox', 3000),
  ('00000000-0000-0000-0000-00000000000d', 'Netlify', 12000, current_date - 3, null, null, null, 'none', null, 'flat', 0),
  ('00000000-0000-0000-0000-00000000000c', 'Vercel', 5000, current_date + 100, null, null, null, null, null, null, null);

-- The billing view does the arithmetic: hosting + domain + mailboxes x price, and
-- the earliest renewal today or later (a past one is reported separately).
do $$ begin
  assert (select yearly_total_cents from public.site_billing where site_id = '00000000-0000-0000-0000-00000000000a') = 20000 + 1800 + 4 * 3000,
    'site_billing sums hosting, domain and per-mailbox email';
  assert (select next_renewal_date from public.site_billing where site_id = '00000000-0000-0000-0000-00000000000a') = current_date + 10,
    'site_billing picks the earliest future renewal';
  assert (select overdue_renewal_date from public.site_billing where site_id = '00000000-0000-0000-0000-00000000000a') is null,
    'site A has no overdue renewal';
  assert (select next_renewal_date from public.site_billing where site_id = '00000000-0000-0000-0000-00000000000d') is null,
    'site D has no future renewal';
  assert (select overdue_renewal_date from public.site_billing where site_id = '00000000-0000-0000-0000-00000000000d') = current_date - 3,
    'site D reports its lapsed renewal';
  assert (select yearly_total_cents from public.site_billing where site_id = '00000000-0000-0000-0000-00000000000d') = 12000,
    'a flat email fee of zero adds nothing';
end $$;

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
do $$ begin perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a003","role":"authenticated","email":"client-a@example.com"}', true); end $$;
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

  -- Services and prices stay with the agency: a client reads nothing, not even for their own site.
  assert (select count(*) from public.site_services) = 0, 'client A cannot read site_services (not even site A)';
  assert (select count(*) from public.site_billing) = 0, 'client A cannot read site_billing';

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
  begin
    insert into public.site_services (site_id, hosting_provider) values ('00000000-0000-0000-0000-00000000000a', 'Forged');
    raise exception 'client A was able to write site_services for their own site';
  exception when insufficient_privilege then null;
  end;
end $$;

-- A client cannot change prices either: the update matches no rows.
update public.site_services set hosting_annual_fee_cents = 1 where site_id = '00000000-0000-0000-0000-00000000000a';

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
do $$ begin perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a002","role":"authenticated","email":"x-staff@example.com"}', true); end $$;
set local role authenticated;

do $$ begin
  assert (select count(*) from public.sites) = 3, 'agency X staff see all three agency X sites, hosting-only included';
  assert (select status from public.sites where id = '00000000-0000-0000-0000-00000000000d') = 'hosting_only', 'agency X staff see the hosting-only site';
  assert (select count(*) from public.site_services) = 2, 'agency X staff see services for A and D only';
  assert (select count(*) from public.site_services where site_id = '00000000-0000-0000-0000-00000000000c') = 0, 'agency X staff cannot read site C services';
  assert (select count(*) from public.site_billing) = 2, 'agency X staff see billing for A and D only';
  assert (select hosting_annual_fee_cents from public.site_services where site_id = '00000000-0000-0000-0000-00000000000a') = 20000, 'the client update above changed nothing';
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

-- Staff keep the services record: edit A, create one for B, never for C.
update public.site_services set hosting_annual_fee_cents = 24000 where site_id = '00000000-0000-0000-0000-00000000000a';
insert into public.site_services (site_id, hosting_provider, hosting_annual_fee_cents) values ('00000000-0000-0000-0000-00000000000b', 'Netlify', 9900);
do $$ begin
  assert (select hosting_annual_fee_cents from public.site_services where site_id = '00000000-0000-0000-0000-00000000000a') = 24000, 'agency staff can update site_services';
  assert (select yearly_total_cents from public.site_billing where site_id = '00000000-0000-0000-0000-00000000000a') = 24000 + 1800 + 4 * 3000, 'site_billing follows the update';
  assert (select count(*) from public.site_services) = 3, 'agency staff can create a services row for their own site';
  begin
    insert into public.site_services (site_id, hosting_provider) values ('00000000-0000-0000-0000-00000000000c', 'Intruder');
    raise exception 'agency X staff were able to write services for agency Y site C';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Staff can add a site to their agency but not to agency Y.
insert into public.sites (agency_id, name, repo_owner, repo_name, branch, github_installation_id)
values ('00000000-0000-0000-0000-0000000000aa', 'Site E', 'acme', 'site-e', 'main', 1);
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
do $$ begin perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated","email":"x-owner@example.com"}', true); end $$;
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
do $$ begin perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000b001","role":"authenticated","email":"y-owner@example.com"}', true); end $$;
set local role authenticated;

do $$ begin
  assert (select count(*) from public.sites) = 1, 'agency Y owner sees one site';
  assert (select name from public.sites) = 'Site C', 'agency Y owner sees site C';
  assert (select count(*) from public.agencies) = 1 and (select name from public.agencies) = 'Agency Y', 'agency Y owner sees agency Y only';
  assert (select count(*) from public.publishes) = 1, 'agency Y owner sees site C publishes only';
  assert (select count(*) from public.change_requests) = 1, 'agency Y owner sees site C requests only';
  assert (select count(*) from public.invites) = 1, 'agency Y owner sees agency Y invites only';
  assert (select count(*) from public.agency_members where agency_id = '00000000-0000-0000-0000-0000000000aa') = 0, 'agency Y owner cannot list agency X members';
  assert (select count(*) from public.site_services) = 1, 'agency Y owner sees site C services only';
  assert (select count(*) from public.site_services where site_id = '00000000-0000-0000-0000-00000000000a') = 0, 'agency Y owner cannot read site A services';
  assert (select count(*) from public.site_billing where site_id = '00000000-0000-0000-0000-00000000000a') = 0, 'agency Y owner cannot read site A billing';
  assert (select count(*) from public.profiles where id = '00000000-0000-0000-0000-00000000a001') = 0, 'agency Y owner cannot see agency X owner profile';
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- 5. Anonymous callers see nothing at all
-- ---------------------------------------------------------------------------
do $$ begin perform set_config('request.jwt.claims', '', true); end $$;
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
do $$ begin perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a003","role":"authenticated","email":"client-a@example.com"}', true); end $$;
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

-- ---------------------------------------------------------------------------
-- 7. Form entries: read by the site's people, written only by the function
-- ---------------------------------------------------------------------------
insert into public.form_submissions (id, site_id, page_slug, element_id, form_name, data, ip_hash) values
  ('00000000-0000-0000-0000-00000000f00a', '00000000-0000-0000-0000-00000000000a', 'contact', 'form0001', 'Contact', '{"name":"Ada"}', repeat('a', 64)),
  ('00000000-0000-0000-0000-00000000f00b', '00000000-0000-0000-0000-00000000000b', 'contact', 'form0002', 'Contact', '{"name":"Bo"}', repeat('b', 64)),
  ('00000000-0000-0000-0000-00000000f00c', '00000000-0000-0000-0000-00000000000c', 'contact', 'form0003', 'Contact', '{"name":"Cy"}', repeat('c', 64));

-- The recipients list only takes real-looking addresses, at most ten.
do $$ begin
  insert into public.site_services (site_id, form_recipients) values ('00000000-0000-0000-0000-00000000000b', array['office@example.com', 'owner@example.com'])
  on conflict (site_id) do update set form_recipients = excluded.form_recipients;
  begin
    update public.site_services set form_recipients = array['not an email'] where site_id = '00000000-0000-0000-0000-00000000000b';
    raise exception 'a malformed form recipient was accepted';
  exception when check_violation then null;
  end;
end $$;

-- Client A: reads site A's entry only, marks it read, cannot change it, add one or delete it.
do $$ begin perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a003","role":"authenticated","email":"client-a@example.com"}', true); end $$;
set local role authenticated;
do $$ begin
  assert (select count(*) from public.form_submissions) = 1, 'client A reads only site A form entries';
  update public.form_submissions set read_at = now() where id = '00000000-0000-0000-0000-00000000f00a';
  assert (select read_at from public.form_submissions where id = '00000000-0000-0000-0000-00000000f00a') is not null, 'client A can mark an entry read';
  begin
    update public.form_submissions set data = '{"name":"Forged"}' where id = '00000000-0000-0000-0000-00000000f00a';
    raise exception 'client A changed what a visitor sent';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.form_submissions (site_id, page_slug, element_id, data, ip_hash)
    values ('00000000-0000-0000-0000-00000000000a', 'contact', 'form0001', '{}', repeat('d', 64));
    raise exception 'client A inserted a form entry directly';
  exception when insufficient_privilege then null;
  end;
  delete from public.form_submissions where id = '00000000-0000-0000-0000-00000000f00a';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.form_submissions where id = '00000000-0000-0000-0000-00000000f00a') = 1, 'a client cannot delete form entries';
end $$;

-- Agency X staff: read both of X's sites, delete one, never see agency Y's.
do $$ begin perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a002","role":"authenticated","email":"x-staff@example.com"}', true); end $$;
set local role authenticated;
do $$ begin
  assert (select count(*) from public.form_submissions) = 2, 'agency X staff read the entries of agency X sites only';
  delete from public.form_submissions where id = '00000000-0000-0000-0000-00000000f00b';
  assert (select count(*) from public.form_submissions) = 1, 'agency staff can delete an entry';
  assert (select count(*) from public.site_services where form_recipients <> '{}') = 1, 'agency staff read where entries go';
end $$;
reset role;

-- Clients cannot see where entries go (site_services stays with the agency).
-- (Client B was promoted to staff earlier in this file, so client A stands in.)
do $$ begin perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a003","role":"authenticated","email":"client-a@example.com"}', true); end $$;
set local role authenticated;
do $$ begin
  assert (select count(*) from public.site_services) = 0, 'a client cannot read form recipients';
end $$;
reset role;

-- Anonymous visitors have no access to entries at all.
set local role anon;
do $$ begin
  begin
    perform count(*) from public.form_submissions;
    raise exception 'anon was able to query form entries';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 8. Page builder: editing levels, drafts, templates
-- ---------------------------------------------------------------------------
do $$ begin
  assert (select editing_level from public.sites where id = '00000000-0000-0000-0000-00000000000a') = 'content', 'sites default to the content editing level';
  begin
    update public.sites set editing_level = 'designer' where id = '00000000-0000-0000-0000-00000000000a';
    raise exception 'an unknown editing level was accepted';
  exception when check_violation then null;
  end;
end $$;

-- A client cannot raise their own editing level.
do $$ begin perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a003","role":"authenticated","email":"client-a@example.com"}', true); end $$;
set local role authenticated;
do $$ begin
  update public.sites set editing_level = 'builder' where id = '00000000-0000-0000-0000-00000000000a';
end $$;
reset role;
do $$ begin
  assert (select editing_level from public.sites where id = '00000000-0000-0000-0000-00000000000a') = 'content', 'a client cannot change the editing level';
end $$;

-- Drafts: client A saves their own for site A, not for site B, not as someone else.
do $$ begin perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a003","role":"authenticated","email":"client-a@example.com"}', true); end $$;
set local role authenticated;
do $$ begin
  insert into public.builder_drafts (site_id, user_id, draft, change_count) values ('00000000-0000-0000-0000-00000000000a', auth.uid(), '{"v":2}', 3);
  update public.builder_drafts set change_count = 4 where site_id = '00000000-0000-0000-0000-00000000000a';
  begin
    insert into public.builder_drafts (site_id, user_id, draft) values ('00000000-0000-0000-0000-00000000000b', auth.uid(), '{}');
    raise exception 'client A saved a draft for site B';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.builder_drafts (site_id, user_id, draft) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000a002', '{}');
    raise exception 'client A saved a draft as someone else';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Agency Y sees none of it; agency X staff see it and may delete it.
do $$ begin perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000b001","role":"authenticated","email":"y-owner@example.com"}', true); end $$;
set local role authenticated;
do $$ begin
  assert (select count(*) from public.builder_drafts) = 0, 'another agency cannot read drafts';
end $$;
reset role;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a002","role":"authenticated","email":"x-staff@example.com"}', true); end $$;
set local role authenticated;
do $$ begin
  assert (select change_count from public.builder_drafts where site_id = '00000000-0000-0000-0000-00000000000a') = 4, 'agency staff read a client draft';
  update public.builder_drafts set change_count = 99 where site_id = '00000000-0000-0000-0000-00000000000a';
end $$;
reset role;
do $$ begin
  assert (select change_count from public.builder_drafts where site_id = '00000000-0000-0000-0000-00000000000a') = 4, 'agency staff cannot rewrite a client draft';
end $$;

-- Templates: staff save agency-wide ones; a client saves site templates only.
do $$ begin perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a002","role":"authenticated","email":"x-staff@example.com"}', true); end $$;
set local role authenticated;
do $$ begin
  insert into public.builder_templates (id, agency_id, site_id, name, kind, content, created_by)
  values ('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000000aa', null, 'Agency hero', 'section', '{}', auth.uid());
  insert into public.builder_templates (id, agency_id, site_id, name, kind, content, created_by)
  values ('00000000-0000-0000-0000-0000000e0002', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000000b', 'Site B footer', 'section', '{}', auth.uid());
  begin
    insert into public.builder_templates (agency_id, site_id, name, kind, content, created_by)
    values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000000c', 'Wrong agency', 'section', '{}', auth.uid());
    raise exception 'a template was tied to another agency''s site';
  exception when check_violation then null;
  end;
end $$;
reset role;

do $$ begin perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a003","role":"authenticated","email":"client-a@example.com"}', true); end $$;
set local role authenticated;
do $$ begin
  assert (select count(*) from public.builder_templates) = 1, 'client A reads the agency-wide template but not site B''s';
  insert into public.builder_templates (id, agency_id, site_id, name, kind, content, created_by)
  values ('00000000-0000-0000-0000-0000000e0003', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000000a', 'My section', 'section', '{}', auth.uid());
  begin
    insert into public.builder_templates (agency_id, site_id, name, kind, content, created_by)
    values ('00000000-0000-0000-0000-0000000000aa', null, 'Agency-wide by a client', 'section', '{}', auth.uid());
    raise exception 'a client saved an agency-wide template';
  exception when insufficient_privilege then null;
  end;
  delete from public.builder_templates where id = '00000000-0000-0000-0000-0000000e0001';
  delete from public.builder_templates where id = '00000000-0000-0000-0000-0000000e0003';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.builder_templates where id = '00000000-0000-0000-0000-0000000e0001') = 1, 'a client cannot delete an agency template';
  assert (select count(*) from public.builder_templates where id = '00000000-0000-0000-0000-0000000e0003') = 0, 'a client deletes their own site template';
end $$;

set local role anon;
do $$ begin
  begin
    perform count(*) from public.builder_drafts;
    raise exception 'anon was able to query drafts';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 9. site-files bucket: no anonymous listing, only the site's people see rows,
--    the totals view is scoped, and only postgres can call the nightly rollup.
-- ---------------------------------------------------------------------------
-- The database owner drops one file into each of A, B and C so the row visibility
-- can be checked from every caller.
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('site-files', '00000000-0000-0000-0000-0000000000aa/00000000-0000-0000-0000-00000000000a/media/one.webp', null, '{"size":1000}'::jsonb),
  ('site-files', '00000000-0000-0000-0000-0000000000aa/00000000-0000-0000-0000-00000000000b/media/two.webp', null, '{"size":2000}'::jsonb),
  ('site-files', '00000000-0000-0000-0000-0000000000bb/00000000-0000-0000-0000-00000000000c/media/three.webp', null, '{"size":3000}'::jsonb);

-- Client A: sees only site A's files, and only site A's totals row.
do $$ begin perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a003","role":"authenticated","email":"client-a@example.com"}', true); end $$;
set local role authenticated;
do $$ begin
  assert (select count(*) from storage.objects where bucket_id = 'site-files') = 1, 'client A lists only their site''s files';
  assert (select name from storage.objects where bucket_id = 'site-files') like '%/00000000-0000-0000-0000-00000000000a/%', 'client A sees the site A file';
  assert (select count(*) from public.site_storage_totals) = 1, 'client A sees exactly one totals row (site A)';
  assert (select total_bytes from public.site_storage_totals where site_id = '00000000-0000-0000-0000-00000000000a') = 1000, 'the totals view sums the visible file(s)';
  -- Uploading into their own site is fine; uploading into site B is refused.
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('site-files', '00000000-0000-0000-0000-0000000000aa/00000000-0000-0000-0000-00000000000a/media/mine.webp', auth.uid(), '{"size":500}'::jsonb);
  begin
    insert into storage.objects (bucket_id, name, owner, metadata)
    values ('site-files', '00000000-0000-0000-0000-0000000000aa/00000000-0000-0000-0000-00000000000b/media/forged.webp', auth.uid(), '{"size":500}'::jsonb);
    raise exception 'client A was able to upload into site B''s folder';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Agency X staff: sees both A and B files (and totals), never Y's.
do $$ begin perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a002","role":"authenticated","email":"x-staff@example.com"}', true); end $$;
set local role authenticated;
do $$ begin
  assert (select count(*) from storage.objects where bucket_id = 'site-files') = 3, 'agency X staff list site A and site B files (A now has two rows)';
  assert (select count(*) from public.site_storage_totals) = 2, 'agency X staff see totals for A and B only';
  assert (select count(*) from storage.objects where bucket_id = 'site-files' and name like '%/00000000-0000-0000-0000-00000000000c/%') = 0, 'agency X staff cannot list site C files';
end $$;
reset role;

-- Anonymous callers: no listing at all, no totals row.
do $$ begin perform set_config('request.jwt.claims', '', true); end $$;
set local role anon;
do $$ begin
  begin
    perform count(*) from storage.objects where bucket_id = 'site-files';
    raise exception 'anon was able to list storage.objects (should be refused for lack of privilege)';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.site_storage_totals;
    raise exception 'anon was able to read site_storage_totals';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- The rollup and its tables were removed in migration 20260924000700_remove_stats.sql.
-- Confirm those objects no longer exist so the migration is rolled forward correctly.
do $$ begin
  assert (select to_regclass('public.site_stats_events')) is null, 'site_stats_events should have been dropped';
  assert (select to_regclass('public.site_stats_daily')) is null, 'site_stats_daily should have been dropped';
  assert (select count(*) from pg_proc where proname = 'rollup_site_stats_daily' and pronamespace = 'public'::regnamespace) = 0,
    'rollup_site_stats_daily should have been dropped';
end $$;

-- ---------------------------------------------------------------------------
-- 10. armature_settings: RLS on, revoked from client roles; the pg_cron rollup
--     job runs as postgres, but no service_role key is ever stored here.
-- ---------------------------------------------------------------------------
do $$ begin perform set_config('request.jwt.claims', '', true); end $$;
set local role anon;
do $$ begin
  begin
    perform count(*) from public.armature_settings;
    raise exception 'anon was able to read armature_settings';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

do $$ begin perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a002","role":"authenticated","email":"x-staff@example.com"}', true); end $$;
set local role authenticated;
do $$ begin
  begin
    perform count(*) from public.armature_settings;
    raise exception 'agency staff were able to read armature_settings';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Last login (migration 20260923000300): a sign-in on auth.users reaches the profile.
update auth.users set last_sign_in_at = '2026-09-23T10:00:00Z' where id = (select id from public.profiles order by email limit 1);
do $$ begin
  assert (select count(*) from public.profiles where last_sign_in_at = '2026-09-23T10:00:00Z') = 1, 'profiles.last_sign_in_at follows auth.users.last_sign_in_at';
end $$;

select 'rls.test.sql: all assertions passed' as result;
rollback;
