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

import { config } from "./config.js";
import { info, warn, error, shadow } from "./log.js";
import * as alpaca from "./alpaca.js";
import * as store from "./store.js";
import { BarStore, ChainStore } from "./state.js";
import { StockBarStream } from "./stream.js";
import { decideChannel, buildSessionBars, computeLevels, type DecisionCtx, type ShadowDecision } from "./decide.js";
import type { Bar } from "../../engine/types";

const RTH_OPEN = 570, RTH_CLOSE = 960;

const bars = new BarStore(config.barHistory);
const chain = new ChainStore();
let cfg: { fund: store.FundState | null; channels: store.ChannelConfig[] } = { fund: null, channels: [] };
let reloadPending = false;
let cycling = false;

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
  bars.seed(await alpaca.backfillBars(config.symbol, 3));
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

    const ctx: DecisionCtx = {
      sessionBars,
      chain,
      fund: cfg.fund,
      equity: account.equity,
      todayET,
      minutesToClose: Math.max(0, RTH_CLOSE - barMin),
      next1DTE: chain.nextExpiryAfter(todayET),
      ...computeLevels(bars.all(), todayET),
      openRows: new Map((await store.getOpenPositions()).map((r) => [r.strategist_id, r])),
      alpacaByOcc: new Map(alpacaPositions.map((p) => [p.symbol, p])),
    };

    const decisions: ShadowDecision[] = [];
    for (const ch of cfg.channels) {
      try { decisions.push(await decideChannel(ch, ctx)); }
      catch (e) { warn(`decide ${ch.slug} failed — ${(e as Error).message}`); }
    }
    report(trigger, lastSession, account.equity, decisions);
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
  info("SEVE streaming worker — Phase A · SHADOW (the third engine driver)");
  const writeMode = config.hasServiceRole
    ? (config.shadowWriteEvents ? "events" : "none (service role, events off)")
    : "none (anon, read-only)";
  info(`feeds: stock=${config.stockFeed} opt=${config.optFeed} · dryRun=${config.dryRun} · writes=${writeMode}`);

  if (!config.dryRun) {
    error("DRY_RUN=false is NOT supported in v1 — Phase A is shadow-only. Live order placement is Phase B (see README). Refusing to start.");
    process.exit(1);
  }

  await reloadConfig();
  info(`config: ${cfg.fund ? `fund cap $${cfg.fund.total_capital_usd} mode=${cfg.fund.mode} halted=${cfg.fund.is_halted}` : "fund MISSING"}, ${cfg.channels.length} channels [${cfg.channels.map((c) => `${c.slug}:${c.status}`).join(", ")}]`);
  await seed();

  store.subscribeConfig(() => { reloadPending = true; });
  setInterval(() => { reloadPending = true; }, 30_000); // poll fallback if realtime is off

  // Decide once against the latest known bar at boot (validates the pipeline + is
  // useful when booting mid-session); thereafter every bar-close drives it.
  await cycle("boot");

  const stream = new StockBarStream(config.symbol, onBar, onReconnect);
  stream.start();

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => { info(`shutdown (${sig})`); stream.stop(); process.exit(0); });
  }
}

main().catch((e) => { error(`fatal — ${(e as Error).message}`); process.exit(1); });
