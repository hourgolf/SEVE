import assert from "node:assert/strict";

async function main() {
  // Dynamic import after dummy environment and an explicit deny-all transport.
  // This test never reads a credential file or contacts an external endpoint.
  Object.assign(process.env, { ALPACA_KEY: "fixture", ALPACA_SECRET: "fixture",
    SUPABASE_URL: "https://db.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture" });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("NETWORK DENIED"); };
  const { limitLadderFill } = await import("./alpaca.js");
  const api = { paperHost: "https://broker.invalid", headers: {} };
  const input = { symbol: "SPY260908C00640000", side: "buy" as const, qty: 4,
    coidBase: "fixture", bid: 1.99, ask: 2, ladder: { frac: .5, rungs: 2, rungSec: .001 },
    requireConfirmedTerminalBeforeAdvance: true };
  try {
    let posts: Record<string, unknown>[] = [];
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "https://broker.invalid/v2/orders");
      assert.equal(init?.method, "POST");
      posts.push(JSON.parse(String(init?.body)));
      throw new Error("accepted order response lost");
    };
    await assert.rejects(limitLadderFill(input, api), /response lost/);
    assert.equal(posts.length, 1, "uncertain POST must not advance to another buy");

    posts = [];
    globalThis.fetch = async (url, init) => {
      assert.ok(String(url).startsWith("https://broker.invalid/v2/orders"));
      if (init?.method === "POST") posts.push(JSON.parse(String(init.body)));
      if (init?.method === "DELETE") throw new Error("cancel outcome unknown");
      return new Response(JSON.stringify({ id: "partial", status: "partially_filled",
        filled_qty: "2", filled_avg_price: "1.99" }));
    };
    await assert.rejects(limitLadderFill(input, api), /prior_rung_unresolved/);
    assert.equal(posts.length, 1, "uncertain cancellation must not advance");

    posts = [];
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "https://broker.invalid/v2/orders");
      assert.equal(init?.method, "POST");
      posts.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(posts.length === 1
        ? { id: "first", status: "canceled", filled_qty: "2", filled_avg_price: "1.99" }
        : { id: "second", status: "filled", filled_qty: "2", filled_avg_price: "2" }));
    };
    const result = await limitLadderFill(input, api);
    assert.deepEqual(posts.map(p => p.qty), ["4", "2"]);
    assert.equal(result.filledQty, 4);
    assert.equal(result.fill, 1.995);
    assert.equal(result.status, "filled");
    // These assertions prove rung sequencing only. They do not prove durable
    // position recovery after a partial fill, failed row write, or restart.
    console.log("fixedContractLadder: PASS · unknown POST/cancel stops continuation; terminal partial advances only residual quantity");
  } finally { globalThis.fetch = originalFetch; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
