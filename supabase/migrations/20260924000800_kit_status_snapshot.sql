-- =============================================================================
-- Armature — kit status snapshot on public.sites, and a few extra columns on
-- public.kit_updates so Undo and the live-version watch work.
--
-- Why the snapshot is on `sites`
--   The Projects list needs to show every site's Kit verdict (up to date /
--   update available / needs setup / not installed) in one query. Reading the
--   live URL and the site's repo per row would be one HTTP round trip per
--   site every render — too slow and rate-limit-heavy. Instead, kit-status
--   writes the last-known versions back to `sites` whenever it runs, and the
--   Projects page derives the verdict from those stored strings plus the
--   compiled KIT_VERSION. When the numbers get stale the panel says so and
--   offers a re-check.
--
-- What lands on kit_updates
--   - `previous_commit_sha`: the branch head SHA before the update commit
--     landed, so Undo can restore the kit folder from that commit without
--     needing an archived package.
--   - `live_checked_at`, `live_version_seen`: last time the live URL was
--     probed after the update, and what the probe saw. The live watcher fills
--     these in until `status` flips to `live_confirmed` or `needs_attention`.
--   - `attempts`: how many live checks have run. The 15-minute deadline is
--     enforced by comparing `now() - created_at` on each poll.
--   - New status values: `undo_pushed` (an Undo commit landed) and
--     `undo_confirmed` (the live URL flipped back).
--
-- Idempotent: every column and check is `if not exists` / drop-then-recreate.
-- =============================================================================

alter table public.sites
  add column if not exists kit_version_in_repo text
    check (kit_version_in_repo is null or kit_version_in_repo ~ '^[A-Za-z0-9._-]+$');
alter table public.sites
  add column if not exists kit_version_live text
    check (kit_version_live is null or kit_version_live ~ '^[A-Za-z0-9._-]+$');
alter table public.sites
  add column if not exists kit_verdict text
    check (kit_verdict is null or kit_verdict in ('not_installed', 'needs_setup', 'update_available', 'up_to_date'));
alter table public.sites
  add column if not exists kit_probed_at timestamptz;

comment on column public.sites.kit_version_in_repo is 'What kit-status last saw at kit_path/version.ts on the connected branch. Null means it has never been probed.';
comment on column public.sites.kit_version_live   is 'What kit-status last read from the live URL''s data-armature-kit attribute. Null means unreachable or never probed.';
comment on column public.sites.kit_verdict        is 'The last-computed Kit verdict — the Projects Kit column reads this directly.';
comment on column public.sites.kit_probed_at      is 'When the snapshot above was last written.';

alter table public.kit_updates
  add column if not exists previous_commit_sha text
    check (previous_commit_sha is null or previous_commit_sha ~ '^[0-9a-f]{7,40}$');
alter table public.kit_updates
  add column if not exists live_checked_at timestamptz;
alter table public.kit_updates
  add column if not exists live_version_seen text
    check (live_version_seen is null or live_version_seen ~ '^[A-Za-z0-9._-]+$');
alter table public.kit_updates
  add column if not exists attempts integer not null default 0
    check (attempts >= 0);
alter table public.kit_updates
  add column if not exists needs_attention_reason text;

-- Expand the status check to include Undo states.
alter table public.kit_updates drop constraint if exists kit_updates_status_check;
alter table public.kit_updates add constraint kit_updates_status_check check (
  status in ('commit_pushed', 'live_confirmed', 'needs_attention', 'undo', 'undo_pushed', 'undo_confirmed')
);

comment on column public.kit_updates.previous_commit_sha  is 'Branch head SHA before the update commit landed. Used by undo-kit-update to restore the kit folder from that commit.';
comment on column public.kit_updates.live_checked_at      is 'When the live URL was last polled after the commit was pushed.';
comment on column public.kit_updates.live_version_seen    is 'What the last poll of the live URL saw (data-armature-kit).';
comment on column public.kit_updates.attempts             is 'How many live-version polls have run for this row. Growing over time until status flips.';
comment on column public.kit_updates.needs_attention_reason is 'Plain-English reason the live version did not flip in the 15-minute window (e.g. "The site did not rebuild. Netlify may have failed the build.").';

-- Index the pending rows so the poll job stays cheap.
create index if not exists kit_updates_pending_idx
  on public.kit_updates (created_at)
  where status in ('commit_pushed', 'undo_pushed');
