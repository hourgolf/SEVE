# Native Review → Legacy retirement gate

Status: local implementation candidate; Legacy navigation remains active.

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

## Retirement sequence

After the observation receipts pass:

1. Hide `Legacy Rooms` from normal desktop navigation.
2. Retain the direct archive fallback for one production release.
3. Verify one additional completed session through native Review.
4. Remove the archive surface and its obsolete self-fetching compatibility code.

Any parity failure resets the observation window after the correction. No schema
migration, Railway restart, worker release, or trading/configuration action is
required for this UI migration.
