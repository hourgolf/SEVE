// ============================================================================
//  fly-capture-probe — does recapturing the ATM body spread (the A2 limit ladder)
//  flip the short iron fly from breakeven to +EV? (2026-06-22)
//
//  The theta / chop-premium verdict: the ±$5 iron fly is ~BREAKEVEN (fly·REAL ≈ +$1/day
//  always-on, +$20/day on realized-chop days) because the ATM body is SOLD @bid on open
//  and BOUGHT BACK @ask on close — crossing the spread twice. That double-cross is the
//  exact cost A2's marketable-limit ladder recaptures. This re-runs the EXACT chop-premium
//  fly mechanic (real Databento NBBO, 13:00 entry, hold OTM wings to expiry) with a CAPTURE
//  fraction c on the body legs: open sell at bid + c·halfSpread, close buy at ask − c·halfSpread.
//  c=0 = cross (today, the breakeven baseline — sanity anchor); c=0.5 = half-capture (A1's level).
//
//  THE DECISIVE READ:
//   · always-on flips clearly +EV  → a chop-ROBUST channel that needs NO chop detection
//     (breaks the circle: profit from chop without predicting it). The fly direction is GO.
//   · only realized-chop flips +EV → capture helps but it STILL needs the (dead-axis) chop
//     classifier for selectivity → no escape from the wall.
//   · neither flips                → the fly is structurally dead even with perfect execution.
//
//  Conservative model: capture on the BODY legs only (the liquid ATM where a marketable-limit
//  works); wings stay bought @ask (OTM, wider, held to expiry — A2 might capture some, omitted).
//
//    npm run fly-capture-probe
// ============================================================================

import { loadRealSessions } from "./realsource";
import { loadDatabentoByDay, makeDatabentoChain } from "./databentosource";
import type { Quote } from "./types";

const etMinOf = (ms: number): number => {
  const et = new Date(new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York" }));
  return et.getHours() * 60 + et.getMinutes();
};
const CLOSE = 16 * 60, EXIT_ET = 15 * 60 + 50, ENTRY = 13 * 60, WING = 5, COMM = 0.04;
const CAPTURES = [0, 0.25, 0.5];
const WINDOWS = [
  { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];
const atQ = (ch: Quote[], k: number, t: "call" | "put") => ch.find((q) => q.optType === t && Math.round(q.strike) === k);
const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));

interface Row {
  date: string; window: string; legs: number;
  ceBid: number; ceMid: number; peBid: number; peMid: number;       // body @ entry (sell side)
  cxAsk: number; cxMid: number; pxAsk: number; pxMid: number;       // body @ close (buy side)
  wAsk: number; wingExp: number;                                    // wings: bought @ask, expiry intrinsic
}

