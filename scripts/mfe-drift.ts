// ============================================================================
//  mfe-drift — per-channel behavior-drift monitor (weekly run).
//
//  "Are the live channels still behaving like the model that justified arming
//  them?" Compares, per AUTO channel (manual twins excluded):
//    LIVE  — last N closed trades (positions table): MFE% (peak option_quotes
//            mid vs entry fill), giveback% on green trades, hold minutes, win
//            rate, exit-reason mix (worker journal in `events`), $/contract.
//    MODEL — the engine backtest over the most recent Databento-covered window,
//            live-faithful per the probe corpus (worker base-slug resolution,
//            spec_json entries/exits/trail, cost gate 3.0, config ustop, −50%
//            catastrophic stop), MFE from the same NBBO the fills come from.
//  Flags material divergence (MFE median, win rate, hold time, exit-mix flip,
//  entry rate) → verdict OK / DRIFT / LOW-SAMPLE per channel.
//
//    npm run mfe-drift
//    npm run mfe-drift -- --live-days 10 --model-sessions 80 --channel grind-v3 --json
//
//  DETECTION ONLY. The output feeds the month-end promote/cut ladder (a human
//  decision). It NEVER tunes targets/trails/params — the exit-study corpus
//  (tier2/breakeven/late-gate verdicts) refuted auto-adjusting exits from this
//  kind of data. Read-only (anon); touches no worker, strategy, or config.
//
//  Bounds to know: live peaks need option_quotes (7-DAY retention — run weekly,
//  no nightly quote export exists); exit reasons need events (30d); the model
//  window ends at the local Databento cache's last day (refresh via
//  npm run backfill:databento [-- --underlying QQQ] for a tighter match).
// ============================================================================

import { simulateSession } from "../engine/backtest";
import { specToStrategyDef, specPremiumExit } from "../engine/specEvaluate";
import { specTrail, type StrategySpec } from "../lib/desk/strategySpec";
import { STRATEGY_REGISTRY } from "../engine/registry";
import { loadRealSessions, type RealSession } from "../engine/realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "../engine/databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "../engine/cost";
import type { ChainProvider } from "../engine/optionsource";
import type { Evaluate, FundState, OptType, StrategistConfig, Trade } from "../engine/types";
import { createServerSupabaseClient } from "./serverSupabase";

// ---- CLI -------------------------------------------------------------------
const arg = (n: string, d: string): string => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const LIVE_DAYS = Number(arg("live-days", "14"));      // live lookback (peaks only survive ~7d of it)
const LIVE_CAP = Number(arg("n", "60"));               // max live trades per channel
const MODEL_SESSIONS = Number(arg("model-sessions", "60")); // model window length (covered sessions)
const ONLY = arg("channel", "");                       // optional slug filter
const JSON_OUT = process.argv.includes("--json");

const sb = createServerSupabaseClient("mfe-drift");

// ---- live-faithful constants (worker 2026-06-10a) ---------------------------
const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE = { minMoveToCostRatio: 3.0 };  // COST_GATE_RATIO, exempt set empty since 06-09a
const CATASTROPHIC_STOP_PCT = 50;          // PREMIUM_STOP_PCT — global backstop
// worker base-slug precedence: exact REGISTRY hit, then ticker-suffix-stripped, then spec_json
const baseSlug = (s: string) => s.replace(/-(qqq|spy)$/i, "");

// ---- exit-reason buckets (shared vocab — one engine, two drivers) ------------
const BUCKET: Record<string, string> = {
  stop: "stop", stop_premium: "stop", premium_stop: "stop", underlying_stop: "stop", failed_break: "stop",
  target: "target", target_premium: "target", move_target: "target", target_vwap: "target",
  time_stop: "time", time_exit: "time", eod_flatten: "time", manual_eod_backstop: "time",
  trail_stop: "trail", trail_chandelier: "trail", trail_giveback: "trail",
};
const bucketOf = (r: string) => BUCKET[r] ?? "other";

