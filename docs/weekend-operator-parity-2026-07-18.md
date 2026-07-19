# Weekend operator parity — 2026-07-18

## Outcome

This slice makes the existing read-only operations evidence usable from both
desktop and mobile without creating another subscription or order path.

- The broker book is compared with the desk ledger by paper account and OCC
  symbol.
- A positive flat claim is allowed only when every relevant paper account is
  reachable, every signed quantity matches, and both books contain zero
  contracts.
- Partial broker reachability is yellow and can never claim flat. Quantity drift
  is red.
- Filled-position evidence can be followed as candidate → fill → held capture →
  manager arms → booked close, including the operator's manual close reason when
  one exists.
- Desktop and mobile render the same readiness model and evidence component.

## Authority and safety boundary

`GET /api/broker-reconciliation` is an authenticated, no-store read route. It:

1. verifies the supplied Supabase access token with `auth.getUser(token)`;
2. requires the desk-operator role;
3. reads account routing and open desk positions with the server-only service
   role;
4. reads each relevant Alpaca **paper** account's current positions; and
5. returns only a normalized reconciliation receipt.

The route exports no mutation handler and contains no Supabase insert, update,
or delete call. It cannot place or close an order, alter configuration, rebook
history, or expose broker credentials. Existing manual-close functionality is
unchanged.

## Files

- `lib/ops/brokerReconciliation.ts` — pure signed-quantity comparison.
- `app/api/broker-reconciliation/route.ts` — authenticated paper-book read.
- `hooks/useOpsEvidence.ts` — independent broker receipt and outcome reads.
- `lib/ops/readiness.ts` — truthful broker state and per-position evidence chains.
- `components/ops/OpsReadinessPanel.tsx` — shared detailed evidence view.
- `components/perform/OpsWorkspace.tsx` — desktop summary uses the same receipt.
- `app/ops-readiness.css` — shared desktop/mobile details layout.

## Verification

- `npm run broker-reconciliation-selftest` — 21/21.
- `npm run ops-readiness-selftest` — 43/43.
- `npm run position-close-flow-selftest` — 16/16.
- `npm run operator-selftest` — 5/5.
- `npx tsc --noEmit` — clean.
- `npm run build` — clean, including the dynamic reconciliation route.
- Signed-out route probe — HTTP 401 with `cache-control: private, no-store`.
- Desktop local smoke — protected evidence remains truthful; zero console errors.
- Mobile 390×844 smoke — Ops evidence renders; 390px document width, no
  horizontal overflow, zero console errors.

## Preview acceptance gate

Do not merge from the local proof alone. On the Vercel preview, sign in as the
operator and verify:

1. private evidence tables read without RLS errors;
2. every relevant paper account reports reachable;
3. broker and desk books are either explicitly matched or show the exact drift;
4. no state asserts flat when the receipt is partial;
5. desktop and mobile Ops remain console-clean.

This slice makes no production, Supabase schema, R2, strategy, roster, or worker
change.
