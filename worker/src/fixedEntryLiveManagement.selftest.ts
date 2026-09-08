import assert from "node:assert/strict";
import { fixedEntryIntentFixture } from "./fixedEntryLedger.fixtures.js";
import { createFixedEntryServiceClient } from "./fixedEntryServiceClient.js";
async function main() {
  Object.assign(process.env, { ALPACA_KEY: "fixture", ALPACA_SECRET: "fixture", SUPABASE_URL: "https://fixture.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "fixture" });
  const { makeFixedEntryLiveManagement } = await import("./fixedEntryLiveManagement.js");
  const { observeFixedNativeManagement } = await import("./fixedEntryManagement.js");
  const intent = fixedEntryIntentFixture();
  let now = Date.parse("2026-09-08T14:30:03Z"), live = true, slow = false, failedFund = false, quoteFails = false;
  let account: Record<string, unknown> | null = { id: intent.accountId, name: "original", mode: "paper",
    cred_ref: "2", is_armed: false, is_halted: false, master_daily_stop_usd: 0 };
  let fund: Record<string, unknown> = { id: 1, mode: "paper", is_halted: false };
  const reads: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(init?.method ?? "GET", "GET");
    const u = new URL(String(input)), table = u.pathname.split("/").at(-1)!;
    reads.push(table); assert.ok(table === "accounts" || table === "fund_state", "management never reads the current roster");
    if (table === "accounts") assert.equal(u.searchParams.get("id"), `eq.${intent.accountId}`);
    if (slow) now += 2_001;
    const failed = table === "fund_state" && failedFund;
    return new Response(JSON.stringify(failed ? { message: "fixture" } : table === "accounts" ? (account ? [account] : []) : [fund]),
      { status: failed ? 503 : 200, headers: { "content-type": "application/json" } });
  };
  const token = ["eyJhbGciOiJIUzI1NiJ9", Buffer.from('{"role":"service_role"}').toString("base64url"), "fixture"].join(".");
  const client = createFixedEntryServiceClient("https://fixture.supabase.co", token, fetcher);
  const binding = makeFixedEntryLiveManagement(client, { now: () => now, liveMode: () => live,
    apiForAccount: _a => ({ paperHost: "https://paper-api.alpaca.markets", headers: {} }),
    quote: () => { if (quoteFails) throw new Error("fixture"); return { bid: 2, ask: 2.01, observedAtMs: now }; },
    eventPolicy: { enabled: true, beforeMinutes: 10, afterMinutes: 30 } });
  assert.equal(reads.length, 0);
  assert.equal((await binding.broker(intent))?.accountId, intent.accountId);
  assert.equal((await binding.management(intent, "sweep", null)).allowed, true, "disarming cannot strand original exits");
  account!.is_halted = true; quoteFails = true;
  let result = await binding.management(intent, "sweep", null);
  assert.equal(result.allowed, true);
  const empty = { records: [], positions: [], brokerNetQty: 0, brokerObservedAtMs: now };
  assert.equal(observeFixedNativeManagement(intent, empty, result.input).exit?.reason, "halt_flatten",
    "halt remains observable when no row/quote exists");
  fund.mode = "live";
  result = await binding.management(intent, "sweep", null);
  assert.equal(result.allowed, false); assert.equal(result.input.accountHalted, true);
  fund.mode = "paper"; account!.is_halted = false; account!.cred_ref = null;
  assert.equal(await binding.broker(intent), null, "removed original credential ref never selects default credentials");
  assert.equal((await binding.management(intent, "sweep", null)).allowed, false);
  account!.cred_ref = "3";
  assert.equal(await binding.broker(intent), null, "an otherwise resolvable credential reassignment cannot redirect original lots");
  account!.cred_ref = "2"; slow = true;
  assert.equal((await binding.management(intent, "sweep", null)).allowed, false, "freshness begins before reads");
  slow = false; failedFund = true; account!.is_halted = true;
  result = await binding.management(intent, "sweep", null);
  assert.equal(result.allowed, false); assert.equal(result.input.fundHalted, null);
  assert.equal(observeFixedNativeManagement(intent, empty, result.input).exit?.reason, "halt_flatten");
  failedFund = false; account!.is_halted = false; quoteFails = false;
  now = Date.parse("2026-09-08T19:25:00Z");
  result = await binding.management(intent, "cycle", { price: 1, observedAtMs: now });
  assert.equal(result.allowed, true);
  assert.equal(observeFixedNativeManagement(intent, empty, result.input).exit?.reason, "rc54_eod_flatten");
  now = Date.parse("2026-09-08T20:00:00Z");
  assert.equal((await binding.management(intent, "sweep", null)).allowed, false);
  now = Date.parse("2026-09-12T14:30:00Z");
  assert.equal((await binding.management(intent, "sweep", null)).allowed, false, "weekend cannot grant broker submission");
  account = null; assert.equal(await binding.broker(intent), null);
  live = false; assert.equal((await binding.management(intent, "sweep", null)).allowed, false);
  console.log("fixedEntryLiveManagement: PASS · original account, disarm/halt, missing row/quote/fund, stale reads, paper wall, EOD/weekend and no current-roster dependency");
}
void main().catch(e => { console.error(e); process.exitCode = 1; });
