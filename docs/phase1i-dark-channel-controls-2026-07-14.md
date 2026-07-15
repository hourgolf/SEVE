# Phase 1I — dark channel-specific exits and family admission

Status: merged and deployed for dark production observation at main
`386f4c620f347739f0ddd8c7509486998f2b4468`. The database migration and worker
observer are live. Strategy configuration, paper orders, and dashboard behavior
remain unchanged.

## Why this exists

The July 14 session rejected the idea of a single fleet-wide exit. A +15%
half-bank with a half-of-peak runner improved the observed `pb-ride-2` paths,
while the same shape reduced `vb-ribbon-cross` results. The same session also
showed repeated PB and SPY-ORB entries expressing one directional thesis at the
same minute. Exit fit and family admission are therefore measured separately.

## Dark exit candidate

`PB2-BANK15/HALF-GIVEBACK` is enrolled only for `pb-ride-2`:

- before banking, the research stop is -30%;
- at the first executable bid at or above +15%, bank the smaller half of an odd
  integer lot and retain the larger half as runner;
- ratchet the runner's executable-bid peak;
- exit the runner when its return falls to half that peak, floored at 0%;
- otherwise mark the runner at the session cutoff;
- calculate the combined return and P&L with actual integer tranche sizes.

The candidate supports source quantities of two or more contracts. The older
portable-manager cohort retains its preregistered four-contract minimum. A
one-contract position cannot model an executable scale-out and is excluded,
not fractionally invented.

This remains counterfactual. It has no execution import, and no active channel
configuration points to it.

## Family-admission observer

The observer records collisions only when at least two otherwise accepted
entry decisions share family, source bar, underlying, and option side.

- PB: `pb-ride`, `pb-ride-2`, `pb-ride-itm`
- SPY ORB: `orb-trend-rider`, `orb-ustop`, `orb-ustop-ctl`

`orb-qqq-trail` is intentionally excluded: prefix matching would silently pool
a different underlying and thesis. QQQ family design needs its own evidence.

Each append-only receipt stores every candidate's deterministic opportunity id,
account, OCC, quantity, executable ask, and reason. It emits one arm per possible
sole survivor. The observer does not choose a winner by current iteration order,
historical P&L, or an invented confidence score; later outcomes can grade every
survivor arm against the native cluster through existing opportunity lineage.

The runtime queue is best-effort and non-blocking. Execution never reads the new
table. Missing persistence can lose research evidence only.

## Release order and review clock

If this branch is approved for dark production observation:

1. apply `20260714220000_phase_1i_family_admission_observer.sql`;
2. deploy the worker with both observers enabled by the existing manager-shadow
   runtime;
3. verify new family receipts, manager enrollments, flat books, and unchanged
   broker decisions;
4. collect out-of-sample paper sessions before any promotion discussion.

The first review should require multiple independent session dates and both
winning and losing paths. A useful initial evidence floor is 20 triggered
`pb-ride-2` staged paths and 10 PB/ORB collision groups across at least five
sessions. That is a review threshold, not an automatic promotion rule. Regime
concentration, quote gaps, native-close censoring, and slippage sensitivity can
still reject the candidate.

## Verification

- worker TypeScript: clean
- application TypeScript: clean
- manager shadow policy: 17/17
- durable manager shadow book: 140/140
- family admission model: 13/13
- database design: append-only UUID identity, explicit checks, indexed worker
  foreign key, RLS enabled, authenticated operator read only, service-role
  select/insert only
- `.venv-databento/` remains untracked and untouched
