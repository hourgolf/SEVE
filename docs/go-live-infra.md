# Go-live infrastructure blueprint (2026-07-08)

The one-account shadow proved the dream team's edge survives a single cash pool (+31% era-4,
cash never bound ≥$15k, concentration — not buying power — is the constraint). This doc sequences
the INFRASTRUCTURE that must exist before real capital rides in one account, ordered by risk and
by "shadow-measurable now" vs "live-worker trade-path change."

**Doctrine for all of it (non-negotiable):** the live worker is the desk's highest-risk code
(the runaway-rebuy incident is why `already_open` guards + INSERT error-checks exist). Every worker
change is deploy-by-paste, verified via `select note from worker_heartbeat` + the `stream: boot:`
event, never by invoking the armed worker. Shadow-first: measure the effect before changing the
trade path. The worker-code items below are **dedicated-session work (Fable-tier — near-live-capital)**,
not tail-of-session edits.

## The collapse: what 3 buckets → 1 account breaks

Today the 3 paper accounts diffuse three things that a single live account will expose:
- **Budget contention** — channels size off `equity × capital_pct` independently; in one pool they
  race for buying power in broker-arrival order (random starvation). *Shadow-measured: cash never
  binds ≥$15k at current sizes → LOW priority until pool size is known.*
- **Self-cross / coalescing** — 70% of trades share strikes; in one account, channel A's exit-sell
  and channel B's entry-buy on the same OCC in the same minute cross against each other (pay the
  spread twice, flirt with self-trade-prevention flags). *Not yet measured → the first build below.*
- **Concentration** — the real constraint (max stack 3ch/54ct one strike). C1 stack-cap is built
  (`64_stack_cap.sql`, DARK) and sequenced post-A6.

## Sequence

### 0. Self-cross / coalescing DETECTOR — ✅ DONE 2026-07-08 (`npm run one-account-shadow -- --cross-audit`)
Flags from actual trades: same-OCC opposite-direction same-minute fills (self-cross) + same-OCC
same-direction same-minute entries (coalescing opp). No worker change. **First read (era-4, 130
trades): self-cross 0 events · coalescing 13 events / 412ct / ~$287 (modeled 3% half-spread, an
OVER-estimate).** → **de-prioritizes item 1**: nothing self-crosses, and coalescing's ceiling is
~$40/session (likely less on real NBBO) — not worth a live trade-path change now. Re-run as the
roster/fleet grows; revisit item 1 only if the number climbs materially.

### 1. Order coalescing + self-trade prevention — WORKER, dedicated session — DEFERRED (item 0 says not worth it yet)
If (0)'s number climbs: net same-minute same-OCC orders desk-side into one broker order, allocate
fills back per-channel (row-primary booking already handles shared-OCC attribution). Currently
DEFERRED — self-cross 0, coalescing ceiling ~$287/era. Don't touch order submission for ~$40/session.

### 2. Capital allocator — WORKER, dedicated session, pool-size-gated
Only material if the live pool is small enough that cash binds (shadow says ≥$15k it doesn't). When
needed: a deterministic priority order (or shared risk budget) deciding who gets the slot when
buying power is scarce — the doctrine's one-at-a-time slot made literal. Shadow the priority rule
in one-account-shadow (rescale mode, where cash DOES bind) before wiring it live.

### 3. Master-stop enforcement — WORKER, dedicated session
`fund_state.master_daily_stop_usd` is read but NOT enforced (only the manual KILL halts the desk).
For one live NAV, an account-level auto-halt is the number that matters. Wire into `decide.ts`
(halt all new entries at −$X realized desk-wide; KILL=FLATTEN already exists for the exit side).
Capital on/off stays the operator's discretionary call — this is the *option* of an enforced floor,
tested at paper first. (5A master stop was deliberately kept OFF — this revisits it for live.)

### 4. Reliability repricing — OPS, before any live dollar
Paid Supabase tier (statement timeouts + 0.5GB cap unacceptable with open risk), heartbeat
dead-man alerting during RTH with open positions, quarterly failover verification. Short checklist,
not a project. (PDT no longer exists → no $25k regulatory floor; pool size is deployment math.)

## What's already done (don't rebuild)
- One-account shadow + rescale + maxDD + daily-target + hands-off (the measurement layer).
- C1 stack-cap DARK-built (config flip post-A6).
- KILL = FLATTEN (halt_flatten, exit side).
- Row-primary booking + reconcile (shared-OCC attribution — makes coalescing bookkeeping tractable).
