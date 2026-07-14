// Phase 1G-B dark durable manager runtime. Observation-only by construction:
// no execution, broker account, broker position, or broker order imports.

import { config } from "./config.js";
import { BOOT_ID } from "./runId.js";
import { info, warn } from "./log.js";
import * as alpaca from "./alpaca.js";
import * as store from "./store.js";
import {
  advanceManagerShadowRun,
  attachActualClose,
  buildManagerShadowEnrollments,
  buildManagerShadowTerminalObservation,
  censorManagerShadowRun,
  decodeManagerShadowRun,
  managerEnrollmentEligible,
  recordManagerQuoteMiss,
  type ManagerShadowRun,
} from "./managerShadowBookModel.js";
import { targetedOptionBatches, type TargetedOptionQuote } from "./managerShadowQuoteModel.js";
import {
  MANAGER_SHADOW_CUTOFF_GRACE_MS,
  MANAGER_SHADOW_QUOTE_MAX_AGE_MS,
  managerShadowMeaningfulChange,
  managerShadowSessionPhase,
} from "./managerShadowRuntimeModel.js";
import { SHADOW_MANAGER_COHORT_FROM } from "./managerShadowObservationModel.js";

type RuntimeRun = { run: ManagerShadowRun; sourceBootId: string };
export interface ManagerShadowBookContext {
  paperMode: boolean;
  channels: readonly store.ChannelConfig[];
  accounts: readonly store.AccountRow[];
  nowMs?: number;
}

const runs = new Map<string, RuntimeRun>();
const enrolledPositions = new Set<string>();
let hydrated = false;
let disabled = false;
let ticking = false;
let lastHealthLogMs = 0;
let lastSuccessfulTickMs: number | null = null;
const pendingTerminalReceipts = new Set<string>();

const ET_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
function etClock(ms: number): { date: string; minute: number; second: number } {
  let year = "", month = "", day = "", hour = 0, minute = 0, second = 0;
  for (const part of ET_CLOCK.formatToParts(new Date(ms))) {
    if (part.type === "year") year = part.value;
    else if (part.type === "month") month = part.value;
    else if (part.type === "day") day = part.value;
    else if (part.type === "hour") hour = Number(part.value) % 24;
    else if (part.type === "minute") minute = Number(part.value);
    else if (part.type === "second") second = Number(part.value);
  }
  return { date: `${year}-${month}-${day}`, minute: hour * 60 + minute, second };
}

async function hydrate(): Promise<boolean> {
  if (hydrated) return true;
  const rows = await store.loadManagerShadowRows();
  if (rows == null) return false;
  let rejected = 0;
  for (const row of rows) {
    const run = decodeManagerShadowRun(row);
    if (!run) { rejected++; continue; }
    runs.set(run.id, { run, sourceBootId: row.source_boot_id as string });
    enrolledPositions.add(run.positionId);
    if (run.status === "terminal") pendingTerminalReceipts.add(run.id);
  }
  hydrated = true;
  info(`manager-shadow-book: hydrated ${runs.size} retained runs${rejected ? `; rejected ${rejected} incompatible rows` : ""}`);
  return true;
}

function freshQuote(quote: TargetedOptionQuote | undefined, nowMs: number): quote is TargetedOptionQuote {
  if (!quote || quote.feed !== "opra" || quote.quoteAtMs > nowMs) return false;
  return nowMs - quote.quoteAtMs <= config.managerShadowQuoteMaxAgeMs;
}

