// ============================================================================
//  chop-premium-probe — does SHORT PREMIUM, gated to predicted-chop days, work?
//  (the chop-day brainstorm, 2026-06-11 — the one composition never run.)
//
//  The desk's books are trend/breakout RIDES; chop days steamroll them. Prior work
//  closed two doors and pointed at a third:
//   · DIRECTIONAL cleverness on chop — REFUTED twice: chop-router (route the
//     Nakamoto reversal book to chop → loses 20× worse on whipsaw days) and tonight's
//     level-gate (every level gate lowers the rides). Rides want structure crossings.
//   · SHORT PREMIUM always-on — theta-probe: the ±$5 iron fly is ~BREAKEVEN, because
//     TREND days run it through a short strike (max loss) and eat the chop-day credit.
//   · The UNTESTED synthesis (here): sell the fly ONLY on days the 10:30 gate predicts
//     CHOP — skip the trend days that kill it. Short premium IS the chop-native payoff
//     (unlike directional reversals), so this is the structurally-correct routing.
//
//  Composes the theta-probe's iron-fly P&L (real-NBBO, sell@bid/buy@ask, 13:00 ET entry
//  — AFTER the 10:30 gate is known, no look-ahead) with the chop-router's morning score
//  (drift + VWAP-persistence percentiles; predicted-chop = score < 0.5) and the realized
//  whipsaw-leg ORACLE (legs ≥ 5 = a known-chop day = the ceiling the gate chases).
//
//  READ:
//   · gate rescues it  → predicted-chop fly·REAL avg/day > 0, > the always-on baseline,
//     and predicted-trend < predicted-chop (the gate separates) → short-premium-on-chop
//     is the live chop book (pending the Phase-B multi-leg/limit doors).
//   · signal too weak  → realized-chop (oracle) ≫ realized-trend but predicted-chop ≈
//     baseline → the edge is real but the 10:30 gate can't catch it → STAND-DOWN.
//   · door closed      → even realized-chop fly·REAL ≤ 0 → the 4-leg entry spread wall
//     beats the thin OTM credit even on KNOWN chop days → only stand-down remains.
//
//  CAVEAT (same as chop-router): full-corpus percentiles = mildly in-sample → a
//  hypothesis-generator, not an arm ticket. An arm needs per-window OOS threshold fit.
//
//    npm run chop-premium-probe
// ============================================================================

import { loadRealSessions } from "./realsource";
import { loadDatabentoByDay, makeDatabentoChain } from "./databentosource";
import type { Quote } from "./types";

