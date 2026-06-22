/**
 * discover_levels_v2 — data-driven SPY level discovery, ported from David's
 * prototype (`ground_truth_code/discover_levels_v2.py`, 2026-06-22 handoff).
 *
 * Finds levels where ranges ACTUALLY happen — recency-weighted VOLUME-AT-PRICE
 * (acceptance zones) + 5m SWING-PIVOT clusters (reversal zones) — instead of the
 * round-$5 grid that `warmupLevels` (levels.ts) blankets the tape with. The grid
 * is why the Phase-2 level gate is weak: $1 proximity to a $5 grid ⇒ ~40% of the
 * tape reads "at a level" (no selectivity). This finder is the +EV hypothesis:
 * better levels → does the level-gated strategy flip off the −$10.4k baseline?
 *
 * FAITHFUL port. The python self-check (its __main__) discovers 06-09's real
 * traded levels (~747/733/722) using ONLY data strictly BEFORE 06-09 — run this
 * file directly to reproduce that:  tsx engine/nakamoto/discover-levels.ts 2026-06-09
 *
 * Source-agnostic: takes a Bar[] so the Phase-B head-to-head feeds it the SAME
 * IEX 1m bars the −$10.4k baseline uses (apples-to-apples), and a live channel
 * could later feed it Databento/Alpaca bars. No prep_cache / oos_validation deps.
 */
import { readdirSync } from "fs";
import { Bar, ptParts, hm, loadCsvBars } from "./data";

// ---- exact constants from discover_levels_v2.py -----------------------------
export interface DiscoverConfig {
  lookbackTd: number;   // trading days of intraday history (30)
  bin: number;          // volume-profile price bin $ (0.25)
  halflife: number;     // recency half-life, days (12.0)
  swingWin: number;     // 5m bars each side for a swing pivot (8)
  cluster: number;      // merge levels within $ (1.0)
  topN: number;         // keep best-N near anchor (16)
  nearAnchor: number;   // keep levels within $ of anchor (30)
  rthStartPt: number;   // 06:30 PT
  rthEndPt: number;     // 13:00 PT (python filter is inclusive: <= 13:00)
}

export const DEFAULT_DISCOVER: DiscoverConfig = {
  lookbackTd: 30,
  bin: 0.25,
  halflife: 12.0,
  swingWin: 8,
  cluster: 1.0,
  topN: 16,
  nearAnchor: 30,
  rthStartPt: hm("06:30"),
  rthEndPt: hm("13:00"),
};

export interface ScoredLevel { price: number; score: number; n: number; source?: "vol" | "swing" | "merged" }
export interface DiscoverResult {
  levels: number[];           // the discovered level prices, sorted ascending
  scored: ScoredLevel[];      // levels with their merged scores (price-sorted)
  anchor: number | null;      // last RTH close strictly before targetDay
  nDays: number;              // distinct trading days used
}

const DAY_MS = 86_400_000;

// numpy.percentile(method="linear") — rank = p/100·(n−1), interpolate. ------------
function percentileLinear(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const frac = rank - lo;
  if (lo + 1 >= sorted.length) return sorted[sorted.length - 1];
  return sorted[lo] + frac * (sorted[lo + 1] - sorted[lo]);
}

// ---- _volume_profile: recency-weighted volume-at-price ----------------------
// w = exp(−age/halflife); weight = volume·w; histogram of CLOSE into $bin bins.
function volumeProfile(closes: number[], weights: number[], bin: number): { centers: number[]; hist: number[] } {
  if (!closes.length) return { centers: [], hist: [] };
  let mn = Infinity, mx = -Infinity;
  for (const c of closes) { if (c < mn) mn = c; if (c > mx) mx = c; }
  const lo = Math.floor(mn), hi = Math.ceil(mx);
  // np.arange(lo, hi+bin, bin) → edges lo..hi (last edge < hi+bin). nbins = len(edges)-1.
  const nEdges = Math.floor((hi + bin - lo) / bin - 1e-9) + 1; // values strictly < hi+bin
  const nbins = Math.max(0, nEdges - 1);
  if (nbins <= 0) return { centers: [], hist: [] };
  const hist = new Array(nbins).fill(0);
  for (let k = 0; k < closes.length; k++) {
    let idx = Math.floor((closes[k] - lo) / bin);
    if (idx === nbins) idx = nbins - 1; // px == hi falls in the right-closed last bin
    if (idx >= 0 && idx < nbins) hist[idx] += weights[k];
  }
  const centers = new Array(nbins);
  for (let i = 0; i < nbins; i++) centers[i] = lo + (i + 0.5) * bin;
  return { centers, hist };
}