// fly·REAL with body-leg capture fraction c (0 = cross = today; 0.5 = half-capture).
function flyReal(r: Row, c: number): number {
  const bodyOpen = (r.ceBid + c * (r.ceMid - r.ceBid)) + (r.peBid + c * (r.peMid - r.peBid)); // sell @ bid + c·half
  const bodyClose = (r.cxAsk - c * (r.cxAsk - r.cxMid)) + (r.pxAsk - c * (r.pxAsk - r.pxMid)); // buy @ ask − c·half
  const openCr = bodyOpen - r.wAsk;
  return (openCr - bodyClose + r.wingExp) * 100 - 6 * COMM;
}

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET)) as unknown as Map<string, unknown[]>;
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0 && s.bars.length >= 90);

  const rows: Row[] = [];
  for (const s of real) {
    const win = WINDOWS.find((w) => s.dateET >= w.from && s.dateET <= w.to);
    if (!win) continue;
    let legs = 0, anchor = s.bars[0].close, dir = 0;
    for (const b of s.bars) {
      const mv = (b.close - anchor) / anchor;
      if (Math.abs(mv) >= 0.003) { const d = Math.sign(mv); if (d !== dir && dir !== 0) legs++; if (d !== dir) dir = d; anchor = b.close; }
    }
    const chainAt = makeDatabentoChain(byDay.get(s.dateET)! as Parameters<typeof makeDatabentoChain>[0]);
    const mins = s.bars.map((b) => etMinOf(b.ts));
    const barAt = (t: number) => { for (let i = 0; i < mins.length; i++) if (mins[i] >= t) return i; return -1; };
    const ei = barAt(ENTRY), xi = barAt(EXIT_ET);
    if (ei < 0 || xi <= ei) continue;
    const eb = s.bars[ei], xb = s.bars[xi], sf = s.bars[s.bars.length - 1].close, K = Math.round(eb.close);
    const chE = chainAt(eb.close, CLOSE - mins[ei], eb.ts), chX = chainAt(xb.close, CLOSE - mins[xi], xb.ts);
    const ce = atQ(chE, K, "call"), pe = atQ(chE, K, "put"), cx = atQ(chX, K, "call"), px = atQ(chX, K, "put");
    const wce = atQ(chE, K + WING, "call"), wpe = atQ(chE, K - WING, "put");
    if (!(ce && pe && cx && px && wce && wpe && ce.mid > 0 && pe.mid > 0 && cx.ask > 0 && px.ask > 0)) continue;
    rows.push({
      date: s.dateET, window: win.name, legs,
      ceBid: ce.bid, ceMid: ce.mid, peBid: pe.bid, peMid: pe.mid,
      cxAsk: cx.ask, cxMid: cx.mid, pxAsk: px.ask, pxMid: px.mid,
      wAsk: wce.ask + wpe.ask, wingExp: Math.max(0, Math.abs(sf - K) - WING),
    });
  }

  const stat = (set: Row[], c: number) => {
    const v = set.map((r) => flyReal(r, c));
    if (!v.length) return { n: 0, avg: NaN, tot: NaN, win: NaN, worst: NaN };
    const tot = v.reduce((a, x) => a + x, 0);
    return { n: v.length, avg: tot / v.length, tot, win: (100 * v.filter((x) => x > 0).length) / v.length, worst: Math.min(...v) };
  };
  const line = (label: string, set: Row[], c: number) => {
    const s = stat(set, c);
    return s.n ? `  ${label.padEnd(28)} ${String(s.n).padStart(4)}d  ${usd(s.avg).padStart(7)}/day  Σ ${usd(s.tot).padStart(9)}  ${s.win.toFixed(0).padStart(3)}% win  worst ${usd(s.worst).padStart(7)}` : `  ${label.padEnd(28)} —`;
  };

  const allRows = rows, chopRows = rows.filter((r) => r.legs >= 5), trendRows = rows.filter((r) => r.legs <= 2);
  console.log(`\n  FLY-CAPTURE probe · short ±$${WING} iron fly @ 13:00 ET · real-NBBO · ${rows.length} sessions · per-contract $`);
  console.log(`  Q: does recapturing the ATM body spread (A2 ladder) flip the fly +EV? c = body-leg capture (0 = cross = today).\n`);
  for (const c of CAPTURES) {
    console.log(`  ══ capture c = ${c}${c === 0 ? "  (cross — the breakeven baseline / sanity anchor)" : c === 0.5 ? "  (half-capture — A1's tested level)" : ""} ══`);
    console.log(line("ALL days (always-on)", allRows, c));
    console.log(line("realized-CHOP ≥5 legs", chopRows, c));
    console.log(line("realized-TREND ≤2 legs", trendRows, c));
    console.log("");
  }
  console.log(`  per-window ALWAYS-ON fly·REAL by capture (the chop-robust, no-detection arm):`);
  console.log(`  window            ${CAPTURES.map((c) => `c=${c}`.padStart(10)).join("  ")}`);
  for (const w of WINDOWS) {
    const wr = rows.filter((r) => r.window === w.name);
    if (!wr.length) continue;
    console.log(`  ${w.name.padEnd(16)} ${CAPTURES.map((c) => usd(stat(wr, c).tot).padStart(10)).join("  ")}`);
  }
  console.log(`\n  READ: if ALWAYS-ON avg/day goes clearly +EV by c=0.5 → chop-robust channel, NO detection needed (escapes the wall).`);
  console.log(`  If only realized-CHOP flips → still needs the dead-axis classifier. If neither → the fly is structurally dead.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
