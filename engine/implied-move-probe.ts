// ============================================================================
//  implied-move-probe — can a realized-vs-implied morning gate beat the 10:30
//  drift+persist gate at detecting chop, and is the chop-fly door even open?
//  (2026-06-13, the ultracode slate's #1 probe.)
//
//  Two questions, in order:
//   (0) DOOR-CHECK FIRST — the chop-fly's binding constraint may be the EXIT, not
//       detection: realized-chop (legs≥5, the ORACLE = a perfect classifier's
//       ceiling) fly·REAL is only ~+$20/day. Before any classifier search, test
//       whether a structural change LIFTS that ceiling: wider ±$10 wings (theta-
//       probe's "cheaper insurance" lever) and the EXP optimistic bound. If the
//       ceiling can't move, NO classifier matters → the thread is door-blocked.
//   (1) CLASSIFIER — the open ATM straddle IS the priced expected move. Does
//       realized(9:30→10:30) / implied(open straddle) separate chop better than the
//       drift+persist gate (which catches only ~36% of realized-chop days)?
//
//  Kill-lanes (the desk's fingerprints that bury ~90% of composes):
//   · ex-CHOP-MIX  — does any predicted-chop edge survive WITHOUT the one window
//     (CHOP-MIX 25-26) that carried gap_min / cross-gap?
//   · confound     — does the implied gate catch DIFFERENT realized-chop days than
//     drift, or the SAME ones (then it's a vol-level tautology, no new signal)?
//
//  Fly P&L mechanic is cloned verbatim from chop-premium-probe.ts (13:00 entry,
//  sell body @bid / buy wings @ask, close ATM body @15:50 ask, OTM wings settle).
//  The implied feature is read at the OPEN (~9:35) + realized by 10:30 → both known
//  before the 13:00 fly entry (no look-ahead). Per-contract $, real Databento NBBO.
//
//    npm run implied-move-probe
// ============================================================================

import { loadRealSessions } from "./realsource";
import { loadDatabentoByDay, makeDatabentoChain } from "./databentosource";
import type { Quote } from "./types";

