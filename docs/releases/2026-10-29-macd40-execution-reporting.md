# MACD +40/-50 and execution/report packaging repair

The operator approved all three priorities and arming the new MACD paper manager.
Activation is a receipt-bound, flat-book maintenance action after worker deployment.

## Changes

- `VB-MACD-WIDE40-50`: four contracts, all remaining contracts out at +40%,
  original -50% catastrophe and 15:25 ET cutoff. Existing fixed-contract broker
  affordability remains authoritative; legacy stored dollar budgets do not
  become admission caps. Signals, entry gates, account route and daily count
  are preserved. Momo's +15/+5 protection is preserved.
- New worker compatibility `stream-macd-wide40-v1` fences older workers. Entry
  receipts retain the exact manager and target; already-created +20/-50 intents
  continue under +20/-50 after activation and restart.
- Enroll the displaced WIDE20/50 control and WIDE40/50 model only for the exact
  new manager hash. Historical manager arm sets and outcomes are not rewritten.
- After cancellation is independently confirmed terminal, booked and coverage
  refreshed, the lifecycle can submit its next original sell rung in the same
  pass. At most one NEW sell is still permitted per pass. A cancellation request
  alone, unknown fill, failed booking or unavailable authority cannot advance it.
- Include the daily report's shared attribution modules in the worker image.
  A build-time import smoke check fails the image if they cannot resolve.

## Evidence and limits

The October 19 native exit request-to-fill interval was 50.998 seconds. Durable
coverage receipts preceded the next two sell commands by 12.188 and 12.657
seconds. Those gaps include scheduler and fresh safety I/O; this change removes
an avoidable pass boundary, not all network latency or the broker's fill risk.
The existing 1.5-second configured limit waits and price ladder are not retuned.

The target-only manager modeled +$1,568.40 versus -$17.20 across 27 later entries,
but +$14.40 versus +$249.60 across seven earlier entries. This is an authorized
paper experiment with counterevidence, not proof of universal profitability.
A higher target can give back some trades that the +20% control would capture.
Compare same-entry net results, saved/sacrificed profit, tails, holding time and
execution latency. Missing or recovered quote paths remain explicitly censored.

## Rollout and verification

1. Require CI, the image import smoke check, a fresh worker heartbeat and flat
   configured paper accounts. Deploy code before changing the target.
2. Dry-run `scripts/activate-macd-wide40.ts` against its pinned source manifest
   and MACD spec. It must show a manager-only change and preserve every other spec.
3. Execute with the exact deployed worker commit, operator approval reference,
   SEVE environment file and a private evidence output directory. The script
   enforces the mutation window, fresh broker/desk flatness, current worker
   acknowledgment, atomic activation and matching adopted manager/epoch.
4. Independently verify adopted roots, account/collection configuration, no new
   manual orders, and the new target with the original -50% stop and size four.
5. Verify the next normal report publication and next eligible MACD paper fill.
   Successful startup alone does not validate forward performance or fill latency.

No database schema change is required. Roll back management through a new
receipt-bound proposal at a safe flat-book boundary; keep compatible code while
new-version positions/intents remain unsettled. Preserve report and trade history.
