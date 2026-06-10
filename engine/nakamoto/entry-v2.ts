/**
 * Faithful TS port of Nakamoto's `entry_v2.py` (received verbatim) — the
 * REVERSAL + BREAKOUT confluence scorers and the main scanner.
 *
 * Differences from the Python, all deliberate:
 *  - The env-config window/ban/cutoff are explicit params. LOOP_FACTS (06-09
 *    addendum) confirms paperC runs WIN 07:00–12:30 PT, BAN 09:00–10:00 PT,
 *    REV_CUTOFF off — our defaults.
 *  - Single-bar shapes, volume_z, trend_structure come from the REAL
 *    momentum_patterns.py port (momentum-patterns.ts, addendum).
 *    `useSingleBarShapes:false` ablates the F1 single-bar half (N-bar
 *    curl/rollover still counts); `regimeGate:false` bypasses classify_regime.
 */
import { Bar } from "./data";
import {
  barsSinceSessionExtreme, curlUp, edgeAtLevel, maCrossState, macdState,
  nearestLevel, nearLevel, rangeBreakoutDirection, rangeCompression, rolloverDown,
} from "./detectors";
import { isEngulfing, isPinBar, isStrongTrendBar, trendStructure, volumeZ } from "./momentum-patterns";

// ---- exact config constants from entry_v2.py --------------------------------
export const LEVEL_PROXIMITY = 1.00;
export const EDGE_LEVEL_PROXIMITY = 1.00;
export const BREAKOUT_RANGE_BARS = 8;
export const BREAKOUT_RANGE_WIDTH_PCT = 0.005;
export const BREAKOUT_EDGE_MARGIN = 0.10;
export const REVERSAL_SHAPE_BARS = 7;
export const MIN_RTH_BARS_FOR_BREAKOUT = 8;
export const MIN_5M_BARS = 4;
export const HIGH_CONFLUENCE = 3;
export const MEDIUM_CONFLUENCE = 2;

export interface EntrySignal {
  direction: "up" | "down";
  right: "c" | "p";
  setup: "reversal" | "breakout";
  confidence: number;
  context: Record<string, unknown>;
}

export interface ScanConfig {
  winStartPt: number;       // minutes since midnight PT (default 07:00 = 10:00 ET)
  winEndPt: number;         // default 12:30 PT = 15:30 ET
  banStartPt: number | null; // default 09:00 PT = 12:00 ET
  banEndPt: number | null;   // default 10:00 PT = 13:00 ET
  revCutoffPt: number | null;
  useSingleBarShapes: boolean; // ablation: count pin/engulfing/strong-trend in F1
  regimeGate: boolean;         // apply classify_regime gate to MEDIUM reversals
}

export const DEFAULT_SCAN_CONFIG: ScanConfig = {
  winStartPt: 7 * 60, winEndPt: 12 * 60 + 30,
  banStartPt: 9 * 60, banEndPt: 10 * 60,
  revCutoffPt: null,
  useSingleBarShapes: true, regimeGate: true,
};

// ---- Regime ------------------------------------------------------------------

export function classifyRegime(bars5mRth: Bar[]): "trend_up" | "trend_down" | "chop" {
  if (bars5mRth.length < 6) return "chop";
  const s = trendStructure(bars5mRth, Math.min(12, bars5mRth.length));
  if (s === "up") return "trend_up";
  if (s === "down") return "trend_down";
  return "chop";
}

// ---- REVERSAL scorer -----------------------------------------------------------

function scoreReversal(
  bars5m: Bar[], bars5mRth: Bar[], spot: number, levels: number[],
  direction: "up" | "down", cfg: ScanConfig,
): EntrySignal | null {
  if (bars5m.length < MIN_5M_BARS) return null;

  const closes = bars5m.map(b => b.close);
  const macd = macdState(closes);
  const ma = maCrossState(closes);
  const ext = barsSinceSessionExtreme(bars5mRth);

  const features: string[] = [];
  const right = direction === "up" ? "c" : "p";

  // F1: SHAPE — N-bar curl/rollover OR single-bar pin/engulfing/strong-trend (one-hot)
  const nBarShape = direction === "up"
    ? curlUp(bars5m, REVERSAL_SHAPE_BARS)
    : rolloverDown(bars5m, REVERSAL_SHAPE_BARS);
  const lastBar = bars5m[bars5m.length - 1];
  const prevBar = bars5m[bars5m.length - 2];
  const singleBarShape = cfg.useSingleBarShapes && (
    isPinBar(lastBar, direction)
    || isEngulfing(prevBar, lastBar, direction)
    || isStrongTrendBar(lastBar, direction)
  );
  if (nBarShape || singleBarShape) features.push("shape");

  // F2: MACD aligned
  const macdAligned = direction === "up"
    ? macd.in_direction_long || macd.fresh_cross_up
    : macd.in_direction_short || macd.fresh_cross_down;
  if (macdAligned) features.push("macd");

  // F3: level proximity
  if (nearLevel(spot, levels, LEVEL_PROXIMITY)) features.push("level");

  // F4: stale opposite-extreme (needs ≥12 RTH bars to be informative)
  if (ext.rth_bars_total >= 12) {
    if (direction === "up" && ext.since_hod >= 6) features.push("stale_extreme");
    else if (direction === "down" && ext.since_lod >= 6) features.push("stale_extreme");
  }

  // (MA20/MA120 agreement intentionally NOT counted — per their 95-day blind.)

  const confidence = features.length;
  if (confidence < MEDIUM_CONFLUENCE) return null;

  const [L, dist] = nearestLevel(spot, levels);
  return {
    direction, right, setup: "reversal", confidence,
    context: {
      features, level: L, level_dist: dist,
      macd_sign: macd.sign, macd_bars_since_cross: macd.bars_since_cross,
      ma_direction: ma.direction, since_hod: ext.since_hod, since_lod: ext.since_lod,
    },
  };
}

