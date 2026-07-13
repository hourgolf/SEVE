// Entry-path study: evaluate entry engines independently of their managers.
//
// One first valid entry per session is frozen, then its real executable-bid path
// is followed to the bell. The eventual MFE is an outcome label only; it never
// influences entry or an exit decision. This is the evidence layer from which a
// small set of causal managers can later be pre-registered.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { computeFeatures } from "./engine";
import { costGatePass } from "./manage";
import { DEFAULT_COST_MODEL, fillWithCost, type CostModel } from "./cost";
import { loadDatabentoV2Day, makeMultiDteChain } from "./databentosource";
import { inEventWindow } from "./market-events";
import { nextTradingDay } from "./market-calendar";
import { loadRealSessions, type RealSession } from "./realsource";
import { specToStrategyDef } from "./specEvaluate";
import type { Evaluate, OptType, Quote } from "./types";
import type { StrategySpec } from "../lib/desk/strategySpec";

const CANDIDATES = [
  "breakout-smart-entries",
  "breakout-alt-v3",
  "momo-shape-2",
  "qqq-thrust-trail",
  "orb-trend-rider",
  "orb-ustop",
  "orb-qqq-trail",
  "vb-ribbon-cross",
  "vb-squeeze-break-qqq",
] as const;
const CACHE_DIR = "data/databento-v2/underlying-sessions";
const RECEIPT = "data/databento-v2/manifests/entry-path-study.json";
const ET_OPEN_MIN = 9 * 60 + 30;
const RTH_ROLL_CUTOFF_MIN = 31;
const THRESHOLDS = [10, 20, 30, 50, 100] as const;
const FILL: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE: CostModel = { ...FILL, slippageTicksPerSide: 0.25 };

type Config = { entry_dte: number | null; strike_offset: number | null; event_policy: string | null };
type Row = {
  slug: string; name: string; underlying: string | null; status: string | null;
  spec_json: StrategySpec | string | null; strategist_config: Config | Config[] | null;
};
type Policy = {
  slug: string; name: string; symbol: "SPY" | "QQQ" | "IWM"; status: string;
  spec: StrategySpec; entryDte: number; strikeOffset: number; eventPolicy: "standdown" | "ignore";
  specHash: string;
};
type EntryPath = {
  date: string; entryTs: number; direction: OptType; strike: number; expiration: string;
  entryAsk: number; entryBid: number; entrySpread: number; entryFill: number;
  context: {
    minute: number; minutesToClose: number; spot: number; atr: number; er: number; relVol: number;
    momAtr: number; vwapDistanceAtr: number; openRangeDepthAtr: number | null; gapPct: number | null;
  };
  observations: number; lastReturnPct: number; mfePct: number; maePct: number;
  timeToPeakMin: number; givebackPctPoints: number;
  firstTouchMin: Record<string, number | null>;
  returnPath: Array<[minuteFromEntry: number, executableReturnPct: number]>;
};

function cachePath(symbol: string): string { return `${CACHE_DIR}/${symbol.toLowerCase()}.json.gz`; }
async function sessionsFor(symbol: "SPY" | "QQQ" | "IWM"): Promise<RealSession[]> {
  const path = cachePath(symbol);
  if (existsSync(path)) return JSON.parse(gunzipSync(readFileSync(path)).toString("utf8")) as RealSession[];
  const sessions = await loadRealSessions({ symbol, sinceDaysAgo: 2_000 });
  if (sessions.length < 1_000) throw new Error(`underlying coverage incomplete for ${symbol}: ${sessions.length}`);
  mkdirSync(CACHE_DIR, { recursive: true });
  const temp = `${path}.partial`;
  writeFileSync(temp, gzipSync(JSON.stringify(sessions), { level: 6 }));
  renameSync(temp, path);
  return sessions;
}

function normalize(row: Row): Policy {
  const c = (Array.isArray(row.strategist_config) ? row.strategist_config[0] : row.strategist_config) ?? {} as Config;
  const spec = typeof row.spec_json === "string" ? JSON.parse(row.spec_json) as StrategySpec : row.spec_json;
  if (!spec) throw new Error(`${row.slug} has no compiled entry spec`);
  const symbol = String(row.underlying ?? "SPY").toUpperCase();
  if (symbol !== "SPY" && symbol !== "QQQ" && symbol !== "IWM") throw new Error(`unsupported symbol ${symbol}`);
  return {
    slug: row.slug, name: row.name, symbol, status: row.status ?? "draft", spec,
    entryDte: Number(c.entry_dte ?? 0), strikeOffset: Number(c.strike_offset ?? 0),
    eventPolicy: c.event_policy === "ignore" ? "ignore" : "standdown",
    specHash: createHash("sha256").update(JSON.stringify(spec)).digest("hex"),
  };
}

