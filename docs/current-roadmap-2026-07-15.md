# SEVE current-state roadmap — updated 2026-07-16

Status: canonical operating roadmap after the July 16 paper session. This supersedes dated status
sections in earlier handoffs and implementation logs; those remain historical receipts.

SEVE remains paper-only. Nothing here authorizes live-money trading, automatic channel promotion,
unreviewed strategy/config changes, or a production deploy.

## 1. Product north star

SEVE is becoming an operating system for **swappable, versioned strategy channels**, not an entry
collector with a dashboard attached.

```text
trusted market + execution data
  -> reproducible trade path
  -> channel hypothesis
  -> preregistered policy test
  -> untouched prospective holdout
  -> dark/shadow manager
  -> paper activation
  -> operator control + attribution
  -> promote / alter / bench as a new policy version
```

A credible channel must preserve:

- what admitted the trade and which executable quote path it used;
- channel-specific stop, target, scale, runner, time-exit, event, and risk rules;
- native manager behavior versus each shadow policy;
- sibling collisions, occupancy, buying power, and the shared opportunity clock;
- strategy-native outcomes versus operator actions, tests, corrections, and censored rows;
- the policy version, data provenance, and evidence window behind every claim.

There is no four-contract minimum. Multiple contracts are useful because they permit scaling research;
two are enough for an integer bank/runner arm. Final size is a channel and risk decision.

## 2. Current evidence baseline

Phase 1K-C is merged. Its July 13–14 development cohort has exact traded-contract OPRA consolidated
NBBO at one-second cadence:

- 101/101 native outcomes have an eligible exact path;
- 653,824 valid CBBO-1s rows across 34 session-contracts;
- compressed local footprint: 6.19 MiB; observed Databento cost: about $0.10;
- five MOMO/VB scale-out arms are frozen as `phase1k-c-preregister-v1`;
- `vb-ribbon-cross` native management remains the control;
- no result may automatically alter policy or promote a channel.

These are development results from two correlated sessions, not edge validation. They support two
important separations: entry quality is not realized exit quality, and one fleet-wide manager is not
credible. The July 15 paper session is complete and must be scored as an untouched prospective holdout
without changing the frozen selectors or thresholds.

## 3. Current implementation state

Production baseline before this research-only review branch: `main@241525d`.

| Area | State | Receipt / remaining gate |
|---|---|---|
| Phase 1I dark controls | Merged | Exit and family-collision observations exist; no execution authority. |
| Phase 1J observer scorecard | Merged | Dark evidence can be graded; promotion remains human. |
| Phase 1K-A evidence audit | Merged | Fleet evidence readiness inventoried. |
| Phase 1K-B path reconstruction | Merged | Censored exact option paths reconstructed. |
| Phase 1K-C preregistration | Merged | Development selectors frozen before July 15 scoring. |
| Operator authentication | Merged | Desktop auth restored; authorized operator writes are gated. |
| Manual close + reason | Merged | Desktop/mobile actionable positions share the deliberate close flow. |
| Markets workspace | Merged | Chart, option chain, contract detail; open risk stays pinned. |
| Positions workspace | Merged | Actionable book, aggregate exposure, recent exit context. |
| Worker incident ledger | Merged + production green | Long-running-current-run false `W-empty` fixed; 59/59 pure checks. |
| Sentinel workspace | Not started | Full evidence, provenance, freshness, deterministic vs interpretive split. |
| Event Tape / Review | Not started | Live execution versus after-action evidence. |
| Ops workspace | Not started | Auth/settings/preflight/health/safety consolidation. |
| Strategy cartridge/passport | Contract merged | Pure V1 + read-only 68-channel inventory complete; systemic policy stamps identified; no runtime wiring. |
| Session evidence correctness | Merged + deployed | V2 immediate manager admission, closed-row truth, and resilient market reads are live; strategy and execution policy remain unchanged. |
| Phase 1K-D | Complete; review only | July 15 exact holdout scored unchanged against `phase1k-c-preregister-v1`; receipt and results are preserved in the research review branch. |
| Phase 1K-E | Frozen; accumulating | PB, ORB, Grind, QQQ, and IWM tests were frozen before the July 16+ prospective window; evidence floors require at least five independent sessions. |
| Phase 1K-F | Merged + deployed; first-session validation pending | Execution-quality receipts are observation-only and live. Reconcile the next session's eligible exits before activating any alert thresholds. |
| Phase 1K-G | Default-off runtime in review | Held-contract OPRA capture reuses manager-book requests, buffers position-scoped evidence off-path, and writes verified R2 segments plus private receipts. The 52-check suite is green; migration is unapplied and production flag remains absent/off. |

The seam remains load-bearing:

```text
app/page.tsx owns remote reads
  -> SurfaceProps
  -> desktop/mobile shells compose
  -> leaves remain subscription-free where practical
```

Legacy Rooms remains available until each required operator job has a useful, tested native home.

## 4. Phase 1K-D — untouched July 15 holdout

The completed July 15 historical CBBO-1s gate produced:

- 94 held positions, 89 strategy-native outcomes, and five operator-managed outcomes kept separate;
- 86 exact eligible positions from 555,969 CBBO-1s rows;
- two native positions censored for missing in-window quotes, never scored as zero;
- a maximum same-OCC overlap of six positions / 66 contracts, confirming that fleet rows are not independent evidence;
- a one-session MOMO result where the +15% half-bank arms reduced loss and drawdown versus native management;
- a one-session VB result where both frozen +15% scale arms underperformed native management.

These are holdout observations, not edge validation or production authority. The frozen rules and full
decision boundary are recorded in `docs/phase1k-d-holdout-results-2026-07-16.md`.

