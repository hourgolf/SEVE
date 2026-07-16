# Phase 1K-D — rolling historical gate runbook

Status: research-only preparation. No Supabase write, R2 write, strategy,
worker, dashboard, order, merge, deploy, or production change is authorized.

## Frozen inputs

- branch baseline: `phase1k-d-prospective-holdout@e4546fd` before this
  reporting preparation;
- frozen July 15 receipt:
  `data/trade-path-audits/2026-07-15-frozen.json`;
- required SHA-256:
  `a283d38758497f59505f9ee050159f27c80fc8f1ade9b273a281c66074808f53`;
- frozen policy: `phase1k-c-preregister-v1`;
- frozen arms: the three MOMO and two VB-ribbon arms already registered before
  July 15;
- targets, runner rules, minimum quantity, stop behavior, eligibility, and
  channel selectors remain unchanged.

## Pre-gate integrity result

The frozen receipt passes the local integrity audit:

- 94 positions / 94 unique position IDs;
- 89 native outcomes, native P&L **-$278** before path censoring;
- five operator-managed outcomes, **+$2,342**, excluded from native scoring;
- four `manual:target` and one `manual:reversal`, all correctly attributed;
- two native paths currently censored for `no_window_quotes`:
  `grind-v3` +$84 and `vb-squeeze-break-qqq` -$282;
- no open/unresolved position, duplicate logical trade, invalid timeline,
  invalid quantity, broken runner lineage, or accidental promotion flag;
- 23 same-clock multi-channel groups;
- maximum observed same-OCC overlap: six positions / 66 contracts on
  `SPY260715P00752000`.

OCC overlap is not ledger corruption and does not block exact-path recovery.
It is material portfolio concentration that must remain visible beside any
per-trade manager result.

## Exact gate sequence

Run from the Phase 1K-D worktree. Stop on the first failed integrity check.

1. Recompute the frozen-receipt checksum and local ledger audit.
2. Request Databento's cost estimate only:

   ```text
   npm run backfill:trade-option-paths -- --from 2026-07-15 --through 2026-07-15 --held-receipt data/trade-path-audits/2026-07-15-frozen.json
   ```

3. If historical CBBO-1s is available and the estimate is consistent with an
   exact-contract request, repeat the command with `--download`.
4. Verify the content-addressed object's checksum and row count against the
   July 15 manifest.
5. Rebuild paths from the **frozen receipt**, not a mutable live-ledger reread:

   ```text
   npm run rebuild:held-trade-path-audit
   ```

6. Score the unchanged preregistration:

   ```text
   npm run preregistered-path-tests -- --input data/trade-path-audits/2026-07-15-cbbo1s.json --out data/preregistered-path-tests/phase1k-d-holdout-2026-07-15.json
   ```

7. Render the decision receipt:

   ```text
   npm run phase1k-d-report
   ```

All generated objects and reports stay local and git-ignored. No R2 upload is
part of this gate.

## July 15 gate receipt and corrected timing

The first attempt ran at `2026-07-15 21:05 PDT`, after the ET date changed but
before the exact quotes were old enough for unlicensed historical access.

- frozen receipt checksum: PASS;
- ledger integrity audit: PASS;
- exact-contract estimate: 30 session-contracts, **$0.085053**;
- range request: HTTP 403 `license_not_found_unauthorized`;
- provider wording: a live-data license was required for the requested
  `OPRA.PILLAR` range;
- local object/manifest writes: none;
- Supabase/R2/production writes: none.

Databento separates the latest rolling 24 hours from pay-as-you-go historical
access. Midnight ET is not the gate. The frozen cohort's newest requested quote
is `2026-07-15T18:58:46.610Z`, so the pure download preflight opens at
`2026-07-16T18:58:46.610Z` (11:58:46 PDT). The retry is intentionally buffered
until 12:15 PDT. The preflight derives this boundary from the exact frozen
request and fails locally before any premature range call.

Provider references: Databento's [market-data licensing
guide](https://databento.com/blog/introduction-market-data-licensing) defines
historical access as data at least 24 hours old, while its
[quickstart](https://databento.com/docs/quickstart) describes the latest 24
hours as live coverage subject to exchange restrictions.

## Required output

The report must show:

- object and receipt checksums, exact row count, and exact-path eligibility;
- all five frozen arms in their original order;
- trigger rate, native P&L, modeled P&L, and modeled-native delta;
- better / worse / unchanged trades;
- median delta, best/worst trade, and native/model max drawdown;
- `momo-shape` and `momo-shape-2` separately;
- VB-ribbon native behavior as the explicit control;
- every censored path and reason;
- matched-clock and admission diagnostics for PB, ORB, Grind, QQQ, and IWM;
- the 66-contract same-OCC concentration beside event-level results.

## Interpretation boundary

Tonight may answer whether the pre-July-15 MOMO/VB hypotheses survive one
untouched day. It may not establish an edge.

- A favorable MOMO aggregate with opposite Shape/Shape-2 results rejects a
  fleet-wide manager conclusion.
- A favorable total driven by one or two trades, one channel, or one collision
  cluster is tail evidence, not validation.
- A VB scale-out that trails native management leaves native VB as control.
- Any newly attractive target or runner becomes a new version with a later
  holdout; July 15 cannot tune and validate it.
- Operator-managed outcomes remain entry-path context only and cannot validate
  native exit behavior.
- Event-level P&L must be read beside OCC occupancy; freed capital is not
  automatically assumed to be redeployed.
- No result promotes, benches, resizes, arms, mutes, or deploys anything.

If Databento is not ready after the derived rolling boundary, record the
provider response and stop. Do not weaken the date/age guards, buy a live
license for this test, or substitute minute snapshots.
