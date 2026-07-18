# Weekend Ops / capture readiness — 2026-07-18

## Outcome

The desktop and mobile Ops views now consume one page-owned, read-only evidence
model. It keeps four claims separate:

1. the sealed RC5 startup configuration was observed;
2. the worker/process is currently observable (existing incident model);
3. current-session capture and manager receipts were actually observed; and
4. post-close publication and Sentinel evidence are current and internally
   consistent.

None of these claims substitutes for another. In particular, startup
configuration is not liveness, process liveness is not capture proof, and desk
positions are not broker reconciliation.

## Sources and authority

The page seam performs one compact, visibility-aware poll for:

- `execution_observations` — RC5 candidate provenance and positive fills;
- `held_contract_capture_receipts` — immutable held-contract capture receipts;
- `held_contract_capture_health` — capture evidence-loss warnings/high events;
- `manager_shadow_runs` — the eight expected manager arms per filled position;
- `events` — post-close publisher receipts.

The existing dedicated release event read and Sentinel hook remain the source
for startup identity and nightly receipt identity. The four research tables are
operator-only under RLS. A signed-out or rejected read is shown as a read error;
it is never converted into an empty ledger.

## Session semantics

- The RC5 cohort begins `2026-07-20`. Earlier evidence is excluded.
- No candidate is `WAITING`, not a failure.
- A candidate without a fill can be a valid collision/risk censor.
- Capture becomes due only after a positive RC5 fill. The UI allows the sealed
  150-second batching/loss window before warning about a missing receipt.
- Eight distinct manager arms become due per filled position, with a 60-second
  start grace.
- Capture-health warnings/high events override a superficially complete count.
- A current-session publisher completion becomes due after 16:00 ET only when
  the session produced candidate/fill activity.
- Broker reconciliation remains explicitly unavailable.

## Verification

- `npm run ops-readiness-selftest` — 31/31
- `npm run release-receipt-selftest` — 5/5
- `npm run sentinel-receipt-selftest` — 19/19
- `npm run incident-selftest` — 59/59
- `npm run operator-selftest` — 5/5
- `npm run perform-selftest` — 22/22
- `npm run channel-passport-selftest` — 125/125
- `npx tsc --noEmit` — clean
- `npm run build` — clean, 5/5 static pages
- desktop local smoke — readiness panel rendered from live read-only evidence;
  no new console errors
- mobile 390×844 smoke — identical evidence model, no horizontal overflow;
  no new console errors

The local signed-out smoke correctly displayed operator-only tables as RLS
read errors while retaining the verified public startup receipt. A signed-in
preview smoke remains the final review gate before merge.

## Non-goals

This branch does not change production, strategy configuration, order paths,
Supabase schema/RLS, R2, capture behavior, manager behavior, or publisher
behavior. It adds only read-model, UI, and tests.