// ---- shared per-trade record + distribution stats ----------------------------
interface T { pnl: number; qty: number; entry: number; exit: number; holdMin: number; reason: string; peak: number | null }
interface SideStats {
  n: number; perDay: number; win: number | null; medMfe: number | null; mfeN: number;
  medGive: number | null; giveN: number; medHold: number | null; perCt: number | null;
  mix: Record<string, number>; mixKnown: number;
}
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mfeOf = (t: T): number | null => (t.peak != null && t.entry > 0 ? ((t.peak - t.entry) / t.entry) * 100 : null);
function sideStats(ts: T[], days: number): SideStats {
  const mfes = ts.map(mfeOf).filter((v): v is number => v != null);
  // giveback% of the peak GAIN, on trades that were meaningfully green (MFE ≥ +20%)
  const gives: number[] = [];
  for (const t of ts) {
    const m = mfeOf(t);
    if (m == null || m < 20 || t.peak == null || t.peak <= t.entry) continue;
    gives.push(Math.max(0, ((t.peak - t.exit) / (t.peak - t.entry)) * 100));
  }
  const mix: Record<string, number> = {};
  let known = 0;
  for (const t of ts) { const b = bucketOf(t.reason); if (t.reason !== "—") { mix[b] = (mix[b] ?? 0) + 1; known++; } }
  return {
    n: ts.length,
    perDay: days > 0 ? ts.length / days : 0,
    win: ts.length ? (ts.filter((t) => t.pnl > 0).length / ts.length) * 100 : null,
    medMfe: median(mfes), mfeN: mfes.length,
    medGive: median(gives), giveN: gives.length,
    medHold: median(ts.map((t) => t.holdMin)),
    perCt: ts.length ? ts.reduce((a, t) => a + (t.qty > 0 ? t.pnl / t.qty : 0), 0) / ts.length : null,
    mix, mixKnown: known,
  };
}
const domBucket = (s: SideStats): string | null => {
  const e = Object.entries(s.mix).sort((a, b) => b[1] - a[1]);
  return e.length ? e[0][0] : null;
};
const mixShare = (s: SideStats, b: string): number => (s.mixKnown ? ((s.mix[b] ?? 0) / s.mixKnown) * 100 : 0);

// ---- divergence flags (the thresholds are the deliverable's contract) --------
function divergence(live: SideStats, model: SideStats): string[] {
  const fl: string[] = [];
  const rl = live.perDay, rm = model.perDay;
  if (rm > 0.05 || rl > 0.05) {
    const lo = Math.min(rl, rm), hi = Math.max(rl, rm);
    if ((lo === 0 && hi > 0.2) || (lo > 0 && hi / lo > 3)) fl.push(`entry RATE ${rl.toFixed(2)}/d live vs ${rm.toFixed(2)}/d model`);
  }
  if (live.medMfe != null && model.medMfe != null && Math.abs(live.medMfe - model.medMfe) > 15)
    fl.push(`MFE med ${fmtPct(live.medMfe)} live vs ${fmtPct(model.medMfe)} model (Δ>${15}pts)`);
  if (live.win != null && model.win != null && Math.abs(live.win - model.win) > 10)
    fl.push(`WIN ${live.win.toFixed(0)}% live vs ${model.win.toFixed(0)}% model (Δ>10pts)`);
  if (live.medHold != null && model.medHold != null && live.medHold > 0 && model.medHold > 0) {
    const r = live.medHold / model.medHold;
    if (r > 2 || r < 0.5) fl.push(`HOLD ${Math.round(live.medHold)}m live vs ${Math.round(model.medHold)}m model (>2x)`);
  }
  if (live.giveN >= 5 && model.giveN >= 5 && live.medGive != null && model.medGive != null && Math.abs(live.medGive - model.medGive) > 25)
    fl.push(`GIVEBACK med ${live.medGive.toFixed(0)}% live vs ${model.medGive.toFixed(0)}% model (Δ>25pts)`);
  const dl = domBucket(live), dm = domBucket(model);
  if (live.mixKnown >= 5 && model.mixKnown >= 5 && dl && dm) {
    if (dl !== dm) fl.push(`EXIT MIX flipped: live exits mostly '${dl}', model mostly '${dm}'`);
    else if (mixShare(model, dm) - mixShare(live, dm) > 30) fl.push(`EXIT MIX shifted: '${dm}' ${mixShare(live, dm).toFixed(0)}% live vs ${mixShare(model, dm).toFixed(0)}% model`);
  }
  return fl;
}

