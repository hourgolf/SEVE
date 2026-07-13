// Current-policy, real-NBBO replay for the priority channel set.
//
// Research discipline:
// - Reads the live policy once, then stamps a hash into the receipt.
// - Caches underlying sessions locally so repeated studies do not refetch Supabase.
// - Uses the validated Databento v2 gzip corpus one session at a time.
// - Reports fixed-one-contract/no-pyramid separately from current sizing.
// - Uses executable BID observations for exits and brackets fill quality.
// - Retrospective only: no result here is an untouched confirmation or promotion gate.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { simulateSession } from "./backtest";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import { loadDatabentoV2Day, makeMultiDteChain } from "./databentosource";
import { inEventWindow } from "./market-events";
import { nextTradingDay } from "./market-calendar";
import { getStrategy } from "./registry";
import { loadRealSessions, type RealSession } from "./realsource";
import { specPremiumExit, specToStrategyDef } from "./specEvaluate";
import type { ChainProvider } from "./optionsource";
import type { Evaluate, FundState, StrategistConfig, Trade } from "./types";
import { specTrail, type StrategySpec } from "../lib/desk/strategySpec";

const PRIORITY = [
  "breakout", "breakout-smart-entries", "breakout-alt-v3",
  "pb-ride", "pb-ride-2", "pb-ride-itm",
  "momo-shape-2", "grind-smart-entries", "qqq-thrust-trail",
] as const;
const CACHE_DIR = "data/databento-v2/underlying-sessions";
const RECEIPT = "data/databento-v2/manifests/priority-channel-truth-replay.json";
const ET_OPEN_MIN = 9 * 60 + 30;
const DEFAULT_STOP_PCT = 50;
const PYRAMID_MIN_PROFIT_PCT = 30;

type PolicyRow = {
  slug: string;
  underlying: string | null;
  status: string | null;
  spec_json: StrategySpec | string | null;
  strategist_config: PolicyConfig | PolicyConfig[] | null;
};
type PolicyConfig = {
  capital_pct: number | null;
  max_contracts: number | null;
  daily_stop_usd: number | null;
  underlying_stop_pct: number | null;
  event_policy: string | null;
  entry_dte: number | null;
  take_profit_pct: number | null;
  premium_stop_pct: number | null;
  pyramid_adds: number | null;
  strike_offset: number | null;
  stall_minutes: number | null;
  stall_max_favor_pct: number | null;
};
type NormalizedPolicy = {
  slug: string;
  symbol: "SPY" | "QQQ" | "IWM";
  status: string;
  spec: StrategySpec | null;
  riskUsd: number;
  maxContracts: number;
  dailyStopUsd: number;
  underlyingStopPct: number;
  eventPolicy: "standdown" | "ignore";
  entryDte: number;
  takeProfitPct: number;
  premiumStopPct: number;
  pyramidAdds: number;
  strikeOffset: number;
  stallMinutes: number;
  stallMaxFavorPct: number;
};
type RunName = "unit_audited" | "unit_optimistic" | "current_audited" | "current_optimistic";
type DayResult = { date: string; pnl: number; trades: number };

const FILL_AUDITED: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const FILL_OPTIMISTIC: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars", slippageTicksPerSide: 0.25 };
// Worker K=6 is algebraically the engine's delta-0.5 ratio=3 gate.
const ENTRY_GATE = { minMoveToCostRatio: 3, gateCostModel: FILL_OPTIMISTIC };