// ---- _peaks: HVN nodes = local maxima above the 70th pct of nonzero volume ----
function peaks(centers: number[], hist: number[]): Array<[number, number]> {
  const nz = hist.filter(v => v > 0).sort((a, b) => a - b);
  const thr = nz.length ? percentileLinear(nz, 70) : 0;
  const out: Array<[number, number]> = [];
  for (let i = 2; i < hist.length - 2; i++) {
    let wmax = -Infinity;
    for (let j = i - 2; j <= i + 2; j++) if (hist[j] > wmax) wmax = hist[j];
    if (hist[i] >= thr && hist[i] === wmax && hist[i] > 0) out.push([centers[i], hist[i]]);
  }
  return out;
}

// ---- _swing_clusters: cluster 5m swing highs/lows into reversal levels --------
// Faithful to the python: resample('5min')['close'].agg(['max','min']) — i.e. the
// max/min of CLOSE within each 5m bin (not the bar high/low), then swing-detect.
function swingClusters(bars: Bar[], swingWin: number, cluster: number): Array<[number, number]> {
  if (!bars.length) return [];
  const sorted = [...bars].sort((a, b) => a.ts - b.ts);
  // 5m buckets of close max/min
  const buckets = new Map<number, { mx: number; mn: number }>();
  for (const b of sorted) {
    const k = Math.floor(b.ts / 300_000) * 300_000;
    const cur = buckets.get(k);
    if (!cur) buckets.set(k, { mx: b.close, mn: b.close });
    else { if (b.close > cur.mx) cur.mx = b.close; if (b.close < cur.mn) cur.mn = b.close; }
  }
  const keys = [...buckets.keys()].sort((a, b) => a - b);
  const highs = keys.map(k => buckets.get(k)!.mx);
  const lows = keys.map(k => buckets.get(k)!.mn);
  const sw: number[] = [];
  for (let i = swingWin; i < keys.length - swingWin; i++) {
    let hmax = -Infinity, lmin = Infinity;
    for (let j = i - swingWin; j <= i + swingWin; j++) { if (highs[j] > hmax) hmax = highs[j]; if (lows[j] < lmin) lmin = lows[j]; }
    if (highs[i] === hmax) sw.push(highs[i]);
    if (lows[i] === lmin) sw.push(lows[i]);
  }
  sw.sort((a, b) => a - b);
  const clusters: Array<[number, number]> = [];
  let cur: number[] = [];
  for (const p of sw) {
    if (cur.length && p - cur[cur.length - 1] > cluster) {
      clusters.push([cur.reduce((a, b) => a + b, 0) / cur.length, cur.length]);
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length) clusters.push([cur.reduce((a, b) => a + b, 0) / cur.length, cur.length]);
  return clusters;
}

/**
 * Strictly-causal: discover levels for `targetDay` from RTH 1m bars in the
 * `lookbackTd` trading days STRICTLY BEFORE it (bounded to lookbackTd·3 calendar
 * days back, like the python). `bars1mAll` may span any range; only the eligible
 * window is used. Source-agnostic (IEX for the baseline head-to-head; live bars later).
 */
export function discoverLevelsV2(bars1mAll: Bar[], targetDay: string, cfg: DiscoverConfig = DEFAULT_DISCOVER): DiscoverResult {
  const targetMs = Date.parse(`${targetDay}T00:00:00Z`);
  const floorMs = targetMs - cfg.lookbackTd * 3 * DAY_MS; // d > target − lookback·3 days
  // RTH bars strictly before target, within the calendar bound, grouped by PT date.
  const byDate = new Map<string, Bar[]>();
  for (const b of bars1mAll) {
    const p = ptParts(b.ts);
    if (p.date >= targetDay) continue;
    if (p.hm < cfg.rthStartPt || p.hm > cfg.rthEndPt) continue;
    const dMs = Date.parse(`${p.date}T00:00:00Z`);
    if (dMs <= floorMs) continue;
    (byDate.get(p.date) ?? byDate.set(p.date, []).get(p.date)!).push(b);
  }
  // Most-recent lookbackTd distinct trading days.
  const dates = [...byDate.keys()].sort().reverse().slice(0, cfg.lookbackTd);
  if (!dates.length) return { levels: [], scored: [], anchor: null, nDays: 0 };

  const closes: number[] = [];
  const weights: number[] = [];
  const all: Bar[] = [];
  for (const d of dates) {
    const dMs = Date.parse(`${d}T00:00:00Z`);
    const age = Math.round((targetMs - dMs) / DAY_MS); // calendar days, like (target−d).days
    const w = Math.exp(-age / cfg.halflife);
    for (const b of byDate.get(d)!) {
      closes.push(b.close);
      weights.push(b.volume * w);
      all.push(b);
    }
  }
  // anchor = last RTH close before target (max ts).
  let anchor: number | null = null, anchorTs = -Infinity;
  for (const b of all) if (b.ts > anchorTs) { anchorTs = b.ts; anchor = b.close; }

  const { centers, hist } = volumeProfile(closes, weights, cfg.bin);
  const hvn = peaks(centers, hist);                 // [price, vol]
  const swings = swingClusters(all, cfg.swingWin, cfg.cluster); // [price, touches]

  // score: volume nodes by normalized vol, swing clusters by touches (0.6 each).
  const cand: Array<[number, number, "vol" | "swing"]> = [];
  const vmax = hvn.reduce((m, [, v]) => Math.max(m, v), 1);
  for (const [p, v] of hvn) cand.push([p, 0.6 * v / vmax, "vol"]);
  const tmax = swings.reduce((m, [, t]) => Math.max(m, t), 1);
  for (const [p, t] of swings) cand.push([p, 0.6 * t / tmax, "swing"]);
  // python cand.sort() — tuple order: price, then score, then source string.
  cand.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]));

  // merge within CLUSTER, summing score (a level confirmed by BOTH ranks high).
  const merged: Array<[number, number, number]> = []; // [price, score, n]
  for (const [p, s] of cand) {
    const last = merged[merged.length - 1];
    if (last && p - last[0] <= cfg.cluster) {
      const [mp, ms, n] = last;
      merged[merged.length - 1] = [(mp * n + p) / (n + 1), ms + s, n + 1];
    } else {
      merged.push([p, s, 1]);
    }
  }
  const ranked = [...merged].sort((a, b) => b[1] - a[1]);
  const near = ranked
    .filter(m => anchor != null && Math.abs(m[0] - anchor) <= cfg.nearAnchor)
    .slice(0, cfg.topN)
    .sort((a, b) => a[0] - b[0]);

  return {
    levels: near.map(m => m[0]),
    scored: near.map(m => ({ price: m[0], score: m[1], n: m[2], source: "merged" as const })),
    anchor,
    nDays: dates.length,
  };
}