// ---- formatting --------------------------------------------------------------
const fmtPct = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${Math.round(v)}%`);
const fmt$ = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}$${Math.abs(Math.round(v))}`);
const fmtM = (v: number | null) => (v == null ? "—" : `${Math.round(v)}m`);
const pad = (s: string, n: number) => s.padEnd(n);
const padL = (s: string, n: number) => s.padStart(n);
const mixStr = (s: SideStats) =>
  Object.entries(s.mix).sort((a, b) => b[1] - a[1]).map(([b, n]) => `${b} ${Math.round((n / s.mixKnown) * 100)}%`).join(" · ") || "—";

// ~US weekdays in [fromMs, toMs] — the live trades/day denominator (holiday-blind, labeled ~).
function weekdaysBetween(fromMs: number, toMs: number): number {
  let n = 0;
  for (let t = fromMs; t <= toMs; t += 86_400_000) { const d = new Date(t).getUTCDay(); if (d >= 1 && d <= 5) n++; }
  return Math.max(1, n);
}

// ---- roster ------------------------------------------------------------------
interface ChannelRow {
  id: string; slug: string; name: string; underlying: string; muted: boolean;
  spec: StrategySpec | null; maxContracts: number; ustop: number; sortOrder: number;
}
async function loadRoster(): Promise<ChannelRow[]> {
  const { data, error } = await sb.from("strategists")
    .select("id,slug,name,underlying,status,spec_json,sort_order,strategist_config(max_contracts,underlying_stop_pct,muted)");
  if (error) throw new Error("strategists read: " + error.message);
  const rows: ChannelRow[] = [];
  for (const s of (data ?? []) as any[]) {
    if (s.status !== "armed") continue;
    if (/-manual$/i.test(s.slug)) continue; // the operator's book is a different experiment
    if (ONLY && s.slug !== ONLY) continue;
    const c = Array.isArray(s.strategist_config) ? s.strategist_config[0] : s.strategist_config;
    rows.push({
      id: s.id, slug: s.slug, name: s.name ?? s.slug,
      underlying: (s.underlying ?? "SPY").toUpperCase(),
      muted: !!c?.muted,
      spec: (s.spec_json ?? null) as StrategySpec | null,
      maxContracts: Number(c?.max_contracts ?? 6),
      ustop: Number(c?.underlying_stop_pct ?? 0),
      sortOrder: Number(s.sort_order ?? 999),
    });
  }
  return rows.sort((a, b) => a.sortOrder - b.sortOrder);
}

// ---- LIVE side ----------------------------------------------------------------
interface ExitEvent { message: string; tsMs: number }
async function fetchExitEvents(sinceIso: string): Promise<ExitEvent[]> {
  const out: ExitEvent[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from("events").select("message,created_at")
      .gte("created_at", sinceIso)
      .or("message.ilike.%exit%,message.ilike.%reconcil%")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error("events read: " + error.message);
    const rows = (data ?? []) as Array<{ message: string; created_at: string }>;
    out.push(...rows.map((r) => ({ message: r.message, tsMs: Date.parse(r.created_at) })));
    if (rows.length < PAGE) break;
  }
  return out;
}

