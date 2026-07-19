# Channel configuration draft contract — 2026-07-19

## Outcome

The Channels workspace now has a safe next step after the Day 1 RC5 controls were sealed read-only: an authenticated operator may fork an **unsealed, local-only configuration draft** for a future epoch.

This closes a functional gap without weakening the release boundary. A draft does not write Supabase, alter the desk reducer's runtime configuration, change Railway, authorize an order, modify Monday admission, create a configuration epoch, or seal a release.

## Runtime truth versus proposal

- **SEALED RUNTIME** remains the only statement of what the worker may execute.
- **DATABASE** remains evidence about the stored strategist row; it is not treated as the active RC5 exit policy.
- **LOCAL DRAFT** is an inert proposal derived from the selected channel's current database configuration and the verified release identity.
- The collapsed mobile row continues to show sealed runtime behavior, not draft values. This prevents an unfinished proposal from masquerading as an active strategy.
- MUTE, BOOST, BENCH, DUPLICATE, and DELETE remain disabled for the sealed release. Drafting does not provide a side door to those operational writes.

## Draftable fields

`channel-config-draft-v1` permits only these future-epoch fields:

- risk dollars per trade (`capital_pct`, the legacy column name)
- entry latch dollars per day (`daily_stop_usd`)
- maximum contracts
- entry DTE
- premium catastrophe stop
- take-profit percentage, including ride/no-target
- underlying stop percentage, including off
- event policy
- pyramid adds

Strike selection, lifecycle, executor, account, family identity, runtime admission, MUTE/BOOST, and sealing are outside this local contract.

## Guardrails

The pure derivation model:

1. requires a positively verified active release before a draft can be forked;
2. validates every draftable value against bounded ranges;
3. records the source release ID, receipt hash, and configuration-epoch identity when present;
4. warns rather than inventing an epoch identity for dark or non-root channels;
5. emits stable canonical JSON with `activationAuthorized: false`;
6. labels the proposal `empty`, `reviewable`, or `blocked`;
7. never hashes, seals, persists, or activates the proposal.

The copied review receipt is input to a later review process. It is not a release receipt and cannot be consumed as activation authority.

## Lifecycle and loss behavior

Drafts live only in React memory. They survive selection changes while the mounted Channels workspace remains alive, but disappear on reload, sign-out/remount, or explicit discard. This is intentional for this slice: loss is safer than accidentally persisting or activating an unreviewed strategy configuration.

## Future activation work

Activation is a separate, still-unimplemented workflow. It must deliberately define:

1. reviewed configuration identity and epoch creation;
2. authorization and server-side validation;
3. a complete current-to-proposed diff;
4. preregistration/evidence rules and operator approval;
5. sealing and checksum verification;
6. worker deployment/admission timing;
7. rollback and audit receipts.

Until that workflow is built and separately authorized, Monday RC5 remains unchanged.

## Verification contract

- Pure draft self-test covers stable serialization, allowed diffs, range failures, release mismatch, missing epoch identity, unchanged values, and explicit non-activation.
- Desktop and mobile use the same pure model and local-state hook.
- No new remote hook or subscription was added; the page-owned data seam remains intact.
