// ---------------------------------------------------------------------------
//  sentinel (deterministic core) — the nightly opportunity + drift scanner.
//
//  Applies the avg-peak harvest lens (memory/avg-peak-harvest-lens) across the
//  WHOLE roster in one pass — live channels (forensics-dataset.jsonl mfePct, real
//  fills / clean books) + the virtual bench (virtual_trades mfe_pct, mid-basis) —
//  nets the bench to a real-fill estimate via the measured exit half-spread, and
//  surfaces the two things a human keeps having to point out:
//    · BENCH promote candidates — net-positive after spread + a real peak
//    · LIVE harvest leaks       — big peak surrendered → a TP/ratchet lever
//  plus a first cut of DRIFT flags. Read-only. This is the SENSOR layer of the
//  sentinel; the judgment (prose), paging, and capture-chain schedule wrap it
//  (docs/desk-briefing-template.md). NO arm from bench data (mid-basis, capital-
//  blind) — this ranks hypotheses, it does not decide.
//
//    tsx --env-file=.env.local scripts/sentinel.ts [--days N]
// ---------------------------------------------------------------------------
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
);

const ERA4 = "2026-06-30";
// Measured NTM exit half-spread ($/ct) — the mid-basis → real-fill haircut on bench
// pnl (2026-07-09: QQQ ~5, IWM ~2, SPY tightest). Bench pnl is entry-at-ask / exit-at-mid,
// so only the exit half-spread is optimistic. Refresh from option_quotes periodically.
const EXIT_HALF: Record<string, number> = { SPY: 2, QQQ: 5, IWM: 2 };

const idxOf = (slug: string) => (slug.includes("qqq") ? "QQQ" : slug.includes("iwm") ? "IWM" : "SPY");
const r1 = (x: number) => Math.round(x * 10) / 10;
const money = (n: number) => (n < 0 ? "−$" : "+$") + Math.abs(Math.round(n));

// ---- LIVE: avg-peak per channel from forensics (real fills, clean books) ----
type F = { date: string; slug: string; mfePct: number | null; givebackPct: number | null; pnl: number };
function liveScan() {
  const all: F[] = readFileSync(path.join("data", "forensics-dataset.jsonl"), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l));
  const era = all.filter((r) => r.date >= ERA4 && r.mfePct != null);
  const by = new Map<string, F[]>();
  for (const r of era) { const a = by.get(r.slug) ?? []; a.push(r); by.set(r.slug, a); }
  return [...by.entries()].map(([slug, rs]) => {
    const g = rs.filter((r) => r.givebackPct != null);
    return {
      slug, n: rs.length,
      avgPeak: r1(rs.reduce((s, r) => s + (r.mfePct || 0), 0) / rs.length),
      avgGive: g.length ? Math.round(g.reduce((s, r) => s + (r.givebackPct || 0), 0) / g.length) : 0,
      pnl: Math.round(rs.reduce((s, r) => s + r.pnl, 0)),
    };
  });
}

// ---- BENCH: avg-peak per vb channel from virtual_trades (mid-basis), netted to real-fill ----
async function benchScan(days: number) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await sb.from("virtual_trades")
    .select("slug,mfe_pct,giveback_pct,pnl_per_contract")
    .like("slug", "vb-%").gte("signal_at", since).not("mfe_pct", "is", null).limit(5000);
  if (error) throw new Error(`virtual_trades read: ${error.message}`);
  const by = new Map<string, any[]>();
  for (const r of (data ?? []) as any[]) { const a = by.get(r.slug) ?? []; a.push(r); by.set(r.slug, a); }
  return [...by.entries()].map(([slug, rs]) => {
    const avgPeak = rs.reduce((s, r) => s + (r.mfe_pct || 0), 0) / rs.length;
    const midCt = rs.reduce((s, r) => s + (r.pnl_per_contract || 0), 0) / rs.length;
    const g = rs.filter((r) => r.giveback_pct != null).map((r) => r.giveback_pct);
    return {
      slug, n: rs.length, avgPeak: r1(avgPeak),
      netCt: r1(midCt - (EXIT_HALF[idxOf(slug)] ?? 3)),
      avgGive: g.length ? Math.round(g.reduce((s: number, x: number) => s + x, 0) / g.length) : null,
    };
  });
}

async function main() {
  const dArg = process.argv.indexOf("--days");
  const days = dArg > 0 ? Number(process.argv[dArg + 1]) || 7 : 7;

  const live = liveScan().filter((c) => c.n >= 3);
  const bench = (await benchScan(days)).filter((c) => c.n >= 4);

  const O: string[] = [];
  const P = (s = "") => O.push(s);
  P(`# SENTINEL — opportunity + drift scan   (bench window: last ${days}d)`);
  P();

  // BENCH promote candidates: net-positive after spread + a real peak to harvest
  const promote = bench.filter((c) => c.netCt > 0 && c.avgPeak >= 12).sort((a, b) => b.netCt - a.netCt);
  P(`## OPPORTUNITIES · BENCH  (promote: net-positive after spread + real peak → TP-probe)`);
  if (!promote.length) P(`   (none clear the bar this window)`);
  for (const c of promote)
    P(`   ${c.slug.padEnd(24)} peak ${String(c.avgPeak).padStart(5)}%   net ${money(c.netCt).padStart(5)}/ct   give ${String(c.avgGive ?? "-").padStart(4)}%   n=${c.n}`);
  P();

  // LIVE harvest leaks: high peak + high giveback → a TP/ratchet would capture it
  const leaks = live.filter((c) => c.avgPeak >= 25 && c.avgGive >= 50).sort((a, b) => b.avgPeak - a.avgPeak);
  P(`## OPPORTUNITIES · LIVE  (harvest leaks: high peak surrendered → TP/ratchet lever)`);
  if (!leaks.length) P(`   (none)`);
  for (const c of leaks)
    P(`   ${c.slug.padEnd(24)} peak ${String(c.avgPeak).padStart(5)}%   give ${String(c.avgGive).padStart(4)}%   ${money(c.pnl)}   n=${c.n}`);
  P();

  // DRIFT / ANOMALY (v1 mechanical — baseline-diff + regime checks come with the judgment layer)
  P(`## DRIFT / ANOMALY`);
  const scalps = live.filter((c) => c.avgPeak < 5).map((c) => c.slug);
  const craters = bench.filter((c) => c.avgGive != null && (c.avgGive as number) > 500).map((c) => c.slug);
  if (scalps.length) P(`   live scalps (<5% peak — nothing to harvest): ${scalps.join(", ")}`);
  if (craters.length) P(`   bench craters (giveback >500% — peak then deep loss): ${craters.join(", ")}`);
  if (!scalps.length && !craters.length) P(`   (no mechanical flags)`);
  P();
  P(`   ⚠ deterministic sensor layer — judgment (prose) + paging + schedule pending. No arm from bench (mid-basis, capital-blind).`);

  console.log(O.join("\n"));
}
main().catch((e) => { console.error(`sentinel: ${(e as Error).message}`); process.exit(1); });
