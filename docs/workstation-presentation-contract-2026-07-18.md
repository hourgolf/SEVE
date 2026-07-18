# Workstation presentation contract

Status: implementation contract for the functional spine and replaceable visual shells.

The 909 workstation remains the primary product. A future visual direction may
compose the same operational models and actions, but it must not fork trading
logic, database reads, provenance rules, authentication, or safety behavior.

## Load-bearing seam

`app/page.tsx` owns remote hooks and pure cross-source derivations. One
`SurfaceProps` value crosses into the mounted shell. Desktop, mobile, legacy,
and any future skin are subscription-free consumers.

The following may not be reimplemented in a skin:

- release/configuration identity and channel lifecycle classification;
- incident policy and market-session interpretation;
- position marks, peaks, exposure, and close-flow rules;
- operator authentication and protected mutation paths;
- Sentinel provenance/freshness classification;
- event-tape category, read health, and repeated-event handling;
- paper/live mode and safety controls.

## Existing headless contracts

| Workspace | Shared contract | Current consumers |
| --- | --- | --- |
| Channels | `ChannelWorkspaceModel`, `ChannelPassport`, `Day1ReleaseObservation` | desktop Studio, mobile Studio |
| Positions | `PositionsWorkspaceModel`, `PositionCloseFlowState`, manual-close normalization | desktop Positions, mobile Book |
| Markets | `MarketRiskSummary`, page-owned contract history, page-owned market feed | desktop Markets, mobile Play/Book |
| Sentinel | deterministic incident plus versioned Sentinel receipt status | desktop Sentinel, mobile Play/Ops |
| Event Tape | `TapeRow`, `EventTapeStatus`, category/filter derivation | desktop Tape, mobile Play/Review |
| Ops | incident, ops read model, worker-run model, release receipt | desktop Ops, mobile Ops |

The channel model is now derived once at the page seam. Its semantic release
presentation includes checking, verified, missing, mismatch, and read-error
states. A shell cannot infer paper roots from database `armed` rows or mistake an
unfinished read for a missing receipt.

## Shell rules

1. A skin receives models and capability-gated actions; it does not fetch.
2. A safety-critical action uses the shared authenticated action path and
   shared confirmation/annotation contract.
3. Desktop and mobile may compose different layouts, but must expose the same
   truth and essential actions.
4. Loading, empty, error, stale, unreconciled, and unverified are distinct.
5. Historical evidence always carries its window, policy era, provenance, and
   development/prospective partition.
6. Visual labels may be shortened for space only when their semantic state is
   unchanged.
7. Legacy Rooms remain available until every required workspace action has
   passed desktop and mobile operator drills.

## Skin boundary

A second skin should be a sibling shell selected by a presentation preference,
not a CSS override that hides 909 assumptions. Both shells would consume the
same `SurfaceProps` and headless workspace models. Theme tokens such as cream
and blackout remain local to the 909 shell; a future skin owns its own tokens,
layout, typography, and density.

The safe implementation order is:

1. finish lifting remaining workspace derivations to the page seam;
2. define one capability map for read-only versus authenticated actions;
3. finish desktop/mobile functional drills;
4. retain 909 as the default and add a development-only sibling shell;
5. compare usability without changing evidence or trading behavior;
6. expose a persisted skin choice only after both shells pass the same tests.

## Remaining contract gaps

- Channels: configuration changes must fork a versioned cartridge/configuration
  epoch; sealed RC5 controls remain read-only.
- Positions: complete a controlled authenticated paper close drill on both
  shells and preserve broker-reconciliation uncertainty.
- Markets: keep chain/contract selection and open-risk truth together on mobile.
- Review: link a tape event to its trade, channel passport, exact path, and
  manager observations.
- Ops: make capture/publisher freshness and reconciliation blockers first-class
  model fields rather than presentation-only text.
- Dashboard: add only basis-explicit day-book attribution.

Exact 909 aesthetic polish and any alternate-skin prototype come after these
functional gaps. No visual shell is allowed to alter the paper-only release or
strategy configuration.
