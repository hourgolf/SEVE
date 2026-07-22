# July 21 Day 1 after-close research receipt

> Historical receipt note: the original virtual session-close boundary admitted one hour of
> after-hours quotes for eight rows. The preserved receipt below is superseded for those paths by
> `docs/july-21-research-boundary-correction-2026-07-21.md`; live paper-trade evidence is unchanged.

Status: research-only evidence published; paper roster and production behavior unchanged.

## Executive result

The live paper book closed five positions for **-$72**. The session nevertheless produced useful
evidence because the five positions completed all 40 preregistered manager arms and the dark/suppressed
candidate lane was reconstructed without incomplete rows.

The primary observation is not that one manager won. It is that exit behavior varied materially by
channel: QQQ favored an early lock, SPY ORB favored a later lock, IWM needed substantially more path
tolerance, and PB's current bell exit was comparatively competitive. This is evidence for
channel-specific managers, not a universal exit change.

## Live paper book

| Channel | Actual P&L | Peak while held | Trough while held | Close |
| --- | ---: | ---: | ---: | --- |
| `momo-shape` | -$70 | +10.6% | -31.9% | premium stop |
| `pb-ride` | +$106 | +48.5% | -15.5% | 15:25 ET flatten |
| `orb-ustop-ctl` | +$42 | +98.2% | -6.3% | 15:25 ET flatten |
| `orb-qqq-trail` | -$100 | +24.3% | -30.2% | premium stop |
| `breakout-alt-v3-iwm` | -$50 | 0.0% | -32.1% | premium stop |

The five trades used two contracts each. Four of five became profitable before the actual exit.

## Preregistered manager observations

All eight arms completed for every position: 40/40 terminal, zero censors.

| Manager | Runs | Winners | Modeled P&L | Average return |
| --- | ---: | ---: | ---: | ---: |
| `WIDE20/50` | 5 | 5 | +$324 | +23.27% |
| `BELL/no-stop` | 5 | 4 | +$298 | +27.21% |
| `BANK20/RUN50` | 5 | 3 | +$101 | +1.16% |
| `LOCK20/30` | 5 | 3 | +$100 | +0.23% |
| `ARM20/HALF-GIVEBACK` | 5 | 3 | +$62 | -2.46% |
| `LOCK50/30` | 5 | 2 | +$6 | -3.59% |
| `LOCK30/30` | 5 | 2 | -$6 | -5.71% |
| `BELL/-30` | 5 | 2 | -$60 | -9.53% |

These are executable-bid counterfactual observations, not actual fills. Five shared-session paths do
not satisfy the evidence floor and cannot authorize a policy change.

## Dark and release-suppressed opportunities

The corrected sequential after-close walk published **152 distinct, complete** rows to
`virtual_trades`:

| Reason | Independent virtual trades | Mid-basis sum per contract |
| --- | ---: | ---: |
| dark lifecycle | 148 | -$341.11 |
| initial SPY collision | 1 | +$27.00 |
| disabled MOMO reentry | 1 | +$6.00 |
| SPY concurrency / Grind | 2 | -$35.00 |

The four root opportunities were previously omitted by the legacy gate-shadow filter. The correction
now includes collision, reentry, same-contract, family, underlying and global-concurrency suppressions,
while preserving sequential one-position-at-a-time coalescing.

The 1,413 raw dark signals collapsed to 148 native virtual trades and 134 versioned dark-candidate
receipts. With the four suppressed-root receipts, the exact-candidate ledger contains 138 retained
receipts and zero fail-closed censors.

Local freeze hashes:

- Candidate receipts: `f438c3d0874bbfd6a0fdc19ce480504dccf5fbd083e0ebb413226e4553887811`.
- Candidate censors: `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`.
- Native virtual-trade ledger: `24ed240146f7bed6e6388e60177ba34536a9fceead2143bf5e0b4c8eb3f20b80`.

The full versioned candidate payload remains local pending the already-designed Gate 2 tables or R2
publication. Because raw signals are short-retention evidence, the T+1 exact-path pass must preserve
these receipts before that source window expires.

The dark aggregate is **not a portfolio result**: it is capital-blind, mid-price, heavily correlated
across siblings and underlying clocks, and uses the channel's current native exit configuration.
It is only a triage surface for choosing which exact paths deserve T+1 validation.

One-session diagnostic leaders included `orb-trend-rider`, `vb-level-break-qqq`,
`vb-vwap-revert-qqq`, `vb-macd-state`, and `momo-shape-2`. One-session laggards included
`vb-macd-state-qqq`, `vb-vwap-revert-iwm`, `vb-curl-reversal-qqq`, and the QQQ/IWM PM-trend lanes.
None is eligible for promotion or rejection from this session.

## Capture and provenance

- Quote archive: 74,376 rows (`SPY` 24,796; `QQQ` 24,784; `IWM` 24,796).
- Capture window: 13:00:03Z through 20:22:01Z.
- Compressed size: 4,374,088 bytes.
- Source: `supabase.option_quotes`; this is not exact exchange CBBO.
- Content SHA-256: `e2ea16947f79530e0c61f9577387ce435ea425ab8fa4d11a8f95a5604b2f31c2`.
- Compressed SHA-256: `14d6f15dcf864e9a7c7b5eed30238d81621298c3c732ee54d0df9ecdb2f3adb0`.
- Manifest SHA-256: `7ff788465a79b0ed3cd50956afd8343112372943f9dfe14798abf0fa6b0c7e41`.
- Object and manifest verified at 20:22:41Z.
- Sentinel virtual-trade query smoke: pass after publication.

## Decisions and next gates

1. Keep RC5.3 and the six-root paper roster unchanged for the next session.
2. Accumulate the same eight manager arms by channel for at least 10 independent opportunities and
   five independent sessions before selecting an exit policy.
3. Cluster sibling candidates by channel version, configuration epoch, session and source clock before
   scoring; do not treat correlated siblings as independent evidence.
4. At the T+1 availability gate, validate the 138 retained candidates against exact Databento paths.
5. Automate the session-dated gate-shadow publication after close so evidence cannot silently remain
   in raw signals while `virtual_trades` is empty.
6. Investigate why `family_admission_observations` is structurally empty under the one-root-per-family
   release and decide whether a separate dark-family observation contract is needed.

No order, position, schema, strategy configuration, release, merge, or deployment was changed by this
after-close pass.
