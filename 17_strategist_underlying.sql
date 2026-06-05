-- ============================================================================
--  17_strategist_underlying.sql · per-channel underlying ticker (QQQ rollout, step 2)
--  Each channel declares WHICH market it trades — SPY (default), QQQ, …. The .md
--  thesis sets it via `underlying:` in the frontmatter; Add-Channel persists it; the
--  worker (step 3) reads it to pick the bars / option chain / OCC prefix. market-ingest
--  (step 1) already writes SPY + QQQ tapes, so a QQQ channel has live data.
--
--  Idempotent — run once in the Supabase SQL editor. Existing channels backfill to
--  'SPY' via the default, so nothing changes until a channel is created/set to QQQ.
--  The dashboard load is 3-tier-graceful, so it keeps working before/after this runs.
-- ============================================================================

alter table strategists
  add column if not exists underlying text not null default 'SPY';

-- (optional) point an existing channel at QQQ by slug, e.g.:
--   update strategists set underlying = 'QQQ' where slug = 'orb-trend-rider';
