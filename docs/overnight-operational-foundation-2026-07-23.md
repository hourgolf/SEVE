# Overnight operational foundation — 2026-07-23

Status: merged to `main` and deployed through Vercel after authenticated
preview smoke. The reviewed merge state was `90beeeb`; the implementation
commit is `92a9823`, followed by handoff commits `93e0545` and `90beeeb`.
GitHub reported the Vercel check successful for that merge state on 2026-07-23.
No Railway redeploy is required because this slice does not change the worker.
This document is the canonical handoff for the next Codex task. It replaces
conversation-derived status. Read it together with
`docs/sentinel-purpose-review-2026-07-22.md` and
`docs/week1-prospect-evidence-continuity-2026-07-23.md`.

## Review and authenticated preview evidence

The authenticated Vercel preview was smoke-tested on desktop and mobile before
merge authorization:

- SPY, QQQ, and IWM chart and observed-chain switching worked on both layouts;
- IWM OCC rows and the shared underlying contract rendered correctly;
- Shadow Research showed cumulative/native evidence and retained its
  `RESEARCH ONLY · ZERO ORDER AUTHORITY` boundary;
- Sentinel showed the deterministic current/partial packet and truthful T+1
  exact-replay gate;
- the sealed paper-only release identity remained visible;
- no horizontal viewport overflow was observed; and
- the browser console contained no warnings or errors.

`BROKER CHECK` outside OPS is expected under the current load-shedding design:
deep multi-account reconciliation is activated only in OPS. It must not be
misread as a failed reconciliation. The flat preview could not exercise a live
open-position mark update, and the corrected hosted schedule cannot be proven
until its first post-merge run.

## Scope and invariants

This slice repairs evidence delivery and shared market-data capability. It does
not change the paper roster, entry rules, exit rules, quantities, risk,
concurrency, channel lifecycle, or broker authority. It does not apply a
database migration or activate an LLM.

The six sealed paper roots remain:

- `pb-ride`
- `orb-ustop-ctl`
- `grind-v3`
- `momo-shape`
- `orb-qqq-trail`
- `breakout-alt-v3-iwm`

All other channels remain dark/suppressed. Paper-only and fail-closed behavior
remain mandatory.

## 1. Hosted morning publisher

### Confirmed failure

GitHub Actions run `30019836658`, job `89249369564`, completed successfully but
the publisher returned:

```json
{
  "version": "remote-morning-publisher-v1",
  "publisherRunId": "remote-morning-publisher-v1:2026-07-22:2026-07-23",
  "dryRun": false,
  "action": "skip",
  "code": "outside-window",
  "detail": "ET minute 677 is outside 08:55-09:10",
  "targetSession": "2026-07-23",
  "evidenceSession": "2026-07-22"
}
```

The workflow was green because an outside-window skip was a successful process
exit. GitHub's delayed schedules were reaching the job around 11 ET, after the
old 08:55–09:10 ET window. The hosted start/Sentinel/finish chain was therefore
not written.

### Implemented correction

- The hosted window is now 07:00–09:25 ET. It uses prior-session durable
  evidence, so an early run does not depend on current-session market data.
- The workflow attempts publication every 15 minutes across 11:00–13:45 UTC.
  This covers both EDT and EST and tolerates normal GitHub schedule delay while
  stopping before RTH.
- An already-completed target is recognized before the window test, so a late
  retry reports `already-published` rather than an ambiguous window skip.
- Every run writes a GitHub annotation and step summary containing action, code,
  evidence session, target session, run id, and detail. A block is an error; an
  outside-window skip is a warning; publish/already-published is a notice.

Verification: remote publisher 31/31; receipt model 9/9.

Required post-deployment proof: observe one ordered, idempotent
`start -> Sentinel -> finish` chain with the exact hosted run identity. A green
workflow alone is not proof.

## 2. Sentinel

The deterministic replacement already exists and is the operational reference:

- `scripts/deterministic-sentinel.ts`
- `lib/sentinel/operatorPacket.ts`
- `components/perform/SentinelWorkspace.tsx`

It owns receipt identity, release/live/manager/dark evidence, censors, review
findings, and the next-action queue. Its `interpretiveProvider` is `none`.
Claude is not required for the operational packet.

No GPT integration is activated in this slice. A future LLM may only compress a
sealed deterministic packet after an offline Claude/GPT/no-LLM replay
evaluation. It may not recompute facts, infer lifecycle from a slug, recommend
an immediate configuration change, or affect trading/health.

Verification: deterministic operator packet 22/22.

