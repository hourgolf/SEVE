// Re-evaluate the exact channel entry predicate against checksum-verified 5s
// forming bars for actual native entries. Research-only; no broker/storage writes.

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { computeFeatures } from "../../engine/engine.js";
import { getStrategy } from "../../engine/registry.js";
import { specToStrategyDef } from "../../engine/specEvaluate.js";
import type { Bar, Features, Intent } from "../../engine/types.js";
import type { StrategySpec } from "../../lib/desk/strategySpec.js";
import { assessBarFidelity } from "./intraminuteReplayModel.js";

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const DATE = arg("date", new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()));
const INPUT = arg("input", `data/intraminute-replay/${DATE}/entry-source-minutes.json`);
const OUTPUT = arg("out", `data/intraminute-replay/${DATE}/entry-signal-replay.json`);
const PRICE_FIDELITY_TOLERANCE = 0.011;
const VOLUME_FIDELITY_TOLERANCE = 0;
if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE)) throw new Error(`invalid --date ${DATE}`);

interface FixtureEntry {
  opportunityId: string; positionId: string; channel: string; symbol: string; occSymbol: string;
  sourceBarAt: string; sourceMinuteKey: string; decisionAt: string; realizedPnl: number;
}
interface FormingSnapshot { atMs: number; open: number | null; high: number | null; low: number | null; close: number | null; volume: number }
interface FixtureMinute { key: string; minuteStartAt: string; forming5s: FormingSnapshot[] }
interface Fixture { coverage: Record<string, number>; entries: FixtureEntry[]; minutes: FixtureMinute[] }
interface ChannelRow { slug: string; underlying: string; spec_json: StrategySpec | null }
interface BarRow { symbol: string; ts: string; open: number; high: number; low: number; close: number; volume: number }

const ET_PARTS = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
function et(ms: number): { date: string; min: number } {
  const p = Object.fromEntries(ET_PARTS.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const h = Number(p.hour) % 24;
  return { date: `${p.year}-${p.month}-${p.day}`, min: h * 60 + Number(p.minute) };
}
const asBar = (row: BarRow): Bar => ({ ts: Date.parse(row.ts), open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), volume: Number(row.volume), vwap: Number(row.close) });
const resolveCodeSlug = (slug: string): string => slug.replace(/-\d+$/, "").replace(/-manual$/i, "").replace(/-(qqq|spy)$/i, "").replace(/-itm$/i, "").replace(/-wd$/i, "");

function levels(all: readonly Bar[], dateEt: string): { pdh?: number; pdl?: number; gap?: number } {
  const days = new Map<string, { high: number; low: number; firstOpen: number; lastClose: number }>();
  for (const bar of [...all].sort((a, b) => a.ts - b.ts)) {
    const part = et(bar.ts);
    if (part.min < 570 || part.min >= 960) continue;
    const prior = days.get(part.date);
    if (!prior) days.set(part.date, { high: bar.high, low: bar.low, firstOpen: bar.open, lastClose: bar.close });
    else { prior.high = Math.max(prior.high, bar.high); prior.low = Math.min(prior.low, bar.low); prior.lastClose = bar.close; }
  }
  const priorDate = [...days.keys()].filter((d) => d < dateEt).sort().at(-1);
  const prior = priorDate ? days.get(priorDate) : undefined;
  const today = days.get(dateEt);
  if (!prior) return {};
  return {
    pdh: prior.high, pdl: prior.low,
    gap: today && prior.lastClose > 0 ? ((today.firstOpen - prior.lastClose) / prior.lastClose) * 100 : undefined,
  };
}

function sessionWithForming(all: readonly Bar[], dateEt: string, minuteStartMs: number, snapshot: FormingSnapshot): Bar[] {
  const raw = all.filter((bar) => {
    const p = et(bar.ts);
    return p.date === dateEt && p.min >= 570 && p.min < 960 && bar.ts < minuteStartMs;
  }).sort((a, b) => a.ts - b.ts);
  if (snapshot.open == null || snapshot.high == null || snapshot.low == null || snapshot.close == null || snapshot.volume <= 0) return [];
  raw.push({ ts: minuteStartMs, open: snapshot.open, high: snapshot.high, low: snapshot.low, close: snapshot.close, volume: snapshot.volume, vwap: snapshot.close });
  let cumPv = 0, cumV = 0;
  return raw.map((bar) => {
    const volume = bar.volume || 1;
    cumPv += ((bar.high + bar.low + bar.close) / 3) * volume;
    cumV += volume;
    return { ...bar, volume, vwap: cumPv / cumV };
  });
}