// ---- BREAKOUT scorer -------------------------------------------------------------

function scoreBreakout(bars5m: Bar[], bars5mRth: Bar[], levels: number[], cfg: ScanConfig): EntrySignal | null {
  if (bars5mRth.length < MIN_RTH_BARS_FOR_BREAKOUT) return null;
  if (bars5mRth.length < BREAKOUT_RANGE_BARS + 1) return null;
  const breakBar = bars5mRth[bars5mRth.length - 1];
  const prior = bars5mRth.slice(0, -1);

  const rng = rangeCompression(prior, BREAKOUT_RANGE_BARS, BREAKOUT_RANGE_WIDTH_PCT);
  if (rng === null) return null;
  const direction = rangeBreakoutDirection(breakBar, rng, BREAKOUT_EDGE_MARGIN);
  if (direction === null) return null;

  const edgePrice = direction === "up" ? rng.high : rng.low;
  const L = edgeAtLevel(edgePrice, levels, EDGE_LEVEL_PROXIMITY);
  if (L === null) return null;

  const features = ["range", "decisive_break", "edge_at_level"];
  const right = direction === "up" ? "c" : "p";

  const closes = bars5m.map(b => b.close);
  const macd = macdState(closes);
  const macdAligned = direction === "up"
    ? macd.in_direction_long || macd.fresh_cross_up
    : macd.in_direction_short || macd.fresh_cross_down;
  if (macdAligned) features.push("macd");

  const ma = maCrossState(closes);
  if (ma.direction === direction) features.push("ma_cross");

  const vz = volumeZ(bars5mRth, 10);
  if (vz >= 0.5) features.push("volume");

  return {
    direction, right, setup: "breakout", confidence: features.length,
    context: {
      features, level: L, range_high: rng.high, range_low: rng.low,
      range_width_pct: rng.width_pct, macd_sign: macd.sign,
      ma_direction: ma.direction, volume_z: vz,
    },
  };
}

// ---- Main scanner -------------------------------------------------------------------

export function scanForEntry(
  bars5m: Bar[], bars5mRth: Bar[], spot: number,
  nowPtMin: number | null, levels: number[],
  cfg: ScanConfig = DEFAULT_SCAN_CONFIG,
): EntrySignal | null {
  if (nowPtMin === null) return null;
  if (!(cfg.winStartPt <= nowPtMin && nowPtMin < cfg.winEndPt)) return null;
  if (cfg.banStartPt !== null && cfg.banEndPt !== null
    && cfg.banStartPt <= nowPtMin && nowPtMin < cfg.banEndPt) return null;

  if (bars5m.length < MIN_5M_BARS) return null;

  const regime = classifyRegime(bars5mRth);

  const candidates: EntrySignal[] = [];
  const revUp = scoreReversal(bars5m, bars5mRth, spot, levels, "up", cfg);
  const revDn = scoreReversal(bars5m, bars5mRth, spot, levels, "down", cfg);
  const brk = scoreBreakout(bars5m, bars5mRth, levels, cfg);

  for (const c of [revUp, revDn, brk]) {
    if (c === null) continue;
    if (cfg.revCutoffPt !== null && c.setup === "reversal" && nowPtMin >= cfg.revCutoffPt) continue;
    if (c.confidence < HIGH_CONFLUENCE && cfg.regimeGate) {
      if (c.setup === "reversal") {
        if (c.direction === "up" && regime !== "trend_up") continue;
        if (c.direction === "down" && regime !== "trend_down") continue;
      }
    }
    candidates.push(c);
  }

  if (!candidates.length) return null;
  // Highest confidence wins; breakout tie-break (stable sort mirrors python)
  candidates.sort((a, b) =>
    (b.confidence - a.confidence)
    || ((b.setup === "breakout" ? 1 : 0) - (a.setup === "breakout" ? 1 : 0)));
  const best = candidates[0];
  best.context.regime = regime;
  return best;
}