function normalize(row: PolicyRow): NormalizedPolicy {
  const c = (Array.isArray(row.strategist_config) ? row.strategist_config[0] : row.strategist_config) ?? {} as PolicyConfig;
  const spec = typeof row.spec_json === "string" ? JSON.parse(row.spec_json) as StrategySpec : row.spec_json;
  const symbol = String(row.underlying ?? "SPY").toUpperCase();
  if (symbol !== "SPY" && symbol !== "QQQ" && symbol !== "IWM") throw new Error(`unsupported underlying ${symbol} for ${row.slug}`);
  return {
    slug: row.slug, symbol, status: row.status ?? "armed", spec: spec ?? null,
    riskUsd: Number(c.capital_pct ?? 0), maxContracts: Number(c.max_contracts ?? 1),
    dailyStopUsd: Number(c.daily_stop_usd ?? 0), underlyingStopPct: Number(c.underlying_stop_pct ?? 0),
    eventPolicy: c.event_policy === "ignore" ? "ignore" : "standdown",
    entryDte: Number(c.entry_dte ?? 0), takeProfitPct: Number(c.take_profit_pct ?? 0),
    premiumStopPct: c.premium_stop_pct == null ? DEFAULT_STOP_PCT : Number(c.premium_stop_pct),
    pyramidAdds: Number(c.pyramid_adds ?? 0), strikeOffset: Number(c.strike_offset ?? 0),
    stallMinutes: Number(c.stall_minutes ?? 0), stallMaxFavorPct: Number(c.stall_max_favor_pct ?? 0),
  };
}

function cachePath(symbol: string): string { return `${CACHE_DIR}/${symbol.toLowerCase()}.json.gz`; }
async function loadSessions(symbol: "SPY" | "QQQ" | "IWM"): Promise<RealSession[]> {
  const path = cachePath(symbol);
  if (existsSync(path)) return JSON.parse(gunzipSync(readFileSync(path)).toString("utf8")) as RealSession[];
  const sessions = await loadRealSessions({ symbol, sinceDaysAgo: 2_000 });
  if (sessions.length < 1_000) throw new Error(`underlying coverage incomplete for ${symbol}: ${sessions.length} sessions`);
  mkdirSync(CACHE_DIR, { recursive: true });
  const temp = `${path}.partial`;
  writeFileSync(temp, gzipSync(JSON.stringify(sessions), { level: 6 }));
  renameSync(temp, path);
  return sessions;
}

function baseSlug(slug: string): string {
  return slug.replace(/-\d+$/, "").replace(/-manual$/i, "").replace(/-(qqq|spy)$/i, "").replace(/-itm$/i, "").replace(/-wd$/i, "");
}

function evaluator(policy: NormalizedPolicy, session: RealSession): { evaluate: Evaluate; specExit: { profitPct?: number; stopPct?: number }; trailK?: number } {
  const code = getStrategy(policy.slug) ?? getStrategy(baseSlug(policy.slug));
  if (code) return { evaluate: code.build(session.bars, code.timeframeMin), specExit: {} };
  if (!policy.spec) throw new Error(`no code strategy or spec_json for ${policy.slug}`);
  const def = specToStrategyDef(policy.spec);
  return {
    evaluate: def.build(session.bars, def.timeframeMin, { pdh: session.pdh, pdl: session.pdl, gap: session.gap }),
    specExit: specPremiumExit(policy.spec),
    trailK: specTrail(policy.spec.management)?.atrChandelierK,
  };
}

function withEventPolicy(policy: NormalizedPolicy, date: string, inner: Evaluate): Evaluate {
  if (policy.eventPolicy === "ignore") return inner;
  return (f, pos) => inEventWindow(date, ET_OPEN_MIN + f.minute, 10, 30, policy.symbol)
    ? (pos ? { kind: "exit", reason: "event_standdown" } : null)
    : inner(f, pos);
}

function summarize(days: DayResult[]) {
  const pnl = days.reduce((a, d) => a + d.pnl, 0);
  const trades = days.reduce((a, d) => a + d.trades, 0);
  const active = days.filter((d) => d.trades > 0);
  let equity = 0, peak = 0, maxDD = 0;
  for (const d of days) { equity += d.pnl; peak = Math.max(peak, equity); maxDD = Math.max(maxDD, peak - equity); }
  const ranked = [...active].sort((a, b) => b.pnl - a.pnl);
  const grossPositive = ranked.filter((d) => d.pnl > 0).reduce((a, d) => a + d.pnl, 0);
  const top3 = ranked.filter((d) => d.pnl > 0).slice(0, 3).reduce((a, d) => a + d.pnl, 0);
  return {
    pnl: +pnl.toFixed(2), trades, activeSessions: active.length,
    expectancy: trades ? +(pnl / trades).toFixed(2) : 0,
    maxDD: +maxDD.toFixed(2), bestSession: ranked[0] ?? null, worstSession: ranked.at(-1) ?? null,
    top3PositiveSharePct: grossPositive ? +(100 * top3 / grossPositive).toFixed(1) : null,
  };
}

