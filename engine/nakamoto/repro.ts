/**
 * Phase-1 signal reproduction vs Nakamoto's paperC trade log — full-fidelity
 * version per the 06-09 addendum (LOOP_FACTS + real momentum_patterns + the
 * bot's own levels_<date>.json audits).
 *
 * Faithful loop (LOOP_FACTS): scan every 60 s while flat; bars_5m =
 * resample(1m → 5m) with NO drop of the last bin (the forming bar IS the
 * signal/break bar); 1m span = 04:00 PT (premarket) → now, feed IEX;
 * paperC env = WIN 07:00–12:30 PT, BAN 09:00–10:00 PT, REV_CUTOFF off.
 * Irreducible fuzz: live strike = round(live IEX quote MID) at the scan
 * instant — unrecoverable from bar data; we proxy with the last 1m close.
 * Their own re-run reproduced right+confidence on only 18/32 (their stated
 * ceiling); the diff is distributional, not tick-exact, by construction.
 *
 * Two tests:
 *  A. ENRICHED-AGREEMENT — mirror enrich_tradelog.py exactly (1m bars with
 *     start ≤ fill ts, resample, spot = last 1m close, audit levels) and
 *     compare my (setup, conf, right) to their re-derived columns per trade.
 *     This is port-correctness on REAL data: same inputs → same outputs.
 *  B. TRADE MATCHING — run the faithful 60 s loop all day; for each logged
 *     entry, does a matching signal (right+strike) fire within [−6m, +1m]?
 *     Ablations: computed-levels (level-algo gap) and no-single-bar-shapes.
 *
 * Run: npm run nakamoto-repro [-- --dump]
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "fs";
import { Bar, loadCsvBars, ptParts, pyRound, resample5m, rthOnly } from "./data";
import { DEFAULT_SCAN_CONFIG, EntrySignal, ScanConfig, scanForEntry } from "./entry-v2";
import { loadLevelsAudit, warmupLevels } from "./levels";

const IEX = "data/handoff-verify/iex";
const DAYS = ["2026-06-04", "2026-06-05", "2026-06-08", "2026-06-09"];
const LOG_SRC = "/Users/mattlynch/Downloads/matt_handoff/paperC_tradelog_jun2026.csv";
const LOG_LOCAL = "data/handoff-verify/paperC_tradelog_jun2026.csv";
const ENRICHED = "data/handoff-verify/paperC_tradelog_jun2026_enriched.csv";

const SPAN_START_PT = 4 * 60; // LOOP_FACTS §3: 1m fetch from 04:00 PT (premarket)

// ---- trade log ---------------------------------------------------------------
interface LogTrade {
  day: string; entryTs: number; exitTs: number;
  right: "c" | "p"; strike: number;
}

function loadLog(): LogTrade[] {
  if (!existsSync(LOG_LOCAL) && existsSync(LOG_SRC)) copyFileSync(LOG_SRC, LOG_LOCAL);
  const lines = readFileSync(LOG_LOCAL, "utf8").trim().split("\n").slice(1);
  return lines.map(l => {
    const [day, entryET, cp, strike, , , exitET] = l.split(",");
    // June 2026 = EDT = UTC-4 (fixed offset valid for these dates)
    return {
      day,
      entryTs: Date.parse(`${day}T${entryET}-04:00`),
      exitTs: Date.parse(`${day}T${exitET}-04:00`),
      right: cp.toLowerCase() as "c" | "p",
      strike: +strike,
    };
  });
}

interface EnrichedRow {
  day: string; entryET: string; entryTs: number;
  logCP: string; logStrike: number; logConf: string;
  rrSetup: string; rrConf: string; rrCP: string; rrLevel: string; rrFeatures: string; match: string;
}

function loadEnriched(): EnrichedRow[] {
  const lines = readFileSync(ENRICHED, "utf8").trim().split("\n").slice(1);
  return lines.map(l => {
    const c = l.split(",");
    return {
      day: c[0], entryET: c[1], entryTs: Date.parse(`${c[0]}T${c[1]}-04:00`),
      logCP: c[2], logStrike: +c[3], logConf: c[4],
      rrSetup: c[5], rrConf: c[6], rrCP: c[7], rrLevel: c[8], rrFeatures: c[10], match: c[11],
    };
  });
}

// ---- eligibility from the log's own position state ----------------------------
function eligible(t: number, dayTrades: LogTrade[]): boolean {
  const prior = dayTrades.filter(tr => tr.entryTs <= t);
  if (prior.length >= 10) return false; // LOOP_FACTS §4: cap=10/day — bot stops scanning
  const open = dayTrades.filter(tr => tr.entryTs <= t && t < tr.exitTs);
  if (open.length >= 2) return false;
  if (open.length >= 1 && prior.length
    && t - Math.max(...prior.map(tr => tr.entryTs)) < 10 * 60_000) return false;
  return true;
}

// ---- data ----------------------------------------------------------------------
const fiveAll = loadCsvBars(`${IEX}/spy_5m.csv`);   // multi-day 5m (levels fallback only)
const dailyAll = loadCsvBars(`${IEX}/spy_1d.csv`);
const oneMByDay = new Map(DAYS.map(d => [
  d,
  loadCsvBars(`${IEX}/spy_1m_${d}.csv`).filter(b => ptParts(b.ts).hm >= SPAN_START_PT),
]));

function dayLevels(day: string, forceComputed = false): { levels: number[]; src: string } {
  if (!forceComputed) {
    const audit = loadLevelsAudit(`data/handoff-verify/levels_${day}.json`);
    if (audit) return { levels: audit, src: `audit-json (n=${audit.length})` };
  }
  const ls = warmupLevels(dailyAll, fiveAll, day);
  return { levels: ls.levels, src: `computed (anchor ${ls.anchor.toFixed(2)}, n=${ls.levels.length})` };
}

// ---- signal generation: the faithful 60 s loop -----------------------------------
interface Sig {
  t: number; right: "c" | "p"; strike: number; setup: string; conf: number;
  features: string; level: number; spot: number;
}

function runDay(day: string, levels: number[], cfg: ScanConfig): Sig[] {
  const oneM = oneMByDay.get(day)!;
  const out: Sig[] = [];
  for (const b of oneM) {
    const t = b.ts + 60_000; // scan instant = completed-1m boundary (60 s cadence)
    const pt = ptParts(t);
    if (pt.date !== day) continue;
    if (pt.hm < 6 * 60 + 30 || pt.hm > 13 * 60) continue;

    const ones = oneM.filter(x => x.ts + 60_000 <= t);
    if (!ones.length) continue;
    const bars5m = resample5m(ones); // last bin partial = forming bar (LOOP_FACTS §2)
    const spot = ones[ones.length - 1].close; // proxy for live IEX quote mid

    const sig: EntrySignal | null = scanForEntry(bars5m, rthOnly(bars5m), spot, pt.hm, levels, cfg);
    if (sig) {
      out.push({
        t, right: sig.right, strike: pyRound(spot), setup: sig.setup, conf: sig.confidence,
        features: (sig.context.features as string[]).join("+"), level: sig.context.level as number, spot,
      });
    }
  }
  return out;
}

// ---- A. enriched-agreement (their exact re-run methodology) -----------------------
function enrichedAgreement(): void {
  const rows = loadEnriched();
  let agree = 0;
  const diffs: string[] = [];
  for (const r of rows) {
    const oneM = oneMByDay.get(r.day)!;
    const levels = dayLevels(r.day).levels;
    const ones = oneM.filter(b => b.ts <= r.entryTs); // their b1['timestamp'] <= cu (bar STARTS)
    const bars5m = resample5m(ones);
    const spot = ones[ones.length - 1].close;
    const pt = ptParts(r.entryTs);
    const sig = scanForEntry(bars5m, rthOnly(bars5m), spot, pt.hm, levels, DEFAULT_SCAN_CONFIG);

    const mine = sig === null
      ? { setup: "NONE", conf: "", cp: "" }
      : { setup: sig.setup, conf: String(sig.confidence), cp: sig.right.toUpperCase() };
    const theirs = { setup: r.rrSetup, conf: r.rrConf, cp: r.rrCP };
    const ok = mine.setup === theirs.setup && mine.conf === theirs.conf && mine.cp === theirs.cp;
    if (ok) agree++;
    else {
      diffs.push(`  ${r.day} ${r.entryET}  theirs: ${theirs.setup}/${theirs.conf}/${theirs.cp || "-"}  mine: ${mine.setup}/${mine.conf || "-"}/${mine.cp || "-"}${sig ? ` [${(sig.context.features as string[]).join("+")}]` : ""}`);
    }
  }
  console.log(`A. ENRICHED-AGREEMENT (port vs their enrich_tradelog re-run, same inputs): ${agree}/${rows.length}`);
  if (diffs.length) {
    console.log("   disagreements:");
    for (const d of diffs) console.log(d);
  }
  console.log();
}

// ---- B. trade matching --------------------------------------------------------------
const fmtET = (ts: number) =>
  new Date(ts).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false });

interface DayResult { matched: number; near: number; missed: number; extras: number; rows: string[] }

function diffDay(day: string, sigs: Sig[], trades: LogTrade[]): DayResult {
  const dayTrades = trades.filter(tr => tr.day === day);
  const claimed = new Set<Sig>();
  const rows: string[] = [];
  let matched = 0, near = 0, missed = 0;

  for (const tr of dayTrades.sort((a, b) => a.entryTs - b.entryTs)) {
    const win = sigs.filter(s => s.t >= tr.entryTs - 360_000 && s.t <= tr.entryTs + 60_000 && !claimed.has(s));
    const exact = win.filter(s => s.right === tr.right && s.strike === tr.strike);
    const nearMiss = win.filter(s => s.right === tr.right && Math.abs(s.strike - tr.strike) <= 1);
    const pick = exact[exact.length - 1] ?? nearMiss[nearMiss.length - 1];
    if (pick && exact.length) { matched++; claimed.add(pick); }
    else if (pick) { near++; claimed.add(pick); }
    else missed++;
    rows.push(
      `  ${day} ${fmtET(tr.entryTs)} ${tr.right.toUpperCase()}${tr.strike}  ${pick
        ? `${exact.length ? "MATCH" : "near "} ← sig ${fmtET(pick.t)} ${pick.right.toUpperCase()}${pick.strike} ${pick.setup}/c${pick.conf} [${pick.features}] L=${pick.level}`
        : "MISS  (no signal in window)"}`,
    );
  }

  const unclaimed = sigs.filter(s => !claimed.has(s) && eligible(s.t, dayTrades));
  let extras = 0;
  let lastT = 0; let lastRight = "";
  for (const s of unclaimed.sort((a, b) => a.t - b.t)) {
    if (s.t - lastT > 300_000 || s.right !== lastRight) extras++;
    lastT = s.t; lastRight = s.right;
  }
  return { matched, near, missed, extras, rows };
}

// ---- main -------------------------------------------------------------------------
const dump = process.argv.includes("--dump");
const trades = loadLog();

console.log("Nakamoto Phase-1 signal reproduction — FULL FIDELITY (addendum applied)");
console.log("loop per LOOP_FACTS: 60s scans · forming 5m bar · 04:00 PT span · audit levels\n");

for (const d of DAYS) console.log(`levels ${d}: ${dayLevels(d).src}`);
console.log();

enrichedAgreement();

interface RunVariant { name: string; forceComputed: boolean; cfg: ScanConfig }
const VARIANTS: RunVariant[] = [
  { name: "faithful        ", forceComputed: false, cfg: DEFAULT_SCAN_CONFIG },
  { name: "computed-levels ", forceComputed: true, cfg: DEFAULT_SCAN_CONFIG },
  { name: "no-1bar-shapes  ", forceComputed: false, cfg: { ...DEFAULT_SCAN_CONFIG, useSingleBarShapes: false } },
];

let best: { name: string; score: number; detail: Map<string, DayResult> } | null = null;
console.log("B. TRADE MATCHING (faithful 60s loop, right+strike within [-6m,+1m])");
console.log("variant            matched  near  missed  extra-episodes   (32 log entries)");
for (const v of VARIANTS) {
  const detail = new Map<string, DayResult>();
  let m = 0, n = 0, x = 0, e = 0;
  for (const day of DAYS) {
    const lv = dayLevels(day, v.forceComputed);
    const sigs = runDay(day, lv.levels, v.cfg);
    if (dump) {
      writeFileSync(
        `data/handoff-verify/signals_${day}_${v.name.trim()}.csv`,
        ["t_et,right,strike,setup,conf,features,level,spot",
          ...sigs.map(s => [fmtET(s.t), s.right, s.strike, s.setup, s.conf, s.features, s.level, s.spot.toFixed(2)].join(","))].join("\n"));
    }
    const r = diffDay(day, sigs, trades);
    detail.set(day, r);
    m += r.matched; n += r.near; x += r.missed; e += r.extras;
  }
  console.log(`${v.name}   ${String(m).padStart(4)}  ${String(n).padStart(4)}  ${String(x).padStart(5)}  ${String(e).padStart(8)}`);
  const score = m + 0.5 * n;
  if (!best || score > best.score) best = { name: v.name.trim(), score, detail };
}

if (best) {
  console.log(`\n— per-trade detail: ${best.name} —`);
  for (const day of DAYS) for (const row of best.detail.get(day)!.rows) console.log(row);
}
console.log("\nContext: their OWN re-run reproduces right+conf on 18/32 (LOOP_FACTS");
console.log("§reproducibility) — live-quote-mid strikes + 60s scan instants aren't in");
console.log("the log. Distributional agreement is the bar, and A is the exact-port test.");
