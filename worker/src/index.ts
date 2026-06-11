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
import { updateShadowManagement } from "./shadowManage.js";
import { executeEntry, executeExit, executeReconcile, premiumExitReason, seedRemaining, entryKey, type ExecCtx } from "./execute.js";
import { computeFeatures } from "../../engine/engine";
import { specPremiumExit } from "../../engine/specEvaluate";
import type { StrategySpec } from "../../lib/desk/strategySpec";
import type { Bar } from "../../engine/types";

const RTH_OPEN = 570, RTH_CLOSE = 960;

// Phase B posture: ALL of (DRY_RUN=false, LIVE_TRADING=true, service role) — the
// two-key turn plus credentials. Anything less = shadow, exactly as Phase A.
const liveMode = (): boolean => !config.dryRun && config.liveTrading && config.hasServiceRole;
// A channel this instance EXECUTES: stream-owned + this worker's underlying
// (v1 is single-symbol; QQQ channels migrate in Phase B3 with a second symbol).
const ownedBy = (c: store.ChannelConfig): boolean => c.executor === "stream" && c.underlying === config.symbol.toUpperCase();
// Running peak option mid per open position (power giveback + sweep state).
const peakMidByKey = new Map<string, number>();

const bars = new BarStore(config.barHistory);
const chain = new ChainStore();
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
  const c = await store.loadConfig();
  if (c.fund) cfg = c;
  else warn("config: reload returned no fund_state — keeping previous");
}

async function refreshChain(): Promise<void> {
  const spot = bars.latest()?.close ?? 0;
  if (!spot) return;
  const today = alpaca.etParts(Date.now()).date;
  const toDate = alpaca.etParts(Date.now() + 5 * 24 * 3600 * 1000).date; // captures 0DTE + next session(s)
  try {
    chain.update(await alpaca.snapshotChain(config.symbol, spot, today, toDate));
  } catch (e) {
    warn(`chain: snapshot failed (feed=${config.optFeed}) — ${(e as Error).message}; keeping prior (${chain.size})`);
  }
}

async function seed(): Promise<void> {
  info("seed: backfilling bars + chain via REST");
  bars.seed(await retry("seed bars", () => alpaca.backfillBars(config.symbol, 3)));
  const l = bars.latest();
  info(`seed: ${bars.length} bars (latest ${l ? new Date(l.ts).toISOString() : "—"}, spot ${l?.close ?? "?"})`);
  await refreshChain();
  info(`seed: chain ${chain.size} contracts (feed=${config.optFeed})`);
}

