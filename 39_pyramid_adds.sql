-- 39_pyramid_adds.sql — per-channel PYRAMID executor switch (Phase B, compound-vs-ride-verdict +
-- pyramid-roster-faithful, 2026-06-19).
--
-- pyramid_adds = the MAX number of lots the live worker may ADD to a winning V3/ALT position as it
-- runs (same contract, never average down; the whole stack exits together at the −50%-of-weighted-avg
-- stop / 15:25 flatten). 0 = OFF (Phase A shadow only — the worker logs "PYRAMID would add" but places
-- NO add order; every existing channel stays byte-identical). N>0 = the executor adds up to N lots, and
-- the TOTAL stack (base + adds) is capped at strategist_config.max_contracts (the maxStack=max_contracts
-- finding). So the validated "cap12" arm = pyramid_adds=3 + max_contracts=12 on V3/ALT.
--
-- ⚠ EXECUTOR SAFETY RAILS (all must hold for an add to fire): (1) the worker only ever pyramids the two
-- VALIDATED slugs (breakout-alt-v3, breakout-smart-entries — hardcoded PYRAMID_SLUGS in decide.ts; a
-- new channel needs a deliberate code change, not just this column); (2) the two-key live turn
-- (DRY_RUN=false + LIVE_TRADING=true + service role); (3) the worker that reads this column must be
-- DEPLOYED. So this migration is INERT on its own — it only adds the column (default 0). Arming cap12 is
-- a SEPARATE operator action (set pyramid_adds=3 + max_contracts=12 on V3/ALT) once the multi-lot
-- executor is observed in the paper-lab. Reversible instantly: set pyramid_adds=0 (no redeploy).
--
-- Additive + fail-safe: default 0 keeps every channel byte-identical until explicitly armed.

ALTER TABLE strategist_config ADD COLUMN IF NOT EXISTS pyramid_adds integer NOT NULL DEFAULT 0;

-- NOTE: intentionally NO channel armed here. The validated cap12 arm is the operator's call:
--   UPDATE strategist_config c SET pyramid_adds = 3, max_contracts = 12
--   FROM strategists s WHERE c.strategist_id = s.id AND s.slug IN ('breakout-alt-v3','breakout-smart-entries');
-- Rollback: SET pyramid_adds = 0 (and max_contracts back to 6) for those slugs.
