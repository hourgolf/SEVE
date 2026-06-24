-- ============================================================================
-- 43_stall_exit.sql — STRAND-4 stall-exit per-channel knob (desk-doctrine.md).
--
-- Cut a NON-MOVER: a position held >= stall_minutes whose PEAK option mark never
-- popped past stall_max_favor_pct above entry → free the one-at-a-time slot (the
-- re-entry-when-flat loop then re-bets). DISTINCT from the -50% crash stop (a
-- crasher) and the take-profit (a winner); NOT a tail-capper (requires the peak to
-- have NEVER reached the threshold, so a faded winner is exempt). Applied in the
-- worker's fast-exit sweep (execute.ts premiumExitReason) — the lowest-priority
-- premium exit (a real stop/target/trail wins first).
--
-- 0 = OFF (default → every channel byte-identical). Calibrated shape is PATIENT
-- (long minutes, generous favor pct); the LIVE field-test target is pb-ride (1DTE).
-- Additive + fail-safe.
-- ============================================================================
alter table public.strategist_config
  add column if not exists stall_minutes integer not null default 0,
  add column if not exists stall_max_favor_pct numeric(6,2) not null default 0;
