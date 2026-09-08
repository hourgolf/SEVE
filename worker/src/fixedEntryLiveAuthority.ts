/** Fresh read-only authority for the original fixed entry. It rechecks native
 * constraints and receipt/portfolio truth, but never generates another signal,
 * changes its original OCC or derives quantity from a dollar budget.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalJson } from "../../lib/channels/channelControlPlane.js";
import { policy } from "./config.js";
import type { Api } from "./alpaca.js";
import type { Bar } from "../../engine/types.js";
import type { ChainStore } from "./state.js";
import type { FixedRuntimeBindings, FixedRuntimeEntryAuthority } from "./fixedEntryRuntimeDriver.js";
import type { FixedIntentSeed } from "./fixedEntryIntentAdmission.js";
import type { FixedCommandClaim } from "./fixedEntryCommandCoordinator.js";
import { loadConfig, loadReceiptBoundControlPlane, realizedTodayByChannel, type AccountRow } from "./store.js";
import { resolveDormantChannelRuntimeAuthority } from "./channelConfigurationRuntimeBridge.js";
import { receiptBoundRc54ConfigurationWriteStamp, buildReceiptBoundRc54AdmissionPolicies,
  buildReceiptBoundRc54AdmissionRootResolver } from "./temporaryRc54RuntimeAdapter.js";
import { buildRc54AdmissionOccupancy, prepareRc54ReleaseAdmissions, finalizeRc54ReleaseAdmissions,
  type Rc54BrokerHolding, type Rc54PendingOrderOccupancy } from "./rc54ReleasePolicy.js";
import { readCompleteFixedRows, discoverFixedEntryIntents, readFixedIntentRecords,
  readFixedIntentPositions, FIXED_POSITION_COLUMNS } from "./fixedEntrySupabaseCoverage.js";
import { inspectFixedEntryInventory } from "./fixedEntryLedgerInventory.js";
import { verifyFixedIntentSettlement, type FixedIntentSettlement } from "./fixedEntryIntentSettlement.js";
import { fixedPositionIdentityMatches, type FixedMaterializedPosition } from "./fixedEntryCoverageMaterialization.js";
import { fixedEntryOwnershipPresent } from "../../lib/channels/fixedEntryOwnership.js";
import { fixedEtClock } from "./fixedEntryManagement.js";
import { isTradingDay, sessionCloseMin } from "../../engine/market-calendar.js";
import { nativeEntryBeforeQuote, nativeEntryCost } from "./nativeEntryGuards.js";
import { computeFeatures } from "../../engine/engine.js";
import { buildSessionBars, computeLevels, type ShadowDecision } from "./decide.js";
import { rowAccountIdOf } from "./routing.js";
import { assertFixedEntryServiceClient } from "./fixedEntryServiceClient.js";
import type { OptionsAffordabilitySnapshot } from "./fixedContractAffordability.js";
type Client = Pick<SupabaseClient, "from">;
const terminal = new Set(["filled", "canceled", "expired", "rejected"]);
const number = (v: unknown) => (typeof v === "number" || typeof v === "string" && v.trim() !== "")
  && Number.isFinite(Number(v)) ? Number(v) : null;
export function makeFixedEntryLiveAuthority(client: Client, input: {
  now(): number;
  liveMode(): boolean;
  /** Existing sealed source/executor startup gate, not a new risk policy. */
  infrastructureReady(): boolean;
  workerCompatibilityVersion: string;
  apiForAccount(account: AccountRow): Api | null;
  bars(symbol: string): readonly Bar[];
  chain(symbol: string): ChainStore | null;
  fetch?: typeof globalThis.fetch;
  /** Hermetic tests can replace the existing SELECT-only store adapters. */
  readConfig?: typeof loadConfig;
  readControlPlane?: typeof loadReceiptBoundControlPlane;
  realizedToday?: typeof realizedTodayByChannel;
}): Pick<FixedRuntimeBindings, "entryAuthority" | "exclusiveContract"> {
  assertFixedEntryServiceClient(client);
  const readConfig = input.readConfig ?? (()=>loadConfig(client));
  const readControlPlane = input.readControlPlane ?? (()=>loadReceiptBoundControlPlane(client));
  const fetcher = input.fetch ?? globalThis.fetch;
  async function get(api: Api, path: string): Promise<unknown> {
    if (api.paperHost.replace(/\/$/, "") !== "https://paper-api.alpaca.markets") throw new Error("fixed_live:paper_route_required");
    try {
      const r = await fetcher(api.paperHost.replace(/\/$/, "") + path, { method: "GET", headers: api.headers,
        signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error("unavailable");
      return await r.json();
    } catch { throw new Error("fixed_live:broker_evidence_unavailable"); }
  }
  async function allOpenRows() {
    return readCompleteFixedRows<FixedMaterializedPosition>(client, "positions", FIXED_POSITION_COLUMNS, [["status", "open"]]);
  }
  return {
    async exclusiveContract(intent) {
      const observedAtMs = input.now();
      const [rows, c] = await Promise.all([allOpenRows(), readConfig()]);
      if (!c.accountsFresh) return { allowed: false, observedAtMs };
      const byId = new Map(c.channels.map(ch => [ch.id, ch]));
      let allowed = true;
      for (const row of rows.filter(r => r.occ_symbol === intent.occ)) {
        if (fixedEntryOwnershipPresent(row)) {
          if (!fixedPositionIdentityMatches(intent, row)) allowed = false;
        } else {
          // An absent strategist cannot safely default a historical lot into a
          // different book. Unknown attribution quarantines this OCC.
          if (!byId.has(row.strategist_id) || rowAccountIdOf(row, byId, c.accounts) === intent.accountId) allowed = false;
        }
      }
      return { allowed, observedAtMs };
    },
    async entryAuthority(seed: FixedIntentSeed, claim: FixedCommandClaim | null): Promise<FixedRuntimeEntryAuthority> {
      const started = input.now();
      const denied: FixedRuntimeEntryAuthority = { allowed: false, validUntilMs: started,
        bid: NaN, ask: NaN, quoteAgeMs: Infinity, account: null };
      try {
        if (!Number.isFinite(started) || !input.liveMode() || !input.infrastructureReady()) return denied;
        const [c, stored] = await Promise.all([readConfig(), readControlPlane()]);
        if (!c.fund || !c.accountsFresh || c.fund.mode !== "paper") return denied;
        const apis = new Map(c.accounts.map(a => [a.id, input.apiForAccount(a)]));
        const resolution = resolveDormantChannelRuntimeAuthority({ stored, runtime: {
          channels: c.channels, accounts: c.accounts, fundMode: c.fund.mode,
          workerCompatibilityVersion: input.workerCompatibilityVersion,
          resolvedCredentialAccountIds: c.accounts.filter(a => apis.get(a.id)).map(a => a.id),
          allowUnadoptedRc54Baseline: false } });
        if (resolution.state !== "receipt-bound") return denied;
        const runtime = resolution.runtime, root = runtime.roots.find(r => r.slug === seed.slug);
        const ch = resolution.channels.find(r => r.id === seed.strategistId);
        const originalAccount = c.accounts.find(a => a.id === seed.accountId);
        if (!root?.fixedContractAdmission || root.executionPosture !== "paper" || !ch
            || ch.slug !== seed.slug || ch.account_id !== seed.accountId || ch.executor !== "stream"
            || !originalAccount || originalAccount.mode !== "paper" || originalAccount.cred_ref !== "2"
            || originalAccount.is_armed !== true || originalAccount.is_halted !== false
            || canonicalJson(receiptBoundRc54ConfigurationWriteStamp(runtime, seed.slug)) !== canonicalJson(seed.writeStamp)) return denied;
        // The immutable MACD original owns account2 SPY. No second executable
        // source may share that route during this narrowly approved cutover.
        if (runtime.roots.some(r => r.slug !== seed.slug && r.accountId === seed.accountId
            && r.underlying === seed.underlying && r.executionPosture === "paper")) return denied;
        const requiredIds = new Set(runtime.roots.map(r => r.accountId));
        const accounts = c.accounts.filter(a => requiredIds.has(a.id));
        if (accounts.length !== requiredIds.size || new Set(accounts.map(a => a.id)).size !== accounts.length) return denied;
        const intents = await discoverFixedEntryIntents(client);
        const histories = await Promise.all(intents.map(async intent => ({ intent,
          records: await readFixedIntentRecords(client, intent), positions: await readFixedIntentPositions(client, intent) })));
        const own = claim ? histories.find(h => h.intent.id === claim.command.intentId) : null;
        if (claim && (!own || own.intent.strategistId !== seed.strategistId || own.intent.occ !== seed.occ
            || own.intent.accountId !== seed.accountId || own.intent.sourceBarAt !== seed.sourceBarAt
            || canonicalJson(own.intent.writeStamp) !== canonicalJson(seed.writeStamp))) return denied;
        for (const h of histories) if (h !== own && !verifyFixedIntentSettlement(h.intent, h)) return denied;
        const inventory = own ? inspectFixedEntryInventory(own.intent, own.records) : null;
        const ownNet = inventory?.facts.reduce((n, f) => n + (f.command.side === "buy" ? 1 : -1) * (f.provenFill?.filledQty ?? 0), 0) ?? 0;
        if (!Number.isSafeInteger(ownNet) || ownNet < 0 || ownNet > 4) return denied;
        const portfolioStarted = input.now();
        const [openRows, sessionRows, brokerReads, rawFund] = await Promise.all([
          allOpenRows(),
          readCompleteFixedRows<FixedMaterializedPosition>(client, "positions", FIXED_POSITION_COLUMNS,
            [["opened_at", `${seed.sessionDateEt}T00:00:00Z`, "gte"]]),
          Promise.all(accounts.map(async account => {
            const api = apis.get(account.id); if (!api || account.mode !== "paper") throw new Error("fixed_live:unresolved_account");
            const [a, initialPositions] = await Promise.all([get(api, "/v2/account"), get(api, "/v2/positions")]);
            if (!Array.isArray(initialPositions)) throw new Error("fixed_live:incomplete_broker_inventory");
            const os = await get(api, "/v2/orders?status=open&limit=500&direction=desc&nested=false");
            // Match the native release snapshot ordering. A buy can fill after
            // the first position read and disappear from working orders. Only
            // the confirming read may supply admission holdings; failure cannot
            // fall back to the earlier snapshot. All reads retain the original
            // portfolioStarted freshness deadline.
            const ps = await get(api, "/v2/positions");
            // A full capped page is not a complete inventory. This rejection is
            // explicit rather than silently treating an omitted order as absent.
            if (!a || typeof a !== "object" || Array.isArray(a) || !Array.isArray(ps) || !Array.isArray(os) || os.length >= 500) {
              throw new Error("fixed_live:incomplete_broker_inventory");
            }
            return { account, a: a as Record<string, unknown>, ps: ps as Record<string, unknown>[],
              os: os as Record<string, unknown>[], observedAtMs: portfolioStarted };
          })),
          client.from("fund_state").select("id,mode,is_halted").eq("id", 1).maybeSingle(),
        ]);
        if (rawFund.error || rawFund.data?.id !== 1 || rawFund.data.mode !== "paper" || rawFund.data.is_halted !== false) return denied;
        if (new Set(brokerReads.map(r => r.a.id)).size !== accounts.length
            || brokerReads.some(r => typeof r.a.id !== "string" || !r.a.id || number(r.a.equity) === null || number(r.a.cash) === null)) return denied;
        const original = brokerReads.find(r => r.account.id === seed.accountId)!;
        const account: OptionsAffordabilitySnapshot = {
          observedAtMs: original.observedAtMs, status: String(original.a.status ?? ""), optionsBuyingPowerUsd: number(original.a.options_buying_power),
          tradingBlocked: typeof original.a.trading_blocked === "boolean" ? original.a.trading_blocked : null,
          accountBlocked: typeof original.a.account_blocked === "boolean" ? original.a.account_blocked : null,
          tradeSuspendedByUser: typeof original.a.trade_suspended_by_user === "boolean" ? original.a.trade_suspended_by_user : null,
          optionsTradingLevel: number(original.a.options_trading_level) };
        const byId = new Map(resolution.channels.map(channel => [channel.id, channel]));
        const routes = new Map(resolution.channels.map(channel => [channel.id,
          rowAccountIdOf({ strategist_id: channel.id }, byId, c.accounts)]));
        const peerRows = openRows.filter(row => {
          if (fixedEntryOwnershipPresent(row)) {
            if (!own || !fixedPositionIdentityMatches(own.intent, row)) throw new Error("fixed_live:foreign_fixed_row");
            return false;
          }
          if (!byId.has(row.strategist_id)) throw new Error("fixed_live:desk_route_unresolved");
          return true;
        });
        const ownRows = openRows.filter(r => fixedEntryOwnershipPresent(r));
        if (ownRows.reduce((n,r) => n + r.qty, 0) !== ownNet) return denied;
        const brokerPositions: Rc54BrokerHolding[] = [], pendingOrders: Rc54PendingOrderOccupancy[] = [];
        let originalHeld = 0;
        for (const r of brokerReads) {
          const symbols = new Set<string>(), orderIds = new Set<string>();
          for (const p of r.ps) {
            const qty = number(p.qty), occ = String(p.symbol ?? "");
            if (!occ || qty === null || !Number.isSafeInteger(qty) || qty < 0 || symbols.has(occ)) return denied;
            symbols.add(occ);
            if (r.account.id === seed.accountId && occ === seed.occ) {
              originalHeld = qty;
              if (own && qty === ownNet) continue;
            }
            if (qty > 0) brokerPositions.push({ accountId: r.account.id, occSymbol: occ, quantity: qty, underlying: occ.slice(0, -15) });
          }
          for (const o of r.os) {
            const occ = String(o.symbol ?? "");
            if (typeof o.id !== "string" || !o.id || orderIds.has(o.id) || !occ || typeof o.status !== "string" || terminal.has(o.status)) return denied;
            orderIds.add(o.id);
            const owned = r.account.id === seed.accountId && occ === seed.occ
              && inventory?.facts.find(f => f.command.clientOrderId === o.client_order_id);
            if (owned) {
              if (o.side !== owned.command.side || number(o.qty) !== owned.command.quantity) return denied;
              continue;
            }
            pendingOrders.push({ accountId: r.account.id, occSymbol: occ, underlying: occ.slice(0, -15) });
          }
        }
        if (own && originalHeld !== ownNet) return denied;
        const now = input.now(), clock = fixedEtClock(now), sourceAt = Date.parse(seed.sourceBarAt), barClock = fixedEtClock(sourceAt);
        const sourceAge = now - sourceAt, close = sessionCloseMin(clock.date);
        if (!isTradingDay(clock.date) || clock.date !== seed.sessionDateEt || barClock.date !== seed.sessionDateEt
            || clock.minute < 570 || clock.minute >= close || sourceAge < 0 || sourceAge >= 180_000) return denied;
        const allBars = input.bars(seed.underlying).filter(b => b.ts <= sourceAt);
        const bars = buildSessionBars(allBars, seed.sessionDateEt), last = bars.at(-1);
        if (!last || last.ts !== sourceAt) return denied;
        const features = computeFeatures(bars, bars.length - 1), levels = computeLevels(allBars, seed.sessionDateEt);
        if (!Number.isFinite(features.atr) || !Number.isFinite(features.close)) return denied;
        const deskStack = new Map<string, number>();
        for (const row of peerRows) {
          const key = `${row.underlying.toUpperCase()}:${row.opt_type}`;
          deskStack.set(key, (deskStack.get(key) ?? 0) + 1);
        }
        const gate = await nativeEntryBeforeQuote({ ch, ctx: { fund: c.fund, todayET: seed.sessionDateEt,
          gap: levels.gap, deskStack, rthCloseMin: close, minutesToClose: close - barClock.minute,
          wallMinutesToClose: close - clock.minute }, dir: seed.optionSide, entryExpiry: seed.sessionDateEt,
          inCutoff: close - barClock.minute <= policy.OPEN_0DTE_CUTOFF_MIN,
          realizedTodayByChannel: input.realizedToday ?? ((id,date)=>realizedTodayByChannel(id,date,client)) });
        if (gate.blocked) return denied;
        const quoteAt = input.now(), chain = input.chain(seed.underlying), q = chain?.quoteObservation(seed.occ, quoteAt);
        const bid = number(q?.bid), ask = number(q?.ask), quoteAgeMs = number(q?.localAgeMs);
        if (bid === null || ask === null || bid <= 0 || ask < bid || quoteAgeMs === null || quoteAgeMs < 0
            || quoteAgeMs > 120_000 || !chain || chain.ageMs > 120_000) return denied;
        const cost = nativeEntryCost({ slug: seed.slug, strike: Number(seed.occ.slice(-8)) / 1000,
          dir: seed.optionSide, bid, ask, delta: 0, atr: features.atr });
        if (cost.blocked) return denied;
        const resolver = buildReceiptBoundRc54AdmissionRootResolver(runtime);
        const occupancy = buildRc54AdmissionOccupancy({ openPositions: peerRows,
          sessionPositions: sessionRows.filter(r => !fixedEntryOwnershipPresent(r) && r.opened_at
            && fixedEtClock(Date.parse(r.opened_at)).date === seed.sessionDateEt),
          channelById: byId, accountIdByStrategist: routes, brokerPositions, pendingOrders, rootResolver: resolver });
        for (const h of histories.filter(h => h !== own && h.intent.sessionDateEt === seed.sessionDateEt)) {
          const done = verifyFixedIntentSettlement(h.intent, h)!;
          if ((done.body.intentSettlement as FixedIntentSettlement).sessionEntryConsumed) occupancy.sessionEntries.push({
            domainId: root.domainId, familyId: root.familyId, entryId: h.intent.opportunityId ?? h.intent.id });
        }
        const decision: ShadowDecision = { slug: seed.slug, status: "armed", action: "enter", reason: seed.reason,
          direction: seed.optionSide, occ: seed.occ, qty: 4, blocked: null, detail: { ...seed.evidence, bid, ask } };
        const prepared = prepareRc54ReleaseAdmissions({ channels: [ch], decisions: [decision], accountId: seed.accountId,
          sourceBarAtMs: sourceAt, observedAtMs: quoteAt, currentEtMinute: fixedEtClock(quoteAt).minute,
          sessionCloseEtMinute: close, sessionLedgerReady: true, rootResolver: resolver });
        const final = finalizeRc54ReleaseAdmissions({ prepared: [{ accountId: seed.accountId, sourceBarAtMs: sourceAt,
          decision: prepared[0], executionEligible: true }], ...occupancy, globalPositionTruthComplete: true,
          globalOrderTruthComplete: true, rootResolver: resolver, admissionPolicies: buildReceiptBoundRc54AdmissionPolicies(runtime) })[0].decision;
        const validUntilMs = Math.min(started + 30_000, portfolioStarted + 2_000, sourceAt + 180_000, quoteAt + 120_000 - quoteAgeMs);
        return { allowed: !final.blocked && input.liveMode() && input.infrastructureReady() && input.now() < validUntilMs,
          validUntilMs, bid, ask, quoteAgeMs: quoteAgeMs + input.now() - quoteAt, account };
      } catch { return denied; }
    },
  };
}