function signed(v: number): string { return `${v >= 0 ? "+" : "-"}$${Math.abs(Math.round(v)).toLocaleString("en-US")}`; }

async function fetchPolicies(): Promise<NormalizedPolicy[]> {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await sb.from("strategists").select(
    "slug,underlying,status,spec_json,strategist_config(capital_pct,max_contracts,daily_stop_usd,underlying_stop_pct,event_policy,entry_dte,take_profit_pct,premium_stop_pct,pyramid_adds,strike_offset,stall_minutes,stall_max_favor_pct)",
  ).in("slug", [...PRIORITY]);
  if (error) throw new Error(`policy read failed: ${error.message}`);
  const policies = (data as PolicyRow[]).map(normalize);
  const missing = PRIORITY.filter((slug) => !policies.some((p) => p.slug === slug));
  if (missing.length) throw new Error(`priority policy missing: ${missing.join(", ")}`);
  return PRIORITY.map((slug) => policies.find((p) => p.slug === slug)!);
}

async function replay(policy: NormalizedPolicy, sessions: RealSession[]) {
  const dates = sessions.map((s) => s.dateET);
  const nextOf = new Map<string, string>();
  for (let i = 0; i < dates.length - 1; i++) nextOf.set(dates[i], dates[i + 1]);
  const out = Object.fromEntries((["unit_audited", "unit_optimistic", "current_audited", "current_optimistic"] as RunName[]).map((n) => [n, [] as DayResult[]])) as Record<RunName, DayResult[]>;
  let covered = 0;
  let missingChain = 0, shortSession = 0, missingExpiry = 0;
  for (const session of sessions) {
    const contracts = loadDatabentoV2Day(session.dateET, policy.symbol);
    if (!contracts) { missingChain++; continue; }
    if (session.bars.length < 90) { shortSession++; continue; }
    const expiry = policy.entryDte === 0 ? session.dateET : (nextOf.get(session.dateET) ?? nextTradingDay(session.dateET));
    if (!contracts.some((c) => c.expiration === expiry)) { missingExpiry++; continue; }
    covered++;
    const all = makeMultiDteChain(contracts);
    const chain: ChainProvider = (_spot, _mtc, ts) => all(ts).filter((q) => q.expiration === expiry);
    const built = evaluator(policy, session);
    const evaluate = withEventPolicy(policy, session.dateET, built.evaluate);
    const profitPct = policy.takeProfitPct > 0 ? policy.takeProfitPct : built.specExit.profitPct;
    const stopPct = policy.premiumStopPct > 0 ? policy.premiumStopPct : undefined;
    const premiumExit = profitPct != null || stopPct != null ? { ...(profitPct != null ? { profitPct } : {}), ...(stopPct != null ? { stopPct } : {}) } : undefined;
    const trail = built.trailK != null ? { atrChandelierK: built.trailK } : undefined;
    const stall = policy.stallMinutes > 0 ? { minMinutes: policy.stallMinutes, maxFavorPct: policy.stallMaxFavorPct } : undefined;
    const run = (name: RunName, fill: CostModel, current: boolean): void => {
      const stopFraction = policy.premiumStopPct > 0 ? policy.premiumStopPct / 100 : DEFAULT_STOP_PCT / 100;
      const cfg: StrategistConfig = {
        slug: policy.slug, capital_pct: 100, aggression: 100,
        max_contracts: current ? policy.maxContracts : 1,
        daily_stop_usd: current ? policy.dailyStopUsd : Number.MAX_SAFE_INTEGER,
        muted: false, soloed: false,
      };
      const fund: FundState = {
        total_capital_usd: current ? policy.riskUsd / stopFraction : 1_000_000,
        master_daily_stop_usd: Number.MAX_SAFE_INTEGER, is_halted: false,
      };
      const pyramid = current && policy.pyramidAdds > 0
        ? { maxAdds: policy.pyramidAdds, minProfitPct: PYRAMID_MIN_PROFIT_PCT, maxStack: policy.maxContracts }
        : undefined;
      const trades: Trade[] = simulateSession(
        session.bars, cfg, fund, evaluate, chain, false, premiumExit, fill,
        undefined, trail, undefined, undefined, policy.underlyingStopPct, ENTRY_GATE,
        undefined, pyramid, undefined, stall, undefined, policy.strikeOffset, 0, "bid",
      );
      out[name].push({ date: session.dateET, pnl: trades.reduce((a, t) => a + t.pnl, 0), trades: trades.length });
    };
    run("unit_audited", FILL_AUDITED, false);
    run("unit_optimistic", FILL_OPTIMISTIC, false);
    run("current_audited", FILL_AUDITED, true);
    run("current_optimistic", FILL_OPTIMISTIC, true);
  }
  const pooled = Object.fromEntries(Object.entries(out).map(([name, days]) => [name, summarize(days)]));
  const byYear = Object.fromEntries([2022, 2023, 2024, 2025, 2026].map((year) => [String(year), Object.fromEntries(
    Object.entries(out).map(([name, days]) => [name, summarize(days.filter((d) => d.date.startsWith(String(year))))]),
  )]));
  return { covered, exclusions: { missingChain, shortSession, missingExpiry }, pooled, byYear };
}

