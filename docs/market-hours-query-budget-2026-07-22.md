# Market-hours read and egress budget — 2026-07-22

Status: local preparation only. No push, merge, deployment, schema change, or
production mutation was performed during the session.

## Read-only live baseline

The bounded readiness gate passed during the July 22 session:

- paper broker origin and paper fund mode;
- current worker `stream-2026-07-21b`, clean and five seconds fresh at read time;
- sealed release `weekend-day1-2026-07-21-rc5.3` with matching configuration;
- three active, distinct, flat paper accounts reconciled to the flat desk book;
- six sealed roots ready and nineteen other armed database rows suppressed to
  dark evidence by the release overlay;
- 12/60 held-capture policy and eight-arm observer requirement present.

This was a zero-open-position baseline. It proves runtime identity and
reconciliation, not today's eventual fill/capture completeness.

## Hotspot 1: open-position peak scans

The browser queried `option_quotes` once per open contract every 15 seconds,
ordered the since-entry history by `mid`, and retained the maximum. This was
redundant because:

1. the worker already persists the durable `positions.peak_mark`; and
2. `usePositionMarks` already supplies the fast between-ingest mark.

The local fix derives the displayed peak from those two sources and keeps an
in-memory monotonic ratchet. It performs zero remote reads.

Avoided request rate while positions are open: `4 × open-contract count` reads
per minute. Four open contracts therefore avoid sixteen history queries per
minute, in addition to removing their sort/scan I/O.

## Hotspot 2: market refresh amplification

The active chart previously combined three refresh mechanisms:

- a heavy 200-row option-chain safety poll every minute;
- a Realtime trigger on every `underlying_bars` insert, unfiltered by symbol;
- a separate 60-row bar poll every minute.

The Realtime subscription could react to SPY, QQQ, and IWM inserts even when
only one symbol was visible, and every chain refresh also duplicated the bar
read.

The local fix:

- filters Realtime to the selected symbol;
- makes the chain fallback five minutes rather than one minute;
- coalesces triggers within 30 seconds;
- leaves the live 3-second Alpaca spot path unchanged;
- leaves the compact one-minute bar poll unchanged;
- removes bars from the chain/event request and gives bar health to the
  dedicated bar reader.

Expected result: one normal chain refresh per selected-symbol minute instead of
the safety poll plus one or more cross-symbol triggers, while preserving a
five-minute fail-safe if Realtime is unavailable. Recurring bar transfer is no
longer duplicated.

## Verification

- position peak self-test: 8/8;
- market read self-test: 17/17;
- desk-feed egress self-test: 7/7;
- Ops evidence read self-test: 15/15;
- TypeScript: clean;
- production build: clean;
- `git diff --check`: clean.

## Remaining daytime-safe work

1. Observe candidate, fill, held-capture, and manager-arm completeness through
   bounded SELECT-only snapshots. Do not infer completeness from worker health.
2. Prepare a fixture-only research completeness view; no live subscriptions.
3. Inventory the remaining always-on hooks and quantify their request budgets.
4. After the strict T+1 gate, run the authorized exact 34-contract replay to
   local content-addressed output and compute dark/VB completeness.
5. Hold any schema, release, roster, risk, or strategy change for after close.
