# Market-hours fixture UI lane

Status: preview/local lane implemented. Production and the live desk are unchanged.

## Purpose

`/fixture-lab` is the safe place to develop dashboard hierarchy, responsive layout, typography,
contrast and skin direction while the market is open. It renders deterministic flat, managed-position
and degraded-read scenarios without mounting `app/page.tsx` or any live data/write hook.

The route has:

- no Supabase, Alpaca, broker, worker, market-data or order client;
- no `useMarketData`, `useDeskFeed` or `useDeskWrite` subscription;
- an explicit `FIXTURE ONLY · ZERO LIVE READS · ZERO WRITES` banner;
- 909 and Folio visual switches over the same fixture content;
- representative chart, position, channel and event panels;
- responsive desktop/phone behavior;
- a production fail-closed gate (`notFound()` on Vercel production).

`fixture-lane-selftest` scans the route, component and fixture model for forbidden live imports in
addition to checking the production gate and deterministic scenarios.

## Working rule

Market-hours UI branches may touch `/fixture-lab`, its fixture component/model and isolated CSS.
They may not change the live page seam, hook cadence, Supabase query, broker action, release identity,
strategy configuration or worker during the session. A component moves from the fixture lane to the
live desk only in an after-close functional pass with normal type/build/browser verification.
