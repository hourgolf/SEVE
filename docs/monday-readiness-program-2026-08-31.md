# SEVE Monday readiness program — August 31, 2026

Status: AUTHORIZED / IN PROGRESS · all four bounded production actions approved August 31 before 04:56 Pacific · objective incomplete · Monday read-only check unchanged.

## Objective

Finish the six readiness items below, preserve the existing paper desk, and deliver separate trading and research GO/NO-GO decisions before Monday's regular open at 06:30 America/Los_Angeles. A successful Sunday check is not a Monday preopen check. Do not claim this goal complete while required work or approval gates remain.

## Workspaces and evidence

- Dirty original checkout: `/Users/ben/Developer/Projects/SEVE`. Preserve all changes and do not switch its branch.
- Readiness worktree: `/Users/ben/Developer/Projects/SEVE-monday-readiness-20260831`, branch `codex/monday-readiness-2026-08-31`, initially based on `08737635a4f77c55295b80301e9f09bccecfdb60`.
- Recovered study checkout: `/Users/ben/Developer/Projects/SEVE-three-axis-recovered-20260829`, branch `codex/three-axis-recovered-2026-08-29`, initially at `9c3ffd4d2b258bf8b9ee96fbef87cd24bae2cc3d`.
- The old temporary study directory disappeared. Committed study code/docs were recovered; raw inputs were subsequently recovered from the other worktree without changing it. Regeneration reproduced all seven original analytical hashes exactly (details below). New execution receipts differ because paths and generation time changed.
- The readiness worktree was moved intact from the temporary Sunday audit worktree, preserving its downloaded Friday artifacts under `friday-artifact/`.
- Production credentials: use `SEVE_ENV_FILE=/Users/ben/Developer/Projects/SEVE/.env.local` for existing approved diagnostic commands. Never print or commit values.
- Friday source workflow: https://github.com/hourgolf/SEVE/actions/runs/33233391333
- Saturday source workflow: https://github.com/hourgolf/SEVE/actions/runs/33281087108

## Verified Sunday baseline (not permanent expected state)

At approximately 15:50–16:00 Pacific on August 30:

- Current origin/main and live worker Git SHA: `08737635a4f77c55295b80301e9f09bccecfdb60`.
- Railway deployment: `3072df48-63cf-44be-82d7-243dd0ae530d`.
- Active release: `release:proposal:07c47519-ead9-5084-bde8-a0aebee13b78`.
- Active configuration hash: `37b779cc9529a8c70171debc36c4fdf6bf90c149fbf01eee929a4735cbe03c98`.
- Exactly one fresh healthy worker, no reported worker error, and current receipt congruence passed.
- Three distinct paper accounts were reachable, armed, not halted, and flat. Open orders were zero; broker and desk books matched.
- Immutable runtime projection had 25 roots: 10 paper-trading, 15 observe-only. These are not 25 trading channels.
- Production dashboard authenticated successfully; sampled browser warnings/errors were empty.
- Dashboard research was stale through August 26 although raw paths extended through August 28. Sentinel targeted August 27, not August 31.
- Home said nightly research had finished publishing while System correctly showed stale evidence. This is a reporting-status defect, not proof the trading worker failed.
- Broker calendar returned August 31 regular hours 09:30–16:00 Eastern.

At 17:30:58 Pacific on August 30, a separate read-only Supabase management check confirmed the configured feeds: `OPT_FEED=opra` and `STOCK_FEED=sip`. Secret metadata was compared against the expected values; no credentials or secret digests were printed or stored. The deployed `market-ingest` function was ACTIVE, version 11, with JWT verification enabled. These observations confirm settings and deployment state, not independent provider entitlement, actual provider timestamps, or full-session delivery. No feed-setting change is needed for the proposed provenance release.

Read current state and approved release receipts again before any release or Monday GO. Do not use superseded August 21 identities from older automations as the desired current configuration.

## Six workstreams and acceptance criteria

### 1. Atlas retrieval repair

Observed: scheduled Atlas failed with `pageAll: exceeded max rows (50000)`. A Sunday SELECT-only count found 51,764 signals since July 1, 49,542 execution observations, and 3,675 manager shadow runs. Multiple reads lack an explicit through-session upper bound.

