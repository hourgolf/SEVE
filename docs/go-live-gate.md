# GO-LIVE READINESS — advisory checklist (the OPERATOR decides, by judgment)

**Status: ADVISORY (reframed 2026-07-06, operator's word).** Go-live timing, sizing, and
channel on/off are the operator's discretionary calls — he turns things on when he's
comfortable, full stop. This doc is NOT a gate and sets no thresholds. The registry's
rigidity applies to EXPERIMENTS AND MEASUREMENTS (keeping data interpretable); capital
allocation is explicitly outside it.

What remains useful here: the *information* that makes a comfort call well-informed, and
the safety plumbing real money would want regardless of when the switch flips.

## Readiness signals worth glancing at before flipping anything live
- Forward expectancy on the channels you'd take live (clean books, `a6-read` / weekly-readout).
- How many distinct regimes that record spans (one hot month ≠ three mixed ones).
- Books tie-out streak (`npm run reconcile-alpaca` — nightly in capture) and orphan history.
- Fill-quality reality: paper fills are modeled generosity — the first live weeks should
  compare real slippage vs the model before size grows.

## Safety plumbing to have IN PLACE before the first real dollar (build items, not gates)
- **Master account-level stop wired in decide.ts** — currently a dead knob by choice (fine
  for paper); for real money it's the one brake that doesn't depend on anyone watching.
  Say the word and it gets built dark + paper-tested like everything else.
- ORPHAN_FLATTEN armed and boring.
- Kill-switch flatten re-proven recently.
- A written answer to "what happens if the worker dies mid-session with real positions"
  (cron failover is exit-only today; single Railway replica).

## Suggestions, not rules
- Start small and scale on comfort — a staged ramp beats a switch, but the stages are yours.
- Consider pre-arming a few tripwires you'd *want* to fire without you (e.g. auto-flatten at
  a daily loss number you pick) — optional, and they can be loosened/removed at will.
- Whatever subset goes live first, keeping LAB/MORGUE paper-only keeps the experiment
  machinery clean alongside real money.
