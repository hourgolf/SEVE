# Canonical profitability ledger — local proving contract

Date: 2026-07-29
Scope: paper evidence only
Authority: read-only analysis; no configuration, deployment, migration, or order authority

## Outcome

The canonical unit is a **logical trade**, not a `positions` row. A parent
position and every immutable runner or partial-remainder descendant form one
logical trade. Each closed row contributes its own rewritten closed quantity,
entry debit, and realized P&L exactly once. This matches the worker's
row-primary booking invariant and prevents runner tranches from inflating trade
count or double-counting economics.

The output maintains three separate ledgers:

1. **Actual portfolio dollars** — account-complete paper-broker NAV from
   `equity_daily`.
2. **Normalized broad channel performance** — all structurally complete
   logical trades, with routing and configuration coverage disclosed rather
   than used to discard observed outcomes.
3. **Counterfactual manager research** — `manager_shadow_runs`, with paired and
   censored path denominators disclosed and never added to actual P&L.

## Keep / reuse / add / defer map

| Component | Disposition | Reason |
|---|---|---|
| `positions` row-primary realized P&L | Keep | Fill-based booked truth; each split row owns only its sold share. |
| `position_outcome_events` parent and opportunity lineage | Reuse | Append-only parent chain is the preferred logical-trade join. |
| `positions.runner_of` | Reuse as fallback | Immutable runner link for evidence that predates or temporarily misses the outcome receipt. |
| `execution_observations.account_id` | Reuse | Latest valid immutable position route; immutable opportunity route is the only fallback. |
| `strategists.account_id` and `entry_features.rc54Candidate.accountId` | Exclude | Mutable assignment is not historical execution-account truth. |
| Position epoch triple | Reuse | Exact `channel_spec_version_id` + `release_manifest_id` + `configuration_epoch_id` cohort. Partial triples fail closed. |
| Sealed `entry_features.release_evidence` | Reuse | Exact RC5.4 release/configuration/evidence-era identity until epoch-native entries are active. |
| `execution_quality_receipts` | Reuse | Exit-fill leakage diagnostic. Positive is adverse; negative is price improvement. Never subtract it from realized P&L again. |
| `manager_shadow_runs` | Reuse separately | Counterfactual path evidence, never actual P&L. |
| `equity_daily` | Reuse | Account-complete configured-paper-account NAV view; incomplete dates fail closed. |
| Pure reconciliation and metrics modules | Add locally | One deterministic implementation shared by self-tests and report generation. |
| Quote tables / historical quote backfill | Defer and exclude | Not required for the ledger; too costly and operationally unsafe during market hours. |
| Production view, API, dashboard panel, indexes, migrations | Defer | The local contract must be reviewed before any production surface is proposed. |

## Reconciliation rules

### Logical-trade lineage

1. Prefer `position_outcome_events.parent_position_id`.
2. Use `positions.runner_of` only when no outcome parent exists.
3. Reject conflicting parents, missing parents, lineage cycles, or structural
   identity changes inside one lineage.
4. `partial_exit_remainder` rows use outcome lineage because they intentionally
   have no `runner_of`.
5. Sum realized P&L and rewritten quantities across the lineage once. Do not
   add outcome-event booked P&L to position P&L; that would count the same close
   twice.

### Account attribution

1. Choose the latest valid immutable execution observation for each position.
2. If none exists, use the latest immutable observation for the position's
   opportunity.
3. Require every routed account to be a configured paper account.
4. Censor conflicting, unknown, or non-paper routes.
5. Never fall back to a strategist's current account assignment.

### Configuration identity

1. A complete database epoch triple is exact identity.
2. Otherwise, a sealed release id plus configuration hash is exact identity;
   evidence era remains part of the cohort key.
3. A partial database epoch triple is an integrity failure.
4. Unstamped history remains descriptive and is excluded from decision-grade
   expectancy, profit factor, and rankings.
5. Historical rows are never mutated or reinterpreted when configurations
   change.

## Evidence tiers

| Tier | Required evidence | Permitted use |
|---|---|---|
| Exact configuration | Structurally closed + immutable paper route + complete epoch or sealed release identity | Current-configuration audit overlay, still subject to sample-size warnings. |
| Immutable route only | Structurally closed + immutable paper route + legacy unstamped configuration | Broad channel research and account-attributed historical analysis with mixed-configuration disclosure. |
| Structural only | Structurally closed but no immutable account route | Broad channel research, normalized outcomes, MFE/MAE, and exit-efficiency analysis; no account-specific claim. |
| Censored | Conflicting lineage, routing, configuration, quantity, price, or realized P&L | No profitability metric. |

