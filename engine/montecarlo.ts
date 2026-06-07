// Bootstrap Monte Carlo projection over a channel's real-fill backtest.
//
//   npm run montecarlo -- --strat breakout            # auto-runs the real/databento backtest
//   npm run montecarlo -- --strat power --horizon 63  # project a quarter (63 sessions)
//   npm run montecarlo -- --in /tmp/seve-mc-breakout.json   # reuse an emitted log (no re-run)
//
// WHY bootstrap (not parametric Monte Carlo): 0DTE option P&L is skewed/fat-tailed
// (convex — occasional big winners, stop-capped losers), so assuming a normal shape
// mis-models the tail. Bootstrap is non-parametric: it resamples the ACTUAL realized
// daily P&Ls, preserving the real tail.
//
// WHY block (the default, not i.i.d.): this desk's edge clusters by regime (trending
// vs chop), so losing days bunch up. Plain i.i.d. resampling shuffles that clustering
// away and UNDERSTATES drawdown. A circular block bootstrap resamples contiguous runs
// of sessions, keeping losing streaks intact — the honest version for a regime desk.
//
// WHAT it is NOT: a forecast. It quantifies sampling + sequence uncertainty WITHIN the
// sampled period. It can't know if the next regime differs, and it won't rescue an
// overfit strategy. Feed it the months-long backtest, not a thin live week.
//
// Source of trades: it shells out to engine/backtest.ts with --emit-trades (so the
// backtest stays the single source of truth — this file never re-simulates), then
// bootstraps the emitted per-session P&L log.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---- args ----
const argStr = (name: string, def: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const argNum = (name: string, def: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : def;
};

interface DayPnl { date: string; pnl: number; trades: number }
interface Emit { strat: string; underlying?: string; source?: string; options?: string; span?: string; perDay: DayPnl[] }

// --json → emit a single machine-readable summary line (and suppress the sourced
// backtest's stdout) so a roster runner can aggregate many channels.
const jsonMode = process.argv.includes("--json");

// Absolute path to the local tsx binary — so the backtest re-spawn works whether we
// were launched via `npm run` (node_modules/.bin on PATH) or a bare `node`/spawn (not).
const TSX_BIN = join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");

// ---- get the per-session P&L log (from --in, else run the backtest to a temp file) ----
function loadLog(): Emit {
  const inPath = argStr("in", "");
  if (inPath) return JSON.parse(readFileSync(inPath, "utf8")) as Emit;

  const strat = argStr("strat", "");
  if (!strat) {
    console.error("montecarlo: pass --strat <slug> (auto-runs the backtest) or --in <emitted-log.json>");
    process.exit(1);
  }
  const source = argStr("source", "real");
  const options = argStr("options", "databento");
  const tmp = join(tmpdir(), `seve-mc-${strat.replace(/[^a-z0-9-]/gi, "_")}.json`);
  const args = ["engine/backtest.ts", "--strat", strat, "--source", source, "--options", options, "--emit-trades", tmp];
  for (const p of ["days", "underlying", "spec"] as const) { const v = argStr(p, ""); if (v) args.push(`--${p}`, v); }
  if (process.argv.includes("--gross")) args.push("--gross");
  if (!jsonMode) console.log(`▶ sourcing trades from the backtest:\n  tsx ${args.join(" ")}`);
  try {
    // json mode → swallow the backtest's stdout (keep stderr) so only our summary prints
    execFileSync(TSX_BIN, args, { stdio: jsonMode ? ["ignore", "ignore", "inherit"] : "inherit" });
  } catch {
    console.error("\nmontecarlo: backtest run failed. Run it yourself with --emit-trades, then pass --in:\n" +
      `  npm run backtest -- --strat ${strat} --source ${source} --options ${options} --emit-trades ${tmp}\n` +
      `  npm run montecarlo -- --in ${tmp}\n`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(tmp, "utf8")) as Emit;
}

// ---- seeded RNG (reproducible runs via --seed) ----
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- stats helpers ----
const pctile = (sorted: number[], p: number): number => {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};
const mean = (a: number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const std = (a: number[]): number => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1));
};
const usd = (v: number): string => (v < 0 ? "−$" : "$") + Math.round(Math.abs(v)).toLocaleString();
const pct = (v: number): string => (v * 100).toFixed(1) + "%";

