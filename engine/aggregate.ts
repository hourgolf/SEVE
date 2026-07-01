// Resample 1-minute engine bars to a higher timeframe (clock-aligned, UTC).
// Pure; used by the timeframe sweep. Volume summed, VWAP volume-weighted.
//
// ⚠ LOOK-AHEAD (audit L6b): aggregate() stamps each bucket at its START ts — a
// 15m bar stamped 09:30 contains data through 09:44, so a probe that fills an
// option at bars[i].ts fills ~15 min BEFORE the decision information existed.
// Any probe that trades on aggregated bars must either remap timestamps itself
// (the cross-gap-probe pattern) or use aggregateCausal() below. aggregate() is
// kept as-is so the settled tf-sweep/regime probes stay reproducible; the live
// worker only runs tf=1 channels, so no live path is affected.

import type { Bar } from "./types";

export function aggregate(bars: Bar[], tfMin: number): Bar[] {
  if (tfMin <= 1) return bars;
  const size = tfMin * 60_000;
  const out: Bar[] = [];
  let bucket = -1;
  let volSum = 0;
  let pvSum = 0;
  for (const b of bars) {
    const ms = Math.floor(b.ts / size) * size;
    if (ms !== bucket) {
      out.push({ ...b, ts: ms });
      bucket = ms;
      volSum = b.volume;
      pvSum = b.vwap * b.volume;
    } else {
      const cur = out[out.length - 1];
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
      volSum += b.volume;
      pvSum += b.vwap * b.volume;
      cur.vwap = volSum > 0 ? pvSum / volSum : b.vwap;
    }
  }
  return out;
}

/** Causal resample: identical buckets, but each bucket is stamped at its LAST
 *  constituent 1-min bar's ts — the moment the bucket's information actually
 *  exists. Use this (not aggregate) in any NEW probe that fills options at the
 *  bar timestamp, so fills can't look ahead into the bucket. */
export function aggregateCausal(bars: Bar[], tfMin: number): Bar[] {
  if (tfMin <= 1) return bars;
  const size = tfMin * 60_000;
  const out = aggregate(bars, tfMin);
  // remap each bucket-start ts to the last source ts inside that bucket
  let j = 0;
  for (const o of out) {
    let last = o.ts;
    while (j < bars.length && Math.floor(bars[j].ts / size) * size <= o.ts) {
      if (Math.floor(bars[j].ts / size) * size === o.ts) last = bars[j].ts;
      j++;
    }
    o.ts = last;
  }
  return out;
}
