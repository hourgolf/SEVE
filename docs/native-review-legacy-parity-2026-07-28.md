# Native Review → Legacy retirement gate

Status: local implementation candidate; Legacy navigation remains active.

## Production audit — July 28 after close

Authenticated production was inspected after the `fae9d5a1` deployment.

Confirmed native coverage:

- Review Tape renders the bounded Supabase event chronology and read health.
- Review Autopsy renders both the July 28 daily report and the July 20–24
  weekly report, including narrative, movers, findings, and suggestions.
- Review Performance exposes Today, Week, Month, and All for the selected paper
  account.
- Review Counterfactuals has a native read-only destination.
- The native workspaces also cover the Legacy chart/chain, open book, channel
  inventory, Sentinel, and operational evidence jobs.

Confirmed gaps:

1. Week/Month/All Performance currently blocks because historical positions
   created before immutable execution observations lack an account route. The
   native and Legacy presenters both fail on the same page-owned
   `reviewEvidence`; Legacy does not provide a working bypass.
2. The blocked message prints every missing position UUID. This is accurate but
   unusably verbose. The UI should show a count, provenance boundary, and a
   bounded sample while retaining the full list in diagnostic evidence.
3. The account NAV curve comes from account-scoped `equity_snapshots`, but the
   current hook blocks the entire view before rendering that independently
   attributable curve. Account NAV history and per-channel position attribution
   need separate evidence states.
4. The Legacy Add Channel thesis importer does not yet have a complete native
   desktop destination.
5. Legacy Mix contains direct-looking sliders and buttons alongside active
   values. Those controls should not be copied into native Review. Future
   configuration belongs behind the governed draft → validate/preview → safe
   activation path.

The historical gap must not be “fixed” by falling back to
`strategists.account_id`. Old rows need an explicit historical provenance
policy or must remain visibly unattributed.

## Authority boundary

Native Review and Legacy Review are read-only evidence presenters. Autopsies,
performance history, and counterfactuals cannot approve configuration, alter
readiness, change risk or lifecycle state, or place orders.

## Required observation window

Record at least three completed market sessions before hiding Legacy Rooms.
The sample must include:

- one session with at least one filled position;
- one flat or no-trade session if one occurs during the window;
- the next weekly report publication when due.

## Per-session parity receipt

For both native Review and Legacy Tape, record:

1. Daily Autopsy `report_date`, fund realized P&L, trade count, channel count,
   and top/bottom channel.
2. Weekly Autopsy `week_start`/`week_end`, realized P&L, NAV delta, trade count,
   win rate, and exit-efficiency headline when a weekly report is due.
3. Performance Today/Week/Month/All for every configured paper account:
   evidence state, visible span label, fund value, curve endpoints, and channel
   trade/P&L rows.
4. Counterfactual `report_date`/`generated_at` and the One-account, Give-back,
   Override, Benched, Ratchet, Pyramid, and Virtual Bench headline values.
5. Event Tape event count, read-health state, and latest event identity.

Any missing immutable execution-account route, routing-read failure, or route to
a non-paper account must display `BLOCKED`. A value rendered through
`strategists.account_id` is a release blocker.

## Structural checks

- `app/page.tsx` owns the Review hooks.
- Native Review and Legacy presenters consume the same `reviewEvidence` object.
- Opening native Review does not create a second copy of any Review subscription.
- Leaving Review quiets bounded Review polling.
- Counterfactuals retain `READ ONLY · ZERO ORDER AUTHORITY`.
- Desktop cream and blackout skins remain legible without horizontal clipping.
- Mobile Review preserves evidence access; no Legacy-only operator job is lost.

## Keep / reuse / rewrite

| Capability | Decision | Reason |
|---|---|---|
| Daily and weekly Autopsy | Keep native | Native Review already presents the sealed reports. |
| Event chronology | Keep native | Native Tape owns bounded read health and chronology. |
| Counterfactual research | Keep native | It is already isolated as read-only evidence. |
| Account NAV curve | Reuse with split evidence state | `equity_snapshots.account_id` is independently account-scoped even when legacy channel attribution is unavailable. |
| Historical channel P&L | Rewrite evidence boundary | Never infer an account from the strategist's mutable current assignment. |
| Chart, option chain, open book | Keep native destinations | Markets and Positions already own these operator jobs. |
| Legacy Mix mutation controls | Do not migrate as-is | Configuration needs governed proposal and activation receipts. |
| Add Channel thesis importer | Re-home before final removal | It remains a Legacy-only creation job on desktop. |
| Legacy shell/chassis/settings | Retire | They duplicate the workstation and include stored legacy-only controls. |

## Smallest local implementation slices

1. `hooks/useWindowedPnl.ts`: separate immutable position-attribution evidence
   from account-scoped NAV curve evidence.
2. `components/console/PnlPanel.tsx`: render partial-but-explicit evidence and a
   bounded diagnostic summary without implying attributed channel totals.
3. The existing P&L self-test surface: cover pre-observation positions, route
   read failure, mutable strategist reassignment, and account NAV-only history.
4. The native Channels workspace plus its tests: re-home Add Channel before the
   direct Legacy fallback is removed.
5. `components/shell/WorkstationShell.tsx`: hide the normal Legacy navigation
   entry only after the observation gate passes; retain a direct archive route
   for one release.

The first three slices are now implemented locally:

- account NAV and immutable channel attribution carry separate evidence states;
- either side may remain visible when the other blocks;
- missing immutable routes withhold channel rows without suppressing valid
  account NAV history;
- operator diagnostics show a bounded count/sample while retaining the exact
  issue in hook evidence;
- the immutable routing helper and no-fallback rule remain unchanged.

Focused evidence-state, Review accuracy, and broker-reconciliation tests pass.
This has not been committed, previewed, or deployed.

## Retirement sequence

After the observation receipts pass:

1. Hide `Legacy Rooms` from normal desktop navigation.
2. Retain the direct archive fallback for one production release.
3. Verify one additional completed session through native Review.
4. Remove the archive surface and its obsolete self-fetching compatibility code.

Any parity failure resets the observation window after the correction. No schema
migration, Railway restart, worker release, or trading/configuration action is
required for this UI migration.