// ---- one bootstrapped path's outcome ----
interface PathOut { terminal: number; maxDD: number; downDays: number; breaches: number; checkpoints: number[] }
function walk(daily: number[], checkpointIdx: number[], stopUsd: number): PathOut {
  let cum = 0, peak = 0, maxDD = 0, downDays = 0, breaches = 0, ci = 0;
  const checkpoints: number[] = [];
  for (let i = 0; i < daily.length; i++) {
    cum += daily[i];
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDD) maxDD = dd;
    if (daily[i] < 0) downDays++;
    if (stopUsd > 0 && daily[i] <= -stopUsd) breaches++;
    while (ci < checkpointIdx.length && i === checkpointIdx[ci]) { checkpoints.push(cum); ci++; }
  }
  while (checkpoints.length < checkpointIdx.length) checkpoints.push(cum);
  return { terminal: cum, maxDD, downDays, breaches, checkpoints };
}

function main() {
  const log = loadLog();
  const D = log.perDay.map((d) => d.pnl);
  const nDays = D.length;
  if (nDays < 2) { console.error("montecarlo: need ≥2 sessions of P&L to resample."); process.exit(1); }

  const N = argNum("n", 10000);
  const mode = argStr("mode", "block") === "iid" ? "iid" : "block";
  const B = mode === "iid" ? 1 : Math.max(1, argNum("block", 5));
  const H = Math.max(1, argNum("horizon", nDays));
  const stopUsd = argNum("stop", 0);
  const capital = argNum("capital", 0);
  const rnd = mulberry32(argNum("seed", 1));

  // ---- realized (the one path the backtest actually produced) ----
  const realized = walk(D, [], stopUsd);
  const totalPnl = realized.terminal;
  const tradedDays = log.perDay.filter((d) => d.trades > 0);
  const winDays = D.filter((x) => x > 0).length;
  const totalTrades = log.perDay.reduce((a, d) => a + d.trades, 0);
  const perDayMean = mean(D), perDayStd = std(D);
  const sharpe = perDayStd > 0 ? (perDayMean / perDayStd) * Math.sqrt(252) : 0;

  // ---- bootstrap ----
  const checkpointFr = [0.25, 0.5, 0.75, 1.0];
  const checkpointIdx = checkpointFr.map((f) => Math.max(0, Math.round(f * H) - 1));
  const terms: number[] = [], dds: number[] = [], downs: number[] = [], breaches: number[] = [];
  const cps: number[][] = checkpointFr.map(() => []);
  for (let it = 0; it < N; it++) {
    const path: number[] = [];
    while (path.length < H) {
      const start = Math.floor(rnd() * nDays);
      for (let k = 0; k < B && path.length < H; k++) path.push(D[(start + k) % nDays]);
    }
    const o = walk(path, checkpointIdx, stopUsd);
    terms.push(o.terminal); dds.push(o.maxDD); downs.push(o.downDays); breaches.push(o.breaches);
    o.checkpoints.forEach((c, j) => cps[j].push(c));
  }
  terms.sort((a, b) => a - b); dds.sort((a, b) => a - b);
  const pNeg = terms.filter((t) => t < 0).length / N;
  const pBreach = stopUsd > 0 ? breaches.filter((b) => b > 0).length / N : null;

  // ---- machine-readable summary (for a roster runner) ----
  if (jsonMode) {
    console.log(JSON.stringify({
      strat: log.strat, underlying: log.underlying ?? null, options: log.options ?? null, span: log.span ?? null,
      mode, block: B, n: N, horizon: H, nDays, tradedDays: tradedDays.length, trades: totalTrades,
      realizedTotal: Math.round(totalPnl), realizedMaxDD: Math.round(realized.maxDD),
      winDayPct: +(winDays / nDays).toFixed(3), perDayMean: Math.round(perDayMean), sharpe: +sharpe.toFixed(2),
      p5: Math.round(pctile(terms, 0.05)), p25: Math.round(pctile(terms, 0.25)), p50: Math.round(pctile(terms, 0.5)),
      p75: Math.round(pctile(terms, 0.75)), p95: Math.round(pctile(terms, 0.95)), mean: Math.round(mean(terms)),
      pNeg: +pNeg.toFixed(3), medMaxDD: Math.round(pctile(dds, 0.5)), p95MaxDD: Math.round(pctile(dds, 0.95)),
      pBreach: pBreach == null ? null : +pBreach.toFixed(3),
    }));
    return;
  }

  // ---- report ----
  const W = 64, bar = "═".repeat(W);
  const row = (k: string, v: string) => console.log(`  ${k.padEnd(20)}${v}`);
  console.log("\n" + bar);
  console.log(`  BOOTSTRAP MONTE CARLO · ${log.strat}${log.underlying ? " · " + log.underlying : ""}`);
  if (log.span) console.log(`  ${log.span}`);
  console.log(`  ${mode === "block" ? `block bootstrap (B=${B} sessions)` : "i.i.d. bootstrap"} · ${N.toLocaleString()} paths · horizon ${H} sessions`);
  console.log(bar);
  console.log("  REALIZED (the single backtested path)");
  row("Sessions", `${nDays}  (${tradedDays.length} with trades, ${totalTrades} trades)`);
  row("Total P&L", `${usd(totalPnl)}  (net of cost)`);
  row("Max drawdown", usd(realized.maxDD));
  row("Win days", `${winDays}/${nDays}  (${pct(winDays / nDays)})`);
  row("P&L / session", `${usd(perDayMean)}  ± ${usd(perDayStd)} (1σ)`);
  row("Daily Sharpe×√252", sharpe.toFixed(2));
  console.log(bar);
  console.log(`  PROJECTED over ${H} sessions  (${N.toLocaleString()} bootstrap paths)`);
  console.log("  ── terminal P&L distribution ──");
  row("  p5  (bad)", usd(pctile(terms, 0.05)));
  row("  p25", usd(pctile(terms, 0.25)));
  row("  p50  (median)", usd(pctile(terms, 0.50)));
  row("  p75", usd(pctile(terms, 0.75)));
  row("  p95  (good)", usd(pctile(terms, 0.95)));
  row("  mean", usd(mean(terms)));
  row("P(period < $0)", pct(pNeg));
  console.log("  ── max-drawdown distribution (peak-to-trough) ──");
  row("  median maxDD", usd(pctile(dds, 0.50)));
  row("  p95 maxDD (1-in-20)", usd(pctile(dds, 0.95)));
  row("  worst seen", usd(dds[dds.length - 1]));
  if (capital > 0) {
    row("  p95 maxDD / capital", pct(pctile(dds, 0.95) / capital));
    const ruin = terms.filter((t) => t <= -capital).length / N;
    row(`P(ruin: lose ${usd(capital)})`, pct(ruin));
  }
  if (pBreach != null) {
    row(`P(any day ≤ −${usd(stopUsd)})`, pct(pBreach));
    row("  avg breach days", (mean(breaches)).toFixed(1));
  }
  console.log("  ── cumulative-P&L cone (percentile bands) ──");
  console.log(`  ${"@session".padEnd(12)}${"p5".padStart(12)}${"p50".padStart(12)}${"p95".padStart(12)}`);
  checkpointFr.forEach((f, j) => {
    const s = cps[j].slice().sort((a, b) => a - b);
    const at = (checkpointIdx[j] + 1).toString();
    console.log(`  ${at.padEnd(12)}${usd(pctile(s, 0.05)).padStart(12)}${usd(pctile(s, 0.50)).padStart(12)}${usd(pctile(s, 0.95)).padStart(12)}`);
  });
  console.log(bar);
  console.log("  NB: bootstrap quantifies sampling + sequence risk within the sampled");
  console.log("  period — not a forecast. Block mode keeps losing streaks intact; try");
  console.log("  --mode iid to see how much the regime clustering widens drawdowns.\n");
}

main();
