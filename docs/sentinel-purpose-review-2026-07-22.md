# Sentinel purpose review — 2026-07-22

Status: purpose contract accepted as the implementation boundary. A deterministic
foundation is prepared locally on `work/market-hours-evidence-2026-07-22`; no
merge, deployment, production write, strategy/configuration change, or order
action is authorized by this document.

## Decision

Sentinel should be the desk's **after-action attention allocator**, not a trading
agent, health monitor, strategy optimizer, or source of operational truth. Its
job is to tell the operator:

1. whether the evidence package for the last completed session is trustworthy;
2. what materially changed versus the prior comparable evidence window;
3. which one to three findings deserve human review;
4. what is still unknown or censored; and
5. which already-governed test, replay, or research queue a finding belongs in.

The first screen must therefore be evidence identity and completeness, followed
by deterministic findings. Interpretive prose is optional and subordinate.

## July 22 hosted-publisher finding

The production event ledger contains rich `sentinel-publisher-v2` receipts for
`2026-07-21 -> 2026-07-22` and `2026-07-22 -> 2026-07-23`, but no matching
`morning-publisher: start -> Sentinel -> finish` chain from
`remote-morning-publisher-v1` on July 22. The content became current, but the
Mac-independent hosted publication claim is not proven.

Local commit `3bf14b6` corrects the proof boundary: a deterministic run identity
binds evidence session, target session, and publisher version; retries fill only
missing chain members; and only one ordered hosted start/Sentinel/finish chain
can satisfy the hosted receipt. A local Sentinel row cannot stand in for that
chain. This work remains local and undeployed.

## Deterministic and interpretive boundary

### Deterministic core — mandatory

The core owns all facts and all classifications:

- session, target session, release id/hash, worker version, roster identity,
  channel version, configuration epoch, and manager version;
- source freshness, completeness, query errors, missing rows, censors, and
  conflicts;
- live-fill outcomes, broker/desk reconciliation, manager-arm outcomes, frozen
  dark candidates, exact-path coverage, and independent-opportunity counts;
- cohort-safe descriptive aggregates and changes versus the previous comparable
  cohort;
- routing of a finding to an existing preregistration, research queue, or
  `insufficient evidence` state.

The core must be fully useful without an LLM. It fails closed and never fills a
missing fact with an estimate.

### Interpretive layer — optional

An LLM may only compress the deterministic packet into a short operator read:

- at most three review bullets;
- one explicit `so what` sentence;
- links back to the exact evidence rows and governing test;
- an abstention when the packet is partial, conflicting, thin, or stale.

The LLM may not recompute metrics, choose the comparison cohort, infer current
configuration from a slug, convert a bench result into an edge claim, predict
direction, recommend an immediate knob change, arm/mute a channel, alter risk,
or affect incident/health status.

## Inputs and truth states

Every input carries `{state, source, asOf, session, version/hash}`. The allowed
states are `ok`, `partial`, `missing`, `error`, `stale`, `conflict`, and
`not_due`.

| Input | Authoritative provenance | Freshness/identity requirement |
|---|---|---|
| Release and roster | sealed release receipt plus active worker startup receipt | exact release id/hash and current configuration epochs |
| Live trades | reconciled positions, execution observations, broker results | one completed session; manual/operator outcomes separately labeled |
| Manager observers | `manager_shadow_runs` | exact position, policy version, admission state, quote evidence, terminal/censor state |
| Dark/VB decisions | frozen signal plus execution-observation ledger | exact session, channel/config/manager/source versions; no independent-trade claim |
| Dark/VB paths | Databento exact CBBO scorecards | strict T+1 gate, exact OCC identity, checksum, boundaries, internal-gap guard |
| Market context | maintained calendar and versioned session evidence | session-specific; no carry-forward through missing data |
| Publisher proof | hosted start/Sentinel/finish receipt chain | exact evidence session, target session, run id, publisher version, ordered chain |

`partial`, `missing`, `error`, `stale`, or `conflict` remain visible and may
reduce the report to evidence status only. A healthy worker cannot make stale
Sentinel evidence green.

## Actionable output

