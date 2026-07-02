-- ============================================================================
-- 61_peak_trough_at.sql — WHEN the extremes happened (approved 2026-07-02).
--
-- peak_mark/trough_mark record how high/low each trade's premium went; these
-- record WHEN (the ~10s sweep stamps the timestamp on every NEW-extreme write).
-- Time-to-MFE / time-to-MAE become one query instead of a quotes-archive replay
-- per trade — the A6b ratchet probe and exit-timing analyses read these.
--
-- Seeded at entry (peak=trough=entry price ⇒ both timestamps = open time).
-- Additive + nullable → old rows unaffected; instrumentation only, nothing on
-- the trade path reads them. Worker stream-2026-07-02a stamps them.
-- ============================================================================
alter table positions
  add column if not exists peak_at timestamptz,
  add column if not exists trough_at timestamptz;