function evaluate(channel: ChannelRow, bars: Bar[], lv: ReturnType<typeof levels>): Intent | null {
  const code = getStrategy(channel.slug) ?? getStrategy(resolveCodeSlug(channel.slug));
  const built = code
    ? { evaluate: code.build(bars, code.timeframeMin), warmup: code.warmupBars }
    : channel.spec_json
      ? (() => { const def = specToStrategyDef(channel.spec_json as StrategySpec); return { evaluate: def.build(bars, def.timeframeMin, lv), warmup: def.warmupBars }; })()
      : null;
  if (!built || bars.length < built.warmup) return null;
  const p = et(bars[bars.length - 1].ts);
  const f: Features = { ...computeFeatures(bars, bars.length - 1), minutesToClose: Math.max(0, 960 - p.min) };
  return built.evaluate(f, null);
}

const sameDirection = (intent: Intent | null, direction: "call" | "put"): boolean => intent?.kind === "enter" && intent.direction === direction;
const summarize = (values: number[]): { min: number | null; p50: number | null; p95: number | null; max: number | null } => {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  const p = (q: number): number | null => a.length ? a[Math.max(0, Math.ceil(q * a.length) - 1)] : null;
  return { min: a[0] ?? null, p50: p(0.5), p95: p(0.95), max: a.at(-1) ?? null };
};

