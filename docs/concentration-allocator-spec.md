# Concentration allocator — spec (2026-07-10)

**The operator's ask:** make one-account concentration a *managed* thing, so the dream team can
truly concentrate in a single account — instead of today's implicit isolation, where channel→account
placement is doing the risk work ("where we can fit them in to prevent collision").

## Problem statement

Today, three paper accounts keep channel orders from colliding **by placement**. Collapsing to one
account (go-live) removes that crutch. The measured facts (one-account shadow + cross-audit, era-4):

- **Self-cross / coalescing is a non-issue**: self-cross 0 events; coalescing ~$287 ceiling
  (go-live-infra item 0) → order-path netting deferred.
- **Concentration IS the binding constraint**: 70% of trades land on shared strikes; observed peak
  stack **3 channels / 54 contracts on ONE strike**. Buying power never bound; the strike did.
- What that exposes in one account: one adverse tick marks the whole desk at once; exits compete for
  the same book depth at the same moment; a single OCC carries multi-channel gamma with no desk-level
  ceiling — per-channel `max_contracts` caps each soloist, nothing caps the choir.

## What already exists (don't rebuild)

| piece | state | role |
|---|---|---|
| C1 stack-cap (`64_stack_cap.sql`, `fund_state.stack_cap_n`) | DARK, arms post-A6 | correlated-bet **COUNT** breaker (how many channels may stack one strike) |
| per-channel `max_contracts` | live | per-soloist ceiling |
| `deskStack` (cycle-scoped, in the worker ctx) | live (feeds C1) | already counts per-OCC stacking each cycle |
| one-account-shadow admit/downsize/reject machinery | modeled nightly | exactly the admission mechanics the allocator needs, already simulated |
| row-primary booking + reconcile | live | shared-OCC attribution solved — allocation bookkeeping is tractable |

## The spec — a desk-level concentration allocator (worker, decide-time)

**1 · Concentration ledger.** Extend the cycle's `deskStack` from channel-counts to **sizes**:
desk-wide open exposure per OCC (contracts + premium $) and per underlying (Σ premium $), across
all channels in the account group. Runner rows (R1/R1b) and pyramid adds count toward occupancy.

**2 · Budgets** — `fund_state` knobs, all `0 = off` (dark, byte-identical until armed):
- `occ_max_contracts` — desk-wide contract ceiling on any single OCC.
- `occ_max_premium_usd` — desk-wide premium ceiling on any single OCC.
- `und_max_premium_usd` — umbrella ceiling per underlying (the gap-day pile-on case).

**3 · Admission at entry** (and pyramid adds): after normal sizing,
`qty′ = min(qty, room_occ_ct, room_occ_usd, room_und_usd)` →
**admit** (full) / **downsize** (partial, floor 1 contract) / **reject** (`blocked: "concentration"`,
logged like every other gate). **Exits are NEVER gated.**

**4 · Priority = roster tier.** Within a cycle, evaluate channels in `sort_order` (operator-set) so
FIRST-TEAM earners claim room before LAB probes; across cycles it's first-come (correct — an open
position's claim is real). No silent starvation: a rejected/downsized entry logs the winner.

**5 · Relationship to the rest of the stack:**
- **C1** stays the blunt COUNT breaker; the allocator manages **SIZE within the admitted count**.
- **Go-live item 2** (capital allocator = cash/buying-power) is a separate concern — the shadow says
  cash never binds at current sizes, so THIS (strike concentration) is the one that matters first.
  Sequence this as **item 2b**, ahead of the cash allocator.
- **Master-stop** (item 3) sits above both.

**6 · Numbers: derive, don't guess.** Set initial caps from the one-account shadow's observed stack
distribution (e.g. cap near the p75 of peak per-OCC stacks, so the tail days downsize but typical
days are untouched). The operator sets the final numbers — capital/risk appetite is his discretionary
call, never a formula's.

## Rollout (shadow-first, per desk doctrine)

1. **Extend `one-account-shadow`** with the three budget knobs → nightly emit of would-be
   admit/downsize/reject counts + the P&L delta under caps (the `scenarios` machinery already sweeps
   pool sizes; add cap scenarios beside them). Zero worker change.
2. **Grade ~2 weeks**: how often would caps have bound, what did they cost/save, which channels lose
   size (and would the priority ordering have protected the right ones).
3. **Worker build** in a dedicated session (Fable-tier — near-live-capital trade path, go-live
   doctrine): ledger + admission in `decide.ts`/`execute.ts`, knobs dark.
4. **Arm post-A6** alongside C1, numbers from (2), registry-logged.

**End state:** placement stops being the isolation mechanism. Accounts become pure lifecycle
bookkeeping (FIRST-TEAM / LAB / MORGUE), and the dream team concentrates in one account with the
desk — not the org chart — managing strike risk.