async function liveTrades(ch: ChannelRow, sinceIso: string, events: ExitEvent[]): Promise<{ trades: T[]; peakN: number }> {
  const { data, error } = await sb.from("positions")
    .select("occ_symbol,opt_type,strike,qty,avg_entry_price,realized_pnl,opened_at,closed_at")
    .eq("strategist_id", ch.id).eq("status", "closed")
    .gte("closed_at", sinceIso)
    .order("closed_at", { ascending: false }).limit(LIVE_CAP);
  if (error) throw new Error(`positions read (${ch.slug}): ` + error.message);
  const rows = ((data ?? []) as any[]).reverse();

  // peak option_quotes mid between open and close, per trade (7d retention bounds this)
  const peeks: Array<number | null> = new Array(rows.length).fill(null);
  const CONC = 8;
  for (let i = 0; i < rows.length; i += CONC) {
    await Promise.all(rows.slice(i, i + CONC).map(async (p, j) => {
      const { data: pk } = await sb.from("option_quotes").select("mid").eq("occ_symbol", p.occ_symbol)
        .gte("captured_at", p.opened_at).lte("captured_at", p.closed_at)
        .order("mid", { ascending: false }).limit(1).maybeSingle();
      peeks[i + j] = pk?.mid != null ? Number(pk.mid) : null;
    }));
  }

  const trades: T[] = [];
  let peakN = 0;
  rows.forEach((p, i) => {
    const entry = Number(p.avg_entry_price), qty = Number(p.qty), pnl = Number(p.realized_pnl ?? 0);
    if (!(qty > 0) || !(entry > 0) || !p.opened_at || !p.closed_at) return;
    const exit = entry + pnl / (qty * 100); // fill-derived, same as day-report
    const ev = events.find((e) =>
      e.message.includes(p.occ_symbol) && e.message.includes(ch.slug)
      && Math.abs(e.tsMs - Date.parse(p.closed_at)) < 180_000);
    const reason = ev?.message.match(/\(([a-z_0-9]+)\)\s*$/i)?.[1] ?? (ev && /reconcil/i.test(ev.message) ? "reconciled" : "—");
    if (peeks[i] != null) peakN++;
    trades.push({
      pnl, qty, entry, exit,
      holdMin: Math.max(0, Math.round((Date.parse(p.closed_at) - Date.parse(p.opened_at)) / 60_000)),
      reason, peak: peeks[i],
    });
  });
  return { trades, peakN };
}

// ---- MODEL side -----------------------------------------------------------------
interface DbSeries { strike: number; optType: OptType; ts: number[]; bid: number[]; ask: number[] }
interface ModelData { sessions: RealSession[]; chainOf: (s: RealSession) => ChainProvider; seriesOf: (date: string) => DbSeries[] }
const FILL_LAG_MS = 60_000; // tick-ideal fill (makeDatabentoChain default; fill-lag verdict: cron band immaterial here)

async function loadModel(u: string): Promise<ModelData | null> {
  const lookback = Math.max(150, Math.ceil(MODEL_SESSIONS * 1.9) + 30);
  const sessions = await loadRealSessions({ symbol: u, sinceDaysAgo: lookback });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET), u) as unknown as Map<string, DbSeries[]>;
  const covered = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0).slice(-MODEL_SESSIONS);
  if (!covered.length) return null;
  return {
    sessions: covered,
    chainOf: (s) => makeDatabentoChain(byDay.get(s.dateET) as unknown as Parameters<typeof makeDatabentoChain>[0]),
    seriesOf: (date) => byDay.get(date) ?? [],
  };
}

// worker resolution: exact REGISTRY → base-slug REGISTRY → compiled spec_json
function resolveEvaluate(ch: ChannelRow): { makeEval: (s: RealSession) => Evaluate; kind: string } | null {
  const def = STRATEGY_REGISTRY[ch.slug] ?? STRATEGY_REGISTRY[baseSlug(ch.slug)];
  if (def) return { makeEval: (s) => def.build(s.bars, def.timeframeMin), kind: "builtin" };
  if (ch.spec) {
    const cd = specToStrategyDef(ch.spec);
    return { makeEval: (s) => cd.build(s.bars, cd.timeframeMin, { pdh: s.pdh, pdl: s.pdl }), kind: "spec" };
  }
  return null;
}