## 3. Shadow/VB evidence semantics

Two intentionally different lanes exist:

1. **Native path lane:** same-day `virtual_trades`, capital-blind mid-basis
   triage, using the channel's captured/native exit behavior. It is descriptive,
   correlated, and not portfolio P&L.
2. **Exact manager lane:** T+1 Databento CBBO entry ask to executable bid,
   replayed under the eight sealed manager arms:
   `LOCK20/30`, `LOCK30/30`, `LOCK50/30`, `WIDE20/50`,
   `BANK20/RUN50`, `ARM20/HALF-GIVEBACK`, `BELL/-30`, and
   `BELL/no-stop`.

Consequently, a dark sibling such as `momo-shape-2` is not automatically judged
under the live root's ride-to-close policy. Its native lane reflects its
captured channel policy. Its exact lane compares standardized managers on the
same exact path. A historical `+27/-50` label is not a durable claim unless its
channel version, configuration epoch, manager version, quantity allocation, and
price basis are stamped together.

### Current exact receipts

- July 21: 138 raw clocks, 124 exact-eligible, 14 censored, 995/1,107 manager
  arms, 993 independent paths, including 830 VB paths. The immutable dashboard
  summary is partial because exact gaps were truthfully censored.
- July 22 frozen receipt: 1,247 clocks, 893 exact-eligible, 354 exact censors,
  7,165/9,997 manager arms, and 784 sequenced independent paths. It remains
  partial and is not qualification evidence. Most structural censors were IWM
  internal-gap failures under the preregistered guard.

### Persistence boundary

The native `virtual_trades` ledger is live and bounded in the dashboard.
Content-addressed exact replay objects and compact receipts exist locally.
The review-only exact-candidate and exact-manager-path migrations remain
unapplied in Supabase, and the corresponding live tables do not exist.

This is an explicit operator gate, not an implementation accident. Before
application, review the migrations, RLS/grants, runtime publisher identity,
backfill/idempotency plan, retention, query indexes, and rollback. Do not claim
durable database persistence until that gate is separately authorized and
verified.

## 4. IWM capability and strategic posture

The shared supported-underlying contract now includes `SPY`, `QQQ`, and `IWM`.
The same contract drives:

- desktop chart selection;
- mobile chart selection;
- `/api/spot` validation; and
- fast open-position mark refresh.

This fixes a capability/UI asymmetry; it does not validate the IWM strategy.
`breakout-alt-v3-iwm` remains one sealed paper root, while IWM VB variants remain
dark research candidates. IWM is presently a diversification hypothesis and a
market-structure contrast, not a proven independent source of edge. July 22's
partial exact replay specifically forbids an IWM manager claim.

Verification: market-data read model 20/20; root and worker TypeScript checks
pass.

## 5. What may change after merge

- Hosted morning publication gets a realistic schedule/window and visible
  no-op/block diagnostics.
- IWM becomes a first-class chart/spot/live-mark capability on desktop and
  mobile.

Nothing in this slice changes:

- paper-only posture;
- channel roster or lifecycle;
- entries, exits, quantities, stops, targets, ratchets, or concurrency;
- Supabase schema or R2;
- broker/order behavior;
- Claude/GPT usage.

## 6. Remaining gates

1. **Preview and production smoke:** authentication, desktop/mobile SPY/QQQ/IWM
   chart switching, open-position mark behavior, deterministic Sentinel, and no
   console errors.
2. **Hosted receipt proof:** after deployment, require one exact
   start/Sentinel/finish chain. Do not accept a green Actions check alone.
3. **Exact persistence review:** separately approve or reject the two
   review-only migrations and a no-duplicate publisher/backfill plan.
4. **Interpretive Sentinel evaluation:** replay Claude, GPT, and no-LLM against
   the frozen rubric before selecting any optional prose provider.
5. **IWM research decision:** wait for complete exact evidence across multiple
   independent sessions; do not promote, remove, or retune based on the partial
   July 22 receipt.

## 7. Fresh-task startup

For the next Codex task:

1. Start from latest `origin/main`, not an old worktree assumption.
2. Read this file, `docs/sentinel-purpose-review-2026-07-22.md`,
   `docs/week1-prospect-evidence-continuity-2026-07-23.md`, and the current
   release constants in `lib/channels/day1Release.ts`.
3. Verify current commits, deployment state, hosted receipt chain, and live
   schema before making claims.
4. Keep paper-only, exact-evidence, fail-closed, and review-before-migration
   invariants.
5. Treat chat history as background; treat repository contracts and fresh
   receipts as authority.