const etMinOf = (ms: number): number => {
  const et = new Date(new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York" }));
  return et.getHours() * 60 + et.getMinutes();
};
const CLOSE = 16 * 60, EXIT_ET = 15 * 60 + 50, ENTRY = 13 * 60; // fly: 13:00 entry / 15:50 exit
const STRADDLE_ET = 9 * 60 + 35, MORN_END = 10 * 60 + 30;       // implied read 9:35 / realized by 10:30
const WING = 5, WIDE = 10, COMM = 0.04;
const WINDOWS = [
  { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];
const CHOPMIX = "CHOP-MIX 25-26";
const atQ = (ch: Quote[], k: number, t: "call" | "put") => ch.find((q) => q.optType === t && Math.round(q.strike) === k);
const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
function pctRank(values: number[], v: number): number { let b = 0; for (const x of values) if (x < v) b++; return b / Math.max(1, values.length); }

interface Row {
  date: string; window: string;
  real5: number | null; real10: number | null; exp5: number | null;  // fly P&L variants
  drift: number; persist: number;                                     // existing gate features
  imRatio: number | null;                                             // realized/implied (new feature)
  legs: number; enteredFly: boolean; hasIm: boolean;
}

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET)) as unknown as Map<string, unknown[]>;
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0 && s.bars.length >= 90);

  const rows: Row[] = [];
  for (const s of real) {
    const win = WINDOWS.find((w) => s.dateET >= w.from && s.dateET <= w.to);
    if (!win) continue;
    const chainAt = makeDatabentoChain(byDay.get(s.dateET)! as Parameters<typeof makeDatabentoChain>[0]);
    const mins = s.bars.map((b) => etMinOf(b.ts));
    const barAt = (t: number) => { for (let i = 0; i < mins.length; i++) if (mins[i] >= t) return i; return -1; };

    // ---- morning gate features (knowable by 10:30) ----
    const firstHr = s.bars.slice(0, 60);
    const drift = Math.abs(firstHr[firstHr.length - 1].close - firstHr[0].open) / firstHr[0].open;
    const above = firstHr.filter((b) => b.close > b.vwap).length / firstHr.length;
    const persist = Math.max(above, 1 - above);

    // ---- NEW: implied move from the open ATM straddle vs realized first-hour ----
    let imRatio: number | null = null, hasIm = false;
    const si = barAt(STRADDLE_ET), mi = barAt(MORN_END);
    if (si >= 0 && mi > si) {
      const sb = s.bars[si], K = Math.round(sb.close);
      const ch = chainAt(sb.close, CLOSE - mins[si], sb.ts);
      const ce = atQ(ch, K, "call"), pe = atQ(ch, K, "put");
      if (ce && pe && ce.mid > 0 && pe.mid > 0) {
        const impliedPct = (ce.mid + pe.mid) / sb.close;                       // priced expected move
        const realizedPct = Math.abs(s.bars[mi].close - s.bars[0].open) / s.bars[0].open; // realized 9:30→10:30
        if (impliedPct > 0) { imRatio = realizedPct / impliedPct; hasIm = true; }
      }
    }

    // ---- realized whipsaw legs (ORACLE) ----
    let legs = 0, anchor = s.bars[0].close, dir = 0;
    for (const b of s.bars) {
      const mv = (b.close - anchor) / anchor;
      if (Math.abs(mv) >= 0.003) { const d = Math.sign(mv); if (d !== dir && dir !== 0) legs++; if (d !== dir) dir = d; anchor = b.close; }
    }

    // ---- iron fly P&L (chop-premium mechanic; ±$5 and ±$10 wings; EXP bound) ----
    const ei = barAt(ENTRY), xi = barAt(EXIT_ET);
    let real5: number | null = null, real10: number | null = null, exp5: number | null = null, enteredFly = false;
    if (ei >= 0 && xi > ei) {
      const eb = s.bars[ei], xb = s.bars[xi], sf = s.bars[s.bars.length - 1].close, K = Math.round(eb.close);
      const chE = chainAt(eb.close, CLOSE - mins[ei], eb.ts), chX = chainAt(xb.close, CLOSE - mins[xi], xb.ts);
      const ce = atQ(chE, K, "call"), pe = atQ(chE, K, "put"), cx = atQ(chX, K, "call"), px = atQ(chX, K, "put");
      if (ce && pe && cx && px && ce.mid > 0 && pe.mid > 0) {
        const bodyBid = ce.bid + pe.bid, bodyAskX = cx.ask + px.ask;
        // ±$5 wings
        const wce = atQ(chE, K + WING, "call"), wpe = atQ(chE, K - WING, "put");
        if (wce && wpe) {
          enteredFly = true;
          const open5 = bodyBid - (wce.ask + wpe.ask);
          const wingExp5 = Math.max(0, Math.abs(sf - K) - WING);
          exp5 = (open5 - Math.min(Math.abs(sf - K), WING)) * 100 - 4 * COMM;
          real5 = (open5 - bodyAskX + wingExp5) * 100 - 6 * COMM;
        }
        // ±$10 wings (door-check: cheaper insurance, more credit kept, bigger capped tail)
        const wce2 = atQ(chE, K + WIDE, "call"), wpe2 = atQ(chE, K - WIDE, "put");
        if (wce2 && wpe2) {
          const open10 = bodyBid - (wce2.ask + wpe2.ask);
          const wingExp10 = Math.max(0, Math.abs(sf - K) - WIDE);
          real10 = (open10 - bodyAskX + wingExp10) * 100 - 6 * COMM;
        }
      }
    }
    rows.push({ date: s.dateET, window: win.name, real5, real10, exp5, drift, persist, imRatio, legs, enteredFly, hasIm });
  }

  // ---- scoring sets ----
  const ent = rows.filter((r) => r.enteredFly && r.real5 != null);
  const drifts = ent.map((r) => r.drift), persists = ent.map((r) => r.persist);
  const driftScore = (r: Row) => (pctRank(drifts, r.drift) + pctRank(persists, r.persist)) / 2; // existing gate
  const imEnt = ent.filter((r) => r.hasIm && r.imRatio != null);
  const ratios = imEnt.map((r) => r.imRatio!);
  const imScore = (r: Row) => pctRank(ratios, r.imRatio!); // LOW ratio = quiet vs priced = chop-leaning

  const stat = (set: Row[], pick: (r: Row) => number | null) => {
    const v = set.map(pick).filter((x): x is number => x != null);
    if (!v.length) return { n: 0, avg: NaN, tot: NaN, win: NaN, worst: NaN };
    const tot = v.reduce((a, x) => a + x, 0);
    return { n: v.length, avg: tot / v.length, tot, win: (100 * v.filter((x) => x > 0).length) / v.length, worst: Math.min(...v) };
  };
  const line = (label: string, set: Row[], pick: (r: Row) => number | null) => {
    const x = stat(set, pick);
    return x.n
      ? `  ${label.padEnd(34)} ${String(x.n).padStart(4)}d  ${usd(x.avg).padStart(7)}/day  worst ${usd(x.worst).padStart(7)}  ${x.win.toFixed(0).padStart(3)}% win  Σ ${usd(x.tot).padStart(8)}`
      : `  ${label.padEnd(34)} —`;
  };

  console.log(`\n  IMPLIED-MOVE probe · ${ent.length} fly sessions (${imEnt.length} with an open-straddle implied read) · real-NBBO · per-contract $`);
  console.log(`  fly·REAL = close ATM body @15:50 ask + OTM wings settle (honest) · fly·EXP = all settle (optimistic ceiling)\n`);

  // ============ (0) DOOR-CHECK — is the realized-chop (oracle) ceiling liftable? ============
  const realChop = ent.filter((r) => r.legs >= 5);
  const realTrend = ent.filter((r) => r.legs <= 2);
  console.log(`  ══ (0) DOOR-CHECK — realized-chop ≥5 legs (ORACLE = perfect-classifier ceiling), n=${realChop.length} ══`);
  console.log(line("  fly·REAL ±$5 (current honest)", realChop, (r) => r.real5));
  console.log(line("  fly·REAL ±$10 (wider wings)", realChop, (r) => r.real10));
  console.log(line("  fly·EXP ±$5 (settle, optimistic)", realChop, (r) => r.exp5));
  console.log(line("  [ref] realized-TREND ≤2 legs ±$5", realTrend, (r) => r.real5));
  console.log(`  per-window realized-chop fly·REAL ±$5:`);
  for (const w of WINDOWS) { const x = stat(realChop.filter((r) => r.window === w.name), (r) => r.real5); if (x.n) console.log(`    ${w.name.padEnd(16)} ${String(x.n).padStart(3)}d  ${usd(x.avg).padStart(7)}/day  Σ ${usd(x.tot).padStart(8)}`); }
  console.log(`  DOOR read: if even fly·REAL±5/±10 ≤ ~+$20/day, the exit/wing structure caps the credit even on KNOWN`);
  console.log(`  chop days → door-blocked, no classifier matters. If ±$10 or EXP lifts it materially → a door to chase.\n`);

  // ============ (1) CLASSIFIER — implied-move gate vs drift+persist gate ============
  console.log(`  ══ (1) CLASSIFIER — predicted-chop fly·REAL±5 + realized-chop RECALL ══`);
  const report = (label: string, set: Row[], gate: (r: Row) => boolean) => {
    const predChop = set.filter(gate);
    const x = stat(predChop, (r) => r.real5);
    const oracle = set.filter((r) => r.legs >= 5);
    const caught = oracle.filter(gate).length;
    const recall = oracle.length ? Math.round((100 * caught) / oracle.length) : 0;
    console.log(`  ${label.padEnd(34)} predChop ${String(x.n).padStart(3)}d  ${usd(x.avg).padStart(7)}/day  Σ ${usd(x.tot).padStart(8)}  ${Number.isFinite(x.win) ? x.win.toFixed(0).padStart(3) : "  —"}% win  · recall ${recall}% (${caught}/${oracle.length})`);
  };
  console.log(`  — POOLED (all windows) —`);
  report("drift+persist gate <0.5", imEnt, (r) => driftScore(r) < 0.5);
  report("implied-move gate <0.5 (quiet/priced)", imEnt, (r) => imScore(r) < 0.5);
  console.log(`  — ex-CHOP-MIX (kill-lane a) —`);
  const exMix = imEnt.filter((r) => r.window !== CHOPMIX);
  report("drift+persist gate <0.5", exMix, (r) => driftScore(r) < 0.5);
  report("implied-move gate <0.5", exMix, (r) => imScore(r) < 0.5);
  console.log("");

  // ============ confound kill-lane (b) — do the two gates catch the SAME chop days? ============
  const oracle = imEnt.filter((r) => r.legs >= 5);
  const byDrift = new Set(oracle.filter((r) => driftScore(r) < 0.5).map((r) => r.date));
  const byIm = new Set(oracle.filter((r) => imScore(r) < 0.5).map((r) => r.date));
  const both = [...byIm].filter((d) => byDrift.has(d)).length;
  const imOnly = [...byIm].filter((d) => !byDrift.has(d)).length;
  const driftOnly = [...byDrift].filter((d) => !byIm.has(d)).length;
  console.log(`  ══ (b) CONFOUND — of ${oracle.length} realized-chop days, which gate catches which? ══`);
  console.log(`  both gates ${both}  ·  implied-ONLY ${imOnly}  ·  drift-ONLY ${driftOnly}  ·  neither ${oracle.length - both - imOnly - driftOnly}`);
  console.log(`  implied-ONLY days (new signal drift misses): ${oracle.filter((r) => byIm.has(r.date) && !byDrift.has(r.date)).map((r) => r.date).join(", ") || "none"}`);
  console.log(`  CONFOUND read: implied-ONLY ≈ 0 → the implied gate is a drift restatement (vol-level tautology, no new`);
  console.log(`  signal). implied-ONLY days that are also fly·REAL-positive → the normalization adds real recall.\n`);

  console.log(`  VERDICT: PASS = implied recall > drift's AND ex-CHOP-MIX predChop fly·REAL > +$5/day in ≥2 windows AND`);
  console.log(`  implied-ONLY days are real (not a drift echo). Else = detection is the hard wall → stand-down-sizing only.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
