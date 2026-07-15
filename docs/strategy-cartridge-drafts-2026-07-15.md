# Strategy cartridge draft materialization — 2026-07-15

Status: read-only architecture and evidence adapter. No policy, database, worker, sizing, order, manager, or dashboard behavior changes.

## Outcome

The 14 current paper channels closest to `StrategyCartridgeV1` can now be emitted as evidence-only drafts. The adapter refuses to turn an observed runtime convention into a sealed guarantee. Every pending field is labeled as one of:

- `measured` — computed from append-only receipts;
- `observed_runtime` — demonstrably present in current source/runtime, but not sealed per channel;
- `proposed` — a review candidate that would require explicit ratification;
- `unresolved` — information or policy that cannot be supplied honestly yet.

Every draft remains `promotionEligible:false`, `policyChangeAuthorized:false`, and `paperRuntimeUnchanged:true`.

The current-channel inventory schema advances to V2 because it now preserves the legacy runner fraction and giveback fields needed to show whether scaling actually exists. V1 receipts remain historical inputs; the draft adapter consumes the newly generated V2 receipt.

## What is materialized

### Decision clock and latency

The stream's current completed-one-minute-bar clock is recorded as observed runtime behavior. `execution_observations` **entry-decision** rows measure provider/bar-close-to-admission latency as:

`event_at - (source_bar_at + 60 seconds)`

Rows whose source bar is already three minutes old are counted as censored stale-bar observations, not allowed to inflate the fresh-latency distribution. A monitoring ceiling is proposed only with at least five fresh samples: fresh p99 plus a five-second guard, rounded up to five seconds. It is not an entry authorization or a feed-freshness proof.

The same table also carries real fast-exit decisions and shadow-manager counterfactual exits. Those have different clocks (and shadow rows carry `blocked_reason=observation_only`), so every non-entry row is excluded. Exit-manager responsiveness must be measured separately from admission latency.

### One-open-row behavior

The worker currently maps open rows by strategist and only enters when no row is present. That supports a candidate per-channel limit of one. It is **not** a database invariant: there is no equivalent partial unique constraint on open position rows, so duplicates would be collapsed by the Map rather than safely managed. The draft keeps both facts visible.

### Collision families

Only the two families explicitly named by the Phase 1I dark observer—PB and SPY ORB—can receive a proposal. Their candidate concurrency of one is the observer's one-survivor question, not an active execution cap. All other channels remain unresolved; reporting-family inference is not substituted for capital policy.

### EOD

The current wall-clock backstop is observed as five minutes before session close for machine channels and three for `-manual` channels. The draft proposes sealing the current value for reproducibility while making no claim that it is the best exit for a channel.

### Harvest and scaling

Current TP, runner fraction, giveback, pyramid, stall, and policy-epoch labels are preserved as a legacy observation. They do not become a whole-lot harvest manager. Allocation, minimum quantity, runner behavior, and add funding remain unresolved until exact option paths and the untouched holdout are scored.

### Market inputs

Market inputs remain unresolved. Railway deployment variables are not durably present in `worker_runs` or `policy_epochs`; a local `.env.local` value is not production provenance. A later deployment manifest must stamp the underlying source, option source, calendar, and freshness profile.

## Commands

```bash
npm run current-channel-inventory -- --out data/channel-cartridge-inventories/YYYY-MM-DD.json
npm run current-channel-drafts -- --inventory data/channel-cartridge-inventories/YYYY-MM-DD.json --out data/channel-cartridge-drafts/YYYY-MM-DD.json
npm run current-channel-drafts-selftest
```

Both generated receipts live under gitignored `data/`. Supabase reads are SELECT-only.

## First live materialization

The 2026-07-15 receipt used a rolling seven-day window ending after the July 15 close:

- 223 real entry-admission decisions were eligible for latency measurement;
- 731 non-admission rows (fast exits and shadow-manager observations) were excluded;
- all 14 drafts had at least one admission sample;
- 9 had at least five samples and therefore received a proposed monitoring ceiling between 15 and 25 seconds;
- 5 remained sparse and received no ceiling: `breakout` (3), `breakout-alt-v3-iwm` (4), `breakout-smart-entries-iwm` (3), `orb-qqq-trail` (4), and `qqq-thrust-trail` (4).

The same receipt contained nine dark family-collision observations: six PB and three SPY-ORB. No admission cap changed.

All 14 legacy harvest observations had `runnerFraction=0` and `runnerGivebackPct=0`. Eleven carried all-out premium targets; three were structure/time rides. The result confirms that the current fleet does not encode an actual bank/runner allocation despite earlier manager research. That gap remains intentionally unresolved for the exact-path/holdout step.

## Required next decisions

1. Ratify or reject the candidate one-open-position limit, then separately harden the ledger invariant before calling it enforced.
2. Review PB and SPY-ORB one-survivor evidence; do not generalize their family cap to other channels.
3. Add a deployed market-input manifest rather than inferring Railway variables.
4. Use Phase 1K-D exact July 15 paths to author channel-specific harvest managers; do not stamp one fleet-wide TP/runner recipe.
