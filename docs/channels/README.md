# Channel exports — examine what each channel does

These `.md` files describe the desk's **built-in** channels (`engine/strategies/*.ts`)
in the same thesis format imported channels use — so the whole roster is examinable
in one language. They're **documentation/reference**, not live config (the built-ins
run from code via `engine/registry.ts`; don't re-import these or you'll duplicate a
channel).

- [breakout.md](breakout.md) · [fade.md](fade.md) · [power.md](power.md) · [grind.md](grind.md)

Each is generated faithfully from that strategy's `DEFAULT_*_PARAMS`. The **Desk
note** at the bottom of each flags where its real logic exceeds the importable
`StrategySpec` vocabulary (e.g. the efficiency-ratio regime gate, raw momentum) —
i.e. what the spec layer would need to add to round-trip a built-in as a thesis.

## Examine performance — `npm run report`

`npm run report` (or `-- --days N`) prints a per-channel scorecard from live
telemetry: closed-trade win rate / expectancy / realized P&L, open exposure, and
the **acted vs vetoed** signal breakdown (what the risk layer is blocking). Run it
next to `npm run backtest -- --strat <slug>` to compare the **modeled** edge against
what the channel is **actually doing live**.