Implement deterministic, complete retrieval with explicit session bounds and tests above 50,000 rows, ties at page boundaries, and missing/partial pages. Preserve justified historical evidence; do not silently truncate or merely narrow the cohort until the error disappears. Audit other consumers likely to hit the same ceiling. Validate receipts/counts and reproducibility before claiming the failure resolved.

### 2. Virtual-evidence reconciliation

Observed Friday verifier: 118 local rows, 118 matching-scope remote rows, zero missing IDs, zero duplicates, and 14 payload discrepancies. Two additional remote rows are preserved outside scope. Thursday's recovered artifact independently shows 12 discrepancies with seven additional rows outside scope. There are now TWO exact proposals: 12 Thursday + 14 Friday = 26 virtual rows; nine out-of-scope rows remain untouched.

Cause established at payload level: all 26 rebuilt policies match their immutable source policy, while stored legacy policies differ. Independently replaying the recorded minute quotes with each of the two policies reproduces both respective payloads for every row. Thus these discrepancies are explained by policy differences, not a missing fill. They remain legacy minute-mid target/stop/flatten simulations, NOT actual native-manager or executable-bid performance. Four Friday plus two Thursday rows are metadata-only; ten on each day change simulated results. Repairs can reduce profits as well as increase them.

The process that wrote the unstamped legacy rows has not been positively identified. Updated code refuses unstamped rolling publication, but that does not retroactively fence an obsolete collector running another checkout. Never use the dirty original checkout's older collector for the recovery; recheck for recurrence after release.

Trace original entry-time configuration and quote provenance versus reconstruction policy. Do not assume the local rebuild or current stored values are correct. Distinguish policy-era differences, reconstruction defects, and genuinely corrupt research rows. Produce an exact before/after proposal with table, stable IDs, hashes, rationale, preconditions, readback verification and rollback. Never overwrite the two out-of-scope rows merely to make totals agree. Obtain separate approval for any production correction.

### 3. Close research and Monday brief

Audit August 27 and 28 plus the weekend workflow and identify already successful independent branches so they are not unnecessarily republished. After local retrieval/reconciliation fixes, regenerate the affected outputs with production SELECT/GET-only source reads. Keep expected versus actual output dates and source cohorts explicit. Obtain production publication approval before writing refreshed reports/briefs or dispatching write-capable hosted workflows. Require independent payload verification and a complete publication receipt, with a Monday August 31 target brief, before marking research current.

### 4. Truthful dashboard completion status

Make completion depend on the canonical verified publication result, date, expected next session and required stages. A successful unrelated or earlier event must not override a newer failed/incomplete run. Test stale, partial, failed and successful states and desktop/mobile presentation. Keep messaging concise and distinguish trading health, raw-data availability, and finished analysis. Release only after review and approval.

### 5. Study recovery and provenance release

Recover committed work to durable storage and inventory raw-result/source receipts. Existing study findings are four-session exploratory evidence, not support for changing the trading roster or wrapper.

Read `docs/three-axis-forward-deployment-proposal-2026-08-29.md` and associated study documents in the recovered study checkout. Prepare the additive provider-provenance migration and market-ingest Edge Function release as a separate package. Schema must precede function deployment; verify actual production feed settings, timestamp fields, explicit unknown Greek metadata, and archive compatibility. Report larger-row/archive storage effects and any entitlement/configuration changes separately.

The forward sub-minute observer runtime is not wired and must remain off. ITM1 is a primary research comparison; deeper ITM2–ITM4 remain quote-only sensitivities. No entry, exit, manager, size, roster, priority or routing change is authorized. Account-envelope and full-session archive validation remain distinct requirements; checks requiring a complete forward session cannot be honestly completed Sunday night.

### 6. Monday preopen verification

A one-time in-thread check is scheduled for August 31 at 06:10 America/Los_Angeles: `seve-august-31-preopen-readiness`.

At run time, read this document, subsequent approvals and the latest release receipts. Use the established SELECT/GET-only readiness check from the verified release checkout. Verify one healthy worker, source identity, active manifest/configuration, account routing identity, books, orders, positions, capture/feed health, authenticated dashboard, research dates, and the Monday-targeted brief. Explain any intentional open state. Distinguish closed-market feed expectations from live readiness. Do not repair or change production during this scheduled diagnostic. Report late execution as late, never as an on-time preopen check.

The local machine must be on, connected, and the app running. Ask for reauthentication only if the saved dashboard session is no longer available.

## Approval boundaries and questions for the user

