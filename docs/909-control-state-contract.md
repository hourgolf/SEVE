# 909 control-state contract

This is the source of truth for mounted SEVE workstation controls. It exists to
prevent local CSS layers from assigning a different color or material to the
same interaction state.

## State language

| Meaning | Treatment | Current families |
| --- | --- | --- |
| Primary workspace navigation | Neutral face with orange locator | desktop mode/section navigation; mobile room pads |
| Exclusive selection | Neutral pressed face with amber locator | account, chart/chain, ticker, date/window/lane, chart range/interval/type, review mode, studio scope, settings frame |
| Enabled overlay/toggle | Green | chart overlays and configuration visibility |
| Health or positive value | Green text/light only | process, broker, read receipts, positive P&L |
| Warning | Amber text/light only | degraded or partial evidence |
| Danger/destructive | Red | KILL, close confirmation, negative/risk states |

Green must not be used to mean “selected tab.” Amber must not imply that a
system is healthy. Orange must not be used as a full navigation fill or for
data meaning.

Desktop exclusive choices use connected 30px segmented rails. Mobile choices
use separated 38px touch targets with the same type, radius, and amber selected
locator. Count badges are subordinate to their filter label. Status pills do
not inherit interactive selected styling.

## Mounted control inventory

### Mobile

- Account: `.acct-switch` / `.acct-opt`
- Workspace navigation: `.m2-padbar` / `.m2-modepad`
- Market view and ticker: `.m2-market-switch`
- Chart exclusive selectors: `.chart-toggle`, `.seg`
- Chart overlay toggles: `.ind-chip`, `.chart-cfg-chip`
- Review mode: `.m2-review-modes`
- Shadow Research: `.srw-controls`
- Studio scope: `.m2-channel-scope`
- Desk dialog: `.m2-desk-tabs`
- Frame settings: `.m2-set-seg`

### Desktop

- Workstation command rail: `.ws-rail`
- Workstation section: `.ws-left`
- Account: `.acct-switch` / `.acct-opt`
- Chart exclusive selectors: `.chart-toggle`, `.seg`
- Chart overlay toggles: `.ind-chip`, `.chart-cfg-chip`
- Review sections: `.rvw-head nav`
- Event Tape view: `.etw-head nav`
- Event Tape filters: `.etw-tools nav`
- Shadow Research: `.srw-controls`
- Studio fleet scope: `.fleet-scope`
- Studio inspector: `.iseg`, `.cfg-seg`
- Alternate analytical views: `.roster-toggle`, `.theme-toggle`

`components/mobile/MobileApp.tsx` and the earlier `DeskShell` room tabs are
archived/unmounted surfaces and are not part of the current contract.

The desktop workspace mode is owned solely by `.ws-left`; the former duplicate
PERFORM/STUDIO switch is retired. The command rail carries brand, account,
essential desk telemetry, consolidated system truth, and operator utilities.

## Verification matrix

For every release that changes control styling:

1. Verify cream and blackout.
2. Verify desktop and the 358px/430px mobile breakpoints.
3. Exercise at least one inactive and active state in each mounted family.
4. Confirm active controls keep their geometry and no group overflows.
5. Confirm the browser console is clean.
6. Run `npm run ui-control-contract-selftest`.
