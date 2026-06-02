// ============================================================================
//  scripts/latency.ts   ·   run: npm run latency [-- --days N]
//
//  Quantifies the cost of the worker's once-a-minute cron cadence + fill lag —
//  the input to "is a streaming worker / real-time data worth it?".
//
//  Mechanism: a channel decides on a 1-min bar's close (signal.underlying_price),
//  but the cron places the market order ~1 min later, so it fills after SPY has
//  already moved. For every ACTED signal we measure how far SPY moved IN THE
//  TRADE'S FAVOR between the decision price and the fill-time bar (+1m) and +2m —
//  the "chase". Positive chase = we systematically pay up for a move that already
//  started = exactly what streaming would recover. ~0 = latency isn't costing us.
//
//  Pure read of our own DB (signals + underlying_bars). Est. $ drag uses a 0.5 ATM
//  delta proxy (premium move ≈ delta x underlying move x 100); a precise per-quote
//  version is a follow-up. Underlying_bars are retained long, so --days can be big.
// ============================================================================

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const usd = (v: number) => (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(2);
const sgn = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(3);
const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n);
const padL = (s: string, n: number) => (" ".repeat(n) + s).slice(-n);

async function main() {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });

  const di = process.argv.indexOf("--days");
  const days = di >= 0 && process.argv[di + 1] ? Number(process.argv[di + 1]) : 7;
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  const [stratR, sigR] = await Promise.all([
    sb.from("strategists").select("id,slug"),
    sb.from("signals").select("strategist_id,direction,underlying_price,rationale,created_at").eq("acted_on", true).gte("created_at", since).order("created_at", { ascending: true }).limit(1000),
  ]);
  const slugById = new Map<string, string>(); for (const s of (stratR.data ?? [])) slugById.set(s.id as string, s.slug as string);
  const sigs = sigR.data ?? [];
  // Paginate bars past PostgREST's ~1000-row cap (a plain .limit is silently capped —
  // see CLAUDE.md). Without this, every signal matches the last loaded bar = garbage.
  const bars: { ts: number; high: number; low: number; close: number }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("underlying_bars").select("ts,high,low,close").eq("symbol", "SPY").gte("ts", since).order("ts", { ascending: true }).range(from, from + 999);
    if (error) break;
    const rows = data ?? [];
    for (const b of rows) bars.push({ ts: Date.parse(b.ts as string), high: Number(b.high), low: Number(b.low), close: Number(b.close) });
    if (rows.length < 1000) break;
  }
  if (!bars.length || !sigs.length) { console.log(`\nNot enough data: ${sigs.length} acted signals, ${bars.length} bars in the last ${days}d.\n`); return; }

  const tsArr = bars.map((b) => b.ts);
  // largest bar index with ts <= target
  const idxAtOrBefore = (target: number): number => { let lo = 0, hi = tsArr.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (tsArr[m] <= target) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; };
  const closeNear = (target: number): number | null => { const i = idxAtOrBefore(target); return i >= 0 ? bars[i].close : null; };
  const atrAt = (target: number): number => { const i = idxAtOrBefore(target); if (i < 1) return 0; let s = 0, c = 0; for (let j = Math.max(1, i - 13); j <= i; j++) { s += bars[j].high - bars[j].low; c++; } return c ? s / c : 0; };

  type Row = { n: number; chaseFill: number[]; chaseFillR: number[]; chase2: number[]; drag: number };
  const roll = new Map<string, Row>();
  const ensure = (slug: string) => { let r = roll.get(slug); if (!r) { r = { n: 0, chaseFill: [], chaseFillR: [], chase2: [], drag: 0 }; roll.set(slug, r); } return r; };

  for (const s of sigs) {
    const t0 = Date.parse(s.created_at as string);
    const p0 = Number(s.underlying_price);                         // price the strategy decided on (bar close)
    if (!isFinite(p0) || p0 <= 0) continue;
    const pFill = closeNear(t0);                                   // SPY at ~the cron/fill minute
    const p2 = closeNear(t0 + 120_000);                            // +2 min (if the fill lags more)
    if (pFill == null) continue;
    const dir = String(s.direction);
    const sign = dir === "call" ? 1 : dir === "put" ? -1 : 0;
    if (!sign) continue;
    const atr = atrAt(t0) || 0.01;
    const chaseFill = sign * (pFill - p0);                         // + = SPY already moved our way before we filled
    const chase2 = p2 != null ? sign * (p2 - p0) : chaseFill;
    const qty = Number((s.rationale as { qty?: number } | null)?.qty ?? 1) || 1;
    const r = ensure(slugById.get(s.strategist_id as string) ?? "?");
    r.n++; r.chaseFill.push(chaseFill); r.chaseFillR.push(chaseFill / atr); r.chase2.push(chase2);
    r.drag += Math.max(0, chaseFill) * 0.5 * 100 * qty;            // est premium paid-up: chase x 0.5 delta x 100 x qty
  }

  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const pctPos = (a: number[]) => (a.length ? (100 * a.filter((x) => x > 0).length) / a.length : 0);

  console.log(`\n══ Latency / chase · last ${days}d · ${sigs.length} acted signals · decision→fill = ~1 cron minute ══`);
  console.log("  " + pad("CHANNEL", 17) + padL("n", 5) + padL("chase$(fill)", 14) + padL("chase(ATR)", 12) + padL("%paid-up", 10) + padL("chase$(+2m)", 13) + padL("est $ drag", 12));
  console.log("  " + "─".repeat(82));
  const allR: Row = { n: 0, chaseFill: [], chaseFillR: [], chase2: [], drag: 0 };
  for (const [slug, r] of [...roll.entries()].sort((a, b) => b[1].n - a[1].n)) {
    allR.n += r.n; allR.chaseFill.push(...r.chaseFill); allR.chaseFillR.push(...r.chaseFillR); allR.chase2.push(...r.chase2); allR.drag += r.drag;
    console.log("  " + pad(slug, 17) + padL(String(r.n), 5) + padL(sgn(mean(r.chaseFill)), 14) + padL(sgn(mean(r.chaseFillR)), 12) + padL(pctPos(r.chaseFill).toFixed(0) + "%", 10) + padL(sgn(mean(r.chase2)), 13) + padL(usd(r.drag), 12));
  }
  console.log("  " + "─".repeat(82));
  console.log("  " + pad("ALL", 17) + padL(String(allR.n), 5) + padL(sgn(mean(allR.chaseFill)), 14) + padL(sgn(mean(allR.chaseFillR)), 12) + padL(pctPos(allR.chaseFill).toFixed(0) + "%", 10) + padL(sgn(mean(allR.chase2)), 13) + padL(usd(allR.drag), 12));

  const mR = mean(allR.chaseFillR), mP = pctPos(allR.chaseFill);
  console.log(`\nRead: "chase$(fill)" = SPY points moved IN the trade's favor between decision and fill (+ = we paid up).`);
  console.log(`      "chase(ATR)" normalizes it; "%paid-up" = share of entries where the move had already started.`);
  let verdict: string;
  if (mR >= 0.25 && mP >= 60) verdict = `⚠ MEANINGFUL latency cost — avg ${mR.toFixed(2)} ATR already moved before fill on ${mP.toFixed(0)}% of entries. Streaming/real-time would likely recover a chunk of this.`;
  else if (mR >= 0.1) verdict = `~ MODEST latency cost (avg ${mR.toFixed(2)} ATR; ${mP.toFixed(0)}% paid-up). Worth watching; not yet a clear case for the streaming rebuild.`;
  else verdict = `✓ MINIMAL latency cost (avg ${mR.toFixed(2)} ATR; ${mP.toFixed(0)}% paid-up). The 1-min cadence isn't materially hurting entries — the streaming rebuild likely isn't worth it yet.`;
  console.log(`\n${verdict}\n`);
  console.log(`(est $ drag uses a 0.5 ATM delta proxy on the paid-up entries; a precise per-quote version is a follow-up.)\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
