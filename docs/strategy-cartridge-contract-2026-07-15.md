# Strategy cartridge + evidence passport contract — 2026-07-15

Status: pure architecture slice for review. No database, hook, component, worker, strategy, configuration,
order, sizing, manager, or deployment behavior changes.

SEVE remains paper-only. This contract cannot authorize live-money trading or automatic channel promotion.

## Why this exists

The current system has real pieces of a pluggable channel, but their meaning is split across several layers:

- `engine/registry.ts` and `lib/desk/strategySpec.ts` define admission logic;
- `strategists` and `strategist_config` hold mutable desk settings;
- `policy_epochs` can seal a policy version;
- `PositionPlanV1` stamps one allocator-approved trade;
- execution/outcome/manager receipts describe what actually happened;
- Phase 1K research reports grade whether those receipts are comparable.

That fragmentation let the dashboard show a stop, target, peak, win rate, or day P&L without one durable
object answering: **which channel version, manager version, data clock, outcome partition, and quote basis does
this number describe?** It also made entries feel like the product while exits and scaling remained generic.

`lib/strategy/channelContract.ts` adds two pure versioned envelopes:

1. `StrategyCartridgeV1` — what the channel claims, needs, risks, and does after entry;
2. `StrategyEvidencePassportV1` — what evidence exists for that exact channel + manager version.

They are contracts and validators, not a second strategy engine.

## Load-bearing invariants

1. **Paper-only:** `liveMoneyAuthorized` is literally `false` in V1.
2. **Human promotion:** every cartridge and passport says `operator_only`; evidence can become review-ready,
   but `promotionEligible` is always `false`.
3. **Per-channel management:** stop, bank, runner, giveback, stall, and EOD rules belong to the cartridge's
   versioned manager—not to a fleet-wide account default.
4. **No four-contract doctrine:** the minimum is derived from the selected whole-lot allocation. A half-bank /
   half-runner needs two; thirds need three; all-out needs one.
5. **No silent degradation:** if requested size cannot support the selected arm, the helper returns zero or the
   nearest lower compatible quantity. It never silently converts a two-tranche policy into one-contract all-out.
6. **Matched clocks are named:** every admission policy carries a decision-clock ID so sibling collisions and
   comparisons do not rely on slug proximity or coincidental timestamps.
7. **Missing evidence is censored:** the observability contract requires decision, rejection, family collision,
   order, fill, position, path, manager, outcome, and operator-action receipts.
8. **Native and human outcomes stay separate:** native, operator-managed, operator-test, execution-correction,
   and censored rows reconcile exactly to the passport's closed outcomes.
9. **Performance needs a basis:** every research metric carries its denominator and a structured basis that pins
   cohort, window, channel version, manager version, quote source/basis, and outcome partition.
10. **Immutable source identity:** strategy references and historical quote objects require SHA-256 hashes.

## Cartridge boundaries

### Identity and lifecycle

The cartridge pins the slug, display name, family, hypothesis, semantic version, underlyings, and executor.
Lifecycle is one of `draft`, `dark`, `paper`, `benched`, or `disabled`. `familyId` is the channel's declared
collision/risk identity; it must not be inferred from `inferResearchFamily`, which remains a reporting label only.

### Admission

The cartridge does not copy the full `Condition` vocabulary. It points to an immutable registry or compiled-spec
source by reference and content hash, and separately stamps the deployed worker version + source commit, then
records the operator-readable conditions summary. The existing
`StrategySpec`, capability checks, and registry remain the executable admission authority.

Admission additionally pins what those older types did not fully own:

- the opportunity/decision clock and maximum lag;
- required market inputs, provider, cadence, freshness, and purpose;
- event posture and re-entry posture;
- DTE and strike-selection policy;
- ask-side entry and bid-side exit/mark truth for long options.

This is the seam for replacing one-minute-only decisions with an explicitly versioned intraminute or hybrid
clock. Changing the clock is a new channel version, not an invisible infrastructure improvement.

### Risk

Risk records dollars per trade, contract cap, daily **entry latch**, open-position limit, collision family,
family concurrency, and concentration tags. Account-wide master safety may still exist above the cartridge, but
it does not replace the channel's stop or policy.

### Management

The manager is identified by ID + semantic version. It owns:

- an explicit first-match set of premium, underlying, and/or structural initial stops;
- whole-contract harvest tranches with explicit allocations and triggers;
- earned-conviction adds, when enabled, with increasing favorable-R thresholds and a structural ban on
  averaging down long premium;
