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
import { info, warn, error, shadow } from "./log.js";
import * as alpaca from "./alpaca.js";
import * as store from "./store.js";
import { BarStore, ChainStore } from "./state.js";
import { StockBarStream } from "./stream.js";
import { decideChannel, buildSessionBars, computeLevels, type DecisionCtx, type ShadowDecision } from "./decide.js";
import { alertOnce, alertClear } from "./alerts.js";
import { updateShadowManagement } from "./shadowManage.js";
import { archiveQuotesToStorage, maybeArchiveTick } from "./archive.js";
import { executeEntry, executeExit, executeReconcile, executeAdd, premiumExitReason, seedRemaining, entryKey, type ExecCtx } from "./execute.js";
import { computeFeatures } from "../../engine/engine";
import { specPremiumExit } from "../../engine/specEvaluate";
import type { StrategySpec } from "../../lib/desk/strategySpec";
import type { Bar } from "../../engine/types";

const RTH_OPEN = 570, RTH_CLOSE = 960;

// Phase B posture: ALL of (DRY_RUN=false, LIVE_TRADING=true, service role) — the
// two-key turn plus credentials. Anything less = shadow, exactly as Phase A.
const liveMode = (): boolean => !config.dryRun && config.liveTrading && config.hasServiceRole;
// A channel this instance EXECUTES: stream-owned + one of THIS worker's symbols.
// Multi-symbol (B3): one instance holds N symbols, each with its own bars/chain,
// behind ONE 'stream' heartbeat — so it must reliably handle every symbol it lists.
const SYMBOLS = config.symbols;
const ownedBy = (c: store.ChannelConfig): boolean => c.executor === "stream" && SYMBOLS.includes(c.underlying.toUpperCase());
// Running peak option mid per open position (power giveback + sweep state).
const peakMidByKey = new Map<string, number>();

// Per-symbol in-memory state (one BarStore + ChainStore each); OCCs are globally
// unique (the ticker is in the OCC root) so account-wide reads stay shared.
const barsBySym = new Map<string, BarStore>(SYMBOLS.map((s) => [s, new BarStore(config.barHistory)]));
const chainBySym = new Map<string, ChainStore>(SYMBOLS.map((s) => [s, new ChainStore()]));
const gammaLogged = new Set<string>(); // `${sym}|${etDate}` — once-per-day gamma-open diagnostic snapshot
let cfg: { fund: store.FundState | null; channels: store.ChannelConfig[] } = { fund: null, channels: [] };
let reloadPending = false;
let cycling = false;

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

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
  if (c.fund) cfg = c;
  else warn("config: reload returned no fund_state — keeping previous");
  const nowHalted = cfg.fund?.is_halted ?? false;
  if (hadFund && !prevHalted && nowHalted)
    alertOnce(alpaca.etParts(Date.now()).date, "halt", "fund", "⛔ desk HALTED", "kill switch / master stop tripped — entries frozen, exits keep managing");
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
      bars.seed(await retry(`seed bars ${sym}`, () => alpaca.backfillBars(sym, 3)));
      const l = bars.latest();
      info(`seed[${sym}]: ${bars.length} bars (latest ${l ? new Date(l.ts).toISOString() : "—"}, spot ${l?.close ?? "?"})`);
      await refreshChain(sym);
      info(`seed[${sym}]: chain ${chainBySym.get(sym)!.size} contracts (feed=${config.optFeed})`);
    } catch (e) { error(`seed[${sym}] failed — ${(e as Error).message}; the websocket will populate bars live`); }
  }
}