The gate executed the following unchanged protocol:

1. read the final ledger and acquire only exact OCC contracts traded July 15;
2. store a new content-addressed local object and checksum manifest;
3. verify source, quote validity, start/end lag, internal gaps, and booked outcome;
4. score `phase1k-c-preregister-v1` without changing a selector or threshold;
5. report MOMO Shape and Shape-2 separately: better/worse/unchanged trades, drawdown,
   bank-trigger rate, and native versus modeled distribution;
6. retain `vb-ribbon-cross` native management as control;
7. extend matched-clock/admission diagnostics for PB, ORB, Grind, QQQ/IWM, and VB without changing
   roster or runtime configuration;
8. classify missing/invalid paths as **censored**, never zero.

If July 15 suggests another threshold, that becomes a new policy version with a future holdout. This
session cannot both tune and validate the same rule.

## 5. Strategy cartridge and evidence passport

The next architecture contract is pure, versioned, and independent of dashboard chrome.

Minimum cartridge fields:

- identity: channel/slug, family, hypothesis, underlying, executor, version;
- admission: market inputs, cadence, clock, conditions, event policy, option selector;
- risk: budget, cap, daily entry latch, concentration, collision family;
- management: premium/underlying stop, banks, runner allocation, giveback/stall/time/EOD behavior,
  and minimum quantity for each arm;
- observability: decision, rejection, order, fill, path, manager, outcome evidence;
- lifecycle: draft, dark, paper, benched, disabled—promotion is always human;
- display contract: which live facts and research facts each surface may show.

Minimum passport fields:

- development cutoff and prospective holdout start;
- independent sessions, matched opportunity clocks, and family collisions;
- native/operator/test/correction/censored partitions;
- quote and outcome provenance;
- MFE, MAE, realized/MFE capture, modeled/native delta, and current blockers;
- policy era and explicit statement of whether evidence is development or prospective.

This is where per-channel stops, scaling, and swappable managers belong. They must not be inferred from
UI labels or hard-coded slug lists.

## 6. Dashboard workspaces and remaining parity

| Workspace | Native capability now | Next functional work |
|---|---|---|
| Dashboard | account/NAV/day/open/risk, incident, compact book truth | Bring forward useful day-book/P&L attribution only after basis is explicit. |
| Markets | chart + chain + contract detail | Authenticated contract drill and mobile density regression. |
| Positions | close/reason, marks, peaks, exposure, recent exits | Full authenticated production drill with a controlled paper position. |
| Channels | fleet + selected-channel controls/evidence | Cartridge-backed stop/target/size/posture and evidence passport; remove placeholder metrics. |
| Sentinel | global compact status | Build the full deterministic/interpretive evidence workspace. |
| Event Tape / Review | partial tape/review on existing surfaces | Separate live execution from after-action analysis; link event to trade/channel evidence. |
| Ops | health available globally; settings/auth fragmented | One obvious home for auth, process/stream/cron, capture, preflight, transport, safety. |

Desktop and mobile may feel different while sharing truth and actions:

- **Desktop PERFORM:** adaptive action surface—incident, actionable positions, chart, Sentinel, tape.
- **Desktop STUDIO:** fleet exceptions and selected-channel mixer, not a research leaderboard.
- **Mobile PLAY:** chart plus immediate position action.
- **Mobile STUDIO:** touch-safe channel inspection and controls.
- **Mobile BOOK:** positions and manual close first, then aggregate exposure.
- **Mobile REVIEW:** versioned passports/session evidence with provenance.
- **Mobile OPS:** incident, worker/capture health, reconciliation, auth, settings.

Every performance number must identify its window, policy era, quote basis, outcome partition, and
development/prospective status. `pk` and win rate can be useful, but neither is a standalone verdict.

## 7. Ordered work from here

1. **Complete:** worker-ledger long-run correction is merged, deployed, and production-smoked green.
2. **Complete; human review required:** Phase 1K-D scored the July 15 holdout unchanged. No policy or production change is authorized.
3. **Frozen and accumulating:** Phase 1K-E evaluates PB, ORB, Grind, QQQ, and IWM beginning July 16; do not score a final verdict before its minimum five-session evidence floors are met.
4. **Next evidence gate:** reconcile Phase 1K-F receipts against the next paper session's eligible exits; missing cron-failover and late-recovery evidence stays explicit.
5. **Next evidence build:** complete Phase 1K-G held-contract OPRA capture from the reviewed pure foundation. Wire it observation-only, off the order path, behind a default-off flag; preserve strict manager-v1 quote semantics.
6. **Next dashboard slice:** build Sentinel with provenance and freshness; no LLM claim in health logic.
7. **Then:** build Event Tape / Review with live versus after-action separation.
8. **Then:** consolidate Ops/auth/preflight/safety and complete authenticated operator drills.
9. **Then:** reshape Channels around cartridge controls and evidence passports; test PB, ORB, Grind,
   MOMO, QQQ/IWM, and VB as separate hypotheses and policy eras.
10. **Only after parity:** retire Legacy Rooms.
11. **Finally:** finish exact 909 aesthetic tuning, responsive sizing, contrast, density, and blackout skin.

## 8. Release gates

Every implementation slice requires:

- fresh branch from latest `origin/main` and scoped commits;
- pure/self-tests for policy or derivation logic;
- clean TypeScript and production build;
- desktop and mobile browser checks, including authenticated write paths when relevant;
- no duplicate reads across the page seam;
- explicit preview review before merge;
- post-merge production smoke test;
- worker version bump and heartbeat verification only for a separately approved worker release.

UI-only work does not authorize a Railway deploy. No result authorizes live trading.
