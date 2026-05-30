// Aggregate 1-minute underlying bars into a higher timeframe (5/15/30/60 min)
// on clock-aligned buckets. Pure — used by the intraday chart for both line and
// candle views. Bars are assumed oldest → newest.

import type { UnderlyingBar } from "@/lib/types";

export const TIMEFRAMES = [
  { label: "1m", minutes: 1 },
  { label: "5m", minutes: 5 },
  { label: "15m", minutes: 15 },
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
] as const;

export type TimeframeMinutes = (typeof TIMEFRAMES)[number]["minutes"];

interface NumBar {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number;
}

// Keep only bars with a usable close; coerce nullable numerics.
function clean(bars: UnderlyingBar[]): NumBar[] {
  return bars
    .filter((b) => b.close != null)
    .map((b) => {
      const close = Number(b.close);
      return {
        ts: b.ts,
        open: b.open != null ? Number(b.open) : close,
        high: b.high != null ? Number(b.high) : close,
        low: b.low != null ? Number(b.low) : close,
        close,
        volume: b.volume != null ? Number(b.volume) : 0,
        vwap: b.vwap != null ? Number(b.vwap) : close,
      };
    });
}

// Floor a timestamp (ms) to the start of its timeframe bucket, in UTC. Minute
// timeframes divide the hour evenly (5/15/30/60), so UTC flooring is also
// clock-aligned in any fixed-offset exchange timezone.
function bucketStart(ms: number, tfMin: number): number {
  const size = tfMin * 60_000;
  return Math.floor(ms / size) * size;
}

export function aggregateBars(
  bars: UnderlyingBar[],
  tfMin: number
): NumBar[] {
  const src = clean(bars);
  if (tfMin <= 1) return src;

  const out: NumBar[] = [];
  let bucketMs = -1;
  let volSum = 0;
  let vwapVolSum = 0;

  for (const b of src) {
    const ms = bucketStart(Date.parse(b.ts), tfMin);
    if (ms !== bucketMs) {
      // start a new bucket
      out.push({ ...b, ts: new Date(ms).toISOString() });
      bucketMs = ms;
      volSum = b.volume;
      vwapVolSum = b.vwap * b.volume;
    } else {
      const cur = out[out.length - 1];
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
      volSum += b.volume;
      vwapVolSum += b.vwap * b.volume;
      cur.vwap = volSum > 0 ? vwapVolSum / volSum : b.vwap;
    }
  }
  return out;
}
