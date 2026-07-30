# RC5.5 sequential-entry canary

Status: local implementation and review evidence only. No proposal, activation,
worker restart, or order authority is created by this document.

## Decision boundary

`maxEntriesPerSession` counts distinct logical entries for one channel family.
It does not permit pyramiding or overlapping positions. Before every accepted
entry, the existing admission layer still requires:

- the family to be flat;
- complete broker position and order truth;
- the same-contract limit to pass;
- the domain's same-clock priority to pass;
- underlying and global concurrency to remain inside their existing caps; and
- the exact receipt-bound paper account route to agree.

Runner and remainder rows inherit one `opportunity_id` and count as one logical
entry. A missing or invalid numeric cap fails closed. The maximum supported cap
is three.

## Reviewed channel classification

| Channel | Proposed cap | Source-semantic reason |
| --- | ---: | --- |
| `pb-ride` | 3 | A later pullback and recovery is a new event after the prior trade is flat. |
| `orb-ustop-ctl` | 3 | A later qualifying breakout candidate can be distinct after a full close. |
| `grind-v3` | 3 | The strategy detects discrete, time-boxed momentum bursts. |
| `vb-squeeze-break` | 3 | A later break of a newly formed rolling range is a new event. |
| `vb-ribbon-cross-qqq` | 3 | A later moving-average cross is an explicit new transition. |
| `momo-shape` | 1 | The range-break condition can remain true across adjacent bars; no explicit re-arm exists yet. |
| `orb-qqq-trail` | 1 | The AM opening-range setup is intentionally narrow and produced no exact second path in the current study. |
| `breakout-alt-v3-iwm` | 1 | The opening-range setup is single-shot until a distinct re-arm rule is reviewed. |
| `vb-macd-state` | 1 | It is a persistent state, not a transition; automatic re-entry could rebuy the same state repeatedly. |

This classification uses source signal semantics to decide whether re-entry is
well-defined. The RC5.4 replay is supporting context, not a claim that second
entries are already profitable.

## What remains unchanged

- paper-only authority and account allocation;
- quantity (two contracts);
- take-profit, stop-loss, ratchet, and end-of-day management;
- strategy signal logic and channel roster;
- account, family, priority, and collision-domain topology;
- open-position management policy;
- quote, held, manager, broker-reconciliation, Sentinel, and execution-quality
  capture;
- all historical rows and configuration epochs.

## Activation shape

Each channel change remains an ordinary immutable
`ChannelChangeProposal`. A request supplies only `maxEntriesPerSession`; the
server derives the paired `reentryPolicy` and complete `entryParameters`
identity. The candidate manifest derives the domain's bounded-reentry flag from
its channel specifications. Worker and dashboard projections come from that one
manifest.

Activation still requires validation, preview, a safe boundary, worker
acknowledgement, and an immutable activation receipt. A fresh entry is stamped
with the exact re-entry policy and numeric cap. Existing positions continue
under their entry-time policy.

The five proposed cap-three channels should be reviewed and activated as
separate channel proposals so each has an exact diff and rollback identity.
No TP/SL or quantity proposal is bundled with this canary.
