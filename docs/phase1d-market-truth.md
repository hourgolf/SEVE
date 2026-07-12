# Phase 1D — Market-truth foundation

Status: implementation branch, shadow/research only. No strategy promotion and no production deployment are authorized by this work.

## What data remains

The harvested corpus is still present locally and is sufficient for a materially better replay:

- Underlying one-minute bars: SPY 610 sessions (2024-02-01 through 2026-07-10), QQQ 130 sessions, and IWM 329 sessions across collected eras.
- Databento option history: one-minute OCC contract bid/ask paths, including multi-DTE SPY (312 files, roughly 2024-05-01 through 2026-06-01), IWM (313 files), and QQQ (71 files).
- Forward quote archive: 26 compressed daily files from 2026-06-05 through 2026-07-10.
- Desk evidence: 1,082 position records, 12,549 signals, 1,082-line forensics export, and a 387-contract broker-truth snapshot.

The important qualification is that availability is not uniform. Each result must state the overlapping bar, quote, symbol, expiry, and policy coverage actually used. A large database does not repair biased execution assumptions.

## Canonical replay contract

`npm run phase1d-pb-replay` is the first canonical replay. It starts with `pb-ride` because the channel exposes the desk's central unresolved question: whether a good entry engine can be converted into durable trade management.

The replay pins:

- the current policy snapshot rather than the original blessed settings;
- next-session-expiry SPY contracts (the channel's configured 1DTE);
- real underlying bars and Databento one-minute OCC NBBO;
- entry fills at ask plus a declared slippage bracket;
- exit decisions from executable bid, not midpoint;
- stop-aware RISK sizing, current maximum contracts, daily stop, target, premium stop, underlying stop, and stall rule;
- the live cost gate and FOMC stand-down;
- both natural re-entry and one-entry-per-day views, so management effects are not confused with extra entry opportunities.

Historical midpoint-triggered runs remain reproducible, but they are labeled legacy evidence. They cannot be cited as live-faithful performance.

## First finding: pb-ride

The initial 308-session replay (2024-05-01 through 2026-05-29 overlap) rejects the old positive headline under the current policy:

- Current +10% target with natural re-entry: -$30,818 at the audited one-tick fill bound and -$12,943 at the optimistic quarter-tick bound (989 positions).
- Current +10% target limited to one entry per day: -$23,316 and -$16,948 respectively (290 positions).
- Ride, +20%, and +30% target alternatives were also negative at both cost bounds. The least-negative tested result was +20% with natural re-entry at the optimistic bound (-$1,736), which is still a rejection, not a near-pass.
- The current audited result was negative in all five registered windows.

The historical golden replay remains +$4,632 over 250 trades. That is useful as a reproducibility check, not as evidence for the current channel: it used the older six-contract/no-daily-stop/50%-stop configuration, a one-tick gate that suppressed churn, and midpoint-based management observations. The discrepancy is explained by changed policy and corrected market semantics; it is not a data deletion or a nondeterministic rerun.

## Acceptance discipline

No channel is promoted from pooled profit alone. A candidate must survive:

1. both declared execution-cost bounds;
2. multiple time windows rather than one favorable regime;
3. session-level drawdown and winner-concentration review;
4. an entry-locked comparison when evaluating exits;
5. forward paper observation with quote and policy provenance.

The next Phase 1D increment is a versioned observation ledger for every decision and broker event: account, channel, opportunity, policy/config version, worker boot, quote timestamp/source/age, bid/ask, decision, order, fill, and exit attribution. This is additive and shadow-first; it must not share a failure path with execution.
