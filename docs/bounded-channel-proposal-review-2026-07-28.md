# Bounded channel proposal review — 2026-07-28

Status: **PREPARED REVIEW INPUT · LOCAL PLUMBING SPECIMEN ONLY · NO PROPOSAL ROW · NO STRATEGIC VALUE SELECTED · NO AUTHORITY**

## Generated plumbing specimen

The local command `npm run channel-bounded-proposal` now proves that the generic
workflow can generate one coherent bounded proposal and matching worker and
dashboard projections. Its deterministic evidence hash is:

`sha256:e8ff23187be55a6e73924178133fa86c681965c4935e5be9517fe5ef11969cba`

The specimen changes `orb-ustop-ctl` from quantity 2 to quantity 3 and scales
its declared debit/risk envelope from 400/120 to 600/180. Those numbers are a
plumbing fixture, not a recommendation, strategy decision, or request to
persist a proposal. The generated artifact explicitly records:

- `selectedValueBasis: plumbing-specimen-only`;
- `strategicRecommendation: false`;
- `strategicApproval: false`;
- `persistenceAuthorized: false`;
- `runtimeAuthority: false`;
- `orderAuthority: false`;
- `activationAuthorized: false`;
- replay, current capacity, safe-boundary, acknowledgement, and activation
  receipt evidence all absent.

Static schema, paper-account, risk-envelope, collision, and projection checks
pass. Replay, evidence readiness, and the safe boundary remain `not-run`, so the
specimen cannot produce a persistable activation preview. No Supabase row or
runtime authority is created by the command.

## Candidate decision

- Channel: `breakout-alt-v3-iwm`
- Active sealed release: `week2-2026-07-27-rc5.4`
- Active spec key: `spec:rc54:breakout-alt-v3-iwm`
- Current quantity: 2
- Current manager: `RC53-RIDE`
- Current take profit: ride / no fixed target
- Current catastrophe stop: 30% on executable option bid
- Requested change class: bounded TP/SL or quantity, exact field not yet selected

This remains the first strategic bounded-change review packet after the RC5.4
no-op canary. It is deliberately separate from the plumbing specimen above:
choosing a real value is an operator strategy decision, and the current
evidence does not meet the documented activation-quality floor.

## Why this channel is the review candidate

The July 27 RC5.4 path reached approximately +191.8% favorable excursion and
later closed near the 30% catastrophe stop. That is a strong channel-specific
profit-protection question. It is not evidence for a global target or stop
change.

The existing preregistration compares:

- `LOCK20/30`;
- `LOCK30/30`;
- `LOCK50/30`;
- `BANK20/RUN50`;
- `ARM20/HALF-GIVEBACK`;
- the current `BELL/-30` comparator.

The first path favored several protection arms, but one path cannot select a
manager.

## Current readiness blockers

1. The preregistered activation floor requires 12 same-configuration IWM
   opportunities over at least five sessions, with favorable and adverse path
   diversity. The current packet documents only one IWM opportunity.
2. The current bounded `takeProfit` schema represents ride or a half-bank. It
   does not faithfully represent an all-out `LOCK20/30`, `LOCK30/30`, or
   `LOCK50/30` arm.
3. A half-bank value alone would leave the remainder policy implicit in the
   existing manager profile. A proposal must not claim `BANK20/RUN50` unless
   the reviewed spec and worker projection bind the +50 remainder behavior.
4. No evidence currently supports a quantity change.
5. Current stop evidence supports keeping the 30% catastrophe stop unchanged.

Treating the plumbing specimen as this channel's strategic answer would create
false precision and could make an unsupported manager or size look
activation-ready.

## Operator decision fields

The future proposal generator requires all of the following:

| Field | Required operator/evidence decision |
| --- | --- |
| Change field | quantity, take profit, or stop loss |
| Exact proposed value | no placeholder or inferred default |
| Manager semantics | all-out, half-bank plus exact remainder, ratchet, or ride |
| Evidence references | immutable replay/path receipts supporting the value |
| Replay result | sufficient under the preregistered decision rule |
| Capacity/collision impact | passing current-session evidence |
| Rationale | channel-specific; no pooled two-session optimization |

## Prepared transition after strategic selection

Once the evidence floor and operator decision exist, the generic builder can
produce an inert draft against the exact active manifest:

1. resolve the single active control-plane manifest and exact base spec/hash;
2. build one bounded patch;
3. reject semantic no-ops, stale bases, and unsupported fields;
4. compile worker and dashboard projections from the same candidate manifest;
5. leave replay and capacity evidence not-run until attached;
6. leave approval state `draft`;
7. retain `activationAuthorized: false`;
8. persist nothing until a separate live-proposal approval.

## Decision

No new TP, SL, or quantity value is strategically selected by this packet.
The quantity-3 proposal is only a deterministic local generator specimen.
RC5.4 remains unchanged. The next strategic review should either:

- confirm that the evidence floor has been reached and select one exact,
  representable manager policy; or
- continue the preregistered shadow comparison.

Sources:

- `docs/rc54-tp-sl-review-packet-2026-07-28.md`
- `docs/rc54-iwm-manager-preregistration-2026-07-28.md`