- optional stall behavior;
- a session-relative EOD flatten offset, so early-close days use the market calendar rather than a fixed 16:00 assumption.

A structural stop must still carry a catastrophic premium fallback. Premium and underlying stops can coexist;
neither is inherited from an account-wide label. A runner can use a bid-side peak giveback,
underlying ATR trail, or an immutable versioned rule. The exact selection is channel evidence, not dashboard
decoration.

### Observability and display

The cartridge names every required receipt and makes `censor` the only missing-evidence behavior. Its display
contract separates live operator facts from research facts:

| Live / STUDIO | Research / REVIEW |
|---|---|
| state and actual open position | development vs prospective cohort |
| day P&L with explicit basis | exact observed window |
| risk budget and initial stop | independent sessions and native outcomes |
| next harvest action | operator/test partitions |
| channel + manager version | matched opportunity clocks |
| last decision and freshness | MFE, MAE, capture, modeled delta |
| | quote provenance and blockers |

Placeholder performance metrics are forbidden. A missing value should say why it is missing; it should not render
`win --%`, `pk --%`, or a zero that can be mistaken for evidence.

## Evidence passport

The passport is pinned to one cartridge version, manager version, and policy epoch. It carries:

- observed window, development cutoff, and untouched holdout start;
- cohort classification: development, prospective, or explicitly blocked mixed evidence;
- root trades, closed outcomes, independent sessions, matched clocks, collision groups, and scaling-capable paths;
- mutually exclusive outcome partitions;
- coverage for admission, entry broker result, booked outcome, and manager decisions;
- exact option-path source, schema, cadence, trigger basis, object checksums, and censored-path count;
- denominator-bearing metrics with structured provenance and current blockers.

`evidenceFloorMet` means only that the supplied receipt is structurally complete: at least one native closed path
from at least one session, no declared blockers, full lineage coverage, and no censored outcome/quote path. Empty
arithmetic (`0/0` everywhere) cannot turn green. This is deliberately not a profitability threshold and never
means “promote.” Sample-size and economic decision rules remain preregistered, versioned review policy.

## Mapping from the current system

| Current source | Cartridge/passport destination | Migration rule |
|---|---|---|
| `strategists.slug/name/underlying/executor/status` | identity + lifecycle | Direct after normalization; status `armed` maps to `paper`, never live. |
| registry or `spec_json` | `admission.strategyRef` | Reference and hash the exact source; do not duplicate conditions. |
| `worker_runs.version/git_sha` | `admission.runtimeRef` | Pin the deployed interpreter/feature runtime separately from the strategy payload. |
| `entry_dte` | option selector DTE | Direct only when the range is truly exact. |
| `strike_offset` | ATM-offset selector | Direct; dynamic selectors require a versioned rule. |
| `event_policy` | event posture | `standdown` → `stand_down`; `ignore` needs operator review before `trade_through`. |
| `capital_pct` legacy column | `riskPerTradeUsd` | Current column already means dollars; rename at the adapter/UI, do not reinterpret as percent. |
| `max_contracts` | contract cap | Direct; it is a ceiling, not a target quantity. |
| `daily_stop_usd` | daily entry latch | Direct after relabel; it does not flatten the account. |
| `premium_stop_pct` | premium initial stop | Direct only with bid trigger basis and a stamped policy era. |
| `underlying_stop_pct` | underlying initial stop | Direct only when enabled and semantics are confirmed. |
| `take_profit_pct` | all-out/bank trigger | Not enough by itself to invent tranches; unresolved allocation is a blocker. |
| `pyramid_adds` | earned-conviction add stages | **No direct migration.** Count alone lacks thresholds and allocations. |
| `stall_minutes/stall_max_favor_pct` | stall policy | Direct as a pair when both are valid. |
| Phase 1F/1G manager IDs | manager identity | Pin exact manager + version; never use “current manager.” |
| `policy_epochs` | persisted cartridge envelope | Natural future storage seam; requires a separately reviewed migration/adapter. |
| `PositionPlanV1` | one accepted opportunity instance | Stamp cartridge/channel/manager/policy IDs; it remains the trade-level plan. |
| Phase 1K fleet audit | passport inventory input | Preserve its provenance partitions; do not treat family summaries as independent samples. |
| exact CBBO manifests | quote provenance | Carry source/schema/cadence/hash and censor invalid paths. |

