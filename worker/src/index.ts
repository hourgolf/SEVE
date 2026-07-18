// ============================================================================
//  SEVE streaming worker — entrypoint (Phase A · SHADOW).
//
//  The THIRD engine driver (backtest / cron / streaming). Holds an always-on
//  Alpaca stock-bar websocket, keeps bars + the NTM chain + config in memory,
//  and on every bar-close runs the SAME engine the backtest uses to decide each
//  channel — logging what it WOULD do (no orders, no prod-table writes). Validate
//  these against the cron worker's signals for a few sessions, then wire Phase B
//  (live orders + cron cutover). See docs/streaming-worker.md.
//
//  SINGLE INSTANCE ONLY — once Phase B places orders, two workers = double
//  orders. Railway: 1 replica, restart-on-crash, sole order-placer.
// ============================================================================

import { config, policy, WORKER_VERSION } from "./config.js";
import { BOOT_ID, INSTANCE_ID } from "./runId.js";
import { info, warn, error, shadow } from "./log.js";
import * as alpaca from "./alpaca.js";
import * as store from "./store.js";
import { BarStore, ChainStore } from "./state.js";
import { StockBarStream } from "./stream.js";
import type { IntraminuteCaptureRuntime } from "./intraminuteCapture.js";
import type { HeldContractCaptureRuntime } from "./heldContractCapture.js";
import {
  HELD_CAPTURE_ADAPTER_REQUEST_TIMEOUT_MS,
  HELD_CAPTURE_NORMAL_FLUSH_WALL_CLOCK_MS,
  HELD_CAPTURE_SHUTDOWN_WALL_CLOCK_MS,
} from "./researchAdapterDeadline.js";
import { decideChannel, buildSessionBars, computeLevels, type DecisionCtx, type ShadowDecision } from "./decide.js";
import { alertOnce, alertClear } from "./alerts.js";
import { updateShadowManagement } from "./shadowManage.js";
import { archiveQuotesToStorage, maybeArchiveTick } from "./archive.js";
import { maybePublishForensicsTick } from "./forensics.js";
import { executeEntry, executeExit, executeReconcile, executeAdd, premiumExitReason, seedRemaining, entryKey, noteRowHeld, type ExecCtx, type ExitQualityPolicy } from "./execute.js";
import { freshExecutableBid } from "./exitRules.js";
import { computeFeatures } from "../../engine/engine";
import { sessionCloseMin } from "../../engine/market-calendar";
import { inEventWindow } from "../../engine/market-events";
import { groupChannelsByAccount, rowAccountIdOf, acctCanEnter, acctCanManage } from "./routing.js";
import { makeExitGuard, sweepExitAllowed } from "./exitGuard.js";
import { captureDecisionObservation, captureManagerShadowObservation } from "./executionObservation.js";
import { advanceManager, MANAGER_IDS, managerIdsForChannel, PB_RIDE_2_MANAGER_ID, recoverManagerState, type ManagerState } from "../../engine/managerPolicy.js";
import { specPremiumExit } from "../../engine/specEvaluate";
import { shadowManagerBookTick } from "./managerShadowBook.js";
import { captureFamilyAdmissionObservations } from "./familyAdmission.js";
import type { FamilyAdmissionInput } from "./familyAdmissionModel.js";
import type { StrategySpec } from "../../lib/desk/strategySpec";
import type { Bar } from "../../engine/types";
import {
  applyDay1ReleaseFleetOverlay,
  buildDay1AdmissionState,
  DAY1_RELEASE_CONFIGURATION_SHA256,
  DAY1_RELEASE_ID,
  DAY1_ROOT_BINDINGS,
  DAY1_ROOTS,
  finalizeDay1ReleaseAdmissions,
  prepareDay1ReleaseAdmission,
  validateDay1ReleaseStartup,
  day1Root,
  day1ReleaseEodDue,
  type Day1BrokerHolding,
  type Day1PendingOrderOccupancy,
  type Day1SnapshotFailure,
} from "./day1ReleasePolicy.js";

const RTH_OPEN = 570, RTH_CLOSE = 960;
let day1StartupReceipt: Record<string, unknown> | null = null;

// Phase B posture: ALL of (DRY_RUN=false, LIVE_TRADING=true, service role) — the
// two-key turn plus credentials. Anything less = shadow, exactly as Phase A.
const liveMode = (): boolean => !config.dryRun && config.liveTrading && config.hasServiceRole;
// A channel this instance EXECUTES: stream-owned + one of THIS worker's symbols.
// Multi-symbol (B3): one instance holds N symbols, each with its own bars/chain,
// behind ONE 'stream' heartbeat — so it must reliably handle every symbol it lists.
const SYMBOLS = config.symbols;
const ownedBy = (c: store.ChannelConfig): boolean => c.executor === "stream" && SYMBOLS.includes(c.underlying.toUpperCase());
// Running peak option BID per open position (giveback/runner trail arm + sweep state).
// audit 2026-07-11 (1b #6): BID-based (was mid) — the trail must arm and give back on
// REALIZABLE prices (bid-side MFE, the desk methodology), so a wide spread can't arm a
// ratchet at a level no buyer ever paid. The persisted peak_mark/trough_mark columns
// switch basis with it — see the era-boundary note at the sweep's seed site below.
const peakBidByKey = new Map<string, number>();
// Running TROUGH option BID per open position — the MAE twin (58_trough_mark). Instrumentation
// only: no exit reads it; it makes stop calibration measurable from durable data. BID-based
// since 1b #6 (a stop-out sells at the bid, so bid-side MAE is the calibration truth).
const troughBidByKey = new Map<string, number>();
// Counterfactual manager state is deliberately separate from the active exit
// policy. It can only feed append-only evidence; executeExit never reads it.
const managerShadowState = new Map<string, ManagerState>();
// 1b #6: per-row throttle (≤1 line/min) for the "price exits skipped" info — a position whose
// quote is stale/bid-less has NO price protection, which must be visible without flooding the
// log at the 10s sweep cadence. Cleared with the peak/trough state when the row leaves.
const sweepSkipLogged = new Map<string, number>();
// One clear point for a row's sweep price-state (peak/trough/skip-throttle) — every path that
// retires a row from the price section (flattens + fired exits) must drop all three together.
function clearSweepPriceState(rowId: string): void {
  peakBidByKey.delete(rowId);
  troughBidByKey.delete(rowId);
  sweepSkipLogged.delete(rowId);
  for (const managerId of MANAGER_IDS) managerShadowState.delete(`${rowId}|${managerId}`);
}

function exitQualityPolicyFor(ch: store.ChannelConfig): ExitQualityPolicy {
  if (config.day1ReleaseEnabled && day1Root(ch.slug)) {
    return { premiumStopPct: 30, specPremiumStopPct: null, underlyingStopPct: null, takeProfitPct: null };
  }
  const premiumGate = ch.premium_stop_pct ?? policy.PREMIUM_STOP_PCT;
  const specExit = ch.spec_json ? specPremiumExit(ch.spec_json as StrategySpec) : undefined;
  const takeProfitCandidates = [ch.take_profit_pct, specExit?.profitPct]
    .filter((value): value is number => typeof value === "number" && value > 0);
  return {
    premiumStopPct: premiumGate > 0 ? premiumGate : null,
    specPremiumStopPct: premiumGate > 0 && (specExit?.stopPct ?? 0) > 0 ? specExit?.stopPct ?? null : null,
    underlyingStopPct: ch.underlying_stop_pct > 0 ? ch.underlying_stop_pct : null,
    // Both compiled-spec and channel-config targets can be active. The first
    // threshold reached is the smaller positive value, which is the truthful
    // configured target for an otherwise identical target_premium reason.
    takeProfitPct: takeProfitCandidates.length ? Math.min(...takeProfitCandidates) : null,
  };
}

function observeShadowManagers(input: {
  ch: store.ChannelConfig;
  row: store.PositionRow;
  accountId: string;
  bid: number;
  mid: number | null;
  chainAgeMs: number;
  peak: number;
  observedAtMs: number;
  isBell: boolean;
}): void {
  const { ch, row, accountId, bid, mid, chainAgeMs, peak, observedAtMs, isBell } = input;
  if (!(row.avg_entry_price > 0)) return;
  const retPct = ((bid - row.avg_entry_price) / row.avg_entry_price) * 100;
  const peakPct = ((peak - row.avg_entry_price) / row.avg_entry_price) * 100;
  const durablePeakPct = (((row.peak_mark ?? row.avg_entry_price) - row.avg_entry_price) / row.avg_entry_price) * 100;
  const openedMs = row.opened_at ? Date.parse(row.opened_at) : NaN;
  const minutesHeld = Number.isFinite(openedMs) ? Math.max(0, (observedAtMs - openedMs) / 60_000) : null;
  for (const managerId of managerIdsForChannel(ch.slug)) {
    if (managerId === PB_RIDE_2_MANAGER_ID && row.qty < 2) continue;
    const key = `${row.id}|${managerId}`;
    // Recover only from the peak that pre-dated this process observation. Using
    // the just-computed current peak here would turn a fresh +24 crossing into
    // an imprecise restart assumption instead of observing the real crossing.
    const prior = managerShadowState.get(key) ?? recoverManagerState(managerId, durablePeakPct);
    const result = advanceManager(managerId, prior, retPct, isBell);
    managerShadowState.set(key, result.state);
    if (!result.exit) continue;
    captureManagerShadowObservation({
      channel: ch, position: row, accountId, exit: result.exit, observedAtMs,
      quoteAgeMs: chainAgeMs, bid, mid, currentReturnPct: retPct,
      peakReturnPct: peakPct, minutesHeld,
    });
  }
}
// Orphan safety-net persistence: `${accountId}|${occ}` → consecutive cycles seen UNCOVERED
// (held in a bucket with no open desk row). A 2-cycle gate dodges same-cycle fill→insert races.
const orphanSeen = new Map<string, number>();

// Per-symbol in-memory state (one BarStore + ChainStore each); OCCs are globally
// unique (the ticker is in the OCC root) so account-wide reads stay shared.
const barsBySym = new Map<string, BarStore>(SYMBOLS.map((s) => [s, new BarStore(config.barHistory)]));
const chainBySym = new Map<string, ChainStore>(SYMBOLS.map((s) => [s, new ChainStore()]));
const gammaLogged = new Set<string>(); // `${sym}|${etDate}` — once-per-day gamma-open diagnostic snapshot
let cfg: { fund: store.FundState | null; channels: store.ChannelConfig[]; accounts: store.AccountRow[] } = { fund: null, channels: [], accounts: [] };
let reloadPending = false;
let cycling = false;
// audit 2026-07-11 (1b #8): the fast exit sweep runs on its OWN mutex — it used to share
// `cycling`, so a slow/hung bar-close cycle disabled every safety backstop (halt/EOD/event
// flatten + premium stops) for its whole duration. Now cycle and sweep run CONCURRENTLY;
// the per-row exitGuard below makes a same-row double-exit structurally impossible
// (belt-and-suspenders on execute.ts's deterministic per-row exit coid).
let sweeping = false;
const exitGuard = makeExitGuard();