## Metric contract

- Expectancy: mean realized P&L per logical trade.
- Profit factor: gross winning P&L divided by absolute gross losing P&L.
- Strategy drawdown: maximum peak-to-trough drawdown of time-ordered logical
  trade P&L.
- Actual portfolio drawdown: maximum peak-to-trough drawdown of account-complete
  broker NAV.
- Actual portfolio daily expectancy, profit factor, win rate, and confidence:
  computed from account-complete daily NAV changes, never from desk rows.
- MFE and MAE: lineage-wide peak and trough marks relative to weighted entry.
- MFE capture: realized return divided by positive MFE; coverage is disclosed.
- Execution leakage: sum of observed receipt leakage; positive is adverse.
- Sample size: logical trades and distinct ET sessions.
- Win-rate confidence: Wilson 95% interval.
- Expectancy confidence: unclustered Student-t 95% interval, explicitly
  descriptive because session and channel observations are correlated.

Daily, Monday-to-date weekly, month-to-date, and all-time report objects contain
portfolio, channel, account, configuration-cohort, and manager-path metrics.
Manager-path groups receive their own counterfactual expectancy, profit factor,
drawdown, win rate, and paired delta; these remain research-only denominators.

## Market-hours safety

The live collector:

- issues only bounded, sequential `SELECT` queries;
- reads durable evidence tables and the account-complete NAV view;
- batches indexed execution-route reads by position or opportunity id;
- never reads option quotes, option archives, or underlying bars;
- never calls RPCs/functions or performs production writes;
- caps every source and fails closed on a page/read error;
- writes only gitignored local snapshots, ledgers, reports, and receipts; and
- supports `--snapshot-file` so analysis iterations do not repeat production
  reads.

The first bounded snapshot completed without blocking integrity errors. The
slowest source was immutable route collection at 4.686 seconds; the full
collection completed in approximately 9 seconds. All later report iterations
used the local snapshot.

## Local proving evidence

Snapshot through 2026-07-28:

- 1,447 position rows became 1,440 logical trades.
- Seven runner rows became seven parent-linked lineages; no partial-exit
  remainder rows existed in the snapshot.
- 1,440 logical trades were structurally closed.
- 358 had immutable paper-account routes.
- 14 had both immutable routes and exact sealed RC5.4 configuration identity.
- 1,082 lacked immutable account routing.
- 1,426 predated exact configuration stamping.
- No blocking lineage, routing, configuration, or booking conflict was found.
- No production write or option-quote row was used.

The full structurally complete logical-trade history is the primary channel
research denominator for designing RC5.5. The 14 exact RC5.4 logical trades
cover two sessions. Their combined result is
+$928, or +$66.29 per logical trade, with profit factor 2.61. This is
**insufficient as a standalone strategic sample**. It demonstrates current
configuration congruence and is an overlay on the broader historical research,
not a replacement for it.

For the two exact sessions, broker NAV change was +$926.07 and structurally
booked logical-trade P&L was +$928, a -$1.93 diagnostic difference. Broader
month/all-time NAV-to-booked comparisons are not declared comparable because
legacy periods contain unrouted evidence.

## RC5.5 shadow-research boundary

The current profitability ledger includes executed positions and
`manager_shadow_runs`. The separate RC5.5 research collector adds
`virtual_trades`, which is the durable source behind VB Swarm and the other
same-session dark-channel would-have results, as a fourth explicitly
counterfactual layer:

- VB channels are identified by `vb-*`; other blocked/dark channel paths remain
  separately grouped.
- `pnl_per_contract`, MFE, giveback, exit reason, and independent ET sessions
  are analyzed as capital-blind research, never portfolio P&L.
- Mid-basis native virtual results remain separate from exact T+1 CBBO path
  receipts and manager-shadow executable-bid results.
- Dark results may nominate or challenge an RC5.5 change, but cannot be added
  to broker NAV, treated as fills, or activate configuration.

The later frozen exact-path study reconstructed 2,637 of 2,658 candidate clocks
from 629 content-addressed Databento CBBO objects across 22 sessions and 65
active/dark/VB channels. Those executable-quote replays supersede the earlier
live-database exact-source absence for TP research, while remaining local,
counterfactual, and non-authoritative.

## Deferred production decision

No runtime deployment is needed to use this contract. The implementation is a
pure reconciler, test matrix, bounded snapshot tool, and report generator. It
is safe to merge as dormant operator tooling because no application or worker
entry point imports it. A later, separately approved step may decide whether
to expose the ledger through a read-only API or dashboard surface. That
decision should not introduce a parallel P&L authority, mutate history, or
require the quote corpus.