The operator-facing artifact should contain, in order:

1. **Receipt:** session, next session, publisher proof, release/config identity,
   and overall completeness.
2. **What happened:** live book, manager book, dark book, and every censor.
3. **What changed:** only cohort-safe deltas versus the prior comparable window.
4. **Review queue:** zero to three findings, each with evidence class, sample
   size, exact-path coverage, confidence limits, and its governing test.
5. **Next action:** `hold`, `collect`, `replay`, `preregister`, or `operator
   review`; never `change now`.

## Non-goals

Sentinel is not:

- a market-direction forecast or intraday signal;
- a liveness/incident input;
- an autonomous strategist promoter, tuner, or portfolio allocator;
- a substitute for exact bid-side replay or broker reconciliation;
- a way to pool versions, configuration epochs, sibling clocks, or overlapping
  candidates into a larger-looking sample;
- proof that a publisher ran merely because some current Sentinel row exists.

## Stale-channel and configuration failure modes

The current implementation can mention inactive or obsolete channels because
its live scan pools a local forensics file from a fixed era boundary and its
bench scan uses a rolling virtual-trade window. A channel slug alone does not
prove current roster membership or configuration identity.

The replacement contract must explicitly prevent:

- retired/muted/dark rows being described as currently active;
- results pooled across channel versions or configuration epochs;
- exit-only siblings being counted as independent entry evidence;
- overlapping re-entry clocks inflating opportunity counts;
- local rich publication satisfying hosted-publisher readiness;
- mid-basis virtual outcomes being presented as executable fills;
- partial current-session data being compared with a complete prior session;
- an LLM converting a large peak, thin sample, or multiple-comparison artifact
  into a promotion claim.

## Evaluation rubric and frozen replay set

Before any model change, run the same deterministic packets through the current
Claude judge, a candidate GPT judge, and a no-LLM renderer. The replay set must
include at least:

- July 17: known receipt-schema yellow;
- July 20: RC5.1 manager/configuration mismatch and manual intervention;
- July 21: five live fills plus 138 frozen dark decisions, 34 exact contracts,
  124 fully eligible exact scorecards, and 14 path censors;
- July 22: flat-close session, three -30% live stops, 24 terminal manager runs,
  1,247 dark-lifecycle decisions, and a current rich Sentinel without hosted
  start/finish proof;
- synthetic stale, conflicting, partial, zero-candidate, duplicate-clock,
  configuration-epoch, manual-close, and provider-gap fixtures.

Score each renderer on:

1. receipt/session/config correctness;
2. factual grounding and traceability;
3. censor and uncertainty preservation;
4. active-versus-dark lifecycle correctness;
5. no unsupported causal, edge, or direction claim;
6. correct routing to `hold/collect/replay/preregister/review`;
7. stability under input ordering and repeated runs;
8. operator usefulness in a 20-second scan.

Any wrong health claim, wrong active status, missing censor, invented fact,
immediate configuration recommendation, or untraceable number is an automatic
failure.

## Is an LLM necessary?

No LLM is necessary for receipt status, anomaly detection, evidence ranking,
cohort comparison, or queue routing. Those should be deterministic.

An LLM may still be useful for the final compression layer once the deterministic
packet is sealed, because it can explain why two facts matter together and
reduce operator reading time. That value must be demonstrated by the frozen
replay evaluation. Until then, the no-LLM renderer is the reference behavior.

## Staged implementation decision

1. **Prepared locally:** `sentinel-operator-packet-v1` renders a deterministic,
   versioned packet without an LLM; production remains unchanged pending review.
2. **Hosted handoff prepared:** the after-close workflow builds the packet and
   the morning publisher carries forward only a structurally valid packet.
3. **Offline evaluation:** compare Claude, GPT, and no-LLM output on the frozen
   replay set. No publishing and no configuration authority.
4. **Optional shadow interpretation:** if GPT materially improves operator usefulness with
   zero rubric failures, publish its digest alongside—not instead of—the
   deterministic packet.
5. **Operator ratification:** only after repeated clean replays decide whether
   GPT should replace Claude in the optional compression layer.