function modelTrades(ch: ChannelRow, md: ModelData): { trades: T[]; kind: string } | null {
  const r = resolveEvaluate(ch);
  if (!r) return null;
  // exits, live-faithful: spec premium target/stop (catastrophic −50% floor), armable
  // chandelier trail (the only worker-wired trail mode), config ustop, cost gate 3.0
  let premiumExit: { profitPct?: number; stopPct?: number } = { stopPct: CATASTROPHIC_STOP_PCT };
  let trailExit: { atrChandelierK?: number } | undefined;
  if (r.kind === "spec" && ch.spec) {
    const pe = specPremiumExit(ch.spec);
    premiumExit = {
      ...(pe.profitPct != null ? { profitPct: pe.profitPct } : {}),
      stopPct: Math.min(pe.stopPct ?? CATASTROPHIC_STOP_PCT, CATASTROPHIC_STOP_PCT),
    };
    const t = specTrail(ch.spec.management);
    if (t?.atrChandelierK != null) trailExit = { atrChandelierK: t.atrChandelierK };
  }
  const cfg: StrategistConfig = { slug: ch.slug, capital_pct: 100, aggression: 100, max_contracts: ch.maxContracts, daily_stop_usd: 1e9, muted: false, soloed: false };

  const out: T[] = [];
  for (const s of md.sessions) {
    const tr: Trade[] = simulateSession(s.bars, cfg, FUND, r.makeEval(s), md.chainOf(s), false,
      premiumExit, NBBO, undefined, trailExit, undefined, undefined, ch.ustop > 0 ? ch.ustop : undefined, GATE);
    const series = md.seriesOf(s.dateET);
    for (const t of tr) {
      // peak NBBO mid over the held window, same 1-min granularity as option_quotes
      const c = series.find((x) => x.optType === t.optType && Math.abs(x.strike - t.strike) < 0.01);
      let peak: number | null = null;
      if (c) {
        const a = t.entryTs + FILL_LAG_MS, b = t.exitTs + FILL_LAG_MS;
        for (let i = 0; i < c.ts.length; i++) {
          if (c.ts[i] < a) continue;
          if (c.ts[i] > b) break;
          const m = (c.bid[i] + c.ask[i]) / 2;
          if (peak == null || m > peak) peak = m;
        }
      }
      out.push({
        pnl: t.pnl, qty: t.qty, entry: t.entryPrice, exit: t.exitPrice,
        holdMin: Math.max(0, Math.round((t.exitTs - t.entryTs) / 60_000)),
        reason: t.exitReason, peak,
      });
    }
  }
  return { trades: out, kind: r.kind };
}

// ---- main ------------------------------------------------------------------------
interface Result {
  slug: string; underlying: string; kind: string; muted: boolean;
  live: SideStats & { peakN: number }; model: SideStats | null;
  modelWindow: string | null; flags: string[]; verdict: string;
}

