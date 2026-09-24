-- =============================================================================
-- Armature — record the pre-setup commit SHA for every needs_setup site.
--
-- Troy decided against test branches: the Set up this site prompt now writes
-- directly to the site's connected branch. To keep Undo setup safe, Armature
-- remembers the head SHA of the connected branch at the moment the site was
-- saved as needs_setup. When the agency later clicks Undo setup, the
-- undo-site-setup function rebuilds the tree at that SHA and commits it as
-- ONE new commit on top of the current head — never a force-push.
--
-- pre_setup_commit_sha is null on legacy rows (before this migration) and on
-- sites that were already fully connected when they were added. In both cases
-- Undo setup is not offered; the panel says so and links to the manual git
-- revert instructions in Help.
-- =============================================================================

alter table public.sites
  add column if not exists pre_setup_commit_sha text
    check (pre_setup_commit_sha is null or pre_setup_commit_sha ~ '^[0-9a-f]{7,40}$');

comment on column public.sites.pre_setup_commit_sha is
  'The connected branch head SHA at the moment site-connect saved this site as needs_setup. Used by undo-site-setup to restore the tree to that snapshot as one revert commit.';