// audit 2026-07-11 (1b #9) — escalation: consecutive orders-read failure streak per account
// (the bar-close cycle and the fast sweep share it). At ≥3 the operator gets paged once per
// day: the desk is running DEGRADED (entries/adds suppressed; sweep exits limited to the
// mandatory flattens) and KILL still works — halt-flatten needs no order snapshot.
const ordersFailStreak = new Map<string, number>();
function noteOrdersRead(acctId: string, acctName: string, ok: boolean, todayET: string): void {
  if (ok) {
    if (ordersFailStreak.delete(acctId)) alertClear("ordersdown", acctId); // recovered — a later outage re-pages
    return;
  }
  const n = (ordersFailStreak.get(acctId) ?? 0) + 1;
  ordersFailStreak.set(acctId, n);
  if (n >= 3) alertOnce(todayET, "ordersdown", acctId, "⚠ orders API down — exits degraded",
    `${acctName}: ${n} consecutive order-snapshot read failures — entries/adds and price exits suppressed (mandatory flattens still fire); consider KILL`);
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

// ---- accounts (cockpit P3) -------------------------------------------------
// Each channel routes its orders to ONE Alpaca paper account (strategists.account_id
// → accounts row → cred_ref → config.altAccounts creds). A channel with account_id
// NULL routes to the DEFAULT account (the accounts row with cred_ref null = the
// original paper account). An account_id that DOESN'T RESOLVE is fail-closed to a
// never-armed synthetic account (routing.ts — audit 2026-07-10 critical: the old
// fallback-to-default traded acct-2/3 channels through the default keys whenever the
// accounts read failed transiently). Routing logic itself is PURE in routing.ts so
// the invariant is selftest-covered; this wrapper only attaches the Api.
/** The Api for an account, or null if it's a non-default account whose creds are
 *  absent from env — null = SHADOW ONLY (decide+log, never route an order to the
 *  wrong account). The default account always resolves to ACCT1_API. */
function apiForAccount(acct: store.AccountRow): alpaca.Api | null {
  if (!acct.cred_ref) return alpaca.ACCT1_API;
  const creds = config.altAccounts[acct.cred_ref];
  return creds ? alpaca.makeApi(creds.key, creds.secret) : null;
}
type AccountGroup = { account: store.AccountRow; api: alpaca.Api | null; channels: store.ChannelConfig[] };
/** Group channels by their effective account (cockpit P3). */
function groupByAccount(channels: store.ChannelConfig[], accounts: store.AccountRow[]): AccountGroup[] {
  return groupChannelsByAccount(channels, accounts).map((g) => ({ account: g.account, api: apiForAccount(g.account), channels: g.channels }));
}
/** The account id a position row belongs to (via its channel) — for per-account row scoping. */
const rowAccountId = rowAccountIdOf;

interface DecisionExecutionBatch {
  group: AccountGroup;
  symbol: string;
  channels: store.ChannelConfig[];
  decisions: ShadowDecision[];
  lastSession: Bar;
  chain: ChainStore;
  todayET: string;
  barMin: number;
  canManage: boolean;
  canEnter: boolean;
  allOrders: alpaca.AlpacaOrder[];
  ordersFresh: boolean;
  openRows: Map<string, store.PositionRow>;
  alpacaByOcc: Map<string, alpaca.AlpacaPosition>;
  remainingByOcc: Map<string, number>;
  openRowQty: Map<string, number>;
  sourceBarAtMs: number;
  observedAtMs: number;
  executionEligible: boolean;
  executionIneligibleReason: string | null;
}

/** Phase D only. RC3 never invokes this until every account batch has been
 * prepared and the global release arbiter has returned final decisions. */
async function executeDecisionBatch(batch: DecisionExecutionBatch, deskStack: Map<string, number>): Promise<void> {
  const { group: g, symbol: sym, channels: symChannels, decisions: symDecisions,
    lastSession, chain, todayET, barMin, canManage, canEnter, allOrders, ordersFresh,
    openRows, alpacaByOcc, remainingByOcc, openRowQty } = batch;
  if (!canManage) return;
  const barFresh = Date.now() - lastSession.ts < 180_000;
  if (!barFresh) info(`live pass[${g.account.name}/${sym}]: decision bar stale (boot/off-hours) — orders suppressed, bookkeeping only`);
  const exec: ExecCtx = { api: g.api!, accountId: g.account.id, paperMode: cfg.fund?.mode?.toLowerCase() === "paper", decisionAtMs: lastSession.ts, chain, todayET, etMin: barMin, sinceIso: `${todayET}T00:00:00Z`, allOrders, alpacaByOcc, remainingByOcc, openRowQty };
  const bySlug = new Map(symChannels.map((c) => [c.slug, c]));
  for (const d of symDecisions) {
    const ch = bySlug.get(d.slug);
    if (!ch || !ownedBy(ch)) continue;
    if (barFresh) {
      if (d.action === "exit" && d.reason === "event_flatten")
        alertOnce(todayET, "event", "standdown", "⚑ event stand-down", `${d.slug} flattening ${d.occ ?? ""} — entries blocked through the window`);
      if (canEnter) {
        if (d.action === "enter" && d.blocked === "daily_stop")
          alertOnce(todayET, "latch", d.slug, `⛔ ${d.slug} daily stop latched`, `realized ≤ −$${Math.round(ch.daily_stop_usd)} — its entries are done for the day`);
        if (d.action === "enter" && d.blocked === "daily_target")
          alertOnce(todayET, "latch", d.slug, `✅ ${d.slug} banked its day`, `realized ≥ +$${Math.round(ch.daily_target_usd)} — win-and-done, no more entries today`);
        if (d.action === "enter" && d.blocked === "insufficient_capital")
          alertOnce(todayET, "size0", d.slug, `⚠ ${d.slug} sized to ZERO`, `RISK $${Math.round(ch.capital_pct)} can't clear 1 contract (ask too rich) — nudge the knob if the trade was wanted`);
      }
    }
    const row = openRows.get(ch.id);
    let evidenceBlocked = d.blocked ?? null;
    if (!evidenceBlocked && (d.action === "enter" || d.action === "add" || d.action === "exit") && !barFresh)
      evidenceBlocked = "stale_decision_bar";
    else if (!evidenceBlocked && !ordersFresh && d.action !== "hold" && d.action !== "skip" && d.action !== "exit")
      evidenceBlocked = "orders_snapshot_unavailable";
    else if (!evidenceBlocked && (d.action === "enter" || d.action === "add") && !canEnter)
      evidenceBlocked = "account_manage_only";
    else if (!evidenceBlocked && (d.action === "exit" || d.action === "add" || d.action === "reconcile") && !row)
      evidenceBlocked = "position_row_missing";
    captureDecisionObservation({
      channel: ch,
      decision: evidenceBlocked === (d.blocked ?? null) ? d : { ...d, blocked: evidenceBlocked },
      accountId: g.account.id,
      decisionAtMs: lastSession.ts,
      observedAtMs: Date.now(),
      chainAgeMs: chain.ageMs,
    });
    if (!ordersFresh && d.action !== "hold" && d.action !== "skip" && d.action !== "exit") {
      info(`live pass[${g.account.name}/${sym}]: ${d.slug} ${d.action} suppressed — order snapshot unavailable`);
      continue;
    }
    try {
      if (d.action === "reconcile" && row) await executeReconcile(d, row, exec);
      else if (d.action === "exit" && row && !d.blocked && barFresh) {
        if (!exitGuard.claim(row.id)) {
          info(`live pass[${g.account.name}/${sym}]: ${d.slug} exit skipped — an exit for this row is already in flight (sweep)`);
        } else {
          try { await executeExit(d, row, exec, { frac: ch.runner_frac, givebackPct: ch.runner_giveback_pct }, exitQualityPolicyFor(ch)); }
          finally { exitGuard.release(row.id); }
        }
      }
      else if ((d.action === "add" || d.action === "enter") && !canEnter) {
        if (barFresh) info(`live pass[${g.account.name}/${sym}]: ${d.slug} ${d.action} skipped — account not armed for entries (manage-only)`);
      }
      else if (d.action === "add" && row && !d.blocked && barFresh) await executeAdd(d, ch, row, exec);
      else if (d.action === "enter" && barFresh) {
        await executeEntry(d, ch, Number(d.detail?.spotClose ?? lastSession.close), exec);
        if (d.occ && !d.blocked) {
          const k = `${ch.underlying.toUpperCase()}:${d.occ.slice(-9, -8) === "C" ? "call" : "put"}`;
          deskStack.set(k, (deskStack.get(k) ?? 0) + 1);
        }
      }
      else if (d.action === "hold" && row) {
        const alp = alpacaByOcc.get(row.occ_symbol);
        if (alp) {
          noteRowHeld(row.id);
          const unreal = Math.round((alp.current_price - row.avg_entry_price) * row.qty * 10000) / 100;
          await store.markPositionRow(row.id, alp.current_price, unreal);
        }
      }
    } catch (e) { warn(`execute ${d.slug} failed — ${(e as Error).message}`); }
  }
}

// Retry a transient async op with exponential backoff. Used for boot-time REST
// calls so a flaky Alpaca/network moment doesn't crash-loop the container.
async function retry<T>(label: string, fn: () => Promise<T>, attempts = 5, baseMs = 2000): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      if (i < attempts) {
        const delay = Math.min(30_000, baseMs * 2 ** (i - 1));
        warn(`${label}: attempt ${i}/${attempts} failed — ${(e as Error).message}; retry in ${delay}ms`);
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}

async function reloadConfig(): Promise<void> {
  // Halt-transition watch: page the operator when the kill switch / master stop
  // trips while we hold prior state (a boot into an already-halted desk stays
  // quiet — that's known state, not news). Clearing the halt re-opens the slot
  // so a SECOND halt the same day pages again.
  const hadFund = !!cfg.fund;
  const prevHalted = cfg.fund?.is_halted ?? false;
  const c = await store.loadConfig();
  if (c.fund) {
    // Audit 2026-07-10 (critical): a TRANSIENT accounts-read failure must not replace a
    // good routing table with [] — every channel would regroup onto the default account
    // (wrong-account live orders) while the real lots ride unmanaged. Keep the prior
    // table; routing.ts fail-closes any account_id that still can't resolve.
    const accounts = !c.accountsFresh && cfg.accounts.length ? cfg.accounts : c.accounts;
    if (accounts !== c.accounts) warn("config: accounts read stale — keeping the prior routing table");
    const channels = config.day1ReleaseEnabled ? applyDay1ReleaseFleetOverlay(c.channels) : c.channels;
    if (config.day1ReleaseEnabled) {
      const validation = validateDay1ReleaseStartup({
        channels,
        accounts,
        fundMode: c.fund.mode,
        workerVersion: WORKER_VERSION,
        expectedConfigurationSha256: config.day1ReleaseExpectedSha256,
        resolvedCredentialAccountIds: groupByAccount(channels, accounts)
          .filter((group) => group.account.cred_ref
            ? group.api != null
            : !!config.alpacaKey && !!config.alpacaSecret)
          .map((group) => group.account.id),
        posture: {
          alpacaPaperHost: config.alpacaPaperHost,
          stockFeed: config.stockFeed,
          optionFeed: config.optFeed,
          dryRun: config.dryRun,
          liveTrading: config.liveTrading,
          heldCaptureEnabled: config.heldContractCaptureEnabled,
          heldCaptureFlushMs: config.heldContractCaptureFlushMs,
          heldCaptureTargetSamples: config.heldContractCaptureBatchTargetSamples,
          heldCaptureMaxAgeMs: config.heldContractCaptureBatchMaxAgeMs,
          heldCaptureIngressMaxSamples: config.heldContractCaptureMaxSamples,
          heldCaptureIngressMaxBytes: config.heldContractCaptureMaxBytes,
          heldCaptureStateMaxSamples: config.heldContractCaptureStateMaxSamples,
          heldCaptureStateMaxBytes: config.heldContractCaptureStateMaxBytes,
          heldCaptureRetryMaxAttempts: config.heldContractCaptureRetryMaxAttempts,
          heldCaptureRetryBaseDelayMs: config.heldContractCaptureRetryBaseDelayMs,
          heldCaptureRetryMaxDelayMs: config.heldContractCaptureRetryMaxDelayMs,
          heldCaptureAdapterDeadlineMs: HELD_CAPTURE_ADAPTER_REQUEST_TIMEOUT_MS,
          heldCaptureNormalFlushDeadlineMs: HELD_CAPTURE_NORMAL_FLUSH_WALL_CLOCK_MS,
          heldCaptureShutdownDeadlineMs: HELD_CAPTURE_SHUTDOWN_WALL_CLOCK_MS,
          managerShadowEnabled: config.managerShadowBookEnabled,
          managerShadowQuoteMaxAgeMs: config.managerShadowQuoteMaxAgeMs,
        },
      });
      if (!validation.ok) throw new Error(`Day 1 RC3 startup validation failed: ${validation.errors.join(";")}`);
      day1StartupReceipt = validation.activeSettingsReceipt;
    }
    cfg = { fund: c.fund, channels, accounts };
  }
  else warn("config: reload returned no fund_state — keeping previous");
  const nowHalted = cfg.fund?.is_halted ?? false;
  if (hadFund && !prevHalted && nowHalted)
    alertOnce(alpaca.etParts(Date.now()).date, "halt", "fund", "⛔ desk HALTED", "kill switch tripped — entries frozen; FLATTENING every open position at market (within ~10s in RTH, else at the next open)");
  if (prevHalted && !nowHalted) alertClear("halt", "fund");
}

async function refreshChain(sym: string): Promise<void> {
  const chain = chainBySym.get(sym);
  const spot = barsBySym.get(sym)?.latest()?.close ?? 0;
  if (!chain || !spot) return;
  const today = alpaca.etParts(Date.now()).date;
  const toDate = alpaca.etParts(Date.now() + 5 * 24 * 3600 * 1000).date; // captures 0DTE + next session(s)
  try {
    chain.update(await alpaca.snapshotChain(sym, spot, today, toDate));
  } catch (e) {
    warn(`chain[${sym}]: snapshot failed (feed=${config.optFeed}) — ${(e as Error).message}; keeping prior (${chain.size})`);
  }
}

async function seed(): Promise<void> {
  info(`seed: backfilling bars + chain via REST for ${SYMBOLS.join(",")}`);
  for (const sym of SYMBOLS) {
    const bars = barsBySym.get(sym)!;
    // Per-symbol seed is independent — a flaky one symbol must not abort the others.
    try {
      // 7-DAY seed lookback (2026-07-06 fix): 3 calendar days misses the PRIOR SESSION when a
      // boot follows a long weekend (07-06 incident: a 10:02 ET post-Independence-Day reboot
      // seeded only Fri-holiday+weekend+Monday → computeLevels had no prior session → gap AND
      // pdh/pdl undefined → gap_min channels fail-closed stood down on a +0.51% gap day, and
      // `level` conditions never fired). 7 days guarantees ≥1 prior trading session through any
      // holiday cluster; the BarStore cap keeps memory bounded.
      bars.seed(await retry(`seed bars ${sym}`, () => alpaca.backfillBars(sym, 7)));
      const l = bars.latest();
      info(`seed[${sym}]: ${bars.length} bars (latest ${l ? new Date(l.ts).toISOString() : "—"}, spot ${l?.close ?? "?"})`);
      await refreshChain(sym);
      info(`seed[${sym}]: chain ${chainBySym.get(sym)!.size} contracts (feed=${config.optFeed})`);
    } catch (e) { error(`seed[${sym}] failed — ${(e as Error).message}; the websocket will populate bars live`); }
  }
}

// Per-account ORPHAN safety-net (cockpit P3). An Alpaca lot a bucket holds with NO open desk
// row covering it — the desk believes it's flat. Canonical cause: the 2026-06-24 manual-close
// bug (the route sold the DEFAULT account for a Core/Resurrected position → 0 sold, row booked
// closed, the real lot rode on); an insert-failed entry is another. EVERY other worker path keys
// off OPEN desk rows (fast-exit sweep, EOD hard-flatten), so such a lot is otherwise never
// managed. Detect + page ALWAYS; auto-flatten ONLY when armed (config.orphanFlatten) AND the
// bucket is live — flattening live positions on a held-vs-rows heuristic is where reconciliation
// bugs bite, so it's shadow-first. Runs on the PRE-cycle snapshot (same-cycle entries/exits touch
// neither side) + a 2-cycle persistence gate → only true cross-cycle orphans page. Off the trade
// path: the caller wraps it so a failure never breaks the cycle.
async function orphanSweep(
  g: AccountGroup,
  alpacaByOcc: Map<string, alpaca.AlpacaPosition>,
  groupRows: store.PositionRow[],
  canManage: boolean, // 1b #1: orphan-flatten is risk-REDUCING management — runs on a disarmed account too
  todayET: string,
): Promise<void> {
  if (!alpacaByOcc.size) return;
  const covered = new Map<string, number>();
  for (const r of groupRows) covered.set(r.occ_symbol, (covered.get(r.occ_symbol) ?? 0) + Math.abs(Math.round(r.qty)));
  for (const [occ, p] of alpacaByOcc) {
    const held = Math.abs(Math.round(p.qty));
    const uncovered = held - (covered.get(occ) ?? 0);
    const key = `${g.account.id}|${occ}`;
    if (uncovered <= 0) { orphanSeen.delete(key); continue; }
    const seen = (orphanSeen.get(key) ?? 0) + 1;
    orphanSeen.set(key, seen);
    if (seen < 2) continue; // grace: one cycle to let a same-cycle fill→insert settle
    warn(`orphan: ${g.account.name} holds ${uncovered}× ${occ} with no open desk row (held ${held}, desk-open ${covered.get(occ) ?? 0})`);
    await store.journal("WARN", `orphan: ${g.account.name} holds ${uncovered}× ${occ} the desk thinks is flat`, { account: g.account.name, occ, uncovered, held });
    alertOnce(todayET, "orphan", key, "⚠ orphaned lot", `${g.account.name} holds ${uncovered} ${occ} the desk thinks is flat — close it / check the bucket`);
    if (config.orphanFlatten && canManage && g.api) {
      try {
        const o = await alpaca.orderAndFill(
          { symbol: occ, qty: String(uncovered), side: "sell", type: "market", time_in_force: "day", client_order_id: `orphan-${occ}-${Date.now()}` },
          g.api,
        );
        await store.journal("EXEC", `orphan-flatten: ${g.account.name} sold ${o.filledQty}/${uncovered} ${occ} @ ${o.fill.toFixed(2)} (${o.status})`,
          { account: g.account.name, occ, sold: o.filledQty, order_id: o.id });
        if (o.filledQty >= uncovered) orphanSeen.delete(key); // fully cleared; else re-page next round
      } catch (e) {
        await store.journal("WARN", `orphan-flatten ${g.account.name} ${occ} failed — ${(e as Error).message}`);
      }
    }
  }
}

async function cycle(trigger: string): Promise<void> {
  if (cycling) { return; } // never overlap cycles
  cycling = true;
  try {
    if (reloadPending) { reloadPending = false; await reloadConfig(); }
    if (!cfg.fund) { warn(`cycle(${trigger}): missing config — skip`); return; }

    const todayET = alpaca.etParts(Date.now()).date;
    const rthClose = sessionCloseMin(todayET); // 960 normal / 780 half-day (early-close audit fix)
    const live = liveMode();
    const byId = new Map(cfg.channels.map((c) => [c.id, c]));
    const openRowsArr = await store.getOpenPositions(); // spans accounts; scoped per group below
    const sessionPositions = config.day1ReleaseEnabled
      ? await store.loadDay1SessionPositions(`${todayET}T00:00:00Z`)
      : [];
    // C1 STACK CAP input: desk-wide open ROW count by "UNDERLYING:direction" (OCC root = the
    // chars before the 15-char date+type+strike tail). Rebuilt each cycle from DB truth;
    // incremented below on each executed entry so two same-cycle entries can't both slip
    // under the cap. Inert while fund.stack_cap_n = 0 (the dark default).
    const deskStack = new Map<string, number>();
    for (const r of openRowsArr) {
      const k = `${r.occ_symbol.slice(0, r.occ_symbol.length - 15).toUpperCase()}:${r.opt_type}`;
      deskStack.set(k, (deskStack.get(k) ?? 0) + 1);
    }
    if (live) await store.heartbeat(`${WORKER_VERSION} cycle`);
    // Refresh every chain ONCE up front (shared, account-independent) so the per-account
    // passes + the diagnostics pass all read the same fresh NTM snapshot.
    for (const sym of SYMBOLS) await refreshChain(sym);

    const decisions: ShadowDecision[] = [];
    const familyAdmissionInputs: FamilyAdmissionInput[] = [];
    const releaseBatches: DecisionExecutionBatch[] = [];
    const releaseBoundAccountIds = new Set(DAY1_ROOT_BINDINGS.map((binding) => binding.accountId));
    const releaseObservedAccountIds = new Set<string>();
    const releaseBrokerPositions: Day1BrokerHolding[] = [];
    const releasePendingOrders: Day1PendingOrderOccupancy[] = [];
    const releaseAccountIdByStrategist = new Map<string, string>();
    let releasePositionSnapshotComplete = true;
    let releaseOrderSnapshotComplete = true;
    const releaseSnapshotFailures: Day1SnapshotFailure[] = [];
    const releaseOrderFailureAccountIds = new Set<string>();
    let totEquity = 0, totCash = 0, totUnreal = 0, snappedAny = false;
    // Per-account orphan-sweep inputs, captured on each bucket's PRE-cycle snapshot and swept
    // AFTER the decision pass (so same-cycle entries/exits don't false-positive).
    const sweepInputs: { g: AccountGroup; alpacaByOcc: Map<string, alpaca.AlpacaPosition>; groupRows: store.PositionRow[]; canManage: boolean }[] = [];

    // ---- PER-ACCOUNT pass (cockpit P3) ----
    // Each bucket reads ITS OWN positions/orders/equity (the same OCC can be held in two
    // accounts as separate lots — netting must be per-account) and executes only its own
    // channels via its own Api. A bucket whose creds are absent is fully decided +
    // shadow-logged but places NO orders — the shadow-first gate. A NON-ARMED bucket with
    // creds is MANAGE-ONLY (1b #1): exits/reconcile/marks run, entries/adds don't.
    for (const g of groupByAccount(cfg.channels, cfg.accounts)) {
      for (const channel of g.channels) releaseAccountIdByStrategist.set(channel.id, g.account.id);
      const api = g.api;
      let account: alpaca.AlpacaAccount = { equity: 0, cash: 0 };
      let positions: alpaca.AlpacaPosition[] = [];
      let accountFresh = true;
      let positionsFresh = true;
      const isReleaseBoundAccount = releaseBoundAccountIds.has(g.account.id);
      if (isReleaseBoundAccount) releaseObservedAccountIds.add(g.account.id);
      if (api) {
        try { account = await alpaca.getAccount(api); }
        catch (e) {
          accountFresh = false;
          if (isReleaseBoundAccount) {
            releasePositionSnapshotComplete = false;
            releaseSnapshotFailures.push({ accountId: g.account.id, kind: "account" });
          }
          warn(`cycle(${trigger}): account ${g.account.name} account read failed — ${(e as Error).message}; new RC3 admissions fail closed, risk-reducing management continues where safe`);
        }
        try { positions = await alpaca.getPositions(api); }
        catch (e) {
          positionsFresh = false;
          if (isReleaseBoundAccount) {
            releasePositionSnapshotComplete = false;
            releaseSnapshotFailures.push({ accountId: g.account.id, kind: "positions" });
          }
          warn(`cycle(${trigger}): account ${g.account.name} position read failed — ${(e as Error).message}; new RC3 admissions fail closed, risk-reducing management continues where safe`);
        }
      } else {
        accountFresh = false;
        positionsFresh = false;
        if (isReleaseBoundAccount) {
          releasePositionSnapshotComplete = false;
          releaseSnapshotFailures.push({ accountId: g.account.id, kind: "account" }, { accountId: g.account.id, kind: "positions" });
        }
        warn(`cycle(${trigger}): account ${g.account.name} (cred_ref ${g.account.cred_ref}) has no creds in env — shadow only`);
      }
      if (isReleaseBoundAccount && positionsFresh) {
        for (const position of positions) {
          const match = /^([A-Z]+)\d{6}[CP]\d{8}$/i.exec(position.symbol);
          if (!match || !(Math.abs(position.qty) > 0)) continue;
          releaseBrokerPositions.push({
            accountId: g.account.id,
            occSymbol: position.symbol.toUpperCase(),
            underlying: match[1].toUpperCase(),
            quantity: Math.abs(position.qty),
          });
        }
      }
      const alpacaByOcc = new Map(positions.map((p) => [p.symbol, p]));
      const groupRows = openRowsArr.filter((r) => rowAccountId(r, byId, cfg.accounts) === g.account.id);
      const openRows = new Map(groupRows.map((r) => [r.strategist_id, r]));
      // audit 2026-07-11 (1b #1): is_armed = ENTRIES ONLY (operator decision — see routing.ts).
      // canManage (live + creds resolve + not the fail-closed unresolved account) gates the
      // whole read/execute pass below, so a DISARMED (or halted) account keeps running exits,
      // reconcile, marks and the orphan sweep — its open positions never lose stop/EOD/event
      // protection. canEnter (adds is_armed + !is_halted) gates only enter/add decisions.
      const canManage = acctCanManage(g.account, live, api != null);
      const canEnter = acctCanEnter(g.account, live, api != null);
      sweepInputs.push({ g, alpacaByOcc, groupRows, canManage }); // orphan net (swept post-decision)
      let allOrders: alpaca.AlpacaOrder[] = [];
      let ordersFresh = true; // audit 2026-07-10: the idempotency / lost-insert guards are BLIND without the order snapshot
      let remainingByOcc = new Map<string, number>();
      const openRowQty = new Map<string, number>();
      if (canManage) {
        // audit 2026-07-11 (1b #9): bounded retry (3 × ~500ms backoff, the boot retry() shape)
        // so a transient orders-API blip never even degrades the cycle; a persistent failure
        // still lands in the !ordersFresh path below + the noteOrdersRead escalation.
        try {
          allOrders = await retry(`cycle orders ${g.account.name}`, () => alpaca.getOrders(500, api!, new Date(Date.parse(`${todayET}T00:00:00Z`) - 2 * 86_400_000).toISOString()), 3, 500);
          if (config.day1ReleaseEnabled && isReleaseBoundAccount) {
            for (const order of allOrders) {
              const match = /^([A-Z]+)\d{6}[CP]\d{8}$/i.exec(order.symbol);
              if (!match || order.side.toLowerCase() !== "buy" || alpaca.TERMINAL_ORDER_STATUS.has(order.status)) continue;
              releasePendingOrders.push({ accountId: g.account.id, occSymbol: order.symbol.toUpperCase(), underlying: match[1].toUpperCase() });
            }
          }
          noteOrdersRead(g.account.id, g.account.name, true, todayET);
        }
        catch (e) {
          ordersFresh = false;
          if (config.day1ReleaseEnabled && isReleaseBoundAccount) {
            releaseOrderSnapshotComplete = false;
            releaseOrderFailureAccountIds.add(g.account.id);
          }
          noteOrdersRead(g.account.id, g.account.name, false, todayET);
          warn(`cycle(${trigger}): ${g.account.name} order read failed — ${(e as Error).message}; entries/adds/reconcile suppressed this cycle (exits still run)`);
        }
        remainingByOcc = seedRemaining(positions);
        for (const r of groupRows) openRowQty.set(r.occ_symbol, (openRowQty.get(r.occ_symbol) ?? 0) + Math.abs(Math.round(r.qty)));
      }

      // Per-symbol: each symbol decides on ITS last RTH bar against ITS own bars/chain.
      for (const sym of SYMBOLS) {
        const symChannels = g.channels.filter((c) => c.underlying.toUpperCase() === sym);
        if (!symChannels.length) continue;
        const bars = barsBySym.get(sym)!;
        const sessionBars = buildSessionBars(bars.all(), todayET);
        const lastSession = sessionBars[sessionBars.length - 1];
        if (!lastSession) continue; // this symbol has no RTH bars yet
        const barMin = alpaca.etParts(lastSession.ts).min;
        const minutesToClose = Math.max(0, rthClose - barMin);
        const chain = chainBySym.get(sym)!;
        const ctx: DecisionCtx = {
          sessionBars, chain, fund: cfg.fund, equity: account.equity, todayET,
          minutesToClose, // BAR-relative (strategy intents); wall-clock below is bars-independent
          wallMinutesToClose: Math.max(0, rthClose - alpaca.etParts(Date.now()).min),
          rthCloseMin: rthClose,
          next1DTE: chain.nextExpiryAfter(todayET),
          ...computeLevels(bars.all(), todayET),
          openRows, alpacaByOcc,
          allOrders, // empty unless canManage — the PYRAMID executor reconstructs the lot stack from it
          deskStack, // C1 stack-cap input (desk-wide, cycle-scoped)
        };
        const evaluatedDecisions: ShadowDecision[] = [];
        for (const ch of symChannels) {
          try { evaluatedDecisions.push(await decideChannel(ch, ctx)); }
          catch (e) { warn(`decide ${ch.slug} failed — ${(e as Error).message}`); }
        }
        const familyObservedAtMs = Date.now();
        const symDecisions = config.day1ReleaseEnabled
          ? prepareDay1ReleaseAdmission({
              channels: symChannels,
              decisions: evaluatedDecisions,
              accountId: g.account.id,
              sourceBarAtMs: lastSession.ts,
              observedAtMs: familyObservedAtMs,
              currentEtMinute: alpaca.etParts(Date.now()).min,
              sessionCloseEtMinute: rthClose,
              sessionLedgerReady: sessionPositions != null,
            })
          : evaluatedDecisions;
        const barFresh = Date.now() - lastSession.ts < 180_000;
        const executionEligible = live && accountFresh && positionsFresh && ordersFresh && canEnter && barFresh;
        const executionIneligibleReason = executionEligible ? null
          : !live ? "day1_shadow_rehearsal"
          : !accountFresh || !positionsFresh ? "day1_global_snapshot_incomplete"
          : !ordersFresh ? "day1_global_orders_incomplete"
          : !canEnter ? "day1_account_manage_only"
          : "day1_stale_decision_bar";
        const executionBatch: DecisionExecutionBatch = {
          group: g, symbol: sym, channels: symChannels, decisions: symDecisions,
          lastSession, chain, todayET, barMin, canManage, canEnter, allOrders, ordersFresh,
          openRows, alpacaByOcc, remainingByOcc, openRowQty,
          sourceBarAtMs: lastSession.ts, observedAtMs: familyObservedAtMs,
          executionEligible, executionIneligibleReason,
        };
        if (config.day1ReleaseEnabled) {
          releaseBatches.push(executionBatch);
          continue;
        }
        decisions.push(...symDecisions);
        for (const decision of symDecisions) {
          const channel = symChannels.find((candidate) => candidate.slug === decision.slug);
          if (channel) familyAdmissionInputs.push({
            channel, accountId: g.account.id, decision,
            sourceBarAtMs: lastSession.ts, observedAtMs: familyObservedAtMs,
          });
        }

        // ---- PHASE B: EXECUTE the decisions for channels this worker OWNS ----
        // 1b #1: the block runs under canManage (exits/reconcile/marks on any account whose
        // creds resolve, armed or not); enter/add are individually gated on canEnter below.
        if (canManage) {
          // STALE-BAR ORDER GUARD (per symbol): a boot/restart decides on the last KNOWN
          // bar — orders need a fresh decision bar; reconcile + mark are always safe.
          const barFresh = Date.now() - lastSession.ts < 180_000;
          if (!barFresh) info(`live pass[${g.account.name}/${sym}]: decision bar stale (boot/off-hours) — orders suppressed, bookkeeping only`);
          const exec: ExecCtx = { api: api!, accountId: g.account.id, paperMode: cfg.fund?.mode?.toLowerCase() === "paper", decisionAtMs: lastSession.ts, chain, todayET, etMin: barMin, sinceIso: `${todayET}T00:00:00Z`, allOrders, alpacaByOcc, remainingByOcc, openRowQty };
          const bySlug = new Map(symChannels.map((c) => [c.slug, c]));
          for (const d of symDecisions) {
            const ch = bySlug.get(d.slug);
            if (!ch || !ownedBy(ch)) continue;
            // "The desk summons you" — informational pages (once per day per key; never alters execution).
            if (barFresh) {
              if (d.action === "exit" && d.reason === "event_flatten")
                alertOnce(todayET, "event", "standdown", "⚑ event stand-down", `${d.slug} flattening ${d.occ ?? ""} — entries blocked through the window`);
              // entry-latch pages only where entries can actually happen (1b #1: a manage-only
              // account's blocked entries are expected, not news).
              if (canEnter) {
                if (d.action === "enter" && d.blocked === "daily_stop")
                  alertOnce(todayET, "latch", d.slug, `⛔ ${d.slug} daily stop latched`, `realized ≤ −$${Math.round(ch.daily_stop_usd)} — its entries are done for the day`);
                if (d.action === "enter" && d.blocked === "daily_target")
                  alertOnce(todayET, "latch", d.slug, `✅ ${d.slug} banked its day`, `realized ≥ +$${Math.round(ch.daily_target_usd)} — win-and-done, no more entries today`);
                if (d.action === "enter" && d.blocked === "insufficient_capital")
                  alertOnce(todayET, "size0", d.slug, `⚠ ${d.slug} sized to ZERO`, `RISK $${Math.round(ch.capital_pct)} can't clear 1 contract (ask too rich) — nudge the knob if the trade was wanted`);
              }
            }
            const row = openRows.get(ch.id);
            // Phase 1D: record the actionable decision plus any infrastructure
            // suppression that prevents it reaching the broker. Routine hold/skip
            // ticks are rejected by the pure model to avoid telemetry flooding.
            let evidenceBlocked = d.blocked ?? null;
            if (!evidenceBlocked && (d.action === "enter" || d.action === "add" || d.action === "exit") && !barFresh)
              evidenceBlocked = "stale_decision_bar";
            else if (!evidenceBlocked && !ordersFresh && d.action !== "hold" && d.action !== "skip" && d.action !== "exit")
              evidenceBlocked = "orders_snapshot_unavailable";
            else if (!evidenceBlocked && (d.action === "enter" || d.action === "add") && !canEnter)
              evidenceBlocked = "account_manage_only";
            else if (!evidenceBlocked && (d.action === "exit" || d.action === "add" || d.action === "reconcile") && !row)
              evidenceBlocked = "position_row_missing";
            captureDecisionObservation({
              channel: ch,
              decision: evidenceBlocked === (d.blocked ?? null) ? d : { ...d, blocked: evidenceBlocked },
              accountId: g.account.id,
              decisionAtMs: lastSession.ts,
              observedAtMs: Date.now(),
              chainAgeMs: chain.ageMs,
            });
            // No order snapshot → entry idempotency / lost-insert recovery / reconcile pricing
            // are all blind (audit 2026-07-10: an empty allOrders made the 09d guard silently
            // pass and re-buy an orphan lot) — those stay suppressed. EXITS now PROCEED (audit
            // 2026-07-11, 1b #9): they're risk-REDUCING and route through executeExit, whose
            // deterministic per-row coid (Alpaca rejects a duplicate) + min(held,row) sell-cap
            // + status-guarded close make a degraded re-issue safe even blind to late fills.
            if (!ordersFresh && d.action !== "hold" && d.action !== "skip" && d.action !== "exit") {
              info(`live pass[${g.account.name}/${sym}]: ${d.slug} ${d.action} suppressed — order snapshot unavailable`);
              continue;
            }
            try {
              if (d.action === "reconcile" && row) await executeReconcile(d, row, exec);
              else if (d.action === "exit" && row && !d.blocked && barFresh) {
                // 1b #8: per-row claim — the sweep runs concurrently now; if it already holds
                // this row's exit, skip (never wait). Release in finally so a throw can't wedge.
                if (!exitGuard.claim(row.id)) {
                  info(`live pass[${g.account.name}/${sym}]: ${d.slug} exit skipped — an exit for this row is already in flight (sweep)`);
                } else {
                  try { await executeExit(d, row, exec, { frac: ch.runner_frac, givebackPct: ch.runner_giveback_pct }, exitQualityPolicyFor(ch)); }
                  finally { exitGuard.release(row.id); }
                }
              }
              // 1b #1: is_armed (and per-account halt) gates NEW RISK only — a manage-only
              // account skips enter/add here while every exit/reconcile/mark above kept running.
              else if ((d.action === "add" || d.action === "enter") && !canEnter) {
                if (barFresh) info(`live pass[${g.account.name}/${sym}]: ${d.slug} ${d.action} skipped — account not armed for entries (manage-only)`);
              }
              else if (d.action === "add" && row && !d.blocked && barFresh) await executeAdd(d, ch, row, exec); // PYRAMID (pyramid_adds>0)
              else if (d.action === "enter" && barFresh) {
                await executeEntry(d, ch, Number(d.detail?.spotClose ?? lastSession.close), exec);
                // C1 within-cycle increment: count this entry toward the desk-wide stack so a
                // later same-cycle channel sees it. Conservative over-count if the order 0-filled
                // (rebuilt from DB truth next cycle); only LIVE executed entries count — shadow
                // buckets place no orders and never increment.
                if (d.occ && !d.blocked) {
                  const k = `${ch.underlying.toUpperCase()}:${d.occ.slice(-9, -8) === "C" ? "call" : "put"}`;
                  deskStack.set(k, (deskStack.get(k) ?? 0) + 1);
                }
              }
              else if (d.action === "hold" && row) {
                const alp = alpacaByOcc.get(row.occ_symbol);
                if (alp) {
                  noteRowHeld(row.id); // row is held → reset any pending reconcile count (2-cycle gate)
                  const unreal = Math.round((alp.current_price - row.avg_entry_price) * row.qty * 10000) / 100;
                  await store.markPositionRow(row.id, alp.current_price, unreal);
                }
              }
            } catch (e) { warn(`execute ${d.slug} failed — ${(e as Error).message}`); }
          }
        }
      }

      // Per-account equity snapshot (tagged account_id → clean per-bucket forward NAV).
      if (live && api) {
        const unreal = positions.reduce((a, p) => a + p.unrealized_pl, 0);
        totEquity += account.equity; totCash += account.cash; totUnreal += unreal; snappedAny = true;
        try { await store.insertEquitySnapshot(account.equity, account.cash, unreal, g.account.id); }
        catch (e) { warn(`equity snapshot[${g.account.name}] failed — ${(e as Error).message}`); }
      }
    }

    // ---- RC3 PHASES B/C/D: broker-truth state, one global arbiter, then execution ----
    // No release entry can reach executeDecisionBatch above: release batches take
    // the `continue` path until every account/symbol has been evaluated and stamped.
    if (config.day1ReleaseEnabled) {
      for (const accountId of releaseBoundAccountIds) {
        if (!releaseObservedAccountIds.has(accountId)) {
          releasePositionSnapshotComplete = false;
          releaseSnapshotFailures.push({ accountId, kind: "account-group-missing" });
        }
      }
      const releaseState = buildDay1AdmissionState({
        openPositions: openRowsArr,
        sessionPositions: sessionPositions ?? [],
        channelById: byId,
        accountIdByStrategist: releaseAccountIdByStrategist,
        brokerPositions: releaseBrokerPositions,
        pendingOrders: releasePendingOrders,
      });
      const prepared = releaseBatches.flatMap((batch) => batch.decisions.map((decision) => ({
        accountId: batch.group.account.id,
        sourceBarAtMs: batch.sourceBarAtMs,
        decision,
        executionEligible: batch.executionEligible,
        executionIneligibleReason: batch.executionIneligibleReason,
      })));
      const finalized = finalizeDay1ReleaseAdmissions({
        prepared,
        state: releaseState,
        posture: live ? "paper-executor" : "shadow-counterfactual",
        globalPositionSnapshotComplete: releasePositionSnapshotComplete,
        globalOrderSnapshotComplete: !live || releaseOrderSnapshotComplete,
        globalSnapshotFailures: releaseSnapshotFailures,
        globalOrderFailureAccountIds: [...releaseOrderFailureAccountIds].sort(),
      });
      let cursor = 0;
      for (const batch of releaseBatches) {
        batch.decisions = finalized.slice(cursor, cursor + batch.decisions.length).map((row) => row.decision);
        cursor += batch.decisions.length;
        decisions.push(...batch.decisions);
        for (const decision of batch.decisions) {
          const channel = batch.channels.find((candidate) => candidate.slug === decision.slug);
          if (channel) familyAdmissionInputs.push({
            channel,
            accountId: batch.group.account.id,
            decision,
            sourceBarAtMs: batch.sourceBarAtMs,
            observedAtMs: batch.observedAtMs,
          });
        }
      }
      if (cursor !== finalized.length) throw new Error("Day 1 RC3 arbitration mapping mismatch");
      for (const batch of releaseBatches) await executeDecisionBatch(batch, deskStack);
    }

    // ---- SHARED diagnostics, once per symbol (account-independent) ----
    for (const sym of SYMBOLS) {
      const bars = barsBySym.get(sym)!;
      const sessionBars = buildSessionBars(bars.all(), todayET);
      const lastSession = sessionBars[sessionBars.length - 1];
      if (!lastSession) continue;
      const barMin = alpaca.etParts(lastSession.ts).min;
      const minutesToClose = Math.max(0, rthClose - barMin);
      const chain = chainBySym.get(sym)!;
      // ---- gamma-open diagnostic (frontier #3, SHADOW-ONLY collect-forward) ----
      try {
        const gk = `${sym}|${todayET}`;
        if (barMin >= 575 && barMin <= 600 && !gammaLogged.has(gk)) {
          gammaLogged.add(gk);
          const spot = lastSession.close, k = Math.round(spot);
          const call = chain.byOcc(alpaca.occSymbol(sym, todayET, k, "call"));
          const put = chain.byOcc(alpaca.occSymbol(sym, todayET, k, "put"));
          if (call && put && call.mid > 0 && put.mid > 0) {
            const imPct = ((call.mid + put.mid) / spot) * 100;
            void store.writeShadowEvent(`gamma-open ${sym} — im ${imPct.toFixed(2)}% delta ${call.delta != null ? call.delta.toFixed(2) : "?"} spot ${spot.toFixed(2)}`,
              { kind: "gamma-open", sym, etMin: barMin, spot: Math.round(spot * 100) / 100, strike: k, callMid: call.mid, putMid: put.mid, impliedMovePct: Math.round(imPct * 1000) / 1000, callDelta: call.delta, putDelta: put.delta });
          }
        }
      } catch (e) { warn(`gamma-open[${sym}] failed — ${(e as Error).message}`); }
      // Shadow MANAGEMENT what-if: scale/BE/trail over THIS symbol's live positions (all
      // buckets) on its real-time quote (logs managed-vs-actual; no orders). ALWAYS call —
      // the ride-to-close override finalize must run at the 15:25 flatten.
      try {
        const symRows = openRowsArr.filter((r) => byId.get(r.strategist_id)?.underlying.toUpperCase() === sym);
        await updateShadowManagement({
          rows: symRows,
          slugById: new Map(cfg.channels.filter((c) => c.underlying.toUpperCase() === sym).map((c) => [c.id, c.slug])),
          sym,
          chain, sessionBars,
          atr: computeFeatures(sessionBars, sessionBars.length - 1).atr,
          etMin: barMin, minutesToClose,
        });
      } catch (e) { warn(`shadow-management[${sym}] failed — ${(e as Error).message}`); }
    }

    captureFamilyAdmissionObservations(familyAdmissionInputs);
    report(trigger, totEquity, decisions);
    // Orphan safety-net: flag (and, when armed, flatten) Alpaca lots the desk thinks are flat.
    // Live-only (no pages on shadow/boot); each sweep is isolated so it can never break the cycle.
    if (live) for (const si of sweepInputs) {
      try { await orphanSweep(si.g, si.alpacaByOcc, si.groupRows, si.canManage, todayET); }
      catch (e) { warn(`orphan-sweep[${si.g.account.name}] failed — ${(e as Error).message}`); }
    }
    // Desk-wide TOTAL snapshot (account_id null = the sum across buckets) — the existing
    // dashboard equity curve reads the null rows; per-bucket rows are tagged above.
    if (live && snappedAny) { try { await store.insertEquitySnapshot(totEquity, totCash, totUnreal, null); } catch (e) { warn(`equity snapshot[total] failed — ${(e as Error).message}`); } }
  } catch (e) {
    // A cycle must never throw — it's fired forget-style from onBar, so an
    // unhandled rejection would otherwise take down the process.
    warn(`cycle(${trigger}) failed — ${(e as Error).message}`);
  } finally {
    cycling = false;
  }
}

function report(trigger: string, equity: number, ds: ShadowDecision[]): void {
  const act = ds.filter((d) => d.action === "enter" || d.action === "exit" || d.action === "reconcile" || d.action === "add");
  shadow(`cycle (${trigger}) equity $${Math.round(equity)} — ${ds.length} ch [${SYMBOLS.join("+")}], ${act.length} actionable`);
  for (const d of ds) {
    if (d.action === "add") {
      shadow(`  ${d.slug}: PYRAMID add ${d.occ} ×${d.qty} — WOULD ADD [${d.reason}]`, d.detail);
      void store.writeShadowEvent(`${d.slug} PYRAMID add ${d.occ} ×${d.qty} (${d.reason})`, d.detail);
    } else if (d.action === "enter") {
      const verb = d.blocked ? `BLOCKED(${d.blocked})` : `WOULD BUY ×${d.qty}`;
      shadow(`  ${d.slug}: ENTER ${d.direction} ${d.occ} — ${verb} [${d.reason}]`, d.detail);
      void store.writeShadowEvent(`${d.slug} ENTER ${d.direction} ${d.occ} — ${d.blocked ? `blocked:${d.blocked}` : `qty:${d.qty}`} (${d.reason})`, d.detail);
    } else if (d.action === "exit") {
      shadow(`  ${d.slug}: EXIT ${d.occ} ×${d.qty} — ${d.blocked ? `BLOCKED(${d.blocked})` : "WOULD SELL"} [${d.reason}]`, d.detail);
      void store.writeShadowEvent(`${d.slug} EXIT ${d.occ} ×${d.qty} (${d.reason})`, d.detail);
    } else if (d.action === "reconcile") {
      shadow(`  ${d.slug}: RECONCILE ${d.occ} — orphan desk row (Alpaca flat)`, d.detail);
    }
  }
}

// ---- PHASE B: fast EXIT sweep -------------------------------------------------
// Between bar closes (every FAST_EXIT_SEC) check the PREMIUM-side exits for
// stream-owned open positions on the LIVE chain: catastrophic stop, compiled
// stop/target, power giveback, the manual-twin bell backstop. Underlying-side
// exits (ustop / chandelier / strategy intents) stay on the bar-close cycle —
// they're defined on bars. This is the structural latency win over the minute
// cron: a crossed stop fires within seconds, not at the next minute boundary.
// PRICE BASIS (audit 2026-07-11, 1b #6): every price trigger + the MFE/MAE peak
// state evaluates the fresh EXECUTABLE BID (we sell to close); mid = diagnostic.
async function fastExitSweep(): Promise<void> {
  // audit 2026-07-11 (1b #8): OWN mutex — the sweep used to bail on (and hold) the full-cycle
  // `cycling` flag, so a slow or HUNG bar-close cycle silenced every backstop below (halt/EOD/
  // event flatten + premium stops), and a wedged sweep blocked cycles right back. Now the sweep
  // only guards against overlapping ITSELF; alpaca.ts's bounded fetches (15s abort) guarantee
  // neither loop can hold its mutex forever, and the per-row exitGuard prevents the now-
  // concurrent cycle + sweep from double-exiting one row.
  if (!liveMode() || sweeping) return;
  sweeping = true;
  try {
    // audit 2026-07-11 (1b #7): consume a pending config reload HERE too — is_halted was only
    // read into cfg by cycle()'s consume, so a KILL flipped mid-bar waited up to a full bar
    // (~60s) before the flatten path could see it. The sweep runs every ~10s, so the halt now
    // bites within one sweep. Skip when a cycle is mid-flight (it consumes on its own; a lost
    // reload just waits for the next 10s tick / 30s poll — reloadPending is re-set on failure).
    if (reloadPending && !cycling) {
      reloadPending = false;
      try { await reloadConfig(); }
      catch (e) { reloadPending = true; warn(`fast-exit: config reload failed — ${(e as Error).message}; retrying next sweep`); }
    }
    const nowMin = alpaca.etParts(Date.now()).min;
    const todayET = alpaca.etParts(Date.now()).date;
    const rthClose = sessionCloseMin(todayET); // 960 normal / 780 half-day — the sweep must stop AT the real close
    if (nowMin < RTH_OPEN || nowMin >= rthClose) return;
    const owned = cfg.channels.filter(ownedBy);
    if (!owned.length || !cfg.fund) return;
    await store.heartbeat(`${WORKER_VERSION} sweep`);
    if (cfg.fund.mode !== "paper") return; // a non-paper mode freezes everything (live-$ safety wall)
    // KILL = FLATTEN (operator's word, 2026-07-01): flipping the kill switch closes every open
    // stream-owned position at MARKET — within one ~10s sweep during RTH, or at the first sweep
    // after the next open if tripped off-hours. Entries stay frozen (decide.ts entryGuard);
    // the bar-close exit path stays frozen too (this sweep owns the flatten). Per-account
    // is_halted does the same for just that bucket. Replaces the old freeze-everything
    // semantics, which stranded same-day 0DTEs through the bell (audit M3).
    const haltFlatten = cfg.fund.is_halted;
    const byId = new Map(cfg.channels.map((c) => [c.id, c]));
    const allRows = (await store.getOpenPositions()).filter((r) => owned.some((c) => c.id === r.strategist_id));
    if (!allRows.length) return;
    // refresh only the chains for symbols that have owned open positions
    const activeSyms = new Set(allRows.map((r) => byId.get(r.strategist_id)!.underlying.toUpperCase()));
    for (const sym of activeSyms) await refreshChain(sym);
    // Per-account (cockpit P3): only ARMED buckets with resolved creds sweep; each reads its OWN
    // positions/orders so an exit sells the right account's lot (the same OCC can live in two).
    for (const g of groupByAccount(owned, cfg.accounts)) {
      const api = g.api;
      // A halted bucket is NOT skipped anymore — it enters flatten mode below (kill = close all).
      // 1b #1 (audit 2026-07-11): is_armed dropped too — the sweep is EXITS-ONLY, and a
      // DISARMED account's open positions must keep their halt/EOD/event + price exits
      // (is_armed used to strand them here until re-arm). Creds must still resolve (!api →
      // skip: never a wrong-account order; the unresolved account's api is null by design).
      if (!api) continue;
      const acctFlatten = haltFlatten || g.account.is_halted;
      const rows = allRows.filter((r) => rowAccountId(r, byId, cfg.accounts) === g.account.id);
      if (!rows.length) continue;
      // audit 2026-07-11 (1b #9): SPLIT reads — the old single Promise.all `continue`d the whole
      // bucket on ANY failure, so an orders-API blip meant NO exits fired anywhere. Positions are
      // load-bearing for every sell (sellQty = min(held, row)) → a failed positions read still
      // skips the bucket. A failed ORDERS read only DEGRADES the pass: the mandatory operator/
      // calendar flattens below still run (each fires at most once per row per pass; executeExit's
      // min(held,row) sell-cap + deterministic per-row coid — Alpaca rejects duplicates — bound
      // the damage even with an empty allOrders), while ordinary price-triggered exits stay
      // suppressed (they need the snapshot for late-fill recovery / working-order idempotency).
      let positions: alpaca.AlpacaPosition[] = [], allOrders: alpaca.AlpacaOrder[] = [];
      let ordersFresh = true;
      const ordersAfterIso = new Date(Date.parse(`${todayET}T00:00:00Z`) - 2 * 86_400_000).toISOString();
      try { positions = await retry(`fast-exit positions ${g.account.name}`, () => alpaca.getPositions(api), 3, 500); }
      catch (e) { warn(`fast-exit[${g.account.name}] positions read failed — ${(e as Error).message}; skip bucket`); continue; }
      try {
        allOrders = await retry(`fast-exit orders ${g.account.name}`, () => alpaca.getOrders(500, api, ordersAfterIso), 3, 500);
        noteOrdersRead(g.account.id, g.account.name, true, todayET);
      } catch (e) {
        ordersFresh = false;
        noteOrdersRead(g.account.id, g.account.name, false, todayET);
        warn(`fast-exit[${g.account.name}] orders read failed — ${(e as Error).message}; DEGRADED pass (mandatory flattens only)`);
      }
      const alpacaByOcc = new Map(positions.map((p) => [p.symbol, p]));
      const remainingByOcc = seedRemaining(positions);
      const openRowQty = new Map<string, number>();
      for (const r of rows) openRowQty.set(r.occ_symbol, (openRowQty.get(r.occ_symbol) ?? 0) + Math.abs(Math.round(r.qty)));
      for (const r of rows) {
      const ch = byId.get(r.strategist_id)!;
      const chain = chainBySym.get(ch.underlying.toUpperCase());
      const exec: ExecCtx = { api, accountId: g.account.id, paperMode: cfg.fund?.mode?.toLowerCase() === "paper", decisionAtMs: Date.now(), chain: chain!, todayET, etMin: nowMin, sinceIso: `${todayET}T00:00:00Z`, allOrders, alpacaByOcc, remainingByOcc, openRowQty };
      // ---- KILL/HALT FLATTEN (operator's word, 2026-07-01): close EVERYTHING at market ----
      // Highest priority — runs before every other exit check, incl. the manual twins (a kill
      // switch overrides the human-owns-exits experiment; safety beats the A/B). executeExit's
      // idempotency (working-order check, min(held,row), status-guarded close) makes the 10s
      // retry loop safe until each row books; a rejected/drained lot reconciles via 09b.
      // MANDATORY flatten (1b #9: runs even on a degraded orders pass — sweepExitAllowed('halt_flatten', ·) is always true).
      // 1b #8: per-row exitGuard claim on every sweep exit — the concurrent cycle may hold this row.
      if (acctFlatten) {
        info(`halt-flatten: ${ch.slug} ${r.occ_symbol} ×${r.qty} — kill switch (${haltFlatten ? "fund" : g.account.name})`);
        if (exitGuard.claim(r.id)) {
          try { await executeExit({ slug: ch.slug, status: ch.status, action: "exit", reason: "halt_flatten" }, r, exec, undefined, exitQualityPolicyFor(ch)); }
          catch (e) { warn(`halt-flatten ${ch.slug} failed — ${(e as Error).message}`); }
          finally { exitGuard.release(r.id); }
        }
        clearSweepPriceState(r.id);
        continue;
      }
      // Ratified Day 1 wall-clock close: stop admissions and flatten release
      // roots 35 minutes before the actual session close (15:25 on a normal
      // session). This is bars-independent and remains mandatory if the orders
      // snapshot is degraded.
      if (config.day1ReleaseEnabled && day1ReleaseEodDue(ch.slug, nowMin, rthClose)) {
        info(`day1-eod-flatten: ${ch.slug} ${r.occ_symbol} ×${r.qty} — release close, wall-clock mtc ${Math.max(0, rthClose - nowMin)}`);
        if (exitGuard.claim(r.id)) {
          try { await executeExit({ slug: ch.slug, status: ch.status, action: "exit", reason: "day1_eod_flatten" }, r, exec, undefined, exitQualityPolicyFor(ch)); }
          catch (e) { warn(`day1-eod-flatten ${ch.slug} failed — ${(e as Error).message}`); }
          finally { exitGuard.release(r.id); }
        }
        clearSweepPriceState(r.id);
        continue;
      }
      // ---- EOD HARD-FLATTEN backstop (wall-clock; 2026-06-19 Juneteenth strand fix) ----
      // The strategy's same-day flatten is BAR-relative, so a gapped near-bell bar (06-18: no
      // 15:59 print) means it never fires and the position strands — over a 3-day weekend if a
      // holiday follows. This sweep is a 10s WALL-CLOCK timer that runs even when bars stop, so
      // it force-flattens a SAME-SESSION machine position with margin while the market is still
      // open. Reuses executeExit → inherits the shared-OCC sell-cap + client_order_id idempotency.
      // Machine channels only — manual twins keep their own MANUAL_BACKSTOP_MIN bell exit.
      const wallMtc = Math.max(0, rthClose - nowMin);
      const openedET = r.opened_at ? alpaca.etParts(Date.parse(r.opened_at)).date : todayET;
      // Flatten a SAME-SESSION machine position — AND any position whose contract EXPIRES today
      // (audit M4): a prior-session 1DTE hold is 0DTE now and previously relied only on the
      // bar-relative eod_flatten, the exact gapped-near-bell-bar failure this wall-clock backstop
      // was built for. A genuine multi-day hold (expiration > today) stays exempt.
      const expiresToday = String(r.expiration ?? todayET) <= todayET;
      // MANDATORY flatten (1b #9: runs even on a degraded orders pass). 1b #8: exitGuard-claimed.
      if (wallMtc <= policy.EOD_HARD_FLATTEN_MIN && (openedET === todayET || expiresToday) && !/-manual$/i.test(ch.slug)) {
        // Evaluate the dark controls at the same executable observation that
        // precedes the real wall-clock flatten. This call writes evidence only.
        const bellQ = chain?.byOcc(r.occ_symbol);
        const bellAge = chain?.ageMs ?? Infinity;
        const bellBid = freshExecutableBid(bellQ?.bid, bellAge);
        if (bellBid != null) {
          const bellPeak = Math.max(peakBidByKey.get(r.id) ?? r.peak_mark ?? r.avg_entry_price, bellBid);
          observeShadowManagers({ ch, row: r, accountId: g.account.id, bid: bellBid,
            mid: bellQ?.mid ?? null, chainAgeMs: bellAge, peak: bellPeak,
            observedAtMs: Date.now(), isBell: true });
        }
        info(`eod-hard-flatten: ${ch.slug} ${r.occ_symbol} ×${r.qty} — ${openedET === todayET ? "same-session" : "expires today"}, wall-clock mtc ${wallMtc} (pre-bell backstop, bars-independent)`);
        if (exitGuard.claim(r.id)) {
          try { await executeExit({ slug: ch.slug, status: ch.status, action: "exit", reason: "eod_hard_flatten" }, r, exec, undefined, exitQualityPolicyFor(ch)); }
          catch (e) { warn(`eod-hard-flatten ${ch.slug} failed — ${(e as Error).message}`); }
          finally { exitGuard.release(r.id); }
        }
        clearSweepPriceState(r.id);
        continue;
      }
      // ---- EVENT STAND-DOWN wall-clock backstop (audit 2026-07-10) ----
      // The bar-close event_flatten (decide.ts) is BAR-anchored — a bar-stream stall through
      // 13:50 on an FOMC day leaves the position held into the 14:00 binary, the exact class
      // the EOD hard-flatten above already fixed for the bell. Mirror it here: this 10s
      // wall-clock sweep flattens inside the event window even when bars stop. Same
      // exemptions as the bar-close intent (event_policy='ignore', manual twins).
      // MANDATORY flatten (1b #9: runs even on a degraded orders pass). 1b #8: exitGuard-claimed.
      if (policy.EVENT_STANDDOWN && ch.event_policy !== "ignore" && !/-manual$/i.test(ch.slug)
          && inEventWindow(todayET, nowMin, policy.EVENT_FLATTEN_MIN_BEFORE, policy.EVENT_RESUME_MIN_AFTER, ch.underlying)) {
        info(`event-flatten (wall-clock): ${ch.slug} ${r.occ_symbol} ×${r.qty} — event window, bars-independent backstop`);
        if (exitGuard.claim(r.id)) {
          try { await executeExit({ slug: ch.slug, status: ch.status, action: "exit", reason: "event_flatten" }, r, exec, undefined, exitQualityPolicyFor(ch)); }
          catch (e) { warn(`event-flatten ${ch.slug} failed — ${(e as Error).message}`); }
          finally { exitGuard.release(r.id); }
        }
        clearSweepPriceState(r.id);
        continue;
      }
      // ---- PRICE-TRIGGERED exits below — EXECUTABLE-BID basis (audit 2026-07-11, 1b #6) ----
      // We are LONG options: a liquidation SELLS, so every trigger evaluates the BID — the
      // price a buyer will actually pay — NOT the mid (a mid-based stop fires late/at a level
      // no order can realize on a wide spread; operator decision 2026-07-11). freshExecutableBid
      // also enforces the QUOTE-AGE guard (policy.QUOTE_TRIGGER_MAX_AGE_MS): a stale chain or a
      // missing/zero bid SKIPS the price exits this tick — fail toward NOT firing on a fantasy
      // price. The mandatory halt/EOD/event flattens above already ran (wall-clock/operator-
      // triggered, never price-gated), so this skip can never strand a position past the bell.
      // The MID stays computed as a labeled DIAGNOSTIC only (skip + fire info lines).
      const q = chain?.byOcc(r.occ_symbol);
      const midDiag = q?.mid ?? 0; // diagnostic only — never a trigger or peak input (1b #6)
      const chainAgeMs = chain?.ageMs ?? Infinity;
      const bid = freshExecutableBid(q?.bid, chainAgeMs);
      if (bid == null) {
        // Throttled visibility (≤1/min/row): a row skipped here is running WITHOUT price
        // protection — silent would hide an outage; unthrottled would flood at 10s cadence.
        const last = sweepSkipLogged.get(r.id) ?? 0;
        if (Date.now() - last >= 60_000) {
          sweepSkipLogged.set(r.id, Date.now());
          info(`fast-exit: ${ch.slug} ${r.occ_symbol} price exits skipped — ${chainAgeMs > policy.QUOTE_TRIGGER_MAX_AGE_MS ? `chain stale (${Number.isFinite(chainAgeMs) ? `${Math.round(chainAgeMs / 1000)}s` : "never seeded"})` : `no executable bid (bid ${q?.bid ?? "—"})`}; mid ${midDiag.toFixed(2)} diagnostic — mandatory flattens unaffected`);
        }
        continue;
      }
      // KEY BY ROW ID (review hardening 2026-07-05): the old entryKey(strategist,occ) key was
      // never cleared on bar-close-cycle/manual exits, so a same-day re-entry into the same
      // strike inherited the PRIOR position's peak — pre-existing latent staleness that the
      // runner ratchet would have turned into instant wrong exits. Row-id keys are per-position
      // by construction and self-seed from the row's own persisted peak/trough on first sight.
      const key = r.id;
      // seed from the persisted peak_mark so a worker restart doesn't lose the MFE high-water mark.
      // ⚠ BASIS NOTE (audit 2026-07-11, 1b #6): peak_mark/trough_mark are BID-based from this
      // version (were mid) — the trail arms/gives-back on realizable prices and pk·win reads
      // bid-side MFE. ERA BOUNDARY at the deploy: don't pool pre/post peaks in analysis (bid
      // peaks sit ~half-spread below the old mid peaks). A row open ACROSS the deploy seeds
      // from its persisted mid-based peak — the monotonic max keeps it (a one-time ≤half-spread
      // overstatement on those rows only), then everything is bid-based forever after.
      const prevPeak = peakBidByKey.get(key) ?? r.peak_mark ?? r.avg_entry_price;
      const peak = Math.max(prevPeak, bid);
      peakBidByKey.set(key, peak);
      if (peak > prevPeak) void store.markPeak(r.id, peak); // durable MFE ratchet, NEW-high only (44_trade_forensics; off the trade path)
      // MAE twin (58_trough_mark): ratchet the running MIN bid, NEW-low-only writes, seeded from
      // the persisted value (restart-safe). Instrumentation only — nothing reads it on the trade path.
      const prevTrough = troughBidByKey.get(key) ?? r.trough_mark ?? r.avg_entry_price;
      const trough = Math.min(prevTrough, bid);
      troughBidByKey.set(key, trough);
      if (trough < prevTrough) void store.markTrough(r.id, trough);
      observeShadowManagers({ ch, row: r, accountId: g.account.id, bid, mid: midDiag,
        chainAgeMs, peak, observedAtMs: Date.now(),
        isBell: /-manual$/i.test(ch.slug) && wallMtc <= policy.MANUAL_BACKSTOP_MIN });
      // "The desk summons you" — premium-side pages off the same ~10s sweep state:
      // a ripper crossing +CROSS%, and a meaningful peak giving back ≥ FRAC of the
      // move (the positions panel's 50%-giveback amber, pushed to the phone live).
      const entryPx = r.avg_entry_price;
      if (entryPx > 0) {
        // 1b #6: pages read the BID too (same basis as the peak they compare against) —
        // "up +75%" now means +75% you could actually SELL for, not a mid nobody bid.
        const retPct = ((bid - entryPx) / entryPx) * 100;
        const peakPct = ((peak - entryPx) / entryPx) * 100;
        // dedup scope = the POSITION ROW id (not the OCC) so a same-day re-entry into the
        // same strike (e.g. two ORB legs on 742C) pages on its OWN +75%/giveback, not once.
        if (retPct >= policy.ALERT_CROSS_PCT)
          alertOnce(todayET, "cross", r.id, `▲ ${ch.slug} +${Math.round(retPct)}%`,
            `${r.occ_symbol} ×${r.qty} — entry $${entryPx.toFixed(2)} → bid $${bid.toFixed(2)}. Ride or bank?`);
        if (peakPct >= policy.ALERT_GIVEBACK_MIN_PEAK_PCT && peak - bid >= policy.ALERT_GIVEBACK_FRAC * (peak - entryPx))
          alertOnce(todayET, "giveback", r.id, `▼ ${ch.slug} giving it back`,
            `${r.occ_symbol} peaked +${Math.round(peakPct)}%, now ${retPct >= 0 ? "+" : ""}${Math.round(retPct)}% — ${Math.round(((peak - bid) / (peak - entryPx)) * 100)}% of the move gone`);
      }
      const pe = ch.spec_json ? specPremiumExit(ch.spec_json as StrategySpec) : undefined;
      const day1RootPolicy = config.day1ReleaseEnabled && day1Root(ch.slug) != null;
      // 1b #6: `mark` = the fresh EXECUTABLE BID, `peak` = the bid-based MFE ratchet above.
      // premiumExitReason stays PURE (unchanged comparisons) — only the input price changed.
      const reason = premiumExitReason({
        row: r, slug: ch.slug, premiumExit: day1RootPolicy ? undefined : pe,
        takeProfitPct: day1RootPolicy ? 0 : ch.take_profit_pct, premiumStopPct: ch.premium_stop_pct,
        givebackTrail: day1RootPolicy ? null : policy.GIVEBACK_TRAIL[ch.slug] ?? null,
        isManual: /-manual$/i.test(ch.slug),
        minutesToClose: Math.max(0, rthClose - nowMin),
        stallMinutes: ch.stall_minutes, stallMaxFavorPct: ch.stall_max_favor_pct, // strand-4 stall-exit (0 = off)
        isRunner: !!r.runner_of, runnerGivebackPct: ch.runner_giveback_pct, // R1 runner ratchet (0 = off)
      }, bid, peak);
      if (!reason) continue;
      // 1b #9: ordinary PRICE exits need the order snapshot (late-fill recovery + working-order
      // idempotency read it) — on a degraded pass only the mandatory flattens above may sell.
      // The predicate is pure + selftest-covered (exitGuard.sweepExitAllowed); peak/trough
      // ratchets and the operator pages above keep running degraded (marks need no orders).
      if (!sweepExitAllowed(reason, ordersFresh)) {
        info(`fast-exit: ${ch.slug} ${r.occ_symbol} ${reason} suppressed — orders snapshot unavailable (degraded pass)`);
        continue;
      }
      info(`fast-exit: ${ch.slug} ${r.occ_symbol} → ${reason} (bid ${bid.toFixed(2)} vs entry ${r.avg_entry_price.toFixed(2)}; mid ${midDiag.toFixed(2)} diagnostic)`);
      if (!exitGuard.claim(r.id)) continue; // 1b #8: the concurrent cycle holds this row's exit — skip, retry next sweep
      try {
        await executeExit({ slug: ch.slug, status: ch.status, action: "exit", reason }, r, exec, { frac: ch.runner_frac, givebackPct: ch.runner_giveback_pct }, exitQualityPolicyFor(ch));
        clearSweepPriceState(key);
      } finally { exitGuard.release(r.id); }
      }
    }
  } catch (e) {
    warn(`fast-exit sweep failed — ${(e as Error).message}`);
  } finally {
    sweeping = false; // 1b #8: the sweep's OWN mutex (never touches `cycling`)
  }
}

function onBar(symbol: string, bar: Bar): void {
  const store = barsBySym.get(symbol);
  if (!store) return; // a symbol we don't own (shouldn't happen — sub is scoped)
  const isNew = store.upsert(bar);
  // Only a NEW *RTH* closed bar triggers a decision (after-hours bars update
  // state but don't re-run the strategies). The cycle re-evaluates ALL symbols —
  // cheap (in-memory decide) and keeps minutesToClose fresh across the roster.
  const p = alpaca.etParts(bar.ts);
  // audit 2026-07-11 (1b #13): gate on the bar-day's REAL close (sessionCloseMin — 780 half-day),
  // not a hardcoded 960, so a post-close extended-hours print on a half-day can't trigger an
  // out-of-session cycle. RTH_CLOSE stays as the constant's home; the gate is close-aware.
  if (isNew && p.min >= RTH_OPEN && p.min < sessionCloseMin(p.date)) void cycle(`bar-close ${symbol}`);
}
async function onReconnect(): Promise<void> {
  warn("stream: reconnected — reseeding state from REST");
  try { await seed(); } catch (e) { error(`reseed failed — ${(e as Error).message}`); }
}

async function main(): Promise<void> {
  info(`SEVE streaming worker ${WORKER_VERSION} — the third engine driver`);
  const writeMode = config.hasServiceRole
    ? (config.shadowWriteEvents ? "events" : "none (service role, events off)")
    : "none (anon, read-only)";
  info(`feeds: stock=${config.stockFeed} opt=${config.optFeed} · dryRun=${config.dryRun} · liveTrading=${config.liveTrading} · writes=${writeMode}`);
  if (config.day1ReleaseEnabled && config.day1ReleaseExpectedSha256 !== DAY1_RELEASE_CONFIGURATION_SHA256) {
    error(`Day 1 release checksum mismatch: expected env ${config.day1ReleaseExpectedSha256 || "<missing>"}, code ${DAY1_RELEASE_CONFIGURATION_SHA256}. Refusing to start.`);
    process.exit(1);
  }
  // Boot flags → the DB journal (2026-07-06): env-gated safety switches were previously
  // invisible outside Railway logs — an operator flipping ORPHAN_FLATTEN had no in-band
  // confirmation the restarted worker picked it up. One line per boot, queryable in events.
  void store.journal("EXEC", `boot: ${WORKER_VERSION} · orphanFlatten=${config.orphanFlatten ? "ARMED" : "detect-only"} · symbols=${SYMBOLS.join(",")}`, { boot_id: BOOT_ID, instance_id: INSTANCE_ID });
  // Crash-attribution ledger (external-review P4): open this run + close any prior un-ended run
  // as abrupt. Fail-open, off the trade path. See store.openRun / worker_runs / 67_worker_runs.sql.
  void store.openRun(WORKER_VERSION);

  // Phase B posture — the TWO-KEY turn. Going live requires DRY_RUN=false AND
  // LIVE_TRADING=true AND the service role, together; a partial flip refuses to
  // start rather than guessing. Even fully live, this instance only ever places
  // orders for channels with strategists.executor='stream' on ITS symbol — the
  // cron keeps everything else, and defers via the worker_heartbeat dead-man.
  if (!config.dryRun && !(config.liveTrading && config.hasServiceRole)) {
    error("DRY_RUN=false requires LIVE_TRADING=true AND the service role (the two-key turn). Refusing to start.");
    process.exit(1);
  }
  if (config.liveTrading && config.dryRun) {
    warn("LIVE_TRADING=true but DRY_RUN=true — staying in SHADOW (set DRY_RUN=false to complete the two-key turn).");
  }
  if (liveMode()) {
    info(`◉ LIVE EXECUTOR — trading executor='stream' channels on ${SYMBOLS.join(",")}; heartbeat → worker_heartbeat('stream'); fast exits every ${config.fastExitSec}s`);
  }

  // Boot is non-fatal: a transient config/seed failure must not crash-loop the
  // container. Config self-heals via the realtime sub + 30s poll; bars self-heal
  // via the websocket stream. So we log and carry on rather than exit.
  try { await reloadConfig(); }
  catch (e) {
    if (config.day1ReleaseEnabled) {
      error(`config: RC3 initial validation failed — ${(e as Error).message}; refusing to start`);
      process.exit(1);
    }
    warn(`config: initial load failed — ${(e as Error).message}; will retry via realtime/poll`);
  }
  if (config.day1ReleaseEnabled && (!cfg.fund || DAY1_ROOTS.some((root) => !cfg.channels.some((channel) => channel.slug === root.slug)))) {
    error("Day 1 release configuration is incomplete after the initial read. Refusing to start rather than running an unsealed roster.");
    process.exit(1);
  }
  info(`config: ${cfg.fund ? `fund cap $${cfg.fund.total_capital_usd} mode=${cfg.fund.mode} halted=${cfg.fund.is_halted}` : "fund MISSING"}, ${cfg.channels.length} channels [${cfg.channels.map((c) => `${c.slug}:${c.status}`).join(", ")}]`);
  if (config.day1ReleaseEnabled) {
    const receipt = day1StartupReceipt;
    if (!receipt) {
      error("Day 1 RC3 active-settings receipt is unavailable after validation. Refusing to start.");
      process.exit(1);
    }
    info(`day1-release: ACTIVE ${DAY1_RELEASE_ID} config=${DAY1_RELEASE_CONFIGURATION_SHA256} roots=6 dark=62 paper-only`);
    void store.journal("EXEC", `day1-release ACTIVE ${DAY1_RELEASE_ID} config=${DAY1_RELEASE_CONFIGURATION_SHA256}`, receipt);
  } else {
    info(`day1-release: OFF · candidate=${DAY1_RELEASE_ID} config=${DAY1_RELEASE_CONFIGURATION_SHA256}`);
  }
  // Cockpit P3 routing summary: each bucket's posture — LIVE (armed + creds), shadow (decided,
  // no orders), or no-creds (cred_ref set but env keys absent). The shadow-first verification view.
  const acctSummary = groupByAccount(cfg.channels, cfg.accounts)
    .map((g) => `${g.account.name}[${g.api ? (liveMode() ? (g.account.is_armed && !g.account.is_halted ? "LIVE" : "manage-only") : "shadow") : "no-creds"}]×${g.channels.length}`).join(", ");
  info(`accounts (cockpit P3): ${acctSummary || "single-account"}; alt-creds: [${Object.keys(config.altAccounts).join(",") || "none"}]`);
  try { await seed(); }
  catch (e) { error(`seed failed after retries — continuing; the websocket will populate bars live (${(e as Error).message})`); }

  store.subscribeConfig(() => { reloadPending = true; });
  setInterval(() => { reloadPending = true; }, 30_000); // poll fallback if realtime is off
  // Run-liveness beat (external-review P4): freshens worker_runs.last_heartbeat_at + memory_rss
  // every 60s REGARDLESS of live/shadow, so a crash gap and an RSS climb are both visible even
  // when the trading heartbeat is silent (shadow / outside RTH). Fail-open telemetry.
  setInterval(() => { void store.runHeartbeat(); }, 60_000);

  // Decide once against the latest known bar at boot (validates the pipeline + is
  // useful when booting mid-session); thereafter every bar-close drives it.
  await cycle("boot");

  // Dynamic import keeps the default-off worker byte path free of the R2/S3
  // runtime and its memory footprint. Only the explicit flag can load it.
  let intraminuteCapture: IntraminuteCaptureRuntime | null = null;
  if (config.intraminuteCaptureEnabled) {
    const { IntraminuteCaptureRuntime: CaptureRuntime } = await import("./intraminuteCapture.js");
    intraminuteCapture = await CaptureRuntime.create({
      symbols: SYMBOLS,
      paperMode: cfg.fund?.mode?.toLowerCase() === "paper",
    });
  }
  const stream = new StockBarStream(SYMBOLS, onBar, onReconnect, intraminuteCapture?.observer());
  intraminuteCapture?.start();
  // Phase 1K-G reuses manager-book targeted OPRA requests. Dynamic loading
  // keeps the default-off R2 adapter out of the normal worker path.
  let heldContractCapture: HeldContractCaptureRuntime | null = null;
  if (config.heldContractCaptureEnabled) {
    const { HeldContractCaptureRuntime: CaptureRuntime } = await import("./heldContractCapture.js");
    heldContractCapture = await CaptureRuntime.create({
      paperMode: cfg.fund?.mode?.toLowerCase() === "paper",
    });
    heldContractCapture?.start();
  }
  stream.start();

  // Phase B: the fast premium-exit sweep (no-op in shadow / outside RTH / flat).
  setInterval(() => { void fastExitSweep(); }, Math.max(5, config.fastExitSec) * 1000);

  // Phase 1G-B portable-manager shadow book: a separate, observation-only
  // clock which keeps running after the actual position closes. DARK unless the
  // explicit env flag is enabled; it owns no execution or broker-order imports.
  setInterval(() => { void shadowManagerBookTick({
    paperMode: cfg.fund?.mode?.toLowerCase() === "paper",
    channels: cfg.channels, accounts: cfg.accounts,
    heldContractCapture,
  }); }, Math.max(5, config.fastExitSec) * 1000);

  // FORWARD-DATA DURABILITY: upload each complete day's option_quotes (gz) to Supabase Storage,
  // post-close, from this always-on worker — the Mac-independent backstop against the 7d prune
  // (docs/data-capture.md). Boot run = catch-up for any day missed while down; the timer fires
  // once post-close per ET day. Off the trade path; no-op without the service role.
  void archiveQuotesToStorage("boot");
  setInterval(() => { void maybeArchiveTick(); }, 20 * 60_000); // every 20 min; self-gates to once/day post-close

  // SHADOW §03 PANEL (Mac-independent): run the existing day-report (override/foul-out
  // scorecard + benched-sim) from this always-on worker post-close, so the panel stays
  // current with no Mac. Reuses scripts/shadow-cron.ts as a NON-BLOCKING child (the heartbeat
  // keeps beating while it runs); off the trade path; no-op without the service role.
  setInterval(() => { void maybePublishForensicsTick(); }, 20 * 60_000); // self-gates to once/day post-close

  // PRE-OPEN IDLE BEAT: the cron wakes at 09:00 ET but bars (hence cycles/sweeps)
  // start at 09:30 — the heartbeat read stale every morning and the cron's
  // executor gate WARN-flooded "stream heartbeat STALE" per channel per minute
  // (310 lines on 06-12). Beat once a minute through 08:55–09:35 so the gate
  // reads FRESH from the cron's first cycle. Harmless on weekends (no cron).
  setInterval(() => {
    if (!liveMode()) return;
    const m = alpaca.etParts(Date.now()).min;
    if (m >= RTH_OPEN - 35 && m < RTH_OPEN + 5) void store.heartbeat(`${WORKER_VERSION} pre-open`);
  }, 60_000);

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      info(`shutdown (${sig})`);
      stream.stop();
      void (async () => {
        await Promise.allSettled([intraminuteCapture?.stop(), heldContractCapture?.stop()]);
        await recordExitAndDie(`graceful_${sig.toLowerCase()}`, 0, sig);
      })();
    });
  }
}

