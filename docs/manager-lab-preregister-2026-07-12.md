# Manager lab — retrospective preregistration

Registered after the entry-path aggregate read and **before** evaluating causal manager outcomes. This is retrospective manager discovery, not untouched confirmation.

## Fixed entry cohort

- First valid cost-gated entry per channel/session.
- Current compiled entry spec, underlying, DTE and strike offset.
- Real one-minute underlying bars and causal Databento v2 NBBO.
- Entry at audited ask-plus-one-tick; exit marked at executable bid-minus-one-tick.
- No re-entry, conviction sizing or pyramiding. Manager comparisons use the identical one-contract entry cohort.

The aggregate entry-path read established the reason for this lab: 72–80% of cohorts touched +20%, median MFE was roughly +49% to +73%, median bell return was deeply negative, and about half of entries went green then finished red. Those facts motivate the following small family; they do not select a winner within it.

## Managers registered

All managers flatten at the last valid session observation and carry a hard premium stop where stated. Threshold crossing is evaluated in chronological order on the executable return path.

1. **LOCK20/30** — take all at +20%; hard stop -30%.
2. **LOCK30/30** — take all at +30%; hard stop -30%.
3. **LOCK50/30** — take all at +50%; hard stop -30%.
4. **WIDE20/50** — take all at +20%; hard stop -50%.
5. **BANK20/RUN50** — two equal notional legs: bank half at +20%; the runner moves to a 0% return floor and targets +50%, otherwise exits at the floor or bell. Before +20%, the whole position has a -30% stop.
6. **ARM20/HALF-GIVEBACK** — hard stop -30% before arming at +20%; after arming, exit if executable return gives back half of the highest observed gain, with a floor at 0%; otherwise flatten at bell.

Controls:

- **BELL/-30** — no profit manager; hard stop -30%, otherwise bell.
- **BELL/no-stop** — descriptive ride-to-bell path only, not a deployable proposal.

## Decision reads

For each entry engine and manager report:

- mean return per entry and cumulative one-contract return;
- win rate;
- maximum drawdown in return-point units;
- result by calendar year;
- best-year share of total positive return;
- exit-reason distribution and median holding time.

A manager is a research survivor only if it is positive pooled, positive in at least three calendar years, and not dependent on one year for more than 60% of gross positive return. Survivors still require forward paper confirmation using sub-minute executable observations before any channel/configuration change.

No thresholds will be altered in response to this lab's output. A later threshold study requires a new registration and a reserved confirmation window.