const etMinOf = (ms: number): number => {
  const et = new Date(new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York" }));
  return et.getHours() * 60 + et.getMinutes();
};
const CLOSE = 16 * 60, EXIT_ET = 15 * 60 + 50, ENTRY = 13 * 60; // 13:00 — gate known by then
const WING = 5, COMM = 0.04;
const WINDOWS = [
  { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];
const atQ = (ch: Quote[], k: number, t: "call" | "put") => ch.find((q) => q.optType === t && Math.round(q.strike) === k);
const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
function pctRank(values: number[], v: number): number { let b = 0; for (const x of values) if (x < v) b++; return b / values.length; }

interface Row { date: string; window: string; real: number | null; exp: number | null; drift: number; persist: number; legs: number; entered: boolean }

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET)) as unknown as Map<string, unknown[]>;
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0 && s.bars.length >= 90);

  const rows: Row[] = [];
  for (const s of real) {
    const win = WINDOWS.find((w) => s.dateET >= w.from && s.dateET <= w.to);
    if (!win) continue;
    // ---- morning features (knowable by 10:30 — first 60 session minutes) ----
    const firstHr = s.bars.slice(0, 60);
    const drift = Math.abs(firstHr[firstHr.length - 1].close - firstHr[0].open) / firstHr[0].open;
    const above = firstHr.filter((b) => b.close > b.vwap).length / firstHr.length;
    const persist = Math.max(above, 1 - above);
    // ---- realized whipsaw legs (ORACLE — end-of-day knowledge) ----
    let legs = 0, anchor = s.bars[0].close, dir = 0;
    for (const b of s.bars) {
      const mv = (b.close - anchor) / anchor;
      if (Math.abs(mv) >= 0.003) { const d = Math.sign(mv); if (d !== dir && dir !== 0) legs++; if (d !== dir) dir = d; anchor = b.close; }
    }
    // ---- iron fly P&L (theta-probe mechanic, 13:00 entry, hold OTM wings to expiry) ----
    const chainAt = makeDatabentoChain(byDay.get(s.dateET)! as Parameters<typeof makeDatabentoChain>[0]);
    const mins = s.bars.map((b) => etMinOf(b.ts));
    const barAt = (t: number) => { for (let i = 0; i < mins.length; i++) if (mins[i] >= t) return i; return -1; };
    const ei = barAt(ENTRY), xi = barAt(EXIT_ET);
    let rPnl: number | null = null, ePnl: number | null = null, entered = false;
    if (ei >= 0 && xi > ei) {
      const eb = s.bars[ei], xb = s.bars[xi], sf = s.bars[s.bars.length - 1].close, K = Math.round(eb.close);
      const chE = chainAt(eb.close, CLOSE - mins[ei], eb.ts), chX = chainAt(xb.close, CLOSE - mins[xi], xb.ts);
      const ce = atQ(chE, K, "call"), pe = atQ(chE, K, "put"), cx = atQ(chX, K, "call"), px = atQ(chX, K, "put");
      const wce = atQ(chE, K + WING, "call"), wpe = atQ(chE, K - WING, "put");
      if (ce && pe && cx && px && wce && wpe && ce.mid > 0 && pe.mid > 0) {
        entered = true;
        const bodyBid = ce.bid + pe.bid, bodyAskX = cx.ask + px.ask;
        const openCr = bodyBid - (wce.ask + wpe.ask);            // sell body @bid, buy wings @ask
        const wingExp = Math.max(0, Math.abs(sf - K) - WING);    // long wing intrinsic at expiry
        ePnl = (openCr - Math.min(Math.abs(sf - K), WING)) * 100 - 4 * COMM;     // all settle (optimistic)
        rPnl = (openCr - bodyAskX + wingExp) * 100 - 6 * COMM;   // close ATM body @ask, wings expire (honest)
      }
    }
    rows.push({ date: s.dateET, window: win.name, real: rPnl, exp: ePnl, drift, persist, legs, entered });
  }

  const ent = rows.filter((r) => r.entered);
  const drifts = ent.map((r) => r.drift), persists = ent.map((r) => r.persist);
  const score = (r: Row) => (pctRank(drifts, r.drift) + pctRank(persists, r.persist)) / 2;

  // ---- reporting ----
  const stat = (set: Row[], pick: (r: Row) => number | null) => {
    const v = set.map(pick).filter((x): x is number => x != null);
    if (!v.length) return { n: 0, avg: NaN, worst: NaN, win: NaN, tot: NaN };
    const tot = v.reduce((a, x) => a + x, 0);
    return { n: v.length, avg: tot / v.length, worst: Math.min(...v), win: (100 * v.filter((x) => x > 0).length) / v.length, tot };
  };
  const line = (label: string, set: Row[], pick: (r: Row) => number | null) => {
    const s = stat(set, pick);
    if (!s.n) return `  ${label.padEnd(30)} —`;
    return `  ${label.padEnd(30)} ${String(s.n).padStart(4)}d  ${usd(s.avg).padStart(7)}/day  worst ${usd(s.worst).padStart(7)}  ${s.win.toFixed(0).padStart(3)}% win  Σ ${usd(s.tot).padStart(8)}`;
  };

  const predChop = ent.filter((r) => score(r) < 0.5);
  const predTrend = ent.filter((r) => score(r) >= 0.5);
  const realChop = ent.filter((r) => r.legs >= 5);
  const realTrend = ent.filter((r) => r.legs <= 2);
  const caught = realChop.filter((r) => score(r) < 0.5).length;

  console.log(`\n  CHOP-PREMIUM probe · short ±$${WING} iron fly @ ${Math.floor(ENTRY / 60)}:00 ET · real-NBBO · ${ent.length} sessions · per-contract $`);
  console.log(`  fly·REAL = close ATM body @15:50 ask + OTM wings settle (honest tradeable) · fly·EXP = all settle (optimistic ceiling)`);
  console.log(`  GATE: predicted-chop = 10:30 score < 0.5 (drift + VWAP-persistence pctile) · ORACLE: realized whipsaw legs ≥ 5\n`);

  for (const [name, pick] of [["fly·REAL (honest)", (r: Row) => r.real], ["fly·EXP (ceiling)", (r: Row) => r.exp]] as Array<[string, (r: Row) => number | null]>) {
    console.log(`  ══ ${name} ══`);
    console.log(line("ALL days (always-on baseline)", ent, pick));
    console.log(line("predicted-chop (gate <0.5)", predChop, pick));
    console.log(line("predicted-trend (gate ≥0.5)", predTrend, pick));
    console.log(line("realized-chop ≥5 legs (oracle)", realChop, pick));
    console.log(line("realized-trend ≤2 legs (oracle)", realTrend, pick));
    console.log("");
  }

  console.log(`  per-window predicted-chop fly·REAL (the deployable arm):`);
  for (const w of WINDOWS) {
    const wd = predChop.filter((r) => r.window === w.name);
    const s = stat(wd, (r) => r.real);
    if (s.n) console.log(`    ${w.name.padEnd(16)} ${String(s.n).padStart(3)}d  ${usd(s.avg).padStart(7)}/day  Σ ${usd(s.tot).padStart(8)}  ${s.win.toFixed(0)}% win`);
  }
  console.log(`\n  ROUTER HIT RATE: 10:30 gate catches ${caught}/${realChop.length} realized-chop days (${Math.round((100 * caught) / Math.max(1, realChop.length))}%).`);
  console.log(`  READ: rescue = predicted-chop > 0 & > baseline & > predicted-trend. Weak-signal = oracle ≫ but gate ≈ baseline.`);
  console.log(`  Door-closed = realized-chop ≤ 0 (entry-spread wall beats the credit even on known-chop days → only stand-down).\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
