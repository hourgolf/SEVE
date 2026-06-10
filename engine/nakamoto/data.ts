/**
 * Shared bar type + CSV load + PT-time helpers for the Nakamoto port.
 * His stack is pandas DataFrames keyed on UTC timestamps with PT session
 * logic (America/Los_Angeles) — we mirror that exactly: bars carry epoch ms
 * (UTC) and we derive PT wall-clock via Intl (no hardcoded offsets).
 */
import { readFileSync } from "fs";

export interface Bar {
  ts: number;        // epoch ms, UTC (bar START, Alpaca convention)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function loadCsvBars(path: string): Bar[] {
  const lines = readFileSync(path, "utf8").trim().split("\n");
  const out: Bar[] = [];
  for (let i = 1; i < lines.length; i++) {
    const [t, o, h, l, c, v] = lines[i].split(",");
    out.push({ ts: Date.parse(t), open: +o, high: +h, low: +l, close: +c, volume: +v });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

// ---- PT wall-clock (memoized per minute) ----------------------------------
const ptFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
const ptCache = new Map<number, { date: string; hm: number; sec: number }>();

/** PT parts for an epoch-ms instant: ISO date, minutes-since-midnight, seconds. */
export function ptParts(ts: number): { date: string; hm: number; sec: number } {
  const key = Math.floor(ts / 60000) * 60000;
  let v = ptCache.get(key);
  if (!v) {
    const p: Record<string, string> = {};
    for (const part of ptFmt.formatToParts(key)) p[part.type] = part.value;
    const hour = p.hour === "24" ? 0 : +p.hour; // Intl quirk: midnight as "24"
    v = { date: `${p.year}-${p.month}-${p.day}`, hm: hour * 60 + +p.minute, sec: 0 };
    ptCache.set(key, v);
  }
  return { ...v, sec: Math.floor((ts % 60000) / 1000) };
}

/** 'HH:MM' (PT) -> minutes since midnight. */
export function hm(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

export const RTH_OPEN_PT = hm("06:30"); // 09:30 ET

/** Mirror of detectors.rth_only: keep bars whose PT time >= 06:30. */
export function rthOnly(bars: Bar[]): Bar[] {
  return bars.filter(b => ptParts(b.ts).hm >= RTH_OPEN_PT);
}

/** Resample 1m bars into wall-clock-aligned 5m buckets (bucket start ts). */
export function resample5m(bars1m: Bar[]): Bar[] {
  const out: Bar[] = [];
  let cur: Bar | null = null;
  for (const b of bars1m) {
    const bucket = Math.floor(b.ts / 300000) * 300000;
    if (!cur || cur.ts !== bucket) {
      if (cur) out.push(cur);
      cur = { ts: bucket, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Python round() — half-to-even — for strike = round(spot). JS rounds half up. */
export function pyRound(x: number): number {
  const f = Math.floor(x);
  const frac = x - f;
  if (Math.abs(frac - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}

export const avg = (xs: number[]): number =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
