-- 65_runner_tranche (file numbered 64_runner to follow 64_stack_cap; applied as
-- migration 'runner_tranche'): the RUNNER/SCALE-OUT mechanism — DARK.
--
-- The operator-PINNED lever (registry R1, pre-registered 2026-07-05): at the LOCK
-- take-profit, bank a TRANCHE and let a REMAINDER row ride a peak ratchet — the
-- "TP half vs letting winners win" straddle. Mechanism only; the A/B experiment
-- (runner twin vs all-out LOCK twin, separate accounts, A1 sizing) is configured
-- at the A6 read, never before.
--
-- Knobs (strategist_config, both 0 = OFF → byte-identical all-out behavior):
--   runner_frac         fraction of the position RETAINED at TP (e.g. 0.5 = bank
--                       half, ride half). Unsplittable positions (qty 1, or the
--                       retained share rounds to the whole lot) fall back to the
--                       normal all-out exit.
--   runner_giveback_pct the remainder's peak ratchet: exit when mark ≤
--                       peak × (1 − pct/100). The premium stop / stall / EOD
--                       flatten backstops still apply to the runner row.
--
-- positions.runner_of: the parent row id for a remainder row (split-row design —
-- the row-primary booking invariant is "each row books once, full share, status-
-- guarded"; reducing qty in place would reintroduce the cumulative-booking class).
alter table strategist_config add column if not exists runner_frac numeric not null default 0;
alter table strategist_config add column if not exists runner_giveback_pct numeric not null default 0;
alter table positions add column if not exists runner_of uuid;