async function main() {
  const now = Date.now();
  const sinceMs = now - LIVE_DAYS * 86_400_000;
  const sinceIso = new Date(sinceMs).toISOString();
  const liveDays = weekdaysBetween(sinceMs, now);

  const roster = await loadRoster();
  if (!roster.length) { console.log(`\nNo armed auto channels${ONLY ? ` matching '${ONLY}'` : ""}.\n`); return; }

  console.log(`\n  MFE-DRIFT monitor · live = last ${LIVE_DAYS}d (~${liveDays} trading days) vs model = last ${MODEL_SESSIONS} Databento-covered sessions`);
  console.log(`  ${roster.length} armed auto channels (manual twins excluded) · detection only — feeds the month-end promote/cut ladder, NEVER auto-tunes\n`);

  const events = await fetchExitEvents(sinceIso);

  // model data per underlying, loaded once
  const modelByU = new Map<string, ModelData | null>();
  for (const u of [...new Set(roster.map((c) => c.underlying))]) {
    process.stderr.write(`  loading model data for ${u}…\n`);
    modelByU.set(u, await loadModel(u));
  }

  const results: Result[] = [];
  for (const ch of roster) {
    process.stderr.write(`  ▶ ${ch.slug}\n`);
    const { trades: lt, peakN } = await liveTrades(ch, sinceIso, events);
    const live = { ...sideStats(lt, liveDays), peakN };

    const md = modelByU.get(ch.underlying) ?? null;
    const mt = md ? modelTrades(ch, md) : null;
    const model = mt ? sideStats(mt.trades, md!.sessions.length) : null;
    const modelWindow = md ? `${md.sessions[0].dateET}→${md.sessions[md.sessions.length - 1].dateET}` : null;

    const flags = model ? divergence(live, model) : [];
    const verdict =
      !model ? (md ? "NO-MODEL" : "NO-DATA") :
      live.n === 0 ? (flags.length ? "NO-TRADES ⚠" : "NO-TRADES") :
      live.n < 20 ? (flags.length ? "LOW-SAMPLE ⚠" : "LOW-SAMPLE") :
      flags.length ? "DRIFT" : "OK";
    results.push({ slug: ch.slug, underlying: ch.underlying, kind: mt?.kind ?? "—", muted: ch.muted, live, model, modelWindow, flags, verdict });
  }

  // ---- table ----
  const hdr = pad("channel", 26) + pad("u", 5) + padL("live n(pk)", 11) + padL("t/d L|M", 12)
    + padL("MFEmed L|M", 13) + padL("win% L|M", 11) + padL("hold L|M", 11) + padL("give L|M", 11) + padL("$/ct L|M", 13) + "  verdict";
  console.log("  " + hdr);
  console.log("  " + "─".repeat(hdr.length));
  for (const r of results) {
    const L = r.live, M = r.model;
    const cell = (a: string, b: string) => `${a}|${b}`;
    console.log("  " +
      pad(r.slug + (r.muted ? " (muted)" : ""), 26) + pad(r.underlying, 5) +
      padL(`${L.n}(${L.peakN})`, 11) +
      padL(cell(L.perDay.toFixed(1), M ? M.perDay.toFixed(1) : "—"), 12) +
      padL(cell(fmtPct(L.medMfe), M ? fmtPct(M.medMfe) : "—"), 13) +
      padL(cell(L.win != null ? L.win.toFixed(0) : "—", M?.win != null ? M.win.toFixed(0) : "—"), 11) +
      padL(cell(fmtM(L.medHold), M ? fmtM(M.medHold) : "—"), 11) +
      padL(cell(L.medGive != null ? `${Math.round(L.medGive)}%` : "—", M?.medGive != null ? `${Math.round(M.medGive)}%` : "—"), 11) +
      padL(cell(fmt$(L.perCt), M ? fmt$(M.perCt) : "—"), 13) +
      "  " + r.verdict);
  }

  // ---- exit mix + flags detail ----
  console.log("\n  exit-reason mix (live → model):");
  for (const r of results) {
    if (r.live.n === 0 && !r.model) continue;
    console.log(`  ${pad(r.slug, 26)} L: ${mixStr(r.live)} (${r.live.mixKnown}/${r.live.n} tagged)`);
    if (r.model) console.log(`  ${pad("", 26)} M: ${mixStr(r.model)} (${r.model.n}t · ${r.modelWindow})`);
    for (const f of r.flags) console.log(`  ${pad("", 26)} ⚠ ${f}`);
  }

  // ---- caveats footer (the honest-labeling contract) ----
  const winEnds = [...new Set(results.map((r) => r.modelWindow?.split("→")[1]).filter(Boolean))];
  console.log(`\n  CAVEATS — read before acting:`);
  if (winEnds.length) console.log(`  · model window ends ${winEnds.join(" / ")} (local Databento cache) — the live week is NOT in the model window;`);
  console.log(`    a flag can be regime, not drift (06-09..11 = two −1.2% days + a 20-leg whipsaw). Refresh: npm run backfill:databento [-- --underlying QQQ].`);
  console.log(`  · live MFE/giveback need option_quotes (7-DAY retention, no nightly export exists) — 'pk' counts trades with peak coverage; run this weekly.`);
  console.log(`  · live exit reasons parse the worker journal in events (30d): '—' = no matching journal line (bucketed 'other').`);
  console.log(`  · $/ct = P&L per CONTRACT per trade (live sizes RISK-$ 1-4 lots; model sizes max_contracts — totals aren't comparable, per-contract is).`);
  console.log(`  · model omits the live daily-stop latch + power's +100%-engage giveback trail; live week may truncate after a latch.`);
  console.log(`  · DETECTION ONLY: divergence feeds the month-end promote/cut verdict (human). Do NOT retune targets/trails from this output`);
  console.log(`    (tier2-conservative-targets / breakeven-stop / late-leans-gate verdicts: exit auto-tuning from realized distributions is the mirage).\n`);

  if (JSON_OUT) console.log("JSON:\n" + JSON.stringify(results));
}

main().catch((e) => { console.error(e); process.exit(1); });
