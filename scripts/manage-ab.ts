// ============================================================================
//  manage-ab — A/B the new per-channel MANAGEMENT_BY_SLUG against what actually
//  happened. For each of a day's real entries, replay the managed exit
//  (engine/manage.ts on the option's real per-minute bid/ask path) and compare
//  its P&L to the ACTUAL exit (priced on the SAME cost basis, so it's honest).
//  Answers: would scale-out/breakeven/trail have beaten today's exits? Read-only.
//
//  Run: npx tsx scripts/manage-ab.ts [YYYY-MM-DD]
// ============================================================================

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { computeFeatures } from "../engine/engine";
import { fillWithCost, type CostModel } from "../engine/cost";
import { openManaged, stepManaged } from "../engine/manage";
import { MANAGEMENT_BY_SLUG } from "../engine/management";
import type { Bar, OptType, Quote } from "../engine/types";

function loadEnv() { try { const t = readFileSync(".env.local", "utf8"); for (const l of t.split("\n")) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); } } catch { /* */ } }
loadEnv();
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });

const DAY = process.argv[2] || "2026-06-03";
const RTH_OPEN = 570, RTH_CLOSE = 960;
// Real bid/ask (option_bars source) + the worker's calibrated slippage/commission.
const COST: CostModel = { spreadSource: "option_bars", modeledSpreadPct: 0.03, modeledSpreadFloorUsd: 0.03, slippageTicksPerSide: 0.25, commissionPerContract: 0.04, crossSpread: true };
const ET = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
const etMin = (ms: number) => { const p: Record<string, string> = {}; for (const x of ET.formatToParts(new Date(ms))) p[x.type] = x.value; return (Number(p.hour) % 24) * 60 + Number(p.minute); };
const usd = (n: number) => `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(0)}`;

