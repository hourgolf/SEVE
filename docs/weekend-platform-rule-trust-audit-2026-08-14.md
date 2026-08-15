# SEVE platform-rule trust audit · 2026-08-14

**Read-only production evidence plus local research correction. No roster, order, manager, sizing, routing, or configuration change.**

## Verdict

The concern is partly correct. SEVE's risk and admission rules do not inherently corrupt channel research, but they do if executed trades are treated as the channel's complete opportunity set. The current stack must keep four facts separate:

1. **Raw setup:** the channel entered a durable setup state.
2. **Executable setup:** an exact contract and fresh executable quote existed.
3. **Platform decision:** account capacity, entry limits, priority, occupancy, and collision rules admitted or blocked it.
4. **Native result:** the channel's own manager handled the admitted position.

The order path should retain hard validity checks. Research must preserve every earlier layer and replay policy gates independently.

## Confirmed measurement defect

The Decision Atlas adapter previously copied every `signals` polling row into prospective opportunities. A persistent setup could therefore contribute hundreds or thousands of ambient once-per-minute rows even though only a small number of non-overlapping native paths existed.

The local correction now:

- excludes signal rows with neither an execution receipt nor a durable virtual path;
- groups overlapping virtual paths into one natural opportunity episode;
- permits a new episode only after the first native path ends;
- reports raw rows, evidence-backed rows, excluded ambient rows, virtual paths, and opportunity episodes separately.

Across the frozen 2026-08-14 snapshot, Atlas input fell from **43,210** rows to **7,480** evidence-backed rows and deduplicated to **7,337** logical rows. `vb-vwap-revert-qqq` fell from **650 claimed opportunities / 18 scored** in the latest three-session era to **18 opportunities / 18 scored**. Its result did not change; only the false denominator disappeared.

## Exact blocked-candidate lane now operating

The first checksum-gated T+1 run scored the 2026-08-13 suppressed-candidate cohort against exact Databento CBBO-1s paths:

- 997 frozen candidate clocks and 997 exact path receipts;
- 1,192 independent executable-bid manager paths;
- 6,789 explicit arm censors caused by overlapping manager-specific re-entry or no executable terminal bid;
- 29 exact contracts at a quoted provider cost of $0.098625, below the $0.25/session ceiling;
- 1,994 content-addressed R2 objects verified byte-for-byte;
- 997/997 candidate, 997/997 exact-path, and 1,192/1,192 manager-path database readbacks verified;
- zero event writes and no order, configuration, roster, route, manager, or sizing authority.

The first run is one independent session, so it diagnoses what the platform suppressed or protected but does not by itself authorize a channel change. The nightly Atlas now carries the result into a concise per-channel platform-effect line and keeps the censor/provenance detail behind Sources.

Executed logical trades and fill-linked manager paths were not affected by this defect.

## What the current policy replay can and cannot say

The prior-epoch desk replay covered three sessions. It found 94 modeled candidates but 68 eligible signals without complete paths, and baseline reproduction matched only 29 of 33 acted signals. That is not sufficient for a desk-wide causal conclusion.

Within the covered subset:

- broad extra capacity generally reduced the replayed result;
- unrestricted Account 2 two-slot capacity was negative;
- the bounded Account 3 `breakout-alt-v3-itm` overflow was positive by $76;
- priority alternatives produced large one-session changes, so they remain hypotheses rather than stable rules.

This evidence does **not** support removing platform caps globally. It supports one-policy-at-a-time, channel-specific ablation with complete paths.

## Rules by role

| Rule | Execution posture | Research posture |
|---|---|---|
| Invalid/missing contract, stale or absent quote, insufficient buying power | Keep hard | Record the censor; never invent a fill |
| Same-account same-OCC protection | Keep hard | Cross-account same-OCC remains comparable with independent exits |
| Premium cap | Keep current until ablated | Score candidates immediately above/below the channel's cap |
| Entry/re-entry cap | Keep current control | Preserve every blocked native path and compare chronological ordinals |
| Same-clock priority | Keep receipt-bound control | Replay each channel first while holding all other rules fixed |
| Account/global/underlying capacity | Keep receipt-bound control | Add one eligible slot at a time and measure displaced opportunities |
| Native TP/stop/trail | Defines native result | Preserve post-exit path and paired manager arms |

## Retirement correction

Normalizing polling rows changed the redundancy graph enough to move four paused collectors from automatic `retire` to `retune_one_variable`: `vb-pm-trend-qqq`, `vb-macd-state-iwm`, `vb-squeeze-break-iwm`, and `breakout-manual`.

All four remain materially negative on scored paths. Their current pauses should remain while exact capture is repaired, but the prior claim that they were proven redundant was too strong. They should be reassessed as negative channels with a possible unique single-variable hypothesis, not deleted evidence.

## Forward-capture blocker

A production SELECT probe found all three exact candidate sources absent:

- `vb_candidate_receipts`
- `vb_exact_path_receipts`
- `vb_exact_manager_path_receipts`

Their reviewed migrations exist in the repository, but production has not applied them. Until those tables and the T+1 scorer are active, dark/VB research remains dependent on synthetic mid-basis paths and cannot cleanly answer executable-entry or manager questions.

## Monday evidence contract

Every channel should close with one concise line:

`setups → executable → admitted → filled → native result`

And, when something was blocked:

`gate · protected loss · blocked winner · missing exact path`

The nightly packet must fail closed on incomplete exact paths, keep raw signal density out of confidence counts, and show only channel-specific policy hypotheses. No global rule change follows from this audit.

## Go / no-go

- **GO:** merge the Atlas normalization correction after full validation.
- **GO after explicit production-data approval:** apply the three receipt-only migrations and activate the read-only/T+1 exact scorer.
- **GO:** rerun every lifecycle, redundancy, entry-frequency, capacity, and priority conclusion after normalization.
- **NO GO:** remove broad admission protections or change live channel economics from the incomplete replay.
- **NO GO:** delete paused history or treat a synthetic virtual path as executable P&L.