async function fetchPolicies(): Promise<Policy[]> {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await sb.from("strategists").select(
    "slug,name,underlying,status,spec_json,strategist_config(entry_dte,strike_offset,event_policy)",
  ).in("slug", [...CANDIDATES]);
  if (error) throw new Error(`candidate policy read failed: ${error.message}`);
  const policies = (data as Row[]).map(normalize);
  const missing = CANDIDATES.filter((slug) => !policies.some((p) => p.slug === slug));
  if (missing.length) throw new Error(`candidate spec missing: ${missing.join(", ")}`);
  return CANDIDATES.map((slug) => policies.find((p) => p.slug === slug)!);
}

function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const x = [...values].sort((a, b) => a - b);
  const p = (x.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p);
  return +(x[lo] + (x[hi] - x[lo]) * (p - lo)).toFixed(2);
}

function summary(paths: EntryPath[]) {
  const pct = (n: number) => paths.length ? +(100 * n / paths.length).toFixed(1) : 0;
  const thresholdTouchPct = Object.fromEntries(THRESHOLDS.map((t) => [String(t), pct(paths.filter((p) => p.firstTouchMin[String(t)] != null).length)]));
  const thresholdTouchTimeMin = Object.fromEntries(THRESHOLDS.map((t) => [String(t), quantile(
    paths.map((p) => p.firstTouchMin[String(t)]).filter((v): v is number => v != null), 0.5,
  )]));
  return {
    entries: paths.length,
    positiveAtBellPct: pct(paths.filter((p) => p.lastReturnPct > 0).length),
    gaveBackGreenToRedPct: pct(paths.filter((p) => p.mfePct >= 10 && p.lastReturnPct <= 0).length),
    mfePct: { p25: quantile(paths.map((p) => p.mfePct), 0.25), median: quantile(paths.map((p) => p.mfePct), 0.5), p75: quantile(paths.map((p) => p.mfePct), 0.75) },
    maePct: { p25: quantile(paths.map((p) => p.maePct), 0.25), median: quantile(paths.map((p) => p.maePct), 0.5), p75: quantile(paths.map((p) => p.maePct), 0.75) },
    bellReturnPct: { p25: quantile(paths.map((p) => p.lastReturnPct), 0.25), median: quantile(paths.map((p) => p.lastReturnPct), 0.5), p75: quantile(paths.map((p) => p.lastReturnPct), 0.75) },
    timeToPeakMin: { median: quantile(paths.map((p) => p.timeToPeakMin), 0.5), p75: quantile(paths.map((p) => p.timeToPeakMin), 0.75) },
    givebackPctPoints: { median: quantile(paths.map((p) => p.givebackPctPoints), 0.5), p75: quantile(paths.map((p) => p.givebackPctPoints), 0.75) },
    thresholdTouchPct, thresholdTouchTimeMin,
  };
}

function quoteFor(all: ReturnType<typeof makeMultiDteChain>, ts: number, strike: number, direction: OptType, expiration: string): Quote | undefined {
  return all(ts).find((q) => q.strike === strike && q.optType === direction && q.expiration === expiration);
}

function firstPath(policy: Policy, session: RealSession, nextDate: string, all: ReturnType<typeof makeMultiDteChain>): EntryPath | null {
  const def = specToStrategyDef(policy.spec);
  const evaluate: Evaluate = def.build(session.bars, def.timeframeMin, { pdh: session.pdh, pdl: session.pdl, gap: session.gap });
  for (let i = 0; i < session.bars.length; i++) {
    const f = computeFeatures(session.bars, i);
    if (policy.eventPolicy === "standdown" && inEventWindow(session.dateET, ET_OPEN_MIN + f.minute, 10, 30, policy.symbol)) continue;
    const intent = evaluate(f, null);
    if (intent?.kind !== "enter" || !intent.direction) continue;
    const direction = intent.direction;
    const expiration = policy.entryDte > 0 || f.minutesToClose < RTH_ROLL_CUTOFF_MIN ? nextDate : session.dateET;
    const strike = Math.round(f.close) + (direction === "call" ? 1 : -1) * policy.strikeOffset;
    const quote = quoteFor(all, session.bars[i].ts, strike, direction, expiration);
    if (!quote || !(quote.bid > 0) || !costGatePass(quote, f.atr, 3, GATE)) continue;
    const entryFill = fillWithCost("buy", quote, FILL).fill;
    if (!(entryFill > 0)) continue;
    let mfePct = Number.NEGATIVE_INFINITY, maePct = Number.POSITIVE_INFINITY;
    let lastReturnPct = 0, peakIndex = i, observations = 0;
    const returnPath: Array<[number, number]> = [];
    const firstTouchMin = Object.fromEntries(THRESHOLDS.map((t) => [String(t), null])) as Record<string, number | null>;
    for (let j = i; j < session.bars.length; j++) {
      const q = quoteFor(all, session.bars[j].ts, strike, direction, expiration);
      if (!q || !(q.bid > 0)) continue;
      const exitFill = fillWithCost("sell", q, FILL).fill;
      const ret = 100 * (exitFill - entryFill) / entryFill;
      observations++; lastReturnPct = ret;
      returnPath.push([j - i, +ret.toFixed(2)]);
      if (ret > mfePct) { mfePct = ret; peakIndex = j; }
      maePct = Math.min(maePct, ret);
      for (const t of THRESHOLDS) if (firstTouchMin[String(t)] == null && ret >= t) firstTouchMin[String(t)] = j - i;
    }
    if (!observations) return null;
    return {
      date: session.dateET, entryTs: session.bars[i].ts, direction, strike, expiration,
      entryAsk: quote.ask, entryBid: quote.bid, entrySpread: quote.ask - quote.bid, entryFill,
      context: {
        minute: f.minute, minutesToClose: f.minutesToClose, spot: f.close, atr: f.atr, er: f.er, relVol: f.relVol,
        momAtr: f.atr > 0 ? +(f.mom / f.atr).toFixed(4) : 0,
        vwapDistanceAtr: f.atr > 0 ? +((f.close - f.vwap) / f.atr).toFixed(4) : 0,
        openRangeDepthAtr: f.atr > 0 && f.openRangeHi != null && f.openRangeLo != null
          ? +(Math.min(Math.abs(f.close - f.openRangeHi), Math.abs(f.close - f.openRangeLo)) / f.atr).toFixed(4)
          : null,
        gapPct: session.gap != null ? +session.gap.toFixed(4) : null,
      },
      observations, lastReturnPct: +lastReturnPct.toFixed(2), mfePct: +mfePct.toFixed(2), maePct: +maePct.toFixed(2),
      timeToPeakMin: peakIndex - i, givebackPctPoints: +(mfePct - lastReturnPct).toFixed(2), firstTouchMin,
      returnPath,
    };
  }
  return null;
}

