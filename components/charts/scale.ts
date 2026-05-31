// Shared geometry for the intraday SVG charts, so an HTML overlay (crosshair,
// price axis, LED) can line up exactly with the candles/line drawn inside the
// SVG. Mirrors the math in CandleChart / LineChart, whose viewBox is
// `0 0 VIEW_W H`, stretched to the wrap via preserveAspectRatio="none" — so a
// viewBox coordinate maps to a wrap fraction by dividing by VIEW_W / H.

export const VIEW_W = 600;
export const PAD = 6;

export interface ChartScale {
  N: number;
  min: number;
  max: number;
  H: number;
  /** center x (viewBox units) for bar index i */
  cx: (i: number) => number;
  /** y (viewBox units) for a price */
  y: (v: number) => number;
  /** inverse of y: viewBox y → price */
  priceAt: (yViewBox: number) => number;
}

function withY(min: number, max: number, H: number) {
  const span = max - min || 1;
  return {
    y: (v: number) => H - PAD - ((v - min) / span) * (H - 2 * PAD),
    priceAt: (yv: number) => min + ((H - PAD - yv) / (H - 2 * PAD)) * span,
  };
}

// Line: points span edge-to-edge (i / (N-1)). Matches LineChart's x().
export function lineScale(values: number[], extras: number[], H: number): ChartScale {
  const N = values.length;
  const all = extras.length ? values.concat(extras) : values;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const cx = (i: number) => PAD + (i * (VIEW_W - 2 * PAD)) / (N - 1);
  return { N, min, max, H, cx, ...withY(min, max, H) };
}

// Candles: each bar gets a slot, drawn at its centre. Matches CandleChart's cx().
export function candleScale(
  bars: { low: number; high: number }[],
  extras: number[],
  H: number
): ChartScale {
  const N = bars.length;
  const lows = bars.map((b) => b.low);
  const highs = bars.map((b) => b.high);
  const min = Math.min(...lows, ...extras);
  const max = Math.max(...highs, ...extras);
  const slot = (VIEW_W - 2 * PAD) / N;
  const cx = (i: number) => PAD + i * slot + slot / 2;
  return { N, min, max, H, cx, ...withY(min, max, H) };
}

// "Nice" rounded price ticks within [min, max] for the right-hand axis.
export function priceTicks(min: number, max: number, target = 5): number[] {
  const span = max - min;
  if (!(span > 0)) return [min];
  const rawStep = span / (target - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const niceNorm = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  const step = niceNorm * mag;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + 1e-9; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}
