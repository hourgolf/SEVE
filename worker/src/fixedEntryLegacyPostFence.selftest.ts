import assert from "node:assert/strict";
import { FixedEntryOwnershipError } from "./fixedEntryLegacyOwnership.js";
async function main() {
  Object.assign(process.env, { ALPACA_KEY: "fixture", ALPACA_SECRET: "fixture", SUPABASE_URL: "https://fixture.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "fixture" });
  const { orderAndFill, limitLadderFill } = await import("./alpaca.js");
  const oldFetch = globalThis.fetch;
  let posts = 0, guards = 0, allow = true, partialFirst = false;
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.method, "POST", "all fixture broker responses are terminal; no polling/cancel is needed");
    posts++; const body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: `order-${posts}`, status: partialFirst && posts === 1 ? "canceled" : "filled",
      filled_qty: partialFirst && posts === 1 ? "1" : body.qty, filled_avg_price: "2" }),
      { status: 200, headers: { "content-type": "application/json" } });
  };
  const api = { paperHost: "https://paper-api.alpaca.markets", headers: {},
    beforeOrder: async (symbol: string) => {
      assert.equal(symbol, "SPY260908C00640000"); guards++;
      if (!allow || partialFirst && guards > 1) throw new FixedEntryOwnershipError();
    } };
  const body = { symbol: "SPY260908C00640000", qty: "4", side: "sell" as const,
    type: "market" as const, time_in_force: "day" as const, client_order_id: "orphan-fixture" };
  const ladder = { symbol: body.symbol, qty: 4, side: "buy" as const, coidBase: "legacy-fixture",
    bid: 1.9, ask: 2, ladder: { frac: .5, rungs: 3, rungSec: 1 } };
  try {
    assert.equal((await orderAndFill(body, api)).filledQty, 4); assert.equal(posts, 1); assert.equal(guards, 1);
    allow = false;
    await assert.rejects(orderAndFill(body, api), FixedEntryOwnershipError); assert.equal(posts, 1);
    await assert.rejects(limitLadderFill(ladder, api), FixedEntryOwnershipError); assert.equal(posts, 1);
    await assert.rejects(limitLadderFill({ ...ladder, bid: 0 }, api), FixedEntryOwnershipError); assert.equal(posts, 1);
    allow = true; posts = 0; guards = 0; partialFirst = true;
    await assert.rejects(limitLadderFill(ladder, api), FixedEntryOwnershipError);
    assert.equal(posts, 1, "a negative ownership failure stops the next priced rung without fallback POST");
    assert.equal(guards, 2);
    posts = 0; guards = 0;
    await assert.rejects(limitLadderFill({ ...ladder, ladder: { ...ladder.ladder, rungs: 2 } }, api), FixedEntryOwnershipError);
    assert.equal(posts, 1, "the market successor also checks ownership");
    // No hook on legacy unrelated accounts retains their previous request and
    // result. This test proves callpoint coverage, not cross-process exclusion.
    partialFirst = false; posts = 0; guards = 0;
    assert.equal((await orderAndFill(body, { paperHost: api.paperHost, headers: {} })).filledQty, 4);
    assert.equal(posts, 1); assert.equal(guards, 0);
    console.log("fixedEntryLegacyPostFence: PASS · actual market/limit/orphan-shaped POSTs, fresh per-rung checks, no retry after denial, unchanged unhooked legacy API; not a durable cross-process fence");
  } finally { globalThis.fetch = oldFetch; }
}
void main().catch(e => { console.error(e); process.exitCode = 1; });