async function main(): Promise<void> {
  const policies = await fetchPolicies();
  const policyHash = createHash("sha256").update(JSON.stringify(policies)).digest("hex");
  const symbols = [...new Set(policies.map((p) => p.symbol))];
  const sessions = new Map<string, RealSession[]>();
  for (const symbol of symbols) sessions.set(symbol, await loadSessions(symbol));
  const results: Record<string, unknown> = {};
  const writeReceipt = () => {
    const receipt = { generatedAt: new Date().toISOString(), classification: "retrospective", policyHash, policies, results };
    mkdirSync("data/databento-v2/manifests", { recursive: true });
    const temp = `${RECEIPT}.partial`;
    writeFileSync(temp, JSON.stringify(receipt));
    renameSync(temp, RECEIPT);
  };
  console.log(`\nPRIORITY CHANNEL TRUTH REPLAY · retrospective · policy ${policyHash.slice(0, 12)}`);
  console.log("real 1-min underlying + Databento v2 NBBO · entry ask / exit bid · cost gate K=6 equivalent");
  console.log("unit = 1 contract, no pyramid, no daily latch · current = current risk/cap/latch/pyramid\n");
  for (const policy of policies) {
    const result = await replay(policy, sessions.get(policy.symbol)!);
    results[policy.slug] = { policy, ...result };
    writeReceipt();
    const r = result.pooled as Record<RunName, ReturnType<typeof summarize>>;
    const excluded = result.exclusions.missingChain + result.exclusions.shortSession + result.exclusions.missingExpiry;
    console.log(`${policy.slug.padEnd(28)} ${String(result.covered).padStart(4)}d/${excluded}excluded  unit ${signed(r.unit_audited.pnl).padStart(10)} (${signed(r.unit_audited.expectancy)}/t)  current ${signed(r.current_audited.pnl).padStart(10)} (${signed(r.current_audited.expectancy)}/t)  opt ${signed(r.current_optimistic.pnl).padStart(10)}`);
  }
  writeReceipt();
  console.log(`\nreceipt → ${RECEIPT}\n`);
}

main().catch((error) => { console.error(error); process.exit(1); });