async function main(): Promise<void> {
  const policies = await fetchPolicies();
  const policyHash = createHash("sha256").update(JSON.stringify(policies)).digest("hex");
  const paths = Object.fromEntries(policies.map((p) => [p.slug, [] as EntryPath[]])) as Record<string, EntryPath[]>;
  const coverage = Object.fromEntries(policies.map((p) => [p.slug, { sessions: 0, chainMissing: 0, expiryMissing: 0 }])) as Record<string, { sessions: number; chainMissing: number; expiryMissing: number }>;
  for (const symbol of [...new Set(policies.map((p) => p.symbol))]) {
    const sessions = await sessionsFor(symbol);
    const nextOf = new Map<string, string>();
    for (let i = 0; i < sessions.length - 1; i++) nextOf.set(sessions[i].dateET, sessions[i + 1].dateET);
    const symbolPolicies = policies.filter((p) => p.symbol === symbol);
    for (const session of sessions) {
      const contracts = loadDatabentoV2Day(session.dateET, symbol);
      if (!contracts) { for (const p of symbolPolicies) coverage[p.slug].chainMissing++; continue; }
      const all = makeMultiDteChain(contracts);
      const nextDate = nextOf.get(session.dateET) ?? nextTradingDay(session.dateET);
      for (const policy of symbolPolicies) {
        coverage[policy.slug].sessions++;
        const possibleExpiries = policy.entryDte > 0 ? [nextDate] : [session.dateET, nextDate];
        if (!possibleExpiries.some((expiry) => contracts.some((c) => c.expiration === expiry))) { coverage[policy.slug].expiryMissing++; continue; }
        const path = firstPath(policy, session, nextDate, all);
        if (path) paths[policy.slug].push(path);
      }
    }
  }
  const results = Object.fromEntries(policies.map((policy) => {
    const rows = paths[policy.slug];
    const byYear = Object.fromEntries([2022, 2023, 2024, 2025, 2026].map((y) => [String(y), summary(rows.filter((p) => p.date.startsWith(String(y))))]));
    return [policy.slug, { policy, coverage: coverage[policy.slug], summary: summary(rows), byYear, paths: rows }];
  }));
  const receipt = { generatedAt: new Date().toISOString(), classification: "retrospective-entry-outcomes", policyHash, method: "first-valid-entry-per-session; executable-bid path; no manager", results };
  mkdirSync("data/databento-v2/manifests", { recursive: true });
  const temp = `${RECEIPT}.partial`;
  writeFileSync(temp, JSON.stringify(receipt)); renameSync(temp, RECEIPT);
  console.log(`\nENTRY PATH STUDY · policy ${policyHash.slice(0, 12)} · first valid entry/session · audited executable path\n`);
  for (const policy of policies) {
    const s = summary(paths[policy.slug]);
    console.log(`${policy.slug.padEnd(28)} n=${String(s.entries).padStart(4)}  MFE p50=${String(s.mfePct.median).padStart(7)}%  touch20=${String(s.thresholdTouchPct["20"]).padStart(5)}%  bell p50=${String(s.bellReturnPct.median).padStart(7)}%  green→red=${String(s.gaveBackGreenToRedPct).padStart(5)}%  peak t50=${String(s.timeToPeakMin.median).padStart(5)}m`);
  }
  console.log(`\nreceipt → ${RECEIPT}\n`);
}

main().catch((error) => { console.error(error); process.exit(1); });