async function cycle(trigger: string): Promise<void> {
  if (cycling) { return; } // never overlap cycles
  cycling = true;
  try {
    if (reloadPending) { reloadPending = false; await reloadConfig(); }
    if (!cfg.fund) { warn(`cycle(${trigger}): missing config — skip`); return; }

    const todayET = alpaca.etParts(Date.now()).date;
    // ACCOUNT-WIDE reads, shared across symbols (positions/orders span every ticker;
    // OCCs are globally unique so one set of maps is correct for all symbols).
    let account, alpacaPositions;
    try { [account, alpacaPositions] = await Promise.all([alpaca.getAccount(), alpaca.getPositions()]); }
    catch (e) { warn(`cycle(${trigger}): Alpaca read failed — ${(e as Error).message}; skip`); return; }
    const openRowsArr = await store.getOpenPositions();
    const openRows = new Map(openRowsArr.map((r) => [r.strategist_id, r]));
    const alpacaByOcc = new Map(alpacaPositions.map((p) => [p.symbol, p]));
    const byId = new Map(cfg.channels.map((c) => [c.id, c]));

    const live = liveMode();
    let allOrders: alpaca.AlpacaOrder[] = [];
    let openRowQty = new Map<string, number>();
    let remainingByOcc = new Map<string, number>();
    if (live) {
      await store.heartbeat(`${WORKER_VERSION} cycle`);
      try { [allOrders, openRowQty] = await Promise.all([alpaca.getOrders(), store.openRowQtyByOcc()]); }
      catch (e) { warn(`cycle(${trigger}): order/row read failed — ${(e as Error).message}; bookkeeping only`); }
      remainingByOcc = seedRemaining(alpacaPositions);
    }

    // Per-symbol pass: each symbol decides on ITS last RTH session bar against ITS
    // own bars/chain (a stale symbol can't suppress a fresh one — own freshness).
    const decisions: ShadowDecision[] = [];
    for (const sym of SYMBOLS) {
      const bars = barsBySym.get(sym)!;
      const sessionBars = buildSessionBars(bars.all(), todayET);
      const lastSession = sessionBars[sessionBars.length - 1];
      if (!lastSession) continue; // this symbol has no RTH bars yet
      const barMin = alpaca.etParts(lastSession.ts).min;
      const minutesToClose = Math.max(0, RTH_CLOSE - barMin);
      await refreshChain(sym);
      const chain = chainBySym.get(sym)!;

      // ---- gamma-open diagnostic (frontier #3, SHADOW-ONLY collect-forward) ----
      // Once/day at ~9:35, snapshot the 0DTE ATM implied move (straddle/spot) + ATM call delta —
      // a live-only gamma-regime number (no historical Databento greeks, so it can only accrue
      // forward). Correlate vs day P&L / per-ride R after ~10 sessions to decide if a gamma gate is
      // worth proposing. Pure event write, double-guarded — zero trade-path impact.
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

      const ctx: DecisionCtx = {
        sessionBars, chain, fund: cfg.fund, equity: account.equity, todayET,
        minutesToClose, // BAR-relative (strategy intents); wall-clock below is bars-independent
        wallMinutesToClose: Math.max(0, RTH_CLOSE - alpaca.etParts(Date.now()).min),
        next1DTE: chain.nextExpiryAfter(todayET),
        ...computeLevels(bars.all(), todayET),
        openRows, alpacaByOcc,
        allOrders, // live-only snapshot (empty in shadow) — the PYRAMID executor reconstructs the lot stack from it
      };
      const symChannels = cfg.channels.filter((c) => c.underlying.toUpperCase() === sym);
      const symDecisions: ShadowDecision[] = [];
      for (const ch of symChannels) {
        try { symDecisions.push(await decideChannel(ch, ctx)); }
        catch (e) { warn(`decide ${ch.slug} failed — ${(e as Error).message}`); }
      }
      decisions.push(...symDecisions);

      // ---- PHASE B: EXECUTE the decisions for channels this worker OWNS ----
      // (executor='stream' + a symbol we hold). Everything else stays shadow-logged.
      if (live) {
        // STALE-BAR ORDER GUARD (per symbol): a boot/restart decides on the last
        // KNOWN bar — after an overnight restart that's yesterday's close, and a
        // market order placed then would queue for the next open at an unknowable
        // price. Orders need a fresh decision bar; reconcile + mark are always safe.
        const barFresh = Date.now() - lastSession.ts < 180_000;
        if (!barFresh) info(`live pass[${sym}]: decision bar stale (boot/off-hours) — orders suppressed, bookkeeping only`);
        const exec: ExecCtx = { chain, todayET, etMin: barMin, sinceIso: `${todayET}T00:00:00Z`, allOrders, alpacaByOcc, remainingByOcc, openRowQty };
        const bySlug = new Map(symChannels.map((c) => [c.slug, c]));
        for (const d of symDecisions) {
          const ch = bySlug.get(d.slug);
          if (!ch || !ownedBy(ch)) continue;
          // "The desk summons you" — page the operator on the decision-level moments
          // (informational; once per day per key; never alters the execution below).
          // Gated on barFresh: a boot/stale-bar cycle re-decides on yesterday's bar and
          // would emit phantom "daily stop / sized-to-zero" pages for decisions it is NOT
          // acting on — only page when the decision is fresh (i.e. the worker is acting).
          if (barFresh) {
            if (d.action === "exit" && d.reason === "event_flatten")
              alertOnce(todayET, "event", "standdown", "⚑ event stand-down", `${d.slug} flattening ${d.occ ?? ""} — entries blocked through the window`);
            if (d.action === "enter" && d.blocked === "daily_stop")
              alertOnce(todayET, "latch", d.slug, `⛔ ${d.slug} daily stop latched`, `realized ≤ −$${Math.round(ch.daily_stop_usd)} — its entries are done for the day`);
            if (d.action === "enter" && d.blocked === "insufficient_capital")
              alertOnce(todayET, "size0", d.slug, `⚠ ${d.slug} sized to ZERO`, `RISK $${Math.round(ch.capital_pct)} can't clear 1 contract (ask too rich) — nudge the knob if the trade was wanted`);
          }
          const row = openRows.get(ch.id);
          try {
            if (d.action === "reconcile" && row) await executeReconcile(d, row, exec);
            else if (d.action === "exit" && row && !d.blocked && barFresh) await executeExit(d, row, exec);
            else if (d.action === "add" && row && barFresh) await executeAdd(d, ch, row, exec); // PYRAMID (pyramid_adds>0)
            else if (d.action === "enter" && barFresh) await executeEntry(d, ch, Number(d.detail?.spotClose ?? lastSession.close), exec);
            else if (d.action === "hold" && row) {
              const alp = alpacaByOcc.get(row.occ_symbol);
              if (alp) {
                const unreal = Math.round((alp.current_price - row.avg_entry_price) * row.qty * 10000) / 100;
                await store.markPositionRow(row.id, alp.current_price, unreal);
              }
            }
          } catch (e) { warn(`execute ${d.slug} failed — ${(e as Error).message}`); }
        }
      }

      // Shadow MANAGEMENT what-if (per symbol): scale/BE/trail over THIS symbol's
      // live positions on its real-time quote (logs managed-vs-actual; no orders).
      try {
        const symRows = openRowsArr.filter((r) => byId.get(r.strategist_id)?.underlying.toUpperCase() === sym);
        // ALWAYS call (was gated on open rows): the ride-to-close override finalize must run
        // at the 15:25 flatten even when the overridden position was the last one open.
        await updateShadowManagement({
          rows: symRows,
          slugById: new Map(symChannels.map((c) => [c.id, c.slug])),
          sym,
          chain, sessionBars,
          atr: computeFeatures(sessionBars, sessionBars.length - 1).atr,
          etMin: barMin, minutesToClose,
        });
      } catch (e) { warn(`shadow-management[${sym}] failed — ${(e as Error).message}`); }
    }
    report(trigger, account.equity, decisions);
    if (live) { try { await store.insertEquitySnapshot(account.equity, account.cash, alpacaPositions.reduce((a, p) => a + p.unrealized_pl, 0)); } catch (e) { warn(`equity snapshot failed — ${(e as Error).message}`); } }
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
async function fastExitSweep(): Promise<void> {
  if (!liveMode() || cycling) return;
  const nowMin = alpaca.etParts(Date.now()).min;
  if (nowMin < RTH_OPEN || nowMin >= RTH_CLOSE) return;
  const owned = cfg.channels.filter(ownedBy);
  if (!owned.length || !cfg.fund) return;
  cycling = true;
  try {
    await store.heartbeat(`${WORKER_VERSION} sweep`);
    if (cfg.fund.is_halted || cfg.fund.mode !== "paper") return; // exits frozen (kill switch)
    const byId = new Map(owned.map((c) => [c.id, c]));
    const rows = (await store.getOpenPositions()).filter((r) => byId.has(r.strategist_id));
    if (!rows.length) return;
    // refresh only the chains for symbols that have owned open positions
    const activeSyms = new Set(rows.map((r) => byId.get(r.strategist_id)!.underlying.toUpperCase()));
    for (const sym of activeSyms) await refreshChain(sym);
    const [positions, allOrders] = await Promise.all([alpaca.getPositions(), alpaca.getOrders()]);
    const todayET = alpaca.etParts(Date.now()).date;
    const alpacaByOcc = new Map(positions.map((p) => [p.symbol, p]));
    const remainingByOcc = seedRemaining(positions);
    const openRowQty = await store.openRowQtyByOcc();
    for (const r of rows) {
      const ch = byId.get(r.strategist_id)!;
      const chain = chainBySym.get(ch.underlying.toUpperCase());
      const exec: ExecCtx = { chain: chain!, todayET, etMin: nowMin, sinceIso: `${todayET}T00:00:00Z`, allOrders, alpacaByOcc, remainingByOcc, openRowQty };
      // ---- EOD HARD-FLATTEN backstop (wall-clock; 2026-06-19 Juneteenth strand fix) ----
      // The strategy's same-day flatten is BAR-relative, so a gapped near-bell bar (06-18: no
      // 15:59 print) means it never fires and the position strands — over a 3-day weekend if a
      // holiday follows. This sweep is a 10s WALL-CLOCK timer that runs even when bars stop, so
      // it force-flattens a SAME-SESSION machine position with margin while the market is still
      // open. Reuses executeExit → inherits the shared-OCC sell-cap + client_order_id idempotency.
      // Machine channels only — manual twins keep their own MANUAL_BACKSTOP_MIN bell exit.
      const wallMtc = Math.max(0, RTH_CLOSE - nowMin);
      const openedET = r.opened_at ? alpaca.etParts(Date.parse(r.opened_at)).date : todayET;
      if (wallMtc <= policy.EOD_HARD_FLATTEN_MIN && openedET === todayET && !/-manual$/i.test(ch.slug)) {
        info(`eod-hard-flatten: ${ch.slug} ${r.occ_symbol} ×${r.qty} — same-session, wall-clock mtc ${wallMtc} (pre-bell backstop, bars-independent)`);
        try { await executeExit({ slug: ch.slug, status: ch.status, action: "exit", reason: "eod_hard_flatten" }, r, exec); }
        catch (e) { warn(`eod-hard-flatten ${ch.slug} failed — ${(e as Error).message}`); }
        peakMidByKey.delete(entryKey(r.strategist_id, r.occ_symbol));
        continue;
      }
      const mid = chain?.byOcc(r.occ_symbol)?.mid ?? 0;
      if (!(mid > 0)) continue;
      const key = entryKey(r.strategist_id, r.occ_symbol);
      const peak = Math.max(peakMidByKey.get(key) ?? r.avg_entry_price, mid);
      peakMidByKey.set(key, peak);
      // "The desk summons you" — premium-side pages off the same ~10s sweep state:
      // a ripper crossing +CROSS%, and a meaningful peak giving back ≥ FRAC of the
      // move (the positions panel's 50%-giveback amber, pushed to the phone live).
      const entryPx = r.avg_entry_price;
      if (entryPx > 0) {
        const retPct = ((mid - entryPx) / entryPx) * 100;
        const peakPct = ((peak - entryPx) / entryPx) * 100;
        // dedup scope = the POSITION ROW id (not the OCC) so a same-day re-entry into the
        // same strike (e.g. two ORB legs on 742C) pages on its OWN +75%/giveback, not once.
        if (retPct >= policy.ALERT_CROSS_PCT)
          alertOnce(todayET, "cross", r.id, `▲ ${ch.slug} +${Math.round(retPct)}%`,
            `${r.occ_symbol} ×${r.qty} — entry $${entryPx.toFixed(2)} → $${mid.toFixed(2)}. Ride or bank?`);
        if (peakPct >= policy.ALERT_GIVEBACK_MIN_PEAK_PCT && peak - mid >= policy.ALERT_GIVEBACK_FRAC * (peak - entryPx))
          alertOnce(todayET, "giveback", r.id, `▼ ${ch.slug} giving it back`,
            `${r.occ_symbol} peaked +${Math.round(peakPct)}%, now ${retPct >= 0 ? "+" : ""}${Math.round(retPct)}% — ${Math.round(((peak - mid) / (peak - entryPx)) * 100)}% of the move gone`);
      }
      const pe = ch.spec_json ? specPremiumExit(ch.spec_json as StrategySpec) : undefined;
      const reason = premiumExitReason({
        row: r, slug: ch.slug, premiumExit: pe, takeProfitPct: ch.take_profit_pct,
        isPowerTrail: policy.POWER_TRAIL_CHANNELS.has(ch.slug),
        isManual: /-manual$/i.test(ch.slug),
        minutesToClose: Math.max(0, RTH_CLOSE - nowMin),
      }, mid, peak);
      if (!reason) continue;
      info(`fast-exit: ${ch.slug} ${r.occ_symbol} → ${reason} (mid ${mid.toFixed(2)} vs entry ${r.avg_entry_price.toFixed(2)})`);
      await executeExit({ slug: ch.slug, status: ch.status, action: "exit", reason }, r, exec);
      peakMidByKey.delete(key);
    }
  } catch (e) {
    warn(`fast-exit sweep failed — ${(e as Error).message}`);
  } finally {
    cycling = false;
  }
}

function onBar(symbol: string, bar: Bar): void {
  const store = barsBySym.get(symbol);
  if (!store) return; // a symbol we don't own (shouldn't happen — sub is scoped)
  const isNew = store.upsert(bar);
  // Only a NEW *RTH* closed bar triggers a decision (after-hours bars update
  // state but don't re-run the strategies). The cycle re-evaluates ALL symbols —
  // cheap (in-memory decide) and keeps minutesToClose fresh across the roster.
  const m = alpaca.etParts(bar.ts).min;
  if (isNew && m >= RTH_OPEN && m < RTH_CLOSE) void cycle(`bar-close ${symbol}`);
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
  catch (e) { warn(`config: initial load failed — ${(e as Error).message}; will retry via realtime/poll`); }
  info(`config: ${cfg.fund ? `fund cap $${cfg.fund.total_capital_usd} mode=${cfg.fund.mode} halted=${cfg.fund.is_halted}` : "fund MISSING"}, ${cfg.channels.length} channels [${cfg.channels.map((c) => `${c.slug}:${c.status}`).join(", ")}]`);
  try { await seed(); }
  catch (e) { error(`seed failed after retries — continuing; the websocket will populate bars live (${(e as Error).message})`); }

  store.subscribeConfig(() => { reloadPending = true; });
  setInterval(() => { reloadPending = true; }, 30_000); // poll fallback if realtime is off

  // Decide once against the latest known bar at boot (validates the pipeline + is
  // useful when booting mid-session); thereafter every bar-close drives it.
  await cycle("boot");

  const stream = new StockBarStream(SYMBOLS, onBar, onReconnect);
  stream.start();

  // Phase B: the fast premium-exit sweep (no-op in shadow / outside RTH / flat).
  setInterval(() => { void fastExitSweep(); }, Math.max(5, config.fastExitSec) * 1000);

  // FORWARD-DATA DURABILITY: upload each complete day's option_quotes (gz) to Supabase Storage,
  // post-close, from this always-on worker — the Mac-independent backstop against the 7d prune
  // (docs/data-capture.md). Boot run = catch-up for any day missed while down; the timer fires
  // once post-close per ET day. Off the trade path; no-op without the service role.
  void archiveQuotesToStorage("boot");
  setInterval(() => { void maybeArchiveTick(); }, 20 * 60_000); // every 20 min; self-gates to once/day post-close

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
    process.on(sig, () => { info(`shutdown (${sig})`); stream.stop(); process.exit(0); });
  }
}

// Last-resort safety nets. A stray promise rejection is logged but NOT fatal (the
// worker keeps streaming); a genuine uncaught exception exits so Railway restarts
// with clean state (boot is now retry-hardened, so a restart won't crash-loop).
process.on("unhandledRejection", (reason) => {
  warn(`unhandledRejection — ${reason instanceof Error ? reason.message : String(reason)}`);
});
process.on("uncaughtException", (e) => {
  error(`uncaughtException — ${e.message}; exiting for a clean restart`);
  process.exit(1);
});

main().catch((e) => { error(`fatal — ${(e as Error).message}`); process.exit(1); });
