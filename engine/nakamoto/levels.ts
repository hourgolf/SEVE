/**
 * Level-discovery port for the Nakamoto reproduction.
 *
 * Two fidelity tiers:
 *  - discoverIntradayLevels: EXACT port of intraday_levels.py (received in full).
 *  - warmupLevels: mirrors pre_session.py's merge/dedupe/audit structure; its
 *    three helpers (find_swings_daily / cluster_levels / round_grid) are now
 *    EXACT ports of discover_2025_levels.py (06-09 addendum). For the four
 *    trade-log days, prefer the bot's own levels_<date>.json audits (dropped in
 *    data/handoff-verify/, auto-loaded via loadLevelsAudit) — they pin ground
 *    truth; the computed path is the fallback for any other day.
 */
import { readFileSync, existsSync } from "fs";
import { Bar, ptParts, hm } from "./data";

// ---- exact constants from pre_session.py ------------------------------------
export const STATED_LEVELS = [650.0, 670.0, 677.0, 683.0, 687.0, 690.0, 693.0, 696.0, 700.0];
const LOOKBACK_DAYS = 180;
const GRID_HALF_WIDTH = 25;
const GRID_STEP = 5.0;
const SWING_WINDOW = 2;
const SWING_MIN_PROMINENCE = 2.0;
const CLUSTER_WIDTH = 2.0;
const CLUSTER_MIN_TOUCHES = 3;
const DEDUPE_DISTANCE = 1.0;

// ---- EXACT port: discover_2025_levels.round_grid ------------------------------
// start = floor((lo−pad)/step)·step; stop = (floor((hi+pad)/step)+1)·step, inclusive.
export function roundGrid(lo: number, hi: number, step = GRID_STEP, pad = 0.0): number[] {
  const start = Math.floor((lo - pad) / step) * step;
  const stop = (Math.floor((hi + pad) / step) + 1) * step;
  const out: number[] = [];
  for (let k = start; k <= stop; k += step) out.push(k);
  return out;
}

// ---- EXACT port: discover_2025_levels.find_swings_daily ------------------------
// Prominence is vs the MIN of window highs (resp. MAX of window lows), not the
// min-of-maxima the intraday detector uses — same author, different formula.
export function findSwingsDaily(daily: Bar[], window = SWING_WINDOW, minProminence = SWING_MIN_PROMINENCE): number[] {
  if (daily.length < 2 * window + 1) return [];
  const H = daily.map(b => b.high);
  const L = daily.map(b => b.low);
  const out: number[] = [];
  for (let i = window; i < daily.length - window; i++) {
    const HL = H.slice(i - window, i), HR = H.slice(i + 1, i + 1 + window);
    if (H[i] > Math.max(...HL) && H[i] > Math.max(...HR)) {
      const nearbyMin = Math.min(Math.min(...HL), Math.min(...HR));
      if (H[i] - nearbyMin >= minProminence) out.push(H[i]);
    }
    const LL = L.slice(i - window, i), LR = L.slice(i + 1, i + 1 + window);
    if (L[i] < Math.min(...LL) && L[i] < Math.min(...LR)) {
      const nearbyMax = Math.max(Math.max(...LL), Math.max(...LR));
      if (nearbyMax - L[i] >= minProminence) out.push(L[i]);
    }
  }
  return out;
}

