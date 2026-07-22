# Market-hours evidence hardening — 2026-07-22

Status: prepared and verified on `work/market-hours-evidence-2026-07-22` from
`main@44c822886b4a630e12d12ec8544c13f59784f032`. No merge, push, deployment,
Supabase/R2 mutation, schema change, roster/strategy/risk/quantity change, or
order action has occurred.

## Hosted morning publisher

The hosted publisher previously treated any current Sentinel row as proof that
the GitHub-hosted publication had completed. That was false when the local Mac
publisher won the race, and unsafe when a hosted attempt stopped after writing
its Sentinel but before its finish receipt.

The corrected boundary is the matching hosted finish receipt. A deterministic
run identity now binds the evidence session, target session, and publisher
version. Retries resume missing start/Sentinel/finish rows without duplicating
already written rows, then read the stored chain back and require exactly one
ordered `start -> Sentinel -> finish` chain. Local Sentinel rows cannot satisfy
the hosted proof.

This does not change Sentinel's interpretive purpose or replace the existing
Claude-authored analysis. It only makes the existing deterministic partial
publisher independently auditable. The broader Sentinel purpose review remains
design-only and scheduled after market.

## Dark/VB evidence completeness

`dark-evidence-completeness-v1` converts the existing frozen-candidate and exact
scorecard artifacts into one deterministic session state:

- `no_candidates`: zero valid candidates and zero evidence censors;
- `exact_pending`: candidates are frozen and the strict T+1 gate is not open;
- `complete`: every candidate has one eligible exact scorecard and every
  expected manager arm;
- `partial`: a mixture of complete and pending/censored evidence;
- `censored`: evidence is unusable or still missing after the exact gate.

The contract reports source signals, frozen candidates, freeze censors, exact
contracts, exact scorecards, eligible/censored/missing paths, manager-arm
coverage, blockers, and per-channel coverage. It cannot write externally,
authorize an order, or authorize a policy change. A fixture-only panel exposes
the states for 909/Folio product work without subscribing to live data.

## July 21 exact replay gate

The frozen local ledger is unchanged:

- file SHA-256: `f438c3d0874bbfd6a0fdc19ce480504dccf5fbd083e0ebb413226e4553887811`;
- 138 candidates;
- 34 exact OCC contracts;
- one evidence session: `2026-07-21`;
- strict gate: `2026-07-22T19:59:02.755Z` (12:59:02.755 Pacific).

A metadata-only Databento cost request was blocked before execution because it
would transmit the private frozen contract list to an external provider. No
contract metadata or quote data was sent. The replay remains sealed until the
operator explicitly authorizes that disclosure after being informed of it.

## Verification

- root TypeScript: clean;
- production build: clean, including `/fixture-lab`;
- fixture lane: 12/12;
- dark candidate freeze: 21/21;
- VB candidate evidence: 37/37;
- exact batch planner: 8/8;
- dark evidence completeness: 11/11;
- remote publisher policy: 22/22;
- hosted receipt chain: 9/9;
- Sentinel receipt: 31/31;
- maintained market calendar: pass;
- `git diff --check`: clean.

## Review boundary

The branch can be reviewed during the session, but it should not be merged or
deployed while the desk is active. The July 21 Databento replay is a separate
read-only action after the strict gate and explicit provider-disclosure approval.