async function cycle(trigger: string): Promise<void> {
  if (cycling) { return; } // never overlap cycles
  cycling = true;
  try {
    if (reloadPending) { reloadPending = false; await reloadConfig(); }
    if (!cfg.fund) { warn(`cycle(${trigger}): missing config — skip`); return; }

    // Decide on the last RTH *session* bar (buildSessionBars RTH-filters, so a
    // stray after-hours bar can't be the decision bar). minutesToClose + the gate
    // key off it, keeping them consistent with what the strategies actually see.
    const todayET = alpaca.etParts(Date.now()).date;
    const sessionBars = buildSessionBars(bars.all(), todayET);
    const lastSession = sessionBars[sessionBars.length - 1];
    if (!lastSession) { info(`cycle(${trigger}): no RTH bars for ${todayET} yet — skip`); return; }
    const barMin = alpaca.etParts(lastSession.ts).min;

    await refreshChain();
    let account, alpacaPositions;
    try { [account, alpacaPositions] = await Promise.all([alpaca.getAccount(), alpaca.getPositions()]); }
    catch (e) { warn(`cycle(${trigger}): Alpaca read failed — ${(e as Error).message}; skip`); return; }
    const openRowsArr = await store.getOpenPositions();

    const ctx: DecisionCtx = {
      sessionBars,
      chain,
      fund: cfg.fund,
      equity: account.equity,
      todayET,
      minutesToClose: Math.max(0, RTH_CLOSE - barMin),
      next1DTE: chain.nextExpiryAfter(todayET),
      ...computeLevels(bars.all(), todayET),
      openRows: new Map(openRowsArr.map((r) => [r.strategist_id, r])),
      alpacaByOcc: new Map(alpacaPositions.map((p) => [p.symbol, p])),
    };

    const decisions: ShadowDecision[] = [];
    for (const ch of cfg.channels) {
      try { decisions.push(await decideChannel(ch, ctx)); }
      catch (e) { warn(`decide ${ch.slug} failed — ${(e as Error).message}`); }
    }
    report(trigger, lastSession, account.equity, decisions);

    // ---- PHASE B: EXECUTE the decisions for channels this worker OWNS ----
    // (executor='stream' + this symbol). Everything else stays shadow-logged —
    // the lockstep comparison against the cron continues for free.
    if (liveMode()) {
      await store.heartbeat(`${WORKER_VERSION} cycle`);
      try {
        const [allOrders, openRowQty] = await Promise.all([alpaca.getOrders(), store.openRowQtyByOcc()]);
        const exec: ExecCtx = {
          chain,
          todayET,
          etMin: barMin,
          sinceIso: `${todayET}T00:00:00Z`,
          allOrders,
          alpacaByOcc: ctx.alpacaByOcc,
          remainingByOcc: seedRemaining(alpacaPositions),
          openRowQty,
        };
        const bySlug = new Map(cfg.channels.map((c) => [c.slug, c]));
        for (const d of decisions) {
          const ch = bySlug.get(d.slug);
          if (!ch || !ownedBy(ch)) continue;
          const row = ctx.openRows.get(ch.id);
          try {
            if (d.action === "reconcile" && row) await executeReconcile(d, row, exec);
            else if (d.action === "exit" && row && !d.blocked) await executeExit(d, row, exec);
            else if (d.action === "enter") await executeEntry(d, ch, Number(d.detail?.spotClose ?? lastSession.close), exec);
            else if (d.action === "hold" && row) {
              const alp = ctx.alpacaByOcc.get(row.occ_symbol);
              if (alp) {
                const unreal = Math.round((alp.current_price - row.avg_entry_price) * row.qty * 10000) / 100;
                await store.markPositionRow(row.id, alp.current_price, unreal);
              }
            }
          } catch (e) { warn(`execute ${d.slug} failed — ${(e as Error).message}`); }
        }
        await store.insertEquitySnapshot(account.equity, account.cash, alpacaPositions.reduce((a, p) => a + p.unrealized_pl, 0));
      } catch (e) { warn(`live execution pass failed — ${(e as Error).message}`); }
    }

    // Shadow MANAGEMENT what-if: run each managed channel's scale/BE/trail over
    // the live positions on the real-time quote (logs managed-vs-actual; no orders).
    try {
      await updateShadowManagement({
        rows: openRowsArr,
        slugById: new Map(cfg.channels.map((c) => [c.id, c.slug])),
        chain,
        sessionBars,
        atr: computeFeatures(sessionBars, sessionBars.length - 1).atr,
        etMin: barMin,
        minutesToClose: Math.max(0, RTH_CLOSE - barMin),
      });
    } catch (e) { warn(`shadow-management failed — ${(e as Error).message}`); }
  } catch (e) {
    // A cycle must never throw — it's fired forget-style from onBar, so an
    // unhandled rejection would otherwise take down the process.
    warn(`cycle(${trigger}) failed — ${(e as Error).message}`);
  } finally {
    cycling = false;
  }
}

function report(trigger: string, last: Bar, equity: number, ds: ShadowDecision[]): void {
  const m = alpaca.etParts(last.ts).min;
  const t = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const act = ds.filter((d) => d.action === "enter" || d.action === "exit" || d.action === "reconcile");
  shadow(`bar ${t}ET (${trigger}) spot ${last.close} equity $${Math.round(equity)} — ${ds.length} ch, ${act.length} actionable`);
  for (const d of ds) {
    if (d.action === "enter") {
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
    await refreshChain();
    const [positions, allOrders] = await Promise.all([alpaca.getPositions(), alpaca.getOrders()]);
    const todayET = alpaca.etParts(Date.now()).date;
    const exec: ExecCtx = {
      chain, todayET, etMin: nowMin, sinceIso: `${todayET}T00:00:00Z`,
      allOrders,
      alpacaByOcc: new Map(positions.map((p) => [p.symbol, p])),
      remainingByOcc: seedRemaining(positions),
      openRowQty: await store.openRowQtyByOcc(),
    };
    for (const r of rows) {
      const ch = byId.get(r.strategist_id)!;
      const mid = chain.byOcc(r.occ_symbol)?.mid ?? 0;
      if (!(mid > 0)) continue;
      const key = entryKey(r.strategist_id, r.occ_symbol);
      const peak = Math.max(peakMidByKey.get(key) ?? r.avg_entry_price, mid);
      peakMidByKey.set(key, peak);
      const pe = ch.spec_json ? specPremiumExit(ch.spec_json as StrategySpec) : undefined;
      const reason = premiumExitReason({
        row: r, slug: ch.slug, premiumExit: pe,
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

function onBar(bar: Bar): void {
  const isNew = bars.upsert(bar);
  // Only a NEW *RTH* closed bar triggers a decision (after-hours bars update
  // state but don't re-run the strategies).
  const m = alpaca.etParts(bar.ts).min;
  if (isNew && m >= RTH_OPEN && m < RTH_CLOSE) void cycle("bar-close");
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
    info(`◉ LIVE EXECUTOR — trading executor='stream' channels on ${config.symbol}; heartbeat → worker_heartbeat('stream'); fast exits every ${config.fastExitSec}s`);
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

  const stream = new StockBarStream(config.symbol, onBar, onReconnect);
  stream.start();

  // Phase B: the fast premium-exit sweep (no-op in shadow / outside RTH / flat).
  setInterval(() => { void fastExitSweep(); }, Math.max(5, config.fastExitSec) * 1000);

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
