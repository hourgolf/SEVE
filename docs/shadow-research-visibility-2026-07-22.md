# Shadow Research visibility — 2026-07-22

Status: implementation candidate; no strategy, roster, risk, quantity, worker, schema, or production change.

## Operator job

The Research workspace answers four different questions without pretending they
are the same evidence:

1. Did the dark/VB fleet produce reconstructed paths today?
2. Which hypotheses were directionally interesting or poor on the native
   capital-blind basis?
3. Has the session received checksum-bound exact quote/manager replay?
4. Which manager interactions are worth preregistering for additional evidence?

It has no controls that can arm, mute, resize, promote, place, or close an order.

## Live ledger check

Read-only aggregation of `virtual_trades`, grouped by New York session:

| Session | All paths | VB paths | Winners | Native sum / contract | Target | Stop | Flatten |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2026-07-22 | 141 | 104 | 68 | -$1,627.68 | 65 | 72 | 4 |
| 2026-07-21 | 152 | 120 | 74 | -$343.11 | 71 | 73 | 8 |

These totals are correlated virtual would-haves and are not portfolio P&L.
They are intentionally labeled **same-day native paths** in the interface.
Within the VB lane alone, July 22 was 50/104 positive with a native average of
-$7.52/path; July 21 was 55/120 positive with a native average of -$3.37/path.

Selected July 22 native observations:

- `vb-ribbon-cross`: 1 path, +$53.76/contract.
- `vb-or-fail`: 2 paths, +$18.75/path.
- `vb-curl-reversal-qqq`: 6 paths, +$5.95/path.
- `vb-vwap-revert`: 6 paths, +$2.35/path.
- `vb-macd-state`: 6 paths, -$27.02/path.
- `vb-rsi-revert-qqq`: 1 path, -$52.80/path.

Those are descriptive leads, not promotion or rejection decisions. Small
cohorts and shared clocks make naive ranking especially unsafe.

## July 21 exact layer

The interface includes the reviewed, immutable July 21 replay receipt:

- candidate SHA-256:
  `f438c3d0874bbfd6a0fdc19ce480504dccf5fbd083e0ebb413226e4553887811`
- report SHA-256:
  `44c5299b4660df1f8873e09b1182b5a05b4f7a634aa47b193962d790e986e6c5`
- 138 frozen raw candidate clocks
- 124 exact-eligible candidates
- 14 truthful exact censors; zero missing contracts
- 995 of 1,107 expected manager arms completed
- 993 independent manager paths, including 830 VB paths

The leading aggregate manager arms were `WIDE20/50` (+$3.36/path over 103
paths) and `LOCK20/30` (+$2.77/path over 104 paths). These are pooled
descriptive results, not a recommendation to apply either manager globally.
The UI also exposes selected channel × manager interactions so future tests can
be preregistered at the interaction level instead of promoting a pooled winner.

## July 22 exact gate

July 22 exact replay remains pending the strict provider T+1 gate at
`2026-07-23T19:55:02Z` (12:55:02 PM Pacific). Before that gate the interface
must show the native layer as provisional and exact evidence as pending or
missing. No snapshot, approximate quote, or early provider request may be
substituted.

## Read and cost discipline

- The modern hook is page-owned and runs only while desktop Research or mobile
  Review is visible.
- It reads at most five calendar days and 2,000 rows.
- The visibility poll is ten minutes, not the trading feed cadence.
- The legacy panel is reduced from an unbounded all-history 5,000-row read to a
  30-day, 2,000-row read and classifies VB membership by durable `vb-*` identity
  instead of the obsolete `blocked=not_armed` reason.
- A later database aggregate/read model can reduce egress further after the
  operator authorizes schema work; it is not required to expose tomorrow's
  captured evidence safely.

## Tomorrow gates

Before open:

- release ID and sealed configuration unchanged;
- paper-only mode and three bound paper accounts confirmed;
- process/run ledger, stream, cron, market data, reconciliation, incident,
  12/60 capture, and eight-arm observer checked read-only;
- hosted morning publisher receipt must match the expected session/forDate;
- Research workspace must show native data without implying exact completion.

After 12:55:02 PM Pacific:

- request only the frozen July 22 OCC symbols/windows;
- stop on provider refusal, identity/checksum mismatch, missing exact contracts,
  or quote gaps;
- write only local content-addressed replay/report artifacts;
- do not change the desk from replay results during the live session.