// ---- runnable self-check (mirrors discover_levels_v2.py __main__) -------------
if (process.argv[1] && /discover-levels(\.ts)?$/.test(process.argv[1])) {
  const IEX = "data/handoff-verify/iex";
  const target = process.argv[2] || "2026-06-09";
  const targetMs = Date.parse(`${target}T00:00:00Z`);
  const lookCal = DEFAULT_DISCOVER.lookbackTd * 3;
  const files = readdirSync(IEX)
    .filter(f => /^spy_1m_\d{4}-\d{2}-\d{2}\.csv$/.test(f))
    .map(f => f.slice(7, 17))
    .filter(d => d < target && Date.parse(`${d}T00:00:00Z`) > targetMs - lookCal * DAY_MS)
    .sort();
  const bars: Bar[] = [];
  for (const d of files) bars.push(...loadCsvBars(`${IEX}/spy_1m_${d}.csv`));
  const res = discoverLevelsV2(bars, target);

  const yours: Record<number, string> = { 746.9: "TOP reversal", 733.0: "blow-through", 722.59: "BOTTOM reversal" };
  console.log(`\nData-driven levels for ${target} (using data BEFORE it). anchor=${res.anchor?.toFixed(2)} · ${res.nDays} days · ${bars.length} bars\n`);
  console.log(`${"level".padStart(8)} ${"score".padStart(6)} ${"n".padStart(4)}   vs David's traded levels`);
  for (const s of res.scored) {
    let hit = "";
    for (const [yl, lbl] of Object.entries(yours)) if (Math.abs(s.price - +yl) <= 1.5) hit = `  <-- ~${yl} (${lbl})`;
    console.log(`${s.price.toFixed(2).padStart(8)} ${s.score.toFixed(2).padStart(6)} ${String(s.n).padStart(4)}${hit}`);
  }
}
