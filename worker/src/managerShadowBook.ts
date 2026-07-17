// Phase 1G-B dark durable manager runtime. Observation-only by construction:
// no execution, broker account, broker position, or broker order imports.

import { config, WORKER_VERSION } from "./config.js";
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
  type ManagerEnrollmentInput,
  type ManagerShadowRun,
} from "./managerShadowBookModel.js";
import { TARGETED_OPTION_HARD_CAP, targetedOptionBatches, type TargetedOptionQuote } from "./managerShadowQuoteModel.js";
import {
  heldContractCaptureInputsForFetch,
  type HeldContractCaptureInput,
  type HeldContractCaptureTarget,
} from "./heldContractCaptureModel.js";
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
  heldContractCapture?: { capture(input: HeldContractCaptureInput): void } | null;
  nowMs?: number;
}

const runs = new Map<string, RuntimeRun>();
const enrolledPositions = new Set<string>();
let hydrated = false;
let disabled = false;
let ticking = false;
let lastHealthLogMs = 0;
let lastSuccessfulTickMs: number | null = null;
let lastCaptureCapWarnMs = 0;
const pendingTerminalReceipts = new Set<string>();
const admissionInFlight = new Set<string>();
const admissionHealthWarned = new Set<string>();

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

async function targetedQuotes(
  symbols: readonly string[],
  targets: readonly HeldContractCaptureTarget[],
  capture: ManagerShadowBookContext["heldContractCapture"],
): Promise<Map<string, TargetedOptionQuote>> {
  const batches = targetedOptionBatches(symbols);
  if (batches == null) throw new Error(`active contract hard cap exceeded (${symbols.length})`);
  const settled = await Promise.all(batches.map(async (batch) => {
    const fetchStartedAtMs = Date.now();
    try {
      const quotes = await alpaca.snapshotOptionsTargeted(batch);
      const fetchCompletedAtMs = Date.now();
      return { batch, quotes, requestOutcome: "success" as const, failureCode: null, fetchStartedAtMs, fetchCompletedAtMs };
    } catch (error) {
      const fetchCompletedAtMs = Date.now();
      warn(`manager-shadow-book: targeted quote batch failed — ${error instanceof Error ? error.message : String(error)}`);
      return {
        batch, quotes: new Map<string, TargetedOptionQuote>(), requestOutcome: "provider_error" as const,
        failureCode: "provider_request_failed", fetchStartedAtMs, fetchCompletedAtMs,
      };
    }
  }));
  const out = new Map<string, TargetedOptionQuote>();
  for (const result of settled) {
    if (capture) {
      try {
        const inputs = heldContractCaptureInputsForFetch(targets, {
          requestedSymbols: result.batch, requestOutcome: result.requestOutcome, failureCode: result.failureCode,
          fetchStartedAtMs: result.fetchStartedAtMs, fetchCompletedAtMs: result.fetchCompletedAtMs,
          observedAtMs: result.fetchCompletedAtMs, quotes: result.quotes,
          sourceBootId: BOOT_ID, sourceVersion: WORKER_VERSION,
        });
        for (const input of inputs) capture.capture(input);
      } catch (error) {
        warn(`manager-shadow-book: held-contract capture rejected synchronously — ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    for (const [symbol, quote] of result.quotes) out.set(symbol, quote);
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
  const pending = [...runs.values()].filter((item) => item.run.actualCloseAt == null);
  const ids = [...new Set(pending.map((item) => item.run.positionId))];
  const positions = await store.loadManagerShadowActualPositions(ids);
  if (positions == null) return;
  const byId = new Map(positions.map((position) => [position.id, position]));
  for (const item of pending) {
    const actual = byId.get(item.run.positionId);
    if (!actual || actual.status !== "closed" || !actual.closed_at) continue;
    const next = attachActualClose(item.run, {
      atMs: Date.parse(actual.closed_at), reason: actual.close_reason ?? "unattributed_close", realizedPnl: actual.realized_pnl,
    });
    if (next === item.run) continue;
    if (item.run.status === "active") await persistTransition(item, next);
    else if (await store.saveManagerShadowActualClose(next)) runs.set(next.id, { ...item, run: next });
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

async function persistAdmission(input: ManagerEnrollmentInput): Promise<boolean> {
  if (enrolledPositions.has(input.positionId) || admissionInFlight.has(input.positionId)) return true;
  admissionInFlight.add(input.positionId);
  try {
    const candidates = buildManagerShadowEnrollments(input);
    if (!candidates.length) return false;
    if (!await store.insertManagerShadowRuns(candidates)) return false;
    for (const run of candidates) runs.set(run.id, { run, sourceBootId: BOOT_ID });
    enrolledPositions.add(input.positionId);
    admissionHealthWarned.delete(input.positionId);
    return true;
  } finally {
    admissionInFlight.delete(input.positionId);
  }
}

/** Fill-path hook: enqueue observation persistence only. It returns before any
 * database work begins and can neither reject nor delay the completed order. */
export function queueManagerShadowAdmission(
  input: Omit<ManagerEnrollmentInput, "admissionSource" | "admittedAt">,
  admissionSource: "fill_hook" | "recovery_open" = "fill_hook",
): void {
  if (!config.managerShadowBookEnabled || disabled || !config.hasServiceRole
      || config.optFeed !== "opra" || !input.paperMode) return;
  const admittedAt = new Date().toISOString();
  void Promise.resolve().then(async () => {
    try {
      await persistAdmission({ ...input, admissionSource, admittedAt });
    } catch (error) {
      warn(`manager-shadow-book: fill admission rejected — ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

async function enrollRecoveryPositions(
  ctx: ManagerShadowBookContext,
  rows: readonly store.PositionRow[],
  nowMs: number,
): Promise<void> {
  const channels = new Map(ctx.channels.map((channel) => [channel.id, channel]));
  const defaultAccount = ctx.accounts.find((account) => !account.cred_ref) ?? ctx.accounts[0];
  for (const row of rows) {
    if (!row.opened_at || Date.parse(row.opened_at) < Date.parse(SHADOW_MANAGER_COHORT_FROM)) continue;
    const channel = channels.get(row.strategist_id);
    const accountId = channel?.account_id ?? defaultAccount?.id;
    if (!channel || !managerEnrollmentEligible(channel.slug, row.qty) || !accountId || enrolledPositions.has(row.id)) continue;
    const input: ManagerEnrollmentInput = {
      positionId: row.id, strategistId: row.strategist_id, accountId,
      channelSlug: channel.slug, occSymbol: row.occ_symbol, underlying: row.underlying,
      optionSide: row.opt_type, entryPrice: row.avg_entry_price, entryPriceBasis: "broker_fill",
      entryAt: row.opened_at, originalQty: row.qty,
      quoteMaxAgeMs: config.managerShadowQuoteMaxAgeMs, paperMode: ctx.paperMode,
      admissionSource: row.status === "closed" ? "recovery_closed" : "recovery_open",
      admittedAt: new Date(nowMs).toISOString(),
    };
    if (await persistAdmission(input)) continue;
    if (nowMs - Date.parse(row.opened_at) > 20_000 && !admissionHealthWarned.has(row.id)) {
      admissionHealthWarned.add(row.id);
      warn(`manager-shadow-book: eligible position ${row.id} lacks v2 admission >20s after open`);
      void store.journal("WARN", `manager observer admission delayed >20s — ${channel.slug} ${row.occ_symbol}`, { position_id: row.id });
    }
  }
}

function openPositionCaptureTargets(
  ctx: ManagerShadowBookContext,
  rows: readonly store.PositionRow[],
): HeldContractCaptureTarget[] {
  if (!ctx.heldContractCapture) return [];
  const channels = new Map(ctx.channels.map((channel) => [channel.id, channel]));
  const defaultAccount = ctx.accounts.find((account) => !account.cred_ref) ?? ctx.accounts[0];
  return rows.flatMap((row): HeldContractCaptureTarget[] => {
    if (row.status !== "open") return [];
    const channel = channels.get(row.strategist_id);
    const accountId = channel?.account_id ?? defaultAccount?.id;
    if (!channel || !accountId) return [];
    return [{
      positionId: row.id, strategistId: row.strategist_id, accountId,
      channelSlug: channel.slug, occSymbol: row.occ_symbol, underlying: row.underlying,
    }];
  });
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
    const recentSince = new Date(nowMs - 20 * 60 * 60_000).toISOString();
    const recoveryRows = (await store.loadManagerShadowRecoveryPositions(recentSince) ?? [])
      .filter((row) => row.opened_at && etClock(Date.parse(row.opened_at)).date === clock.date);
    await enrollRecoveryPositions(ctx, recoveryRows, nowMs);
    // A recovered closed row must receive its actual outcome in the same tick.
    await attributeActualCloses();
    if (phase === "closed") return;
    const active = activeRuns();
    const activeManagerTargets = active.map(({ run }): HeldContractCaptureTarget => ({
      positionId: run.positionId, strategistId: run.strategistId, accountId: run.accountId,
      channelSlug: run.channelSlug, occSymbol: run.occSymbol, underlying: run.underlying,
    }));
    // Capture every open position, including lots below the manager cohort's
    // modeled-size floor, plus manager runs that continue after actual close.
    const captureTargets = [...activeManagerTargets, ...openPositionCaptureTargets(ctx, recoveryRows)];
    const managerSymbols = [...new Set(active.map((item) => item.run.occSymbol))].sort();
    const managerSet = new Set(managerSymbols);
    const captureOnlySymbols = [...new Set(captureTargets.map((target) => target.occSymbol))]
      .filter((symbol) => !managerSet.has(symbol)).sort();
    const captureCapacity = Math.max(0, TARGETED_OPTION_HARD_CAP - managerSymbols.length);
    const admittedCaptureSymbols = captureOnlySymbols.slice(0, captureCapacity);
    const omittedCaptureSymbols = captureOnlySymbols.slice(captureCapacity);
    if (ctx.heldContractCapture && omittedCaptureSymbols.length) {
      const omittedAtMs = Date.now();
      try {
        const omissions = heldContractCaptureInputsForFetch(captureTargets, {
          requestedSymbols: omittedCaptureSymbols, requestOutcome: "not_requested",
          failureCode: "targeted_option_hard_cap_shed", fetchStartedAtMs: omittedAtMs,
          fetchCompletedAtMs: omittedAtMs, observedAtMs: omittedAtMs,
          quotes: new Map(), sourceBootId: BOOT_ID, sourceVersion: WORKER_VERSION,
        });
        for (const input of omissions) ctx.heldContractCapture.capture(input);
      } catch (error) {
        warn(`manager-shadow-book: capture hard-cap evidence rejected — ${error instanceof Error ? error.message : String(error)}`);
      }
      if (omittedAtMs - lastCaptureCapWarnMs >= 5 * 60_000) {
        lastCaptureCapWarnMs = omittedAtMs;
        warn(`held-contract-capture: ${omittedCaptureSymbols.length} open-position OCC(s) omitted at provider hard cap; manager symbols retained`);
      }
    }
    // Capture-only expansion can never crowd an active manager OCC out of the
    // provider's tested 500-symbol boundary.
    const symbols = [...managerSymbols, ...admittedCaptureSymbols];
    const quotes = await targetedQuotes(symbols, captureTargets, ctx.heldContractCapture);
    const observedAtMs = Date.now();

    for (const item of activeRuns()) {
      const quote = quotes.get(item.run.occSymbol);
      if (!freshQuote(quote, observedAtMs)) {
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
        observedAtMs, snapshotFetchedAtMs: observedAtMs,
        isBell: phase === "cutoff" || phase === "settle",
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
