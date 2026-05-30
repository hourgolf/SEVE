// Resample 1-minute engine bars to a higher timeframe (clock-aligned, UTC).
// Pure; used by the timeframe sweep. Volume summed, VWAP volume-weighted.

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