// Record the run's epitaph (best-effort, ≤1.5s) THEN exit. Bounded so a hung DB write can never
// wedge shutdown; if it doesn't land, the next boot's openRun still marks this run abrupt — so this
// only UPGRADES attribution (graceful vs uncaught vs fatal), never gates it. (external-review P4)
async function recordExitAndDie(kind: string, code: number, signal: string | null, err?: unknown): Promise<never> {
  try { await Promise.race([store.closeRun(kind, code, signal, err), new Promise((r) => setTimeout(r, 1500))]); }
  catch { /* fail-open */ }
  process.exit(code);
}

// Last-resort safety nets. A stray promise rejection is logged but NOT fatal (the
// worker keeps streaming); a genuine uncaught exception exits so Railway restarts
// with clean state (boot is now retry-hardened, so a restart won't crash-loop).
process.on("unhandledRejection", (reason) => {
  warn(`unhandledRejection — ${reason instanceof Error ? reason.message : String(reason)}`);
});
process.on("uncaughtException", (e) => {
  error(`uncaughtException — ${e.message}; exiting for a clean restart`);
  void recordExitAndDie("uncaught_exception", 1, null, e);
});

main().catch((e) => { error(`fatal — ${(e as Error).message}`); void recordExitAndDie("fatal_boot", 1, null, e); });
