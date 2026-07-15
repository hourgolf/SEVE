# Phase 1K-A — fleet evidence audit and channel passports

Status: implementation branch. Read-only research tooling only. No database
migration, strategy configuration, worker runtime, order, sizing, manager,
dashboard, or deployment behavior is changed by this phase.

Phase 1J merged to `main` as `b26faf4`. Phase 1K-A generalizes the evidence
discipline beyond PB and ORB so Grind, MOMO, QQQ, IWM, VB, and the rest of the
fleet can be assessed without turning a contaminated lifetime P&L table into a
strategy verdict.

## Deliverable

The new command is:

```text
npm run fleet-evidence-audit -- --from YYYY-MM-DD --through YYYY-MM-DD
```

It performs SELECTs only and writes a local JSON receipt under
`data/fleet-evidence-audits/`. Each strategist UUID receives a channel passport
with:

- account, underlying, executor, status, mute state, and a reporting family;
- signal counts, acted/not-acted counts, and explicit block coverage;
- root trades versus runner rows, independent sessions, and quantities capable
  of multi-contract research;
- gross ledger P&L kept separate from native, operator-managed, annotated,
  reconciled, and legacy-unattributed outcomes;
- position-opened, position-booked, opportunity, entry-decision, entry-fill,
  and exit-fill lineage coverage;
- durable manager enrollment, terminal/censored/active runs, and completed
  modeled-versus-actual comparisons;
- a deterministic evidence tier and explicit blockers;
- a permanent `promotionEligible: false` invariant.

The family label is for reporting only. It is not a covariance, risk, or
admission family and must never be consumed by execution.

## Outcome provenance rules

Closed rows are partitioned exactly once:

1. **annotated exclusion** — the durable human-attested registry wins even when
   the execution row truthfully retains a native close reason;
2. **operator managed** — an operator-twin channel or `manual` / `manual:*`
   close; retained for operator research but excluded from native exits;
3. **execution correction** — `reconciled`; retained separately;
4. **legacy unattributed** — no close reason; never silently called native;
5. **native** — remaining rows with an explicit non-manual close reason.

The known `momo-shape-2` +$348 manual-close functionality drill is therefore
excluded by its position UUID even though its authoritative row correctly says
`target_premium`: the target filled before the requested manual close. Execution
truth is preserved; strategy credit is not granted.

Manual closes that are not separately annotated remain useful as entry-path
observations, but their realized close cannot teach the native exit policy.

## Entry lineage correction discovered by the live audit

Entry decisions and broker results are stamped before a new position row exists,
so they may carry an opportunity ID but no position ID. The first live audit
correctly exposed that a naïve position-ID join would mark every channel's entry
evidence missing.

Phase 1K-A resolves entry evidence through the durable chain:

```text
execution observation opportunity_id
  → position outcome opportunity_id
  → root position_id
```

Direct position IDs remain authoritative when present. Runner rows inherit their
root entry only for entry coverage; booked and exit evidence remain row-specific.

## Live inventory: historical ledger era

Read-only window: 2026-06-01 through 2026-07-14.

- 68 configured channels;
- 40 channels with trades and 28 signal-only channels;
- 1,184 root trades / 1,184 closed rows;
- gross paper ledger: **-$38,793.55**;
- 570 explicit native-reason rows: **-$65,281.44**;
- 282 operator-managed rows;
- one durable annotated exclusion;
- three reconciled rows;
- 328 rows without a close reason;
- zero channels with complete lineage across the entire window.

That last result is expected: the durable execution and outcome tables did not
exist for much of the historical ledger. “Native reason” is provenance, not a
claim that older price, booking, OCC-sharing, or policy-era defects have been
repaired. Lifetime family P&L is therefore an inventory fact, not a causal
strategy estimate.

## Live inventory: durable prospective era

Read-only window: 2026-07-13 through 2026-07-14.

- 102 root trades / 102 closed rows;
- gross paper ledger: **-$9,096**;
- 101 native rows: **-$9,444**;
- one annotated `momo-shape-2` operator test: +$348;
- no manual-reason, reconciled, or unattributed rows;
- **19 of the 20 channels that traded have complete durable lineage**;
- the only partial channel is `vb-ribbon-cross`, with five of six auxiliary
  exit broker-result receipts. Its authoritative position and booked outcome
  remain present, matching the existing session receipt.

Family inventory for this two-session cohort:

| Reporting family | Root trades | Native rows | Native P&L | Complete-lineage channels |
|---|---:|---:|---:|---:|
| GRIND | 5 | 5 | -$1,066 | 3 |
| IWM | 3 | 3 | -$840 | 2 |
| MOMO | 18 | 17 | -$3,480 | 2 |
| ORB-SPY | 13 | 13 | -$3,384 | 3 |
| PB | 33 | 33 | +$2,375 | 3 |
| QQQ | 5 | 5 | -$3,501 | 3 |
| VB | 24 | 24 | +$1,088 | 2 |

This is evidence readiness, not a ranking. Two sessions cannot establish an
edge, and correlated sibling entries cannot be treated as independent samples.

## What this enables for the other channels

Phase 1K-A makes the next analyses honest:

- **Grind:** compare `v3`, `v3-2`, and `smart-entries` only on matched
  opportunities; separate entry quality from the stop/target asymmetry.
- **MOMO:** compare Shape and Shape-2 after removing the operator test and any
  later manual overlay; determine whether the difference is entry selection or
  profit capture.
- **QQQ and IWM:** keep each underlying separate. SPY behavior cannot be pooled
  into a portability claim; spread, option selection, and opportunity clocks
  must be measured on their own paths.
- **VB:** treat each subtype and underlying as its own hypothesis. The many
  signal-only draft channels are candidate opportunities, not completed trade
  evidence.

## Quantity truth

There is no new four-contract trade requirement. The passport reports:

- quantity two or greater as multi-contract/scaling-capable evidence;
- quantity four or greater separately because the current durable manager lab
  requires four contracts for its preregistered whole-lot allocation.

Those are evidence properties, not sizing instructions.

## Non-goals and remaining gaps

Phase 1K-A does not:

- join immutable R2 intraminute captures or full OPRA quote paths;
- calculate MFE, MAE, time-to-peak, slippage, or realized/MFE capture;
- normalize capital or correlated family exposure;
- select a target, stop, scaling manager, or channel roster;
- mutate Supabase or change paper execution.

Those path-dependent measurements belong in Phase 1K-B after the passport
proves which positions have trustworthy joins. Missing path evidence will be
censored, not priced as zero.

## Verification

- fleet evidence audit self-test: 40/40;
- Phase 1J observer scorecard regression: 25/25;
- research annotation regression: 4/4;
- root TypeScript: clean;
- live historical audit completed successfully;
- live durable-cohort audit completed successfully;
- known `vb-ribbon-cross` auxiliary exit gap reproduced exactly;
- no Supabase write, migration, worker change, or deployment.
