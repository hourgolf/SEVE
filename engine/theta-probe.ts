// ============================================================================
//  theta-probe — is there a TRADEABLE 0DTE vol-risk-premium? (the spreads thread)
//
//  #1–#3: single-leg directional has no scalp edge (entries coin flips, edges convex).
//  The untested case is NON-DIRECTIONAL premium SELLING — sell an ATM 0DTE straddle on
//  the CLOCK, harvest theta, profit when realized move < implied (straddle) move. The
//  coin-flip finding argues FOR it, and selling collects a LARGE credit vs the spread.
//
//  Naked straddle = the EDGE probe (unbounded risk, NOT tradeable). The iron FLY (short
//  ATM straddle + long ±wing) is the defined-risk live form: does the edge SURVIVE once
//  you pay for the wings that cap the tail? Two rescue levers vs a tight buy-back fly:
//    • WIDER wings (cheaper insurance, keep more credit, bigger but still-capped tail)
//    • HOLD-TO-EXPIRY (skip the 4-leg exit spread — half the multi-leg cost wall)
//
//    npm run theta-probe -- --days 800
//
//  Real Databento NBBO, per-contract $, market fills (sell@bid/buy@ask). Strikes span
//  ~±$11 so ±$10 wings drop some days (n shown). EXP = settle at expiry (no exit spread).
// ============================================================================

import { loadRealSessions } from "./realsource";
import { loadDatabentoByDay, makeDatabentoChain } from "./databentosource";
import type { Quote } from "./types";

const etMinOf = (ms: number): number => {
  const et = new Date(new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York" }));
  return et.getHours() * 60 + et.getMinutes();
};
const CLOSE = 16 * 60, EXIT_ET = 15 * 60 + 50;
const ENTRIES = [10 * 60, 13 * 60]; // 10:00 · 13:00 ET
const WINGS = [5, 10];              // iron-fly wing widths to compare
const COMM = 0.04;

const WINDOWS = [
  { name: "CHOP Mar26",     from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24",       from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];
const atQ = (ch: Quote[], k: number, t: "call" | "put") => ch.find((q) => q.optType === t && Math.round(q.strike) === k);
const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(v).toFixed(0);

async function main() {
  const di = process.argv.indexOf("--days");
  const since = di >= 0 && process.argv[di + 1] ? Number(process.argv[di + 1]) : 800;
  const sessions = await loadRealSessions({ sinceDaysAgo: since });
  if (!sessions.length) { console.log("\nNo real sessions.\n"); return; }
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET)) as unknown as Map<string, unknown[]>;
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0);

  // per entry → window → array of {naked, edge, fly[W]:{bb,exp}}
  type Day = { edge: number; naked: number; fly: Record<number, { bb: number | null; exp: number | null }> };
  const acc = new Map<number, Map<string, Day[]>>();
  for (const et of ENTRIES) acc.set(et, new Map(WINDOWS.map((w) => [w.name, []])));

  for (const s of real) {
    const chainAt = makeDatabentoChain(byDay.get(s.dateET)! as Parameters<typeof makeDatabentoChain>[0]);
    const mins = s.bars.map((b) => etMinOf(b.ts));
    const barAt = (t: number) => { for (let i = 0; i < mins.length; i++) if (mins[i] >= t) return i; return -1; };
    const win = WINDOWS.find((w) => s.dateET >= w.from && s.dateET <= w.to);
    if (!win) continue;
    const xi = barAt(EXIT_ET); if (xi < 0) continue;
    const xb = s.bars[xi], sf = s.bars[s.bars.length - 1].close; // sf ≈ expiry settle

    for (const et of ENTRIES) {
      const ei = barAt(et); if (ei < 0 || ei >= xi) continue;
      const eb = s.bars[ei], K = Math.round(eb.close);
      const chE = chainAt(eb.close, CLOSE - mins[ei], eb.ts), chX = chainAt(xb.close, CLOSE - mins[xi], xb.ts);
      const ce = atQ(chE, K, "call"), pe = atQ(chE, K, "put"), cx = atQ(chX, K, "call"), px = atQ(chX, K, "put");
      if (!ce || !pe || !cx || !px || ce.mid <= 0 || pe.mid <= 0) continue;
      const bodyCredit = ce.bid + pe.bid;                                   // sell body @bid
      const naked = (bodyCredit - (cx.ask + px.ask)) * 100 - 4 * COMM;      // buy back @ask
      const fly: Day["fly"] = {};
      for (const W of WINGS) {
        const wce = atQ(chE, K + W, "call"), wpe = atQ(chE, K - W, "put");
        const wcx = atQ(chX, K + W, "call"), wpx = atQ(chX, K - W, "put");
        if (!wce || !wpe) { fly[W] = { bb: null, exp: null }; continue; }
        const open = bodyCredit - (wce.ask + wpe.ask);                      // sell body @bid, buy wings @ask
        const exp = (open - Math.min(Math.abs(sf - K), W)) * 100 - 4 * COMM; // settle: owe min(move,W)
        const bb = (wcx && wpx) ? (open + ((wcx.bid + wpx.bid) - (cx.ask + px.ask))) * 100 - 8 * COMM : null;
        fly[W] = { bb, exp };
      }
      acc.get(et)!.get(win.name)!.push({ edge: (ce.mid + pe.mid) - Math.abs(xb.close - K), naked, fly });
    }
  }

  console.log(`\n  THETA-HARVEST · ${real.length} real-NBBO sessions · short ATM 0DTE straddle/iron-fly · per-contract $`);
  console.log(`  nakedBB = short straddle (buy back 15:50, unbounded risk). flyW = iron fly ±$W: BB=buy-back · EXP=hold to expiry.\n`);
  const avg = (xs: number[]) => xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : NaN;
  const cell = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? `${usd(avg(v))}/${usd(Math.min(...v))}` : "—"; };

  for (const et of ENTRIES) {
    console.log(`  ══ entry ${Math.floor(et / 60)}:${String(et % 60).padStart(2, "0")} ET   (cells = avg/worst $/day) ══`);
    console.log("  " + "window".padEnd(15) + "n".padStart(4) + "edge$".padStart(7) + "nakedBB".padStart(11)
      + WINGS.flatMap((W) => [`fly${W}·BB`, `fly${W}·EXP`]).map((h) => h.padStart(13)).join(""));
    for (const w of WINDOWS) {
      const rows = acc.get(et)!.get(w.name)!; if (!rows.length) continue;
      const flyCells = WINGS.flatMap((W) => [cell(rows.map((r) => r.fly[W]?.bb ?? null)), cell(rows.map((r) => r.fly[W]?.exp ?? null))]);
      console.log("  " + w.name.padEnd(15) + String(rows.length).padStart(4) + avg(rows.map((r) => r.edge)).toFixed(2).padStart(7)
        + usd(avg(rows.map((r) => r.naked))).padStart(11) + flyCells.map((c) => c.padStart(13)).join(""));
    }
    console.log("");
  }
  console.log(`  The naked edge (edge$>0) is real across regimes. The tradeable question: does any defined-risk fly cell stay`);
  console.log(`  POSITIVE on avg while bounding worst? Wider wings (fly10) keep more credit; EXP skips the exit spread.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