Local repairs, regression tests, read-only production checks, artifact recovery and local report generation can proceed now.

Approval received August 31: the user's “authorized” responds to the explicit four-item list below, including both Vercel and Railway deployment/restart and the separate schema-first ingestion release. Scope was restated before execution. No trading configuration, roster, size, manager, route, feed-setting, observer activation or broker action is included. The prerequisites and exact hash boundaries below still apply.

Release limitation: the current GitHub OAuth login has `repo` but not `workflow` scope. GitHub rejected the initial branch push containing three additional CI commands. Only those additions to `.github/workflows/after-close-research.yml` were removed from the release; existing schedules/workflow behavior are unchanged. The Atlas, publication, and Sentinel regression suites passed locally. Adding their three explicit CI invocations remains a follow-up requiring a workflow-authorized GitHub login; no authentication permissions were changed or bypassed.

1. Exact data correction: approve BOTH hash-bound `virtual_trades`-only proposals below (26 rows total). No inserts, events, manager-shadow changes, fabricated provenance, or changes to the nine out-of-scope rows. Revalidate before hashes/source policies before writing; changed evidence requires renewed review.
2. Code release: approve committing/pushing/merging the tested readiness/reporting/UI package and the coupled Vercel AND Railway auto-deploy/restart. This package excludes the separate quote-provenance migration/Edge release and every trading-economics change.
3. Production report publication: after exact correction and independent verifier success, regenerate Thursday then Friday from corrected sources and publish the learning-enriched Atlas briefs to `decision_atlas_channel_reports`; publish the refreshed Monday-targeted Sentinel receipt to `events`. Preserve legitimate censors visibly. Reuse the already successful exact replay rather than paying for another download. Verify remote readback before calling anything published/current.
4. Separate provenance release: approve the additive quote-provenance migration followed by `market-ingest` Edge Function deployment and validation. Schema/quote content and storage usage change. The observer stays OFF, feeds/entitlements are not changed under this approval, and no entry, exit, manager, size or route changes are included. This is recommended evidence maintenance, not a condition for the existing desk to trade Monday.

Do not silently bypass validation to meet the deadline. If reporting cannot be repaired in time but operational checks pass, report trading GO separately from research NO-GO and explain the unresolved evidence limitation. Do not automatically halt or modify the desk in response.

## Decision discipline

Separate observed facts, supported inference, hypotheses, and missing prospective evidence. State the strongest counterargument and material uncertainty for consequential recommendations. A better exit does not prove good entries; a profitable sum does not prove a positive typical outcome; an exploratory backtest does not establish rehabilitation. Same-opportunity, chronological holdout, without-best-session, era compatibility, capacity/collision and displacement gates remain required for trading recommendations.

## Handoff / current progress

