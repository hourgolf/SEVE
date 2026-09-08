import assert from "node:assert/strict";
import { compileReleaseManifest, managerPolicyContentHash } from "../../lib/channels/channelControlPlane.js";
import { RC54_CONTROL_PLANE_FIXTURE } from "../../lib/channels/rc54ControlPlaneFixture.js";
import { FIXED_CONTRACT_ADMISSION_MODE, FIXED_CONTRACT_WORKER_COMPATIBILITY, LEGACY_RC54_WORKER_COMPATIBILITY } from "../../lib/channels/fixedContractAdmission.js";
import { buildShadowRuntimeProjection } from "../../lib/channels/channelActivation.js";
import { resolveDormantChannelRuntimeAuthority } from "./channelConfigurationRuntimeBridge.js";
import { receiptBoundRc54ConfigurationWriteStamp } from "./temporaryRc54RuntimeAdapter.js";
import { fixedEntryIntentFixture } from "./fixedEntryLedger.fixtures.js";
import { buildFixedEntryIntent } from "./fixedEntryLedgerModel.js";
import { fixedCoverageHarness } from "./fixedEntryCoverage.fixtures.js";
import { coordinateFixedCommand } from "./fixedEntryCommandCoordinator.js";
import { materializeFixedEntryCoverage } from "./fixedEntryCoverageMaterialization.js";
import { createFixedEntryServiceClient } from "./fixedEntryServiceClient.js";
import type { ChannelConfig, AccountRow } from "./store.js";
import type { StoredReceiptBoundControlPlaneRead } from "../../lib/channels/channelControlPlanePersistence.js";
import type { FixedIntentSeed } from "./fixedEntryIntentAdmission.js";
async function main() {
  Object.assign(process.env, { ALPACA_KEY: "fixture", ALPACA_SECRET: "fixture", SUPABASE_URL: "https://fixture.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "fixture" });
  const { makeFixedEntryLiveAuthority } = await import("./fixedEntryLiveAuthority.js");
  const { ChainStore } = await import("./state.js");
  const draft = structuredClone(RC54_CONTROL_PLANE_FIXTURE), macd = draft.channelSpecs.find(s => s.slug === "vb-macd-state")!;
  draft.workerCompatibilityVersion = FIXED_CONTRACT_WORKER_COMPATIBILITY;
  Object.assign(macd, { quantity: 4, maxDebitUsd: 700, managerProfileId: "VB-MACD-WIDE20-50",
    riskLimits: { maxContracts: 4, maxDebitUsd: 700, maxRiskUsd: 210 },
    takeProfit: { kind: "bank", fraction: 0, targetPct: 20 }, stopLoss: { catastrophePct: 50, priceBasis: "executable-option-bid" },
    ratchetParameters: { kind: "none", engageReturnPct: null, givebackPct: null, retainGainPct: null, fixedTargetPct: null } });
  macd.entryParameters.admissionSizingMode = FIXED_CONTRACT_ADMISSION_MODE;
  macd.managerVersion = managerPolicyContentHash({ managerProfileId: macd.managerProfileId, takeProfit: macd.takeProfit,
    stopLoss: macd.stopLoss, ratchetParameters: macd.ratchetParameters, liquidationEt: "15:25" });
  // Synthetic isolated route, as required for the proposed real cutover. This
  // fixture is not a proposal to change the production squeeze channel.
  draft.channelSpecs.find(s => s.slug === "vb-squeeze-break")!.executionPosture = "observe-only";
  const candidate = compileReleaseManifest(draft), projection = buildShadowRuntimeProjection(candidate);
  assert.equal(projection.state, "comparable");
  const channels: ChannelConfig[] = candidate.workerProjection.roots.map(root => ({
    id: root.strategistId, slug: root.slug, name: root.slug, status: "draft", spec_json: null, underlying: root.underlying,
    executor: "stream", account_id: root.accountId, is_active: true, capital_pct: 0, aggression: 0, max_contracts: 99,
    daily_stop_usd: 0, daily_target_usd: 0, underlying_stop_pct: 0, muted: false, soloed: false, boosted: false,
    event_policy: "standdown", entry_dte: 0, strike_offset: 0, premium_stop_pct: 99, take_profit_pct: 99,
    pyramid_adds: 0, stall_minutes: 0, stall_max_favor_pct: 0, gap_min: 0, runner_frac: 0, runner_giveback_pct: 0 }));
  const accounts: AccountRow[] = [...new Set(candidate.workerProjection.roots.map(r => r.accountId))].map((id,i) => ({
    id, name: id, mode: "paper", cred_ref: id === macd.accountId ? "2" : `fixture-${i}`, is_armed: true,
    is_halted: false, master_daily_stop_usd: 0 }));
  let stored: StoredReceiptBoundControlPlaneRead = { state: "receipt-bound", compiled: candidate, error: null,
    databaseIdentity: { releaseManifestDatabaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      channelSpecDatabaseIdsByVersionKey: Object.fromEntries(candidate.channelSpecs.map((s,i) => [s.id,
        `bbbbbbbb-bbbb-4bbb-8bbb-${String(i + 1).padStart(12,"0")}`])) },
    activationReceipt: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", receiptKind: "roster-bundle",
      configurationEpochId: projection.configurationEpochId, releaseManifestId: candidate.manifest.id,
      manifestContentHash: candidate.manifest.contentHash, activatedAt: "2026-09-07T23:00:00Z",
      activatedSpecs: candidate.channelSpecs.map(s => ({ versionId: s.id, contentHash: s.contentHash })) } };
  const resolved = resolveDormantChannelRuntimeAuthority({ stored, runtime: { channels, accounts, fundMode: "paper",
    workerCompatibilityVersion: LEGACY_RC54_WORKER_COMPATIBILITY, resolvedCredentialAccountIds: accounts.map(a => a.id),
    allowUnadoptedRc54Baseline: false } });
  assert.equal(resolved.state, "receipt-bound", JSON.stringify(resolved.blockers));
  if (resolved.state !== "receipt-bound") throw new Error("fixture resolution");
  const base = fixedEntryIntentFixture();
  const { protocol: _baseProtocol, id: _baseId, contentHash: _baseHash, sessionSlotId: _baseSlot, ...baseInput } = base;
  const intent = buildFixedEntryIntent({ ...baseInput, writeStamp: receiptBoundRc54ConfigurationWriteStamp(resolved.runtime, macd.slug) });
  const { protocol: _p, id: _id, contentHash: _hash, sessionSlotId: _slot, attempt: _attempt,
    predecessorIntentId: _pred, predecessorSettlementHash: _predhash, ...seed } = intent;
  const h = fixedCoverageHarness({ intent }); h.db.clear();
  let now = Date.parse("2026-09-08T14:30:03Z"), mode = "paper", halted = false, live = true, ready = true, fail = false,
    slow = false, accountsFresh = true, rawFlagUnknown = false, foreignOrder = false, missingBar = false;
  let held = 0, ask = 10, peerMode = false, hidePeer = false, failConfirmation = false;
  const fund = () => ({ mode, is_halted: halted, total_capital_usd: 300_000, master_daily_stop_usd: 0, stack_cap_n: 0 });
  const rows: Record<string, unknown>[] = [];
  const token = ["eyJhbGciOiJIUzI1NiJ9", Buffer.from('{"role":"service_role"}').toString("base64url"), "fixture"].join(".");
  const dbFetch: typeof fetch = async (request, init) => {
    assert.equal(init?.method ?? "GET", "GET");
    if (fail) return new Response('{"message":"fixture"}', { status: 503 });
    const u = new URL(String(request));
    if (u.pathname.endsWith("/fund_state")) return new Response(JSON.stringify([{ id: 1, mode, is_halted: rawFlagUnknown ? null : halted }]),
      { headers: { "content-type": "application/json" } });
    const all: Record<string, unknown>[] = u.pathname.endsWith("/positions") ? [...h.positions.values()].map((r): Record<string, unknown> => ({ ...r })).concat(rows)
      : [...h.db.values()] as unknown as Record<string, unknown>[];
    const selected = all.filter(row => [...u.searchParams].every(([key, wanted]) => {
      if (["select", "order", "offset", "limit"].includes(key)) return true;
      let value: unknown = row;
      for (const part of key.split(/->>?/)) value = (value as Record<string, unknown> | null)?.[part];
      if (wanted.startsWith("gte.")) return typeof value === "string" && value >= wanted.slice(4);
      if (wanted.startsWith("lt.")) return typeof value === "string" && value < wanted.slice(3);
      return wanted === `eq.${value}`;
    })).sort((a,b) => String(a.id).localeCompare(String(b.id)));
    return new Response(JSON.stringify(selected), { headers: { "content-type": "application/json", "content-range": `0-${Math.max(0,selected.length - 1)}/${selected.length}` } });
  };
  const brokerFetch: typeof fetch = async (request, init) => {
    assert.equal(init?.method, "GET"); assert.ok(String(request).startsWith("https://paper-api.alpaca.markets/"));
    const id = (init!.headers as Record<string,string>).fixtureAccount, u = new URL(String(request));
    if (slow) now += 2_001;
    const same = id === intent.accountId;
    if (same && peerMode && !hidePeer && failConfirmation && u.pathname === "/v2/positions") return new Response("{}", { status: 503 });
    const peerPositions = [641,642,643].map(strike => ({ symbol: `SPY260908C00${strike}000`, qty: "1" }));
    const data = u.pathname === "/v2/account" ? { id, equity: "100000", cash: "100000", status: "ACTIVE",
      options_buying_power: "100000", trading_blocked: false, account_blocked: false, trade_suspended_by_user: false, options_trading_level: 2 }
      : u.pathname === "/v2/positions" ? same && peerMode && !hidePeer ? peerPositions : same && held ? [{ symbol: intent.occ, qty: String(held) }] : []
      : same && foreignOrder ? [{ id: "foreign", symbol: intent.occ, side: "buy", qty: "1", client_order_id: "foreign", status: "new" }] : [];
    if (same && peerMode && u.pathname === "/v2/orders") hidePeer = false;
    return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
  };
  const client = createFixedEntryServiceClient("https://fixture.supabase.co", token, dbFetch);
  const chain = new ChainStore();
  const bars = Array.from({length: 61},(_,i) => ({ ts: Date.parse("2026-09-08T13:30:00Z") + i*60_000,
    open: 640 + i*.1, close: 640+i*.1, high: 640+i*.1+.5, low: 640+i*.1-.5, volume: 10_000, vwap: 640+i*.1 }));
  const oldNow = Date.now; Date.now = () => now;
  try {
    const refresh = () => chain.seed([{ occ: intent.occ, strike: 640, optType: "call", expiration: intent.sessionDateEt,
      bid: ask-.01, ask, mid: ask-.005, delta: null, last: null }]);
    refresh();
    const binding = makeFixedEntryLiveAuthority(client, { now: () => now, liveMode: () => live, infrastructureReady: () => ready,
      workerCompatibilityVersion: LEGACY_RC54_WORKER_COMPATIBILITY, apiForAccount: a => ({ paperHost: "https://paper-api.alpaca.markets", headers: {fixtureAccount:a.id} }),
      bars: () => missingBar ? bars.slice(0,-1) : bars, chain: () => chain, fetch: brokerFetch,
      readConfig: async () => ({ fund: fund(), channels: structuredClone(channels), accounts: structuredClone(accounts), accountsFresh }),
      readControlPlane: async () => structuredClone(stored), realizedToday: async () => 0 });
    const check = (s: FixedIntentSeed = seed) => binding.entryAuthority(s, null);
    assert.equal((await check()).allowed, true, "actual receipt, native gates and full portfolio accept original four-contract signal above old caps");
    assert.equal((await check()).ask, 10);
    peerMode = hidePeer = true;
    assert.equal((await check()).allowed, false, "peer buys filling between positions and orders remain visible in confirming positions");
    assert.equal(hidePeer, false);
    assert.equal((await check()).allowed, false, "stable peer holdings produce the same capacity denial");
    hidePeer = failConfirmation = true;
    assert.equal((await check()).allowed, false, "failed confirmation cannot reuse an empty initial snapshot");
    peerMode = failConfirmation = false;
    foreignOrder = true; assert.equal((await check()).allowed, false); foreignOrder = false;
    held = 1; assert.equal((await check()).allowed, false); held = 0;
    for (const flag of ["halt", "mode", "live", "ready", "accounts", "raw", "bar", "fail"]) {
      halted = flag === "halt"; mode = flag === "mode" ? "live" : "paper"; live = flag !== "live"; ready = flag !== "ready";
      accountsFresh = flag !== "accounts"; rawFlagUnknown = flag === "raw"; missingBar = flag === "bar"; fail = flag === "fail";
      assert.equal((await check()).allowed, false, flag);
    }
    halted = false; mode = "paper"; live = ready = accountsFresh = true; rawFlagUnknown = missingBar = fail = false;
    assert.equal((await check({ ...seed, writeStamp: { ...seed.writeStamp, configuration_epoch_id: `sha256:${"a".repeat(64)}` } })).allowed, false);
    slow = true; assert.equal((await check()).allowed, false); slow = false; now = Date.parse("2026-09-08T14:30:03Z"); refresh();
    now += 180_000; assert.equal((await check()).allowed, false); now = Date.parse("2026-09-08T14:30:03Z"); refresh();
    const saved = stored; stored = { compiled:null, activationReceipt:null, databaseIdentity:null, state:"failed",error:"fixture" };
    assert.equal((await check()).allowed, false); stored = saved;
    // Actual durable partial coverage consumes ONE existing logical admission;
    // it must not block its own remaining original buy as a second entry.
    const originalHarness = fixedCoverageHarness({ intent });
    for (const [id,row] of originalHarness.db) h.db.set(id,row);
    await coordinateFixedCommand(h.commandPorts, intent, h.buy);
    const position = (await materializeFixedEntryCoverage(h.coverage, intent)).position!; assert.ok(position);
    held = 2;
    assert.equal((await binding.entryAuthority(seed, h.buy)).allowed, true, "own partial row/holding is removed only from its own continuation occupancy");
    assert.equal((await binding.exclusiveContract(intent)).allowed, true);
    rows.push({ ...structuredClone(position), id: "unknown-peer", strategist_id: "missing-strategist", entry_features: {}, qty: 1 });
    assert.equal((await binding.entryAuthority(seed,h.buy)).allowed, false);
    assert.equal((await binding.exclusiveContract(intent)).allowed, false);
    console.log("fixedEntryLiveAuthority: PASS · exact compiled receipt, original signal/OCC above old caps, native gates, complete account/portfolio reads, uncertainty, epoch drift, original source age and own partial continuation attribution");
  } finally { Date.now = oldNow; }
}
void main().catch(e => { console.error(e); process.exitCode=1; });
