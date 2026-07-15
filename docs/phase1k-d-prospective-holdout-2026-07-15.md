# Phase 1K-D — July 15 prospective holdout

Status: cohort frozen after the completed July 15 paper session; exact Databento CBBO-1s acquisition
and preregistered scoring pending T+1 historical availability. Research-only. No Supabase/R2 write,
strategy change, order, worker change, dashboard change, deployment, or promotion authority.

## Frozen cohort receipt

The final read-only ledger audit was generated at `2026-07-15T22:30:15.822Z` and stored locally at:

`data/trade-path-audits/2026-07-15-frozen.json`

The file is intentionally git-ignored. Its immutable receipt is:

- SHA-256: `a283d38758497f59505f9ee050159f27c80fc8f1ade9b273a281c66074808f53`;
- ET window: `2026-07-15` only;
- 94 closed trades total;
- 89 strategy-native outcomes;
- five operator-managed outcomes, retained but excluded from native strategy credit;
- preliminary one-minute path view: 87/89 native outcomes comparable, two censored;
- preliminary comparable native P&L: -$80; censored native P&L: -$198;
- 93/94 positions have intraminute source-minute receipts;
- zero rows currently claim checksum-verified exact CBBO-1s evidence.

The preliminary path numbers are readiness diagnostics, not the holdout score. Missing exact paths are
censored, never zero.

## T+1 input hardening

`backfill-trade-option-paths.ts` now accepts `--held-receipt`. With that flag it:

- reads contract, position, open, and close facts from the frozen receipt instead of live Supabase;
- rejects malformed rows, invalid OCC symbols, duplicate position IDs, and a mismatched date window;
- hashes the frozen receipt and records its SHA-256 plus source filename in the Databento manifest;
- still estimates cost before download;
- remains Databento read-only and writes only local content-addressed objects/manifests.

This prevents a later reason-tag edit or other ledger change from silently changing the prospective
holdout cohort.

## Frozen scoring contract

The July 15 exact paths will be scored with `phase1k-c-preregister-v1` unchanged:

1. MOMO bank half at +15%, native runner;
2. MOMO bank half at +15%, half-peak-giveback runner;
3. MOMO bank half at +20%, half-peak-giveback runner;
4. `vb-ribbon-cross` bank half at +15%, native runner;
5. `vb-ribbon-cross` bank half at +15%, half-peak-giveback runner.

MOMO Shape and Shape-2 remain separate. VB native management remains the control. Any new threshold
becomes a new policy version and must use a later untouched session.

## T+1 runbook

Once the ET date is later than July 15 and Databento reports a cost:

```text
npm run backfill:trade-option-paths -- \
  --from 2026-07-15 --through 2026-07-15 \
  --held-receipt data/trade-path-audits/2026-07-15-frozen.json
```

Review the exact contract count and cost. Only then repeat with `--download`. After checksum and row-count
verification, rebuild the July 15 trade-path audit with that manifest and run the existing preregistered
path scorer against the holdout-only receipt.

## Verification so far

- frozen receipt: 94 rows; checksum recorded above;
- exact-path pure self-test: 13/13;
- root TypeScript: clean after dependency setup;
- same-day guard remains intact: July 15 cannot be requested as historical input on July 15;
- no holdout result viewed; no frozen selector or threshold changed.
