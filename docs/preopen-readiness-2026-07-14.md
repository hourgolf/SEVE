# Pre-open readiness — 2026-07-14 paper session

Status: implementation branch, no production deployment. This receipt defines
the hard gate to run immediately before the next market open.

## What is now proved

- All three configured broker identities are distinct, active, unblocked Alpaca
  **paper** accounts. The worker's broker host resolves to
  `https://paper-api.alpaca.markets`; no Railway override changes it.
- `fund_state.mode` is `paper`. Account routing fails closed when an account or
  credential cannot be resolved; it does not fall back to a different account.
- The desk and all three broker books are flat and reconcile at zero open OCCs.
- The 24/7 worker run is fresh and clean. The live process is
  `stream-2026-07-13a`; Railway auto-deploy remains disabled.
- The current armed/active book contains 25 configurations across three paper
  accounts: 20 entry-enabled and 5 intentionally muted. Every configuration is
  stream-owned and has a contract ceiling of at least four.
- The first paper session produced 54 round trips with quantities from 5 to 30
  contracts (average 10.59); no trade was below four contracts.

`npm run preopen` now reproduces those checks without placing an order or
writing the database. It prints the effective channel/account/risk/contract-cap
manifest and exits nonzero on a broken paper boundary, stale/error worker,
unresolved route, broker/desk book mismatch, missing credentials, wrong
executor, or a contract cap below four.

## Four-contract honesty note

The current sizing formula remains risk-first:

`floor(channel risk / per-contract stop risk)`, capped by `max_contracts`.

It rejects only a zero-contract result; it does not forcibly upsize a calculated
one-to-three-contract trade to four. Forcing four could exceed the channel's
risk budget. The pre-open manifest therefore prints the maximum option ask at
which each channel can express four contracts. The first live-paper session
cleared the requirement naturally, but this is not yet a hard runtime guarantee.

If a future candidate calculates below four, the safe policy choices are:

1. skip it as ineligible for the four-plus research cohort; or
2. explicitly raise that channel's risk budget before the session.

Silently exceeding the configured risk budget is not an acceptable third
choice. No sizing rule is changed in this branch.

## Operator path

- Auth user `pobrecitopdx@gmail.com` has the operator role.
- Channel mutations are RLS-gated to that role. Anonymous/read-only clients see
  the same controls disabled.
- Manual-close routing is paper-host-only, account-aware, quantity-checked,
  terminal-fill-aware, and status-guarded. The close-reason menu includes
  `SYSTEM TEST` and `EXECUTION FIX` alongside trading rationales.
- No position was fabricated after hours. The first natural paper position on
  2026-07-14 is the controlled end-to-end manual-close drill.

## Production UI smoke

After live data settled:

- desktop 1280×720: one `.shell-root`, zero mobile shells, one console child,
  zero legacy surface, no horizontal overflow; PERFORM and STUDIO both render;
- mobile 390×844: one mobile shell, zero horizontal overflow in all five rooms;
- PLAY: chart, positions, sentinel, tape, and collapsible channel dock;
- STUDIO: 12 FIRST-TEAM rows, two muted, expandable per-channel stop/TP panel;
- BOOK: positions-first layout, exposure, signals, option chain, chart return;
- REVIEW: attribution and nightly read;
- OPS: process/stream/cron/tape health and paper-book facts.

The automation browser was not authenticated, so mutation buttons correctly
remained read-only. Code/RLS/operator self-tests cover authorization; the first
natural-position drill covers the final browser-to-fill-to-booking path.

## Opening sequence

1. Run `npm run preopen` between 06:20 and 06:27 PT.
2. Require a clean hard-gate exit and visually confirm intentional muted rows.
3. Open production mobile BOOK and OPS: paper, process observed, broker/desk
   open counts equal.
4. Let the first natural paper entry open; verify broker and desk quantity.
5. Manually close it with `SYSTEM TEST`; require terminal fill, closed desk row,
   matching broker flat/remaining quantity, and a stamped manual reason.
6. Continue paper observation only. No manager, entry, sizing, or channel change
   is authorized by this receipt.
