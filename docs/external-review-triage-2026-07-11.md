# External review triage — 2026-07-11

An independent (non-Claude) frontier LLM reviewed the desk from `docs/external-review-2026-07-brief.md`
+ the code bundle. **Headline verdict, accepted: "sophisticated in observability, weak in transactional
foundations" — we built analysis faster than a durable execution state model.** Its real-money gate
ordering is adopted below. Full response is archived at `data/review/RESPONSE-2026-07-11.md` (save the
operator's paste there). Spot-verification (3/3 top CRITICALs confirmed in code) done 07-11.

## Verdict on the verdict
The reviewer is right about the central inversion: broker truth and desk truth can diverge, and our
recovery is heuristic (snapshots + mutable position rows + coid conventions + reconcile) rather than
transactional (orders/fills ledger → positions as a projection). The `orders`/`fills` tables exist in
the schema and are unused — that detail stings because it's true.

## Bucket 1 — PUNCH LIST (point fixes, worker; do as "Mission 1b" in the weekend session)
Verified or accepted; each is bounded work:
1. **is_armed strands exits (CRITICAL, verified `index.ts:264,490`).** Exits + reconcile must run
   whenever credentials resolve; `is_armed` becomes entries-only (or disarm = flatten-then-freeze).
2. **Partial exit closes the whole row (CRITICAL, verified late-fill path `execute.ts:~197`; audit
   the tranche + main sell paths the reviewer cited too).** Close only the sold quantity; remainder
   stays a managed row.
3. **Entry/pyramid assume full fill on nonterminal zero-fill orders (CRITICAL, reviewer; verify vs
   alpaca.ts orderAndFill).** Never create/enlarge a row without positive fill evidence.
4. **Tranche topology change without terminal order state (CRITICAL, reviewer).** Cancel-and-confirm
   before parent/runner split.
5. **Silent Supabase failures (CRITICAL).** One checked DB wrapper; `getOpenPositions` returning []
   on error is the worst case (worker believes itself flat — the runaway-re-buy's cousin).
6. **Mid-triggered stops/targets, market fills (CRITICAL).** Trigger liquidation on fresh executable
   BID (+ quote age); keep mid as diagnostic only.
7. **Kill-switch latency (HIGH, verified `reloadPending` only consumed by bar cycle).** Fast sweep
   consumes config events; risk pass runs immediately on kill.
8. **Fast sweep blocked by the `cycling` mutex (HIGH).** Risk/exit path must not share the full-cycle lock.
9. **getOrders failure suppresses risk-reducing exits (HIGH).** Fail toward exit, not toward hold.
10. **Same-OCC sale mis-attribution in reconcile + $0-close manufacture (HIGH).** `unresolved` state
    instead of invented evidence.
11. **realizedTodayByChannel `.limit(1000)` + sentinel `.limit(5000)` (HIGH, verified).** pageAll both.
12. **"insufficient/not enough" regex closes rows (SPECULATIVE→verify vs raw broker errors).**
13. **Early-close hardcodes 16:00 in session-bar/level/gate paths (MEDIUM, verified pattern).**
14. **Fees: live books gross, engine books net (MEDIUM).** Ingest broker fees; gates use net.
15. **Rename `daily_stop_usd` semantics in UI (MEDIUM):** it's a realized-entry latch, not max-loss.
16. **Sentinel context staleness (MEDIUM, verified — says 09a, worker is 10b).** Auto-generate the
    live-state block from heartbeat/registry; stamp generation time; warn when stale.

## Bucket 2 — ARCHITECTURE (adopt as the new go-live backbone; supersedes the current item order
in docs/go-live-infra.md)
The reviewer's real-money gate, adopted verbatim as sequence:
1. **Durable order/fill ledger** — append-only intent→ack→fills→terminal→derived lots; `positions`
   becomes a projection. (Schema already has the tables.)
2. **Immutable account identity on every row/order at entry** — routing from the row, never from the
   channel's current bucket; reject re-bucketing with open exposure. (Audit 10b fail-closed the
   config-READ path; the deeper stamp-at-entry point stands.)
3. **Restart-safe partial-fill handling** (falls out of 1 done right; chaos-test it).
4. **Independent risk service** — own loop, own data path, executable-bid stops, per-OCC/underlying
   caps, account+desk drawdown, stale-data policy, flatten confirmation. Absorbs the concentration
   allocator spec (its admit/downsize logic belongs HERE, not in decide.ts).
5. **Executor fencing** — Postgres advisory lease + unique active-intent constraint; duplicate open
   rows = fatal incident, not Map collapse.
6. **Policy-epoch stamping** — config hash + worker version + account + policy epoch on every trade;
   "era-4" retired as a pooling key (the sentinel lens pools across documented boundaries today —
   reviewer caught us violating our own registry).
7. **Only then: channel-edge evaluation.**
Also accepted: consider retiring MORGUE's live order placement (shadow-replay the losers instead) —
data value stands but broker-state complexity isn't paying its way.

## Bucket 3 — METHODOLOGY (accepted; changes how we read + label, not what runs)
- **Rename the discipline:** the registry is an *adaptive experiment ledger with prospective rules*,
  not preregistration. Label every result discovery / prospective replication / untouched confirmation.
- **Sessions, not trades, as the inference unit** — report n_trades, n_sessions, best-session and
  best-3-trades P&L share, session-blocked CI, worst session, maxDD, per-epoch.
- **A6's breakeven bar is a binary-game idealization** — primary read becomes session-clustered net
  $/ct under the fixed policy; win-rate bars demote to diagnostics. (A6 reads ~Jul 21 — apply THERE.)
- **Harvest lens demoted from promotion axis to exit-diagnostic.** pk·win never a composite score,
  never a peer of realized P&L; promotions graduate only via forward real-fill policy tests (A14/A16
  already do this — the sentinel's "clean promote" ranking language and the P&L panel's column
  placement must change to match). Bid-side MFE where computable; completeness % shown.
- **Untouched forward holdout** for confirmations; 5-overlapping-windows ≠ replication.
- **Tighten vague kill criteria** (A2 "materially", A15 "materially", A5's n, A9 sign-tests).
- **A13 is an operational comparison, not a clean A/B** (shared account/OCC interference) — label it.
- **UI provenance:** every number carries basis (broker-real vs estimated, gross vs net, mid vs bid),
  epoch, coverage, completeness; all-time NAV always visible next to windowed views; LLM judge output
  visually subordinate to deterministic evidence (invert the current verdict-first Sentinel panel).

## What the reviewer couldn't see (context, not defense)
alpaca.ts, reconcile-alpaca, the shadow instruments, migrations 03–67, the UI components, and the
10b audit diffs were omitted from the bundle. Three CRITICALs are conditionally-confirmed pending
alpaca.ts (their Priority-1 request). Next review round: send alpaca.ts + raw order samples +
migrations + the instruments (their priorities 1–3).

## Recommended plan change (operator to confirm)
The weekend's Mission 3 (sentinel analyst v2) **slides behind the execution substrate**: after the
PERFORM build lands → Mission 1b punch list → order/fill ledger design (Bucket 2 item 1). The
reviewer's closing line is the tiebreaker we asked an outsider to give us: *"further strategy
experiments mostly increase the amount of inference built on an execution substrate that can still
lose track of contracts."*
