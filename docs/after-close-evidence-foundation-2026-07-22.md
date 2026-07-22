# After-close evidence foundation — 2026-07-22

Status: local implementation and verification complete on
`work/market-hours-evidence-2026-07-22`. Production remains unchanged. No push,
merge, deployment, Supabase/R2 mutation, schema change, Databento disclosure,
configuration change, promotion, or order action occurred.

## Session receipt

The SELECT-only deterministic packet reconciled the completed session:

- sealed release `weekend-day1-2026-07-21-rc5.3` and configuration SHA-256
  `b68348407a5f4c5c351213c6cf512afe1571a20646aeb9f213c644dd15f50bf1`;
- three opened and three closed paper positions, zero open, realized P&L
  `-$312`, and zero operator closes;
- 24/24 required live-position manager paths terminal, zero censored and zero
  active;
- 1,247 dark/VB raw decision clocks frozen with zero source censor across 29
  exact OCC contracts;
- deterministic next action `replay`, because the exact path is truthfully
  `not_due` rather than missing or failed.

The freeze file SHA-256 is
`c3417a4da96c8b2c6a03bbaf726b34c68344045cbeb955db4d02364bbf3d98b2`.
Its canonical evidence SHA-256 is
`51271a246cb9b6f849d916ebb2f2802ba2506c087cc2e9ca027d36ffaa71b34d`.

## Dark/VB exact replay

`dark-exact-replay-v1` adds the missing independence boundary:

1. each frozen raw decision clock must receive one exact Databento CBBO
   scorecard for every manager configured for that channel;
2. raw-clock exact coverage is reported separately from independent outcomes;
3. each channel/configuration/manager lane is then walked chronologically;
4. a later clock before that manager's exact prior exit is censored as
   `sequential_reentry_active`;
5. only the retained manager paths are labeled independent opportunities.

This is intentionally different from preselecting entries using an approximate
virtual exit. Managers can exit at different times, so each manager receives
its own sequential lane.

The checksum-gated T+1 runner defaults to a zero-network plan. It requires both
freeze hashes, sends only the 29 frozen OCC/window requests when explicitly
invoked with `--estimate` or `--download`, stores one local content-addressed
provider object per contract, and fails closed on provider refusal, request
expansion, missing contracts, boundary failure, internal gaps, identity
conflict, or incomplete manager arms. It imports no Supabase/R2/order client.

The July 22 strict historical gate is
`2026-07-23T19:55:02.000Z` (12:55:02 PM Pacific). No provider request was made
while preparing this branch.

The existing family-collision replay bridge remains the separate, correct layer
for comparing sibling clusters and one-survivor admission arms. The new swarm
sequencer does not replace or pool that evidence.

## Deterministic Sentinel

`sentinel-operator-packet-v1` implements the accepted purpose contract:

- receipt and release identity first;
- live, manager, dark, and publisher facts with explicit evidence states;
- deterministic review findings and one governed next action;
- no configuration, promotion, or order authority;
- no LLM required.

The legacy Claude scanner is no longer an operational publisher by default and
does not call Anthropic unless both legacy publication and Anthropic
interpretation are explicitly opted in. The hosted after-close workflow is
prepared to publish the deterministic packet; the morning workflow only carries
forward a structurally valid packet and still labels its incomplete remote
terrain inputs as partial. A malformed packet is discarded rather than rendered.

The UI labels this artifact `OPERATOR QUEUE`, not `LLM synthesis`. GPT remains a
later offline comparison candidate for optional prose compression only.

## Database containment already in this branch

The same review stack includes the earlier market-hours containment work:

- position peaks derive from durable position state plus fast marks rather than
  repeatedly scanning quote history;
- Realtime bar refresh is symbol-filtered and coalesced;
- the heavy chain fallback is five minutes and no longer duplicates bar reads;
- incident heartbeat and metadata cadences are separated and hidden tabs pause
  the polling work.

These changes reduce read amplification without changing paper execution,
strategy behavior, evidence capture, or risk-reducing exits. Actual egress and
statement-timeout deltas still require multiple deployed sessions before any
Supabase downgrade decision.

## Verification

- root TypeScript: clean;
- deterministic Sentinel read-only July 22 run: complete;
- dark exact replay: 12/12;
- VB exact candidate evidence: 38/38;
- Sentinel operator packet: 22/22;
- dark evidence completeness: 11/11;
- family exact replay bridge: 16/16;
- remote morning publisher: 27/27;
- after-close workflow contract: 20/20.

Both TypeScript projects are clean, the production build compiles and renders
all five static pages, and the full maintained evidence/capture/release
regression matrix is green. The SELECT-only July 22 packet re-derived 3/3 live
positions closed, 24/24 manager paths terminal, and 1,247 dark clocks frozen
without an LLM or external write.

## Next gates

1. Review the scoped local commits and web/hosted changes before any push,
   merge, or deployment.
2. After 12:55:02 PM Pacific on July 23, explicitly authorize the checksum-bound
   Databento estimate/download; render exact raw coverage and independent
   manager paths locally.
3. Keep the sealed paper configuration unchanged until the evidence process—not
   merely the raw sample count—is complete and repeatable.