async function targetedQuotes(symbols: readonly string[]): Promise<Map<string, TargetedOptionQuote>> {
  const batches = targetedOptionBatches(symbols);
  if (batches == null) throw new Error(`active contract hard cap exceeded (${symbols.length})`);
  const settled = await Promise.allSettled(batches.map((batch) => alpaca.snapshotOptionsTargeted(batch)));
  const out = new Map<string, TargetedOptionQuote>();
  for (const result of settled) {
    if (result.status === "rejected") {
      warn(`manager-shadow-book: targeted quote batch failed — ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      continue;
    }
    for (const [symbol, quote] of result.value) out.set(symbol, quote);
  }
  return out;
}

async function persistTransition(before: RuntimeRun, after: ManagerShadowRun): Promise<boolean> {
  if (!managerShadowMeaningfulChange(before.run, after)) {
    runs.set(after.id, { ...before, run: after });
    return true;
  }
  if (!await store.saveManagerShadowRun(after, before.sourceBootId)) return false;
  runs.set(after.id, { ...before, run: after });
  if (after.status === "terminal") {
    const receipt = buildManagerShadowTerminalObservation(after);
    if (receipt && !await store.insertExecutionObservation(receipt)) pendingTerminalReceipts.add(after.id);
  }
  return true;
}

async function flushTerminalReceipts(): Promise<void> {
  for (const id of [...pendingTerminalReceipts]) {
    const item = runs.get(id);
    const receipt = item ? buildManagerShadowTerminalObservation(item.run) : null;
    if (!receipt || await store.insertExecutionObservation(receipt)) pendingTerminalReceipts.delete(id);
  }
}

async function attributeActualCloses(): Promise<void> {
  const active = [...runs.values()].filter((item) => item.run.status === "active" && item.run.actualCloseAt == null);
  const ids = [...new Set(active.map((item) => item.run.positionId))];
  const positions = await store.loadManagerShadowActualPositions(ids);
  if (positions == null) return;
  const byId = new Map(positions.map((position) => [position.id, position]));
  for (const item of active) {
    const actual = byId.get(item.run.positionId);
    if (!actual || actual.status !== "closed" || !actual.closed_at || !actual.close_reason) continue;
    const next = attachActualClose(item.run, {
      atMs: Date.parse(actual.closed_at), reason: actual.close_reason, realizedPnl: actual.realized_pnl,
    });
    if (next !== item.run) await persistTransition(item, next);
  }
}

async function censorPriorSessionRuns(dateEt: string, nowMs: number): Promise<void> {
  for (const item of activeRuns()) {
    if (etClock(Date.parse(item.run.entryAt)).date >= dateEt) continue;
    const censored = censorManagerShadowRun(item.run, {
      atMs: nowMs,
      code: "missed_session_cutoff",
      fact: "worker resumed after the enrolled session without a durable fresh cutoff bid",
    });
    await persistTransition(item, censored);
  }
}

async function enrollOpenPositions(
  ctx: ManagerShadowBookContext,
  openRows: readonly store.PositionRow[],
  quotes: Map<string, TargetedOptionQuote>,
  nowMs: number,
): Promise<void> {
  const channels = new Map(ctx.channels.map((channel) => [channel.id, channel]));
  const defaultAccount = ctx.accounts.find((account) => !account.cred_ref) ?? ctx.accounts[0];
  for (const row of openRows) {
    if (!row.opened_at || Date.parse(row.opened_at) < Date.parse(SHADOW_MANAGER_COHORT_FROM)) continue;
    const channel = channels.get(row.strategist_id);
    const accountId = channel?.account_id ?? defaultAccount?.id;
    if (!channel || !managerEnrollmentEligible(channel.slug, row.qty) || !accountId || enrolledPositions.has(row.id)) continue;
    const probeId = buildManagerShadowEnrollments({
      positionId: row.id, strategistId: row.strategist_id, accountId,
      channelSlug: channel.slug, occSymbol: row.occ_symbol, underlying: row.underlying,
      optionSide: row.opt_type, entryPrice: row.avg_entry_price, entryPriceBasis: "broker_fill",
      entryAt: row.opened_at, originalQty: row.qty,
      quoteMaxAgeMs: config.managerShadowQuoteMaxAgeMs, paperMode: ctx.paperMode,
    });
    if (!probeId.length || probeId.some((run) => runs.has(run.id))) continue;
    if (!freshQuote(quotes.get(row.occ_symbol), nowMs)) continue;
    if (!await store.insertManagerShadowRuns(probeId)) continue;
    for (const run of probeId) runs.set(run.id, { run, sourceBootId: BOOT_ID });
    enrolledPositions.add(row.id);
  }
}

function activeRuns(): RuntimeRun[] {
  return [...runs.values()].filter((item) => item.run.status === "active");
}

export async function shadowManagerBookTick(ctx: ManagerShadowBookContext): Promise<void> {
  if (!config.managerShadowBookEnabled || disabled || ticking) return;
  ticking = true;
  try {
    if (!ctx.paperMode || !config.hasServiceRole) { disabled = true; return; }
    if (config.optFeed !== "opra") { disabled = true; warn("manager-shadow-book: disabled — executable OPRA feed required"); return; }
    if (config.managerShadowQuoteMaxAgeMs !== MANAGER_SHADOW_QUOTE_MAX_AGE_MS) {
      disabled = true;
      warn(`manager-shadow-book: disabled — quote cohort requires ${MANAGER_SHADOW_QUOTE_MAX_AGE_MS}ms`);
      return;
    }
    if (!await hydrate()) { disabled = true; warn("manager-shadow-book: disabled — durable hydration unavailable"); return; }
    const nowMs = ctx.nowMs ?? Date.now();
    const clock = etClock(nowMs);
    const phase = managerShadowSessionPhase(clock);
    await flushTerminalReceipts();
    await attributeActualCloses();
    await censorPriorSessionRuns(clock.date, nowMs);
    if (phase === "closed") return;
    let openRows: store.PositionRow[] = [];
    try { openRows = await store.getOpenPositions(); } catch { /* enrollment helper logs on its own read */ }
    const channelById = new Map(ctx.channels.map((channel) => [channel.id, channel]));
    const symbols = [...new Set([
      ...activeRuns().map((item) => item.run.occSymbol),
      ...openRows.filter((row) => {
        const channel = channelById.get(row.strategist_id);
        return !!channel && managerEnrollmentEligible(channel.slug, row.qty);
      }).map((row) => row.occ_symbol),
    ])];
    const quotes = await targetedQuotes(symbols);
    await enrollOpenPositions(ctx, openRows, quotes, nowMs);

    for (const item of activeRuns()) {
      const quote = quotes.get(item.run.occSymbol);
      if (!freshQuote(quote, nowMs)) {
        const missed = recordManagerQuoteMiss(item.run);
        await persistTransition(item, missed);
        if (phase === "settle") {
          const current = runs.get(item.run.id) ?? item;
          const censored = censorManagerShadowRun(current.run, {
            atMs: nowMs, code: "no_fresh_cutoff_bid",
            fact: `${config.managerShadowQuoteMaxAgeMs}ms quote limit; ${MANAGER_SHADOW_CUTOFF_GRACE_MS}ms settlement grace`,
          });
          await persistTransition(current, censored);
        }
        continue;
      }
      const result = advanceManagerShadowRun(item.run, {
        bid: quote.bid, ask: quote.ask, quoteAtMs: quote.quoteAtMs,
        observedAtMs: nowMs, isBell: phase === "cutoff" || phase === "settle",
      });
      if (result.kind === "skipped") continue;
      await persistTransition(item, result.run);
    }
    lastSuccessfulTickMs = nowMs;
    if (nowMs - lastHealthLogMs >= 5 * 60_000) {
      lastHealthLogMs = nowMs;
      const all = [...runs.values()].map((item) => item.run);
      const active = all.filter((r) => r.status === "active");
      const oldestActiveMin = active.length
        ? Math.round((nowMs - Math.min(...active.map((r) => Date.parse(r.entryAt)))) / 60_000)
        : 0;
      info(`manager-shadow-book: active=${active.length} terminal_today=${all.filter((r) => r.terminalAt?.startsWith(clock.date)).length} censored_today=${all.filter((r) => r.censoredAt?.startsWith(clock.date)).length} oldest_active_min=${oldestActiveMin} quote_misses=${active.reduce((n, r) => n + r.consecutiveQuoteMisses, 0)} receipt_retry=${pendingTerminalReceipts.size} quotes=${quotes.size} last_ok=${new Date(lastSuccessfulTickMs).toISOString()}`);
    }
  } catch (e) {
    warn(`manager-shadow-book: tick failed — ${(e as Error).message}`);
  } finally { ticking = false; }
}
