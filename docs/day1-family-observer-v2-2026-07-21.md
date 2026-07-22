# Day 1 family observer v2

Status: implementation prepared on `research/day1-family-observer`; not merged or deployed.
No strategy configuration, paper order, position, database schema, or release policy is changed.

## Finding

The Phase 1I observer was structurally unable to emit under the sealed Day 1 release. Its runtime
tap ran after global admission, while the model required at least two unblocked candidates from the
same family and source clock. Day 1 authorizes one paper root per family and marks every sibling
`day1_dark_lifecycle`, so the observer always received at most one admissible candidate. The empty
table was therefore expected from the code path, not evidence that families never collided.

## Corrected observation contract

Observer v2 taps the already-computed decisions after Day 1 per-candidate preparation and before
global arbitration. It remains research-only and accepts only:

- an otherwise clean Day 1 paper root with no release block; or
- an otherwise clean dark sibling whose only block is `day1_dark_lifecycle`.

The original strategy block in the sealed `day1Candidate` provenance must be null. Muted, halted,
stale, cost-gated, malformed, post-arbitration, or forged candidates remain excluded. Candidate
identity, account, source clock, observed clock, OCC, ask, release id, configuration checksum, and
original requested quantity must agree with the stamped decision.

The existing append-only `family_admission_observations` envelope is reused. `policy_version` is
`family-admission-observer-v2`, and the deterministic receipt namespace is versioned separately, so
v1 and v2 evidence cannot collide. Candidate JSON now states whether the row was a paper root, a
dark candidate, or a legacy native accepted decision and preserves both the observed quantity and
the pre-overlay quantity.

Current explicit families remain deliberately narrow:

- PB: `pb-ride`, `pb-ride-2`, `pb-ride-itm`
- SPY ORB: `orb-trend-rider`, `orb-ustop`, `orb-ustop-ctl`

No prefix matching or implicit QQQ/IWM pooling is introduced.

## Safety boundary

- The observer is called after decisions are computed and is persisted through the existing
  best-effort queue.
- The order path never awaits the queue and never reads an observer receipt.
- The observer cannot block, admit, resize, rank, place, cancel, or close an order.
- Missing persistence loses research evidence only.
- Evidence never promotes, arms, mutes, resizes, or reconfigures a channel automatically.

## Interpretation boundary

This correction restores same-clock candidate receipts; it does not invent outcomes for dark
channels. The legacy Phase 1J scorecard can grade actual-filled opportunity lineage, but a v2 group
containing a dark candidate must remain censored until the after-close exact-path replay supplies a
manager-normalized result for every candidate. Live snapshot asks are provenance, not exact fill
claims. The next research step is therefore a v2 receipt-to-frozen-dark-candidate adapter followed
by T+1 Databento CBBO replay, not a strategy or production-policy change.

## Acceptance evidence

- a clean Day 1 root plus clean dark siblings emits one deterministic family group;
- the receipt exposes root/dark posture and release block truthfully;
- original and overlaid quantities are both retained;
- an originally blocked dark decision is excluded;
- a post-preparation capacity block is excluded;
- a dark block without valid Day 1 provenance is excluded;
- the release tap is statically pinned before global arbitration;
- the non-release native observer remains supported;
- the runtime adapter and pure model retain no execution, broker-order, database-client, or timer
  authority beyond the existing persistence adapter.

