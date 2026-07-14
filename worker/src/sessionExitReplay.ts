// Read-only session-scale replay over native positions and captured executable
// bids. Outputs a local research fixture; never writes Supabase or places orders.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { replayScaleBeforeNativeClose, type ExitReplayPosition, type ExitReplayQuote, type RunnerMode } from "./sessionExitReplayModel.js";

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const DATE = arg("date", new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()));
const OUT = arg("out", `data/session-exit-replay/${DATE}.json`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE)) throw new Error(`invalid --date ${DATE}`);

function etWallToUtcMs(dateEt: string, hh: number, mm: number): number {
  const noon = new Date(`${dateEt}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(noon);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "12") % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return Date.parse(`${dateEt}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`) + (12 * 60 - h * 60 - m) * 60_000;
}

interface PositionRow {
  id: string; occ_symbol: string; qty: number; avg_entry_price: number; realized_pnl: number;
  opened_at: string; closed_at: string; close_reason: string; strategists: { slug?: string } | Array<{ slug?: string }> | null;
}
interface QuoteRow { occ_symbol: string; bid: number; captured_at: string }
const slugOf = (value: PositionRow["strategists"]): string => (Array.isArray(value) ? value[0] : value)?.slug ?? "?";
const sum = (values: readonly number[]): number => Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase backend credentials missing");
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const startIso = new Date(etWallToUtcMs(DATE, 9, 30)).toISOString();
  const endIso = new Date(etWallToUtcMs(DATE, 16, 30)).toISOString();
  const { data, error } = await sb.from("positions")
    .select("id,occ_symbol,qty,avg_entry_price,realized_pnl,opened_at,closed_at,close_reason,strategists(slug)")
    .gte("opened_at", startIso).lt("opened_at", endIso).eq("status", "closed").order("opened_at");
  if (error) throw new Error(`positions read failed: ${error.message}`);
  const rows = (data ?? []) as unknown as PositionRow[];
  const positions: ExitReplayPosition[] = rows.map((row) => {
    const quantity = Number(row.qty), entryPrice = Number(row.avg_entry_price), nativePnl = Number(row.realized_pnl);
    return {
      id: row.id, channel: slugOf(row.strategists), quantity, entryPrice,
      openedAtMs: Date.parse(row.opened_at), nativeClosedAtMs: Date.parse(row.closed_at),
      nativeExitPrice: entryPrice + nativePnl / (quantity * 100), nativePnl,
    };
  });
  const occs = [...new Set(rows.map((row) => row.occ_symbol))];
  const quotes: QuoteRow[] = [];
  for (let from = 0; ; from += 1_000) {
    const { data: batchData, error: batchError } = await sb.from("option_quotes")
      .select("occ_symbol,bid,captured_at").in("occ_symbol", occs)
      .gte("captured_at", startIso).lt("captured_at", endIso).order("captured_at").order("id").range(from, from + 999);
    if (batchError) throw new Error(`option quote read failed: ${batchError.message}`);
    const batch = (batchData ?? []) as unknown as QuoteRow[];
    quotes.push(...batch);
    if (batch.length < 1_000) break;
  }
  const quotesByOcc = new Map<string, ExitReplayQuote[]>();
  for (const quote of quotes) {
    const path = quotesByOcc.get(quote.occ_symbol) ?? [];
    path.push({ atMs: Date.parse(quote.captured_at), bid: Number(quote.bid) });
    quotesByOcc.set(quote.occ_symbol, path);
  }

  const targets = [10, 15, 20, 25, 30];
  const modes: RunnerMode[] = ["native", "breakeven", "half_giveback"];
  const policies = targets.flatMap((targetPct) => modes.map((runnerMode) => ({ targetPct, runnerMode })));
  const nativeTotal = sum(positions.map((position) => position.nativePnl));
  const results = policies.map((policy) => {
    const trades = positions.map((position, index) => {
      const result = replayScaleBeforeNativeClose(position, quotesByOcc.get(rows[index].occ_symbol) ?? [], policy.targetPct, policy.runnerMode);
      return { positionId: position.id, channel: position.channel, quantity: position.quantity, nativePnl: position.nativePnl, ...result };
    });
    const channelGroups = new Map<string, typeof trades>();
    for (const trade of trades) { const group = channelGroups.get(trade.channel) ?? []; group.push(trade); channelGroups.set(trade.channel, group); }
    return {
      ...policy,
      eligible: trades.filter((trade) => trade.eligible).length,
      triggered: trades.filter((trade) => trade.triggered).length,
      nativeTotal,
      modeledTotal: sum(trades.map((trade) => trade.modeledPnl)),
      deltaVsNative: sum(trades.map((trade) => trade.deltaVsNative)),
      channels: [...channelGroups.entries()].map(([channel, group]) => ({
        channel, trades: group.length, triggered: group.filter((trade) => trade.triggered).length,
        nativePnl: sum(group.map((trade) => trade.nativePnl)), modeledPnl: sum(group.map((trade) => trade.modeledPnl)),
        deltaVsNative: sum(group.map((trade) => trade.deltaVsNative)),
      })).sort((a, b) => b.deltaVsNative - a.deltaVsNative || a.channel.localeCompare(b.channel)),
      trades,
    };
  }).sort((a, b) => b.modeledTotal - a.modeledTotal);
  const report = {
    schemaVersion: 1, dateEt: DATE, generatedAt: new Date().toISOString(),
    evidence: { basis: "captured_executable_bid_before_native_close", extensionPastNativeClose: false, quoteRows: quotes.length, positions: positions.length },
    caveats: [
      "Observed snapshot bids are causal evidence, not guaranteed fills.",
      "A target missed between snapshots remains untriggered; this is conservative for scale detection.",
      "The runner never extends past the actual close; unobserved post-close paths are not fabricated.",
      "One session can reject mechanics, not promote a channel or policy.",
    ],
    nativeTotal, results,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`session-exit-replay: ${DATE} · ${positions.length} positions · ${quotes.length.toLocaleString()} quote rows`);
  for (const result of results.slice(0, 8)) console.log(`  bank ${result.targetPct}% / ${result.runnerMode.padEnd(13)} ${result.triggered}/${result.eligible} · $${result.modeledTotal} · Δ $${result.deltaVsNative}`);
  console.log(`  native $${nativeTotal} · wrote ${OUT}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