- Goal is incomplete; the approval blocker was removed by the user's August 31 authorization. At 04:57 Pacific, the unchanged release/configuration passed fresh SELECT/GET-only flatness and congruence checks: one fresh healthy worker, three distinct reachable paper accounts, zero positions/orders and matching books, SIP/OPRA settings. This is an early release preflight, not the scheduled 06:10 check. Current origin/main remains `08737635a4f77c55295b80301e9f09bccecfdb60` before the approved release.
- Retrieval fix implemented: counted, deterministically ordered reads with an exclusive through-session bound. Successfully retrieved 51,764 signals; every counted source matched its before/after count and unique identity count. Counts are not a transactional database snapshot; the returned snapshot is frozen and hashed.
- Friday diagnostic Atlas and its snapshot-only repeat have identical `sha256:9106c742e6bc6daf9ffd16095af7ea6dde37b9966b3f77054a1f8ffba7db9324` (68 channels, 9,001 logical opportunities). The full local Friday pipeline through learning/council now completes. It explicitly calls for repair of the 14 Friday discrepancies. It is DIAGNOSTIC, not publish-ready; Thursday's correction also affects cumulative evidence.
- Thursday's full local pipeline also completed through learning/council: 68 channels, 8,857 logical opportunities; Atlas SHA `sha256:1d33e28c710aa0249b53d3670c16fb848f7cf41098b3e174147e5be6fdafd1f8`. Its learning-enriched 68-row brief package passes a zero-write publication dry run, bundle SHA `sha256:5297278acb63fd4bc6017289146087b55ba7489c289828ba3e491214399c8503`. The learning packet explicitly requires repair of the 12 Thursday discrepancies before scoring new decisions. This output is DIAGNOSTIC, not publish-ready. Path: `data/monday-readiness-2026-08-31/nightly-2026-08-27-diagnostic/`.
- Both ordinary and learning-enriched 68-row brief packages pass publication dry runs. The new browser reader verifies every channel/hash against a shared bundle descriptor and measured row count. An older publisher's records remain visible but cannot be called a verified complete bundle.
- Desktop/mobile Home now separates trading readiness from stale/unverified research and stops using stale channel suggestions as the next action. System separately reports Atlas, day-report and Sentinel status. New Sentinel packets retain July 30 evidence as historical rather than renewing its old recommendations/current-era claims by changing the packet date. Sentinel exact-report status no longer says 'not due' after the 24-hour gate has elapsed.
- Local authenticated visual checks: 1280×720 desktop in cream/blackout; 390×844 phone-layout iframe in cream/blackout and 768×844 tablet layout. This is responsive-browser QA, not a physical-phone touch test. Temporary QA HTML removed afterwards. Test relevant auth/error behavior again after deployment.
- Regression suites PASS: Atlas/reader, legacy repair, gate policy/quote-path audit, publication/hash verification, readiness, channel decision packet, Sentinel operator/manager/release audits; TypeScript and production build PASS. Nine three-axis suites and generated market-ingest artifact parity PASS.
- Recovered study source/input/output locations and hashes are below. Optional quote release is prepared separately. A SELECT probe confirms the proposed `option_quotes.provider` column is absent; schema must precede updated ingestion. Production OPRA/SIP settings are now confirmed by the separate 17:30 Pacific read-only check above. Actual provider timestamp capture and one-full-session forward/archive validation remain prospective requirements.
- One-time read-only Monday check scheduled for 06:10 Pacific. Machine/app must remain available. Do not use Sunday's health observation as Monday GO.
- No production repair, publication, push, merge, deployment, migration, feed change or trading change has been performed under this goal.

## Exact recovery receipts

All relative artifact paths in this section are under the readiness checkout's `data/monday-readiness-2026-08-31/`. They are local audit artifacts, not production mutations.

| Session | Exact affected rows | Preserved outside scope | Repair manifest | Manifest SHA-256 |
|---|---:|---:|---|---|
| 2026-08-27 | 12 | 7 | `virtual-repair-proposal-2026-08-27/manifest.json` | `sha256:af7717a124d6e09f341a3efab5c9b2a3387d8c778901cb5a50f6fefef16b9cb0` |
| 2026-08-28 | 14 | 2 | `virtual-repair-proposal/manifest.json` | `sha256:2271f294f992d65e17c0f97fcb727c9d73729c3311c3f0f9ae74cdb6c68cd735` |

Each manifest enumerates exact stable IDs and before/after payloads. Both dry-run receipts report zero remote upserts and zero events. Quote-audit snapshots:

- Thursday `virtual-audit-2026-08-27-quote-verified/`, SHA `sha256:271526a5944fd66bebf9afe10b2c4aaffa1186544e2be3377a9b1972355a7c5c`.
- Friday `virtual-audit-2026-08-28-quote-verified/`, SHA `sha256:691867c723de12beb59921622bcb1526999ad896b2ae1998ec4326b4df3fb2db`.
- Friday fresh independent rebuild `rebuild-2026-08-28-independent/` matches the downloaded Friday canonical payload, SHA `sha256:7cb1f7fe1ffd87dce821b0f2929ec6aed1c3f7bad4e408d2ea7a627260caaa34`.

Repair safety: all approved source policies and manifest payloads are checked before the first write. Save exclusive full before-images before writing; updates compare every original payload/provenance value. Legacy provenance stays null. This is not a multirow transaction: a partial failure must stop, preserve receipts, and be reconciled explicitly. No automatic compensating rewrite is authorized. After both repairs, rerun the independent verifier against all in-scope rows and confirm the nine extra rows are unchanged.

## Already completed exact work — do not rerun blindly

Saturday workflow `33281087108` scored Friday exact evidence and published/read back its receipts successfully; the later Atlas stage failed. Recovered artifact directory: `weekend-artifact/data/decision-atlas/runs/2026-08-28/exact-learning/`.

