# Momo profit protection: approved implementation, activation pending

The operator requested changing Momo's active paper manager. Existing managers
are not permanent constraints. This candidate adds earlier profit protection to
Momo's current two-contract bank/runner policy because that specific combination
has the strongest paired historical support; it does not impose the same manager
on other channels.

## Exact behavior

- New entries use `MOMO-B30-R50-K67-P15-F5` and a v4 immutable entry policy.
- A positive, uncrossed executable bid at least 15% above the actual entry arms
  protection. It must have an original provider clock no older than 15 seconds
  and displayed bid size sufficient for the remaining whole contracts.
- A later eligible bid at or below +5% durably requests an exit of the remaining
  contracts. This is an exit trigger, not a guaranteed +5% fill.
- The request survives process restarts, quote outages, price rebounds and
  partial fills. Existing order freshness, routing, duplicate-order and
  broker-confirmed booking protections still apply.
- Bank half at +30%, retain the current runner rules (33% peak-price giveback;
  after +50%, retain 67% of peak gain), native -30% catastrophe and 15:25 ET
  liquidation. Native exit decisions take precedence on the triggering sweep.
- Positions entered before activation keep their original immutable policies.
  No historical result is relabeled with the new manager.

The historical candidate improved modeled gross PnL by $495 across 20 compatible
complete paths, from -$297 to +$198. Ten-second cadence sensitivity retained a
positive relative improvement but ranged from -$20 to +$193 in absolute gross
PnL. These selected retrospective paths do not establish forward profitability.
The operator has authorized actual paper fills under the changed manager, with
`MOMO-B30-R50-K67-CONTROL` observing the displaced native rules on the same entries.
Retained paths still require coverage/fill-quality checks before any comparison
is called executable or complete.

## Release sequence

1. Check the PR's root/worker typechecks and CI. Do not release in the current
   pre-open/session window; use after close with a reconciled flat paper book.
2. Inspect and apply `20261028010000_momo_profit_protection.sql` through the
   existing Supabase admin session. First test it in a rollback transaction.
   It adds two nullable position-state columns and narrowly extends the manager
   proposal validator. It does not activate the policy or backfill history.
3. Merge/deploy the worker and dashboard; verify the exact new main commit in
   a fresh worker heartbeat, no startup error, and continued current roster.
4. Run `scripts/activate-momo-profit-protection.ts` without `--execute` using
   the SEVE environment and an external private evidence output directory.
   It requires the exact approved base roster/spec hashes and checks that only
   Momo changes. A changed base requires a fresh review of the generated diff.
5. Run with `--execute --expected-worker-commit <40-character deployed SHA>
   --approval-ref operator-approval:2026-10-28:change-momo-too`. The script checks
   the mutation window before any write and again before atomic activation;
   it also requires current worker acknowledgment and safe-boundary evidence.
6. Verify the worker's adopted manifest/epoch, Momo's exact policy hash, all
   other roots unchanged, and flat/order reconciliation. Deployment alone is
   not activation. Archive that receipt with the private preparation packet.
7. On subsequent fills verify v4 entry stamps, quote-qualified arm/exit logs,
   durable state, broker fills and retained control coverage. Assess saved
   giveback, sacrificed winners, net PnL, tail losses and costs together.

The first permitted normal-session activation window is October 28 after
16:00 ET (13:00 Pacific), subject to fresh flat-book and health checks. User
approval is already present; the remaining timing constraint is operational.

## Recovery

Before activation, the dormant code can be reverted without changing managers.
After activation, roll back the Momo manager through the receipt-bound proposal
flow at a safe flat-book boundary. Keep the new runtime while any v4 position
remains open. Do not roll back to a worker that cannot read the new manifest or
entry policy. Leave the nullable state columns and historical receipts intact.
The old manager payload is in the private proposal packet's source roster;
restore it as a new version, not by rewriting prior evidence.