async function main(): Promise<void> {
  const fixture = JSON.parse(readFileSync(INPUT, "utf8")) as Fixture;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase backend credentials missing");
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const slugs = [...new Set(fixture.entries.map((entry) => entry.channel))];
  const symbols = [...new Set(fixture.entries.map((entry) => entry.symbol))];
  const { data: channelData, error: channelError } = await sb.from("strategists").select("slug,underlying,spec_json").in("slug", slugs);
  if (channelError) throw new Error(`channel read failed: ${channelError.message}`);
  const barData: BarRow[] = [];
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await sb.from("underlying_bars").select("symbol,ts,open,high,low,close,volume").in("symbol", symbols)
      .gte("ts", new Date(Date.parse(`${DATE}T00:00:00Z`) - 7 * 86_400_000).toISOString())
      .lt("ts", new Date(Date.parse(`${DATE}T00:00:00Z`) + 2 * 86_400_000).toISOString())
      .order("ts").order("symbol").range(from, from + 999);
    if (error) throw new Error(`underlying bars read failed: ${error.message}`);
    const batch = (data ?? []) as unknown as BarRow[];
    barData.push(...batch);
    if (batch.length < 1_000) break;
  }
  const channelBySlug = new Map(((channelData ?? []) as unknown as ChannelRow[]).map((row) => [row.slug, row]));
  const barsBySymbol = new Map<string, Bar[]>();
  for (const row of barData) { const list = barsBySymbol.get(row.symbol) ?? []; list.push(asBar(row)); barsBySymbol.set(row.symbol, list); }
  const minuteByKey = new Map(fixture.minutes.map((minute) => [minute.key, minute]));

  const results = fixture.entries.map((entry) => {
    const channel = channelBySlug.get(entry.channel);
    const minute = minuteByKey.get(entry.sourceMinuteKey);
    const all = barsBySymbol.get(entry.symbol) ?? [];
    const minuteStartMs = Date.parse(entry.sourceBarAt);
    const direction = entry.occSymbol.slice(-9, -8) === "C" ? "call" as const : "put" as const;
    const lv = levels(all, DATE);
    const evaluations = (minute?.forming5s ?? []).map((snapshot) => {
      const bars = sessionWithForming(all, DATE, minuteStartMs, snapshot);
      const intent = channel && bars.length ? evaluate(channel, bars, lv) : null;
      return { atMs: snapshot.atMs, second: Math.round((snapshot.atMs - minuteStartMs) / 1_000), matches: sameDirection(intent, direction), reason: intent?.kind === "enter" ? intent.reason : null, close: snapshot.close };
    });
    const firstIndex = evaluations.findIndex((evaluation) => evaluation.matches);
    let durableIndex = -1;
    for (let i = 1; i < evaluations.length; i++) if (evaluations[i - 1].matches && evaluations[i].matches) { durableIndex = i; break; }
    const final = evaluations.at(-1) ?? null;
    const finalSnapshot = minute?.forming5s.at(-1) ?? null;
    const official = all.find((bar) => bar.ts === minuteStartMs) ?? null;
    const barFidelity = assessBarFidelity(
      finalSnapshot?.open != null && finalSnapshot.high != null && finalSnapshot.low != null && finalSnapshot.close != null
        ? { open: finalSnapshot.open, high: finalSnapshot.high, low: finalSnapshot.low, close: finalSnapshot.close, volume: finalSnapshot.volume }
        : null,
      official ? { open: official.open, high: official.high, low: official.low, close: official.close, volume: official.volume } : null,
      PRICE_FIDELITY_TOLERANCE,
      VOLUME_FIDELITY_TOLERANCE,
    );
    const first = firstIndex >= 0 ? evaluations[firstIndex] : null;
    const durable = durableIndex >= 0 ? evaluations[durableIndex] : null;
    const directionSign = direction === "call" ? 1 : -1;
    const underlyingAdvantage = durable?.close != null && final?.close != null ? (final.close - durable.close) * directionSign : null;
    return {
      positionId: entry.positionId, opportunityId: entry.opportunityId, channel: entry.channel, symbol: entry.symbol, direction,
      sourceBarAt: entry.sourceBarAt, decisionAt: entry.decisionAt, realizedPnl: entry.realizedPnl,
      closeMatched: final?.matches ?? false, barFidelity,
      timingQualified: barFidelity.qualified && (final?.matches ?? false),
      firstTrueSecond: first?.second ?? null, durableSecond: durable?.second ?? null,
      leadVsNativeDecisionSec: durable ? (Date.parse(entry.decisionAt) - durable.atMs) / 1_000 : null,
      underlyingAdvantageAtDurable: underlyingAdvantage,
      transientBeforeClose: evaluations.some((evaluation) => evaluation.matches) && !(final?.matches ?? false),
      evaluations,
    };
  });
  const byChannel = [...new Set(results.map((result) => result.channel))].sort().map((channel) => {
    const rows = results.filter((result) => result.channel === channel);
    return {
      channel, entries: rows.length, closeMatched: rows.filter((row) => row.closeMatched).length,
      barFidelityQualified: rows.filter((row) => row.barFidelity.qualified).length,
      timingQualified: rows.filter((row) => row.timingQualified).length,
      durableBeforeClose: rows.filter((row) => row.timingQualified && row.durableSecond != null && (row.durableSecond as number) < 60).length,
      durableSecond: summarize(rows.filter((row) => row.timingQualified).map((row) => row.durableSecond).filter((x): x is number => x != null)),
      leadVsNativeDecisionSec: summarize(rows.filter((row) => row.timingQualified).map((row) => row.leadVsNativeDecisionSec).filter((x): x is number => x != null)),
      signedUnderlyingAdvantage: summarize(rows.filter((row) => row.timingQualified).map((row) => row.underlyingAdvantageAtDurable).filter((x): x is number => x != null)),
    };
  });
  const report = {
    schemaVersion: 2, dateEt: DATE, generatedAt: new Date().toISOString(),
    evidence: {
      actualEntries: fixture.entries.length, sourceMinutes: fixture.minutes.length, rawCoverage: fixture.coverage,
      clockSec: 5, persistenceSamples: 2,
      completedBarGate: { priceTolerance: PRICE_FIDELITY_TOLERANCE, volumeTolerance: VOLUME_FIDELITY_TOLERANCE },
    },
    caveats: [
      "This cohort contains actual native entries only; it cannot estimate the false-positive rate on minutes with no native close signal.",
      "The replay evaluates entry predicates on forming underlying bars but has no candidate-time OPRA ask, so it makes no option-PnL claim.",
      "v1 raw SIP captures omitted exchange/tape/sale-condition provenance. A reconstructed minute must reproduce the official completed OHLCV bar before it can support timing inference.",
      "A completed-bar mismatch or final predicate mismatch excludes that row from timing inference; excluded rows remain visible in the report.",
    ],
    summary: {
      closeMatched: results.filter((result) => result.closeMatched).length,
      barFidelityQualified: results.filter((result) => result.barFidelity.qualified).length,
      timingQualified: results.filter((result) => result.timingQualified).length,
      durableBeforeClose: results.filter((result) => result.timingQualified && result.durableSecond != null && (result.durableSecond as number) < 60).length,
      leadVsNativeDecisionSec: summarize(results.filter((result) => result.timingQualified).map((result) => result.leadVsNativeDecisionSec).filter((x): x is number => x != null)),
    },
    channels: byChannel, results,
  };
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`intraminute-signal-replay: predicate close ${report.summary.closeMatched}/${fixture.entries.length} · bar fidelity ${report.summary.barFidelityQualified}/${fixture.entries.length} · timing-qualified ${report.summary.timingQualified}/${fixture.entries.length}`);
  for (const row of byChannel) console.log(`  ${row.channel.padEnd(24)} predicate ${row.closeMatched}/${row.entries} · bar ${row.barFidelityQualified}/${row.entries} · timing ${row.timingQualified}/${row.entries} · early ${row.durableBeforeClose} · lead p50 ${row.leadVsNativeDecisionSec.p50 ?? "—"}s`);
  console.log(`  wrote ${OUTPUT}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