- 1,024 candidate receipts and exact paths, 1,046 independent manager paths verified by the hosted publication receipt. These are different denominators.
- Exact candidate scorecards: 849 fully eligible, 175 censored, zero missing. The reported censor is `BELL/no-stop:no_executable_exit_bid`; do not replace it with a midpoint assumption.
- Report bytes hash verified: `6b9d9639a07eafdbf9ce5ef8ab6793cd89fec7db19f9ac7e4e36b6f6916dfd7a`.
- Publication receipt bytes hash verified: `2f0b38290b83fdb953793bbbddaa5c98a68484f2b42a1da18e118c5506757123`.
- Freeze matches Friday's exact source identity: `4fa6bbd43fcd99e5d53797b99272f623264d8c16948486aadb5f84cd90eb79c7`.
- Latest local Monday brief: `sentinel-2026-08-28-v4/packet.json` and `2026-08-28.receipt.json`. Six executed logical trades closed; 45/48 manager runs terminal, three censored. Exact results are attached, not inaccurately described as still waiting for T+1. Overall PARTIAL is truthful and is not a trading halt instruction.

## Study recovery evidence

Raw sources copied (not modified) from `/Users/ben/.codex/worktrees/b9e8/SEVE/data/atm-shadow/2026-08-27/` and `data/atm-independent/2026-08-27/quotes/` into the recovered study checkout's `data/recovered-inputs/`.

Use `supplemented-latent-signal-audit.json`, not the earlier unsupplemented `latent-signal-audit.json`. The first attempted regeneration correctly failed parity (494 vs 491) with the older audit; using the matching supplemented audit reproduced 491/491. Never weaken that gate. The three missing-minute bar supplements do not prove their historical live availability.

Regenerated output: `/Users/ben/Developer/Projects/SEVE-three-axis-recovered-20260829/data/three-axis/recovered-2026-08-30/`.

| Artifact | Original and regenerated SHA-256 match |
|---|---|
| study.json | `aa9e216a8d14232d2f56e3512ddaa1497af949bd3531a4f6f6d94554910d4d5a` |
| manager-study.json | `dc72a3e2792955997fb75d44b9b5dbf90e6d53ae631f99aa29f3c8c682523835` |
| entry-clock-study.json | `840fde7394c29e453c7ffa504f2222d7c9df14b3fa11844fc438b8f511b4d49c` |
| entry-outcome-study.json | `a5f34c59788a700344dada086e95808de979d8ddf44282b174ea842ea20694c3` |
| episode-sensitivity.json | `9a6f6304fbec2d3d4c95bed09f9577940d98ae22cc18ba1dacde42d13a29fc56` |
| wrapper-exposure-study.json | `57835e00d2169a7e13c3f175694307c143d582d28db72da1c8ab9c65fb2d3804` |
| portfolio-replay-readiness.json | `a84e36ed8dba73865ffc2f3f1771f0baff9ece13a60048d3527cd10619d1d450` |

The regenerated deployment proposal is under that checkout's `data/three-axis/2026-08-29-forward-proposal/`. It remains proposal-only. Recovery does not add sessions, prove an edge, or complete the blocked account-envelope/portfolio checks. ITM1 stays in the primary comparison; ITM2–4 remain quote-only sensitivities. No economics change is recommended from this four-session screen.

## Release and rollback order after explicit approval

1. Recheck clean release base and the exact diff; preserve unrelated dirty checkouts. Do not merge the separate study branch wholesale into the readiness release.
2. Release tested readiness code with explicit Vercel + Railway coupling acknowledged. Verify one worker, unchanged manifest/config hash, accounts and books. A code rollback must restore the known-good release through normal reviewed deployment; no reset of dirty workspaces and no trading-manifest rewrite.
3. Apply the two exact virtual corrections only while their reviewed hashes still match. Verify both days and preserved rows. Investigate any recurrence from an older writer instead of repeatedly overwriting it.
4. Regenerate Thursday then Friday learning-enriched reports and Monday v4 Sentinel; publish only verified packages, retaining censored/partial labels. Verify database readbacks and authenticated dashboard dates. Publishing does not mean every research question is resolved.
5. If separately approved, apply only the additive quote schema then updated market-ingest function. Validate actual feed settings without changing them implicitly. Roll back ingestion code, not by deleting newly captured provenance or dropping the additive columns. Keep observer disabled; validate full-session archive parity prospectively.
6. Monday 06:10 run fresh readiness. Current Sunday recommendation: operational baseline healthy; research not ready to call fully current until repairs/publication; no new trading configuration proposed.
