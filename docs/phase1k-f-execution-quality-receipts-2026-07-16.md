# Phase 1K-F — execution-quality receipts

Status: merged and deployed at `main@241525d`. The private migration is applied and Railway is running
`stream-2026-07-16a`. The release changed observation only: strategy configuration, order sizing,
entry/exit policy, and paper posture remain unchanged. The first live-session receipt reconciliation is
still required before any alert thresholds can be ratified.

## Purpose

This slice makes exit execution quality queryable without confusing a correct policy trigger with a
worse broker fill. It is observation-only and cannot place, resize, cancel, or close an order.

The normalized receipt records:

- channel, account, position, OCC, reason, observer source version, and deterministic order identity;
- trigger observation, local order-submission time, and local terminal-fill observation time;
- executable decision bid, ask, spread, entry price, fill price, requested/filled/crossed quantity;
- trigger return, realized return, adverse or improved fill versus the executable bid;
- leakage per contract, total dollars, and basis points;
- configured premium stop, underlying stop, and take-profit facts;
- premium-stop threshold overshoot in percentage points;
- chain-snapshot age and an explicit nullable provider quote-event age.

Positive leakage is adverse to the desk; negative leakage is price improvement. `fill_observed_at` is
truthfully labeled as the time the worker observed the terminal broker result, not the exchange's exact
fill timestamp.

## July 16 regression receipt

The pure fixture pins the observed GRIND stop:

- entry: $1.56;
- executable trigger-side bid: $1.00;
- paper fill: $0.91 for 10 contracts;
- configured premium stop: 35%;
- trigger return: -35.8974%;
- realized return: -41.6667%;
- fill leakage versus trigger bid: $0.09 per contract / $90 total / 900 bps;
- threshold overshoot: 6.6667 percentage points.

The receipt therefore says both things that are true: the channel triggered at its configured stop, and
the resulting fill landed materially beyond it. It does not relabel execution leakage as strategy-policy
failure.

## Current provenance boundary

The active `ChainStore` records when the snapshot refresh completed but does not retain Alpaca's
authoritative per-contract quote-event timestamp. Phase 1K-F stores `snapshot_age_ms` and leaves
`provider_quote_event_age_ms` null. Phase 1K-G held-contract capture is the planned second clock; this
slice does not invent one.

V1 writes a receipt for a positive exit fill observed directly by the streaming worker. The
authenticated manual-close route also writes an operator receipt after a confirmed paper fill and
status-guarded booking. It deliberately does not add a quote fetch in front of the risk-reducing sell,
so its decision quote and leakage fields are null rather than invented.

The scheduled cron executor remains the stream fleet's exit-only dead-man failover. A rare exit placed
by that failover does not receive a V1 receipt in this slice. The latest audited fleet had every armed
channel stream-owned, but this is still a real coverage gap and a pre-alerting review item. This slice
does not edit or redeploy the live failover trader merely to claim parity.

A sell that returns zero and fills only after the streaming worker's polling window remains recoverable
by the existing position/order logic, but it cannot receive a fully sourced V1 quality receipt without
recovering the original decision quote. That gap must remain visible rather than stamping the later
recovery quote as the trigger quote.

## Persistence and security

Migration `20260717033413_execution_quality_receipts.sql` creates an append-only public table with:

- RLS enabled;
- public and anonymous access revoked;
- authenticated access limited to operator JWTs through `app_metadata.seve_role`;
- service-role `SELECT/INSERT` only;
- no update or delete grant;
- foreign-key and investigation indexes;
- constraints that keep quantities, timestamps, NBBOs, and derived leakage internally consistent.

The worker uses a separate serialized best-effort queue. The order path never awaits the receipt insert.
A missing table or failed write loses evidence only.

## Explicit non-goals

- No alert severity is activated. The proposed $25/3pp and $100/8pp boundaries still require review.
- No entry, exit, stop, target, scale, size, roster, or collision policy changes.
- No production dashboard rendering yet.
- No historical backfill is asserted from incomplete evidence.
- No exact provider quote timestamp is inferred.

## Remaining validation gates

1. During the next paper session, verify each stream-observed or authenticated-manual positive exit fill
   creates one receipt and that no order timing or booking result changes.
2. Reconcile receipt counts against broker exit fills, classifying cron-failover and late-recovered fills
   as explicit missing-evidence cases.
3. Confirm heartbeat/run ledger, paper-only posture, and broker/desk reconciliation remain green.
4. Keep alerts and dashboard judgments off until receipt coverage and missing-evidence counts are reviewed.