async function main() {
  const { data: barRows } = await sb.from("underlying_bars").select("ts,open,high,low,close,volume").eq("symbol", "SPY").gte("ts", `${DAY}T08:00:00Z`).lte("ts", `${DAY}T23:00:00Z`).order("ts", { ascending: true }).limit(2000);
  let cumPV = 0, cumV = 0;
  const session: Bar[] = (barRows ?? []).filter((b: any) => { const m = etMin(Date.parse(b.ts)); return m >= RTH_OPEN && m < RTH_CLOSE; }).map((b: any) => {
    const high = Number(b.high), low = Number(b.low), close = Number(b.close), volume = Number(b.volume ?? 0) || 1;
    cumPV += ((high + low + close) / 3) * volume; cumV += volume;
    return { ts: Date.parse(b.ts), open: Number(b.open), high, low, close, volume, vwap: cumPV / cumV };
  });
  const sMin = session.map((b) => etMin(b.ts));
  const idxOf = (m: number) => { let r = -1; for (let i = 0; i < sMin.length; i++) { if (sMin[i] <= m) r = i; else break; } return r; };
  if (!session.length) { console.log(`no RTH bars for ${DAY}`); return; }
  const atrCache = session.map((_, i) => computeFeatures(session, i).atr);

  const { data: pos } = await sb.from("positions").select("occ_symbol,opt_type,strike,qty,avg_entry_price,opened_at,closed_at,strategists(slug)").eq("status", "closed").gte("closed_at", `${DAY}T08:00:00Z`).order("opened_at", { ascending: true });
  if (!pos?.length) { console.log(`no closed trades ${DAY}`); return; }

  const agg: Record<string, { n: number; actual: number; managed: number }> = {};
  let tActual = 0, tManaged = 0, n = 0;
  for (const p of pos as any[]) {
    const slug = p.strategists?.slug ?? "?";
    const m = MANAGEMENT_BY_SLUG[slug];
    if (!m) continue;
    const optType: OptType = p.opt_type, strike = Number(p.strike), qty = Number(p.qty ?? 1), entry = Number(p.avg_entry_price ?? 0);
    const ei = idxOf(etMin(Date.parse(p.opened_at)));
    if (ei < 0 || entry <= 0) continue;

    // option quote path (bid/ask/mid) forward-filled by session minute
    const { data: qs } = await sb.from("option_quotes").select("captured_at,bid,ask,mid").eq("occ_symbol", p.occ_symbol).gte("captured_at", `${DAY}T08:00:00Z`).order("captured_at", { ascending: true });
    const q: (Quote | null)[] = new Array(session.length).fill(null);
    { let qi = 0; let last: Quote | null = null; const qq = (qs ?? []) as any[];
      for (let i = 0; i < session.length; i++) { while (qi < qq.length && etMin(Date.parse(qq[qi].captured_at)) <= sMin[i]) { const bid = Number(qq[qi].bid ?? 0), ask = Number(qq[qi].ask ?? 0), mid = Number(qq[qi].mid ?? (bid && ask ? (bid + ask) / 2 : bid || ask)); if (mid > 0) last = { strike, optType, bid, ask, mid }; qi++; } q[i] = last; } }
    const quoteAt = (i: number): Quote => q[i] ?? { strike, optType, bid: entry, ask: entry, mid: entry };

    // ACTUAL exit P&L on the manage.ts cost basis (sell crosses to bid)
    const ci = idxOf(etMin(Date.parse(p.closed_at ?? `${DAY}T20:00:00Z`)));
    const actualSell = fillWithCost("sell", quoteAt(ci >= 0 ? ci : session.length - 1), COST).fill;
    const actualPnl = (actualSell - entry) * qty * 100 - COST.commissionPerContract * qty * 2;

    // MANAGED exit P&L (scale-out / BE / trail via manage.ts)
    const entryEdge = fillWithCost("buy", quoteAt(ei), COST).edgeUsd;
    const st = openManaged(m, optType, strike, qty, entry, session[ei].close, ei, atrCache[ei], entryEdge);
    let managedPnl = 0;
    for (let i = ei + 1; i < session.length; i++) {
      const r = stepManaged(st, quoteAt(i), session[i].close, atrCache[i], sMin[i], Math.max(0, RTH_CLOSE - sMin[i]), COST);
      for (const pe of r.partials) managedPnl += pe.pnl;
      if (r.closed) break;
    }
    if (st.remaining > 0) { const r = stepManaged({ ...st, m: { ...m, eodFlattenMinToClose: 999 } }, quoteAt(session.length - 1), session[session.length - 1].close, atrCache[session.length - 1], sMin[session.length - 1], 0, COST); for (const pe of r.partials) managedPnl += pe.pnl; }

    agg[slug] ??= { n: 0, actual: 0, managed: 0 };
    agg[slug].n++; agg[slug].actual += actualPnl; agg[slug].managed += managedPnl;
    tActual += actualPnl; tManaged += managedPnl; n++;
  }

  console.log(`\n=== MANAGEMENT A/B · ${DAY} · ${n} trades (real bid/ask) ===\n`);
  console.log("channel                  n   ACTUAL    MANAGED     Δ");
  for (const [slug, a] of Object.entries(agg).sort((x, y) => (y[1].managed - y[1].actual) - (x[1].managed - x[1].actual))) {
    console.log(`${slug.padEnd(24)} ${String(a.n).padStart(2)}  ${usd(a.actual).padStart(8)}  ${usd(a.managed).padStart(8)}  ${usd(a.managed - a.actual).padStart(8)}`);
  }
  console.log("-".repeat(60));
  console.log(`${"TOTAL".padEnd(24)} ${String(n).padStart(2)}  ${usd(tActual).padStart(8)}  ${usd(tManaged).padStart(8)}  ${usd(tManaged - tActual).padStart(8)}`);
  console.log(`\n(ACTUAL = today's real exits on real fills; MANAGED = per-channel scale/BE/trail)\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