// ---- EXACT port: discover_2025_levels.cluster_levels ----------------------------
// Chain by gap ≤ width from the cluster's last member; median ROUNDED TO $0.1.
export function clusterLevels(prices: number[], clusterWidth = CLUSTER_WIDTH, minTouches = CLUSTER_MIN_TOUCHES): Array<[number, number]> {
  if (!prices.length) return [];
  const sorted = [...prices].sort((a, b) => a - b);
  const clusters: number[][] = [[sorted[0]]];
  for (const s of sorted.slice(1)) {
    const last = clusters[clusters.length - 1];
    if (s - last[last.length - 1] <= clusterWidth) last.push(s);
    else clusters.push([s]);
  }
  const median = (xs: number[]) => {
    const m = Math.floor(xs.length / 2);
    return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
  };
  const out: Array<[number, number]> = [];
  for (const c of clusters) {
    if (c.length >= minTouches) out.push([+median(c).toFixed(1), c.length]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

// ---- EXACT port: intraday_levels.py ------------------------------------------
const IL_LOOKBACK_DAYS = 5;
const IL_PIVOT_WINDOW = 3;
const IL_MIN_PROMINENCE = 0.40;
const IL_CLUSTER_WIDTH = 0.40;
const IL_MIN_TOUCHES = 2;
const RTH_END_PT = hm("13:00");
const RTH_START_PT = hm("06:30");

function detectPivots(bars5m: Bar[], window = IL_PIVOT_WINDOW, minProminence = IL_MIN_PROMINENCE): number[] {
  if (bars5m.length < 2 * window + 1) return [];
  const H = bars5m.map(b => b.high);
  const L = bars5m.map(b => b.low);
  const out: number[] = [];
  for (let i = window; i < bars5m.length - window; i++) {
    const lmax = Math.max(...H.slice(i - window, i));
    const rmax = Math.max(...H.slice(i + 1, i + 1 + window));
    if (H[i] > lmax && H[i] > rmax && H[i] - Math.min(lmax, rmax) >= minProminence) out.push(H[i]);
    const lmin = Math.min(...L.slice(i - window, i));
    const rmin = Math.min(...L.slice(i + 1, i + 1 + window));
    if (L[i] < lmin && L[i] < rmin && Math.max(lmin, rmin) - L[i] >= minProminence) out.push(L[i]);
  }
  return out;
}

function clusterPivots(pivots: number[], clusterWidth = IL_CLUSTER_WIDTH, minTouches = IL_MIN_TOUCHES): number[] {
  if (!pivots.length) return [];
  const sorted = [...pivots].sort((a, b) => a - b);
  const clusters: number[] = [];
  let cur: number[] = [];
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  for (const p of sorted) {
    if (cur.length && p - cur[cur.length - 1] > clusterWidth) {
      if (cur.length >= minTouches) clusters.push(+median(cur).toFixed(2));
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length >= minTouches) clusters.push(+median(cur).toFixed(2));
  return clusters;
}

/** Strictly-causal intraday-pivot levels: last `lookback` distinct trading days
 * of RTH 5m bars ending the day BEFORE tradeDay. Exact port. */
export function discoverIntradayLevels(bars5mAll: Bar[], tradeDay: string, lookbackDays = IL_LOOKBACK_DAYS): number[] {
  const rth = bars5mAll.filter(b => {
    const p = ptParts(b.ts);
    return p.date < tradeDay && p.hm >= RTH_START_PT && p.hm < RTH_END_PT;
  });
  const days = [...new Set(rth.map(b => ptParts(b.ts).date))].sort();
  const keep = new Set(days.slice(-lookbackDays));
  const sliced = rth.filter(b => keep.has(ptParts(b.ts).date));
  if (!sliced.length) return [];
  return clusterPivots(detectPivots(sliced));
}

// ---- pre_session.warmup mirror -------------------------------------------------

function dedupe(levels: number[]): number[] {
  const out: number[] = [];
  for (const L of [...levels].sort((a, b) => a - b)) {
    if (!out.length || L - out[out.length - 1] > DEDUPE_DISTANCE) out.push(L);
  }
  return out;
}

export interface LevelSet {
  levels: number[];
  anchor: number;
  source: "computed" | "audit-json";
  parts: { stated: number[]; grid: number[]; swingClusters: Array<[number, number]>; intraday: number[] };
}

/** Mirror of pre_session.warmup(trade_day): 180-cal-day daily lookback ending
 * the day before tradeDay; anchor = last daily close; merge stated ∪ grid ∪
 * swing-clusters, then + intraday pivots, dedupe $1 ascending. */
export function warmupLevels(dailyAll: Bar[], bars5mAll: Bar[], tradeDay: string): LevelSet {
  const dayMs = Date.parse(`${tradeDay}T00:00:00Z`);
  const startMs = dayMs - LOOKBACK_DAYS * 86400_000;
  const daily = dailyAll.filter(b => b.ts >= startMs && ptParts(b.ts).date < tradeDay);
  if (daily.length < 30) throw new Error(`warmup ${tradeDay}: only ${daily.length} daily bars`);
  const anchor = daily[daily.length - 1].close;

  const swings = findSwingsDaily(daily);
  const multi = clusterLevels(swings);
  const grid = roundGrid(anchor - GRID_HALF_WIDTH, anchor + GRID_HALF_WIDTH);

  const merged = new Set<number>();
  for (const L of STATED_LEVELS) merged.add(L);
  for (const L of grid) merged.add(L);
  for (const [price] of multi) merged.add(price);

  const intraday = discoverIntradayLevels(bars5mAll, tradeDay);
  // pre_session: merged_with_intraday = list(merged) + intraday_levels, then dedupe
  const deduped = dedupe([...merged, ...intraday]);

  return { levels: deduped, anchor, source: "computed", parts: { stated: STATED_LEVELS, grid, swingClusters: multi, intraday } };
}

/** When ask #3 lands: load the bot's own levels_<date>.json audit (exact truth). */
export function loadLevelsAudit(path: string): number[] | null {
  if (!existsSync(path)) return null;
  const j = JSON.parse(readFileSync(path, "utf8"));
  return Array.isArray(j.merged_levels) ? j.merged_levels.map(Number) : null;
}