Fields that cannot be derived honestly—collision family, opportunity clock, content hash, manager allocation,
intraminute lag, or outcome basis—stay unresolved. A future adapter must report them as blockers rather than guess.

## Whole-lot sizing examples

```text
all-out 1/1                         -> minimum 1, step 1
bank 1/2 + runner 1/2              -> minimum 2, step 2
bank 1/3 + bank 1/3 + runner 1/3   -> minimum 3, step 3
bank 1/4 + runner 3/4              -> minimum 4, step 4
```

For a half-bank/runner channel capped at 10 with no planned adds, requests map as `1→0`, `2→2`, `3→2`, and
`12→10`. Enabled adds also participate in the minimum and reserve room under the total-position cap. The zero is
intentional: the allocator/UI must decide whether to wait, choose a different approved policy version, or reject
the opportunity. The runtime must not improvise.

## Adoption sequence

1. **This slice:** pure types, validators, sealing, exact whole-lot derivation, safe review summary, and tests.
2. **Read-only adapter:** map each current channel and report unresolved fields; do not persist or change behavior.
3. **Passport adapter:** join Phase 1K receipts into one versioned review object; keep raw receipts authoritative.
4. **Channels/Review UI:** render cartridge controls and passport facts through `page.tsx → SurfaceProps`; no new
   leaf subscriptions and no placeholder performance.
5. **Policy persistence:** store sealed cartridge JSON with `policy_epochs` only after a reviewed migration.
6. **Runtime adoption:** separately approved paper-only slice after parity tests prove the existing dispatcher and
   the cartridge-derived policy agree. Any difference becomes a new policy version and future holdout.

Legacy Rooms stays until the native Channels, Review, Sentinel, Event Tape, and Ops workspaces cover the operator
jobs with equal or better utility.

## Read-only current-fleet inventory

The new command:

```text
npm run current-channel-inventory -- --out data/channel-cartridge-inventories/YYYY-MM-DD.json
```

performs Supabase `SELECT`s only and writes a gitignored local receipt. It hashes canonical compiled `spec_json`,
hashes the current built-in registry/strategy source bundle, and reads the active `worker_runs.version/git_sha` as
the deployed interpreter stamp. Railway environment values are deliberately not inferred from `.env.local`.

July 15 result:

- 68 channels across three accounts: 25 paper, 38 draft, five disabled;
- all 68 have complete identity and internally consistent lifecycle state;
- 62 have a directly resolvable strategy source: 56 compiled specs and six registry strategies;
- six lack an explicit source link: three operator twins plus `grind-v3-2`, `pb-ride-2`, and `pb-ride-itm`;
- 67 stream channels map to deployed runtime `stream-2026-07-14a` at commit
  `386f4c620f347739f0ddd8c7509486998f2b4468`; the lone cron `grind` channel has no equivalent runtime stamp;
- 20 channels have an active policy epoch (54 historical epoch rows); 48 do not;
- 55 channels have an explicit configured premium stop; 13 currently inherit the runtime default;
- 10 channels also have an underlying stop, proving the cartridge needs a first-match stop set rather than one
  global stop field;
- two channels have `pyramid_adds=3`, but the row still lacks the favorable-R, allocation, and cap-reservation
  details required to call that a complete scaling policy;
- 14 channels are closest to the contract, each with the same seven remaining systemic blockers;
- zero are fully cartridge-ready because the prior model stamped none of these fleet-wide: production
  feed/freshness profile, decision-lag bound, collision family, per-channel open limit, family concurrency,
  whole-lot harvest allocation/minimum, or calendar-relative EOD policy.

The zero is an architecture inventory result, not a trading-health incident and not a recommendation to stop paper
collection. Existing runtime behavior remains unchanged. The next adapter must ratify those seven systemic fields
once, then address the smaller channel-specific exceptions without copying a guessed family or manager into all 68.

## Verification

- pure channel-contract self-test: 60/60 at initial implementation;
- pure current-channel inventory self-test: 25/25;
- live SELECT-only inventory completed for all 68 channels; local receipt is gitignored;
- half, third, and all-out whole-lot derivation pinned;
- invalid version/hash/clock/input/risk/stop/allocation/add/receipt/display cases rejected;
- development/holdout mixing, provenance gaps, partition errors, and auto-promotion rejected;
- TypeScript and production build are release gates before the branch is offered for merge.
