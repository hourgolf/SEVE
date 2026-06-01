"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LineChart, type Overlay } from "@/components/charts/LineChart";
import { CandleChart, type Candle } from "@/components/charts/CandleChart";
import { VolumeBars } from "@/components/charts/VolumeBars";
import { MacdChart } from "@/components/charts/MacdChart";
import { LedDisplay } from "@/components/console/hw/LedDisplay";
import { lineScale, candleScale, priceTicks, VIEW_W } from "@/components/charts/scale";
import { aggregateBars, TIMEFRAMES } from "@/lib/bars";
import { ema, macd as computeMacd } from "@/lib/indicators";
import type { UnderlyingBar } from "@/lib/types";

const CHART_H = 150; // matches the SVG viewBox height in Line/CandleChart

type Mode = "line" | "candles";
const MODE_KEY = "seve-chart-mode";
const TF_KEY = "seve-chart-tf";
const RANGE_KEY = "seve-chart-range";
const VWAP_KEY = "seve-chart-vwap";
const EMA_KEY = "seve-chart-ema";
const VOL_KEY = "seve-chart-vol";
const MACD_KEY = "seve-chart-macd";
const EMA_FAST_KEY = "seve-chart-ema-fast";
const EMA_SLOW_KEY = "seve-chart-ema-slow";

const EMA_FAST_DEFAULT = 9;
const EMA_SLOW_DEFAULT = 21;
const EMA_MIN = 2;
const EMA_MAX = 200;
const EMA_FAST_COLOR = "#45c4d6"; // cyan
const EMA_SLOW_COLOR = "#c061ff"; // violet

// Range presets (Robinhood-style): each maps to a data source + default bar
// interval + how much to show. Short ranges use the live 1-min feed; long ones
// read the daily rollup view. `bars` = the default visible bar count (0 = all).
const DAILY_TF = 1440;
type RangeKey = "1D" | "1W" | "1M" | "3M" | "1Y" | "Max";
const RANGES: Record<RangeKey, { src: "intraday" | "daily"; tf: number; minutes?: number; bars: number }> = {
  "1D":  { src: "intraday", tf: 1,       minutes: 390,  bars: 390 },
  "1W":  { src: "intraday", tf: 15,      minutes: 1950, bars: 130 },
  "1M":  { src: "daily",    tf: DAILY_TF,                bars: 22 },
  "3M":  { src: "daily",    tf: DAILY_TF,                bars: 66 },
  "1Y":  { src: "daily",    tf: DAILY_TF,                bars: 252 },
  "Max": { src: "daily",    tf: DAILY_TF,                bars: 0 },
};
const RANGE_KEYS = Object.keys(RANGES) as RangeKey[];
// Intraday interval options for the desktop override (short ranges only).
const INTRADAY_TFS = [1, 5, 15, 30, 60];

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
// "May 30" — date label for a session/day tick on the x-axis.
const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
// "May" / "May '25" — month label for the long (daily) ranges.
const monthLabel = (iso: string, withYear: boolean) => {
  const d = new Date(iso);
  const m = d.toLocaleDateString([], { month: "short" });
  return withYear ? `${m} '${String(d.getFullYear()).slice(2)}` : m;
};
// Local calendar-day key, so we can detect when the tape crosses into a new
// trading session (where the date-axis ticks + dividers go).
const dayKey = (iso: string) => {
  const d = new Date(iso);
  return d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
};
const monthKey = (iso: string) => {
  const d = new Date(iso);
  return d.getFullYear() * 12 + d.getMonth();
};

// Monitor intraday chart: line/candles + timeframe + VWAP + EMA(9/21) overlay +
// volume strip + MACD panel + hover crosshair. The indicators come from
// lib/indicators — the same math the strategy engine uses.
export function IntradayChart({
  bars,
  dailyBars = [],
  spot,
  mobile = false,
}: {
  bars: UnderlyingBar[];
  /** Daily OHLCV rollup for the long-range presets (3M / 1Y / Max). */
  dailyBars?: UnderlyingBar[];
  spot?: number | null;
  /** Phone layout: hide the desktop-only interval override. */
  mobile?: boolean;
}) {
  const [mode, setMode] = useState<Mode>("line");
  const [range, setRange] = useState<RangeKey>("1D");
  const [tf, setTf] = useState<number>(RANGES["1D"].tf);
  const [showVwap, setShowVwap] = useState(true);
  const [showEma, setShowEma] = useState(true);
  const [showVol, setShowVol] = useState(false);
  const [showMacd, setShowMacd] = useState(false);
  const [emaFastP, setEmaFastP] = useState(EMA_FAST_DEFAULT);
  const [emaSlowP, setEmaSlowP] = useState(EMA_SLOW_DEFAULT);
  const [hover, setHover] = useState<number | null>(null);
  // Vertical mouse position over the chart (0 = top … 1 = bottom), for the
  // horizontal crosshair + the price tag that reads off the cursor.
  const [hoverY, setHoverY] = useState<number | null>(null);
  // Press-and-hold shows a price bubble pinned at the crosshair intersection.
  const [pressing, setPressing] = useState(false);
  // Zoom/pan window. count = bars shown (0 = fit all); offset = bars from the
  // right edge (0 = latest). Pinch zooms, one-finger drag pans.
  const [view, setView] = useState<{ count: number; offset: number }>({ count: RANGES["1D"].bars, offset: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const ptrs = useRef<Map<number, number>>(new Map()); // pointerId → clientX
  const gst = useRef({ kind: "idle", startX: 0, startOffset: 0, startEff: 0, pinchDist: 1, startCount: 0 });

  useEffect(() => {
    const m = window.localStorage.getItem(MODE_KEY);
    if (m === "candles" || m === "line") setMode(m);
    const r = window.localStorage.getItem(RANGE_KEY) as RangeKey | null;
    const rk: RangeKey = r && r in RANGES ? r : "1D";
    setRange(rk);
    // default interval for the range, then honour a persisted intraday override
    let initialTf = RANGES[rk].tf;
    if (RANGES[rk].src === "intraday") {
      const t = Number(window.localStorage.getItem(TF_KEY));
      if (INTRADAY_TFS.includes(t)) initialTf = t;
    }
    setTf(initialTf);
    setView({ count: RANGES[rk].bars, offset: 0 });
    if (window.localStorage.getItem(VWAP_KEY) === "0") setShowVwap(false);
    if (window.localStorage.getItem(EMA_KEY) === "0") setShowEma(false);
    if (window.localStorage.getItem(VOL_KEY) === "1") setShowVol(true);
    if (window.localStorage.getItem(MACD_KEY) === "1") setShowMacd(true);
    const ef = Number(window.localStorage.getItem(EMA_FAST_KEY));
    if (ef >= EMA_MIN && ef <= EMA_MAX) setEmaFastP(ef);
    const es = Number(window.localStorage.getItem(EMA_SLOW_KEY));
    if (es >= EMA_MIN && es <= EMA_MAX) setEmaSlowP(es);
  }, []);

  // Commit on blur: clamp the typed value into range and persist it.
  const commitEma = (which: "fast" | "slow", raw: number) => {
    const fallback = which === "fast" ? EMA_FAST_DEFAULT : EMA_SLOW_DEFAULT;
    const v = Math.round(Math.min(EMA_MAX, Math.max(EMA_MIN, raw || fallback)));
    if (which === "fast") {
      setEmaFastP(v);
      try { window.localStorage.setItem(EMA_FAST_KEY, String(v)); } catch {}
    } else {
      setEmaSlowP(v);
      try { window.localStorage.setItem(EMA_SLOW_KEY, String(v)); } catch {}
    }
  };

  const persistToggle =
    (key: string, set: React.Dispatch<React.SetStateAction<boolean>>) => () =>
      set((v) => {
        try { window.localStorage.setItem(key, v ? "0" : "1"); } catch {}
        return !v;
      });

  const setModePersist = (m: Mode) => {
    setMode(m);
    try { window.localStorage.setItem(MODE_KEY, m); } catch {}
  };
  // Pick a range preset: sets the data source + default interval + visible window.
  const setRangePersist = (rk: RangeKey) => {
    const cfg = RANGES[rk];
    setRange(rk);
    setTf(cfg.tf);
    setHover(null);
    setView({ count: cfg.bars, offset: 0 });
    try { window.localStorage.setItem(RANGE_KEY, rk); } catch {}
  };
  // Desktop-only interval override (intraday ranges): re-aggregate + refit the
  // range's calendar span at the new bar size.
  const setTfPersist = (m: number) => {
    setTf(m);
    setHover(null);
    const mins = RANGES[range].minutes ?? 0;
    setView({ count: mins ? Math.ceil(mins / m) : 0, offset: 0 });
    try { window.localStorage.setItem(TF_KEY, String(m)); } catch {}
  };

  const isDaily = RANGES[range].src === "daily";
  // Live-edge: fold the live spot into the most recent candle so it grows in
  // real time between the 1-min ingest snapshots. Intraday → append a forming
  // candle for the current minute (until its real bar lands); daily → extend
  // today's last candle. formingRef accumulates the minute's high/low.
  const formingRef = useRef<{ min: number; open: number; high: number; low: number } | null>(null);
  const liveSource = useMemo<UnderlyingBar[]>(() => {
    const src = isDaily ? dailyBars : bars;
    if (spot == null || !src.length) return src;
    const last = src[src.length - 1];
    // bar columns are nullable off PostgREST — fall back to spot for the math
    const lastHigh = last.high ?? spot;
    const lastLow = last.low ?? spot;
    const lastClose = last.close ?? spot;
    if (isDaily) {
      const updated = { ...last, close: spot, high: Math.max(lastHigh, spot), low: Math.min(lastLow, spot) };
      return [...src.slice(0, -1), updated];
    }
    const minuteStart = Math.floor(Date.now() / 60000) * 60000;
    if (Date.parse(last.ts) >= minuteStart) return src; // real bar already covers now
    const acc = formingRef.current;
    if (!acc || acc.min !== minuteStart) {
      formingRef.current = { min: minuteStart, open: lastClose, high: Math.max(lastClose, spot), low: Math.min(lastClose, spot) };
    } else {
      acc.high = Math.max(acc.high, spot);
      acc.low = Math.min(acc.low, spot);
    }
    const a = formingRef.current!;
    const forming: UnderlyingBar = {
      ts: new Date(minuteStart).toISOString(),
      open: a.open, high: a.high, low: a.low, close: spot, volume: 0, vwap: spot,
    };
    return [...src, forming];
  }, [isDaily, dailyBars, bars, spot]);
  // Daily bars are already one-per-day; aggregating them at the daily interval
  // is a clean passthrough (and coerces the nullable view columns to numbers).
  const agg = useMemo(
    () => aggregateBars(liveSource, isDaily ? DAILY_TF : tf),
    [liveSource, isDaily, tf]
  );
  const closes = useMemo(() => agg.map((b) => b.close), [agg]);
  const candles = useMemo<Candle[]>(
    () => agg.map((b) => ({ open: b.open, high: b.high, low: b.low, close: b.close })),
    [agg]
  );
  const vwapArr = useMemo(() => agg.map((b) => b.vwap), [agg]);
  // Clamp for the math so a mid-edit value (e.g. "1" or empty) can't break ema().
  const efN = Math.min(EMA_MAX, Math.max(EMA_MIN, emaFastP || EMA_FAST_DEFAULT));
  const esN = Math.min(EMA_MAX, Math.max(EMA_MIN, emaSlowP || EMA_SLOW_DEFAULT));
  const emaFast = useMemo(() => ema(closes, efN), [closes, efN]);
  const emaSlow = useMemo(() => ema(closes, esN), [closes, esN]);
  const md = useMemo(() => computeMacd(closes), [closes]);
  const N = agg.length;

  // ---- zoom/pan window over the full aggregated series ----
  const MIN_BARS = 12;
  const eff = view.count === 0 ? N : Math.min(N, Math.max(MIN_BARS, view.count));
  const offset = Math.min(Math.max(0, view.offset), Math.max(0, N - eff));
  const visStart = Math.max(0, N - offset - eff);
  const visEnd = N - offset;
  const vN = visEnd - visStart;

  const slice = <T,>(a: T[]) => a.slice(visStart, visEnd);
  const vAgg = useMemo(() => slice(agg), [agg, visStart, visEnd]);
  const vCloses = useMemo(() => slice(closes), [closes, visStart, visEnd]);
  const vCandles = useMemo(() => slice(candles), [candles, visStart, visEnd]);
  const vVwap = useMemo(() => slice(vwapArr), [vwapArr, visStart, visEnd]);
  const vEmaFast = useMemo(() => slice(emaFast), [emaFast, visStart, visEnd]);
  const vEmaSlow = useMemo(() => slice(emaSlow), [emaSlow, visStart, visEnd]);
  const vMacd = useMemo(() => slice(md.macd), [md, visStart, visEnd]);
  const vSignal = useMemo(() => slice(md.signal), [md, visStart, visEnd]);
  const vHist = useMemo(() => slice(md.hist), [md, visStart, visEnd]);

  const overlays = useMemo<Overlay[]>(() => {
    if (!showEma || vN < 2) return [];
    return [
      { values: vEmaFast, color: EMA_FAST_COLOR },
      { values: vEmaSlow, color: EMA_SLOW_COLOR },
    ];
  }, [showEma, vEmaFast, vEmaSlow, vN]);

  // Price-domain extras (VWAP + EMA overlays) so the axis matches the chart.
  const extras = useMemo(() => {
    const vw = showVwap ? vVwap.filter((v): v is number => v != null) : [];
    const ov = overlays.flatMap((o) => o.values).filter((v): v is number => v != null);
    return [...vw, ...ov];
  }, [showVwap, vVwap, overlays]);

  // The scale that mirrors the active chart's geometry — drives the crosshair,
  // the right-hand price axis and the cursor price tag.
  const scale = useMemo(() => {
    if (mode === "candles" ? vN < 1 : vN < 2) return null;
    return mode === "candles"
      ? candleScale(vCandles, extras, CHART_H)
      : lineScale(vCloses, extras, CHART_H);
  }, [mode, vCandles, vCloses, extras, vN]);

  const ticks = useMemo(
    () => (scale ? priceTicks(scale.min, scale.max) : []),
    [scale]
  );

  // x-axis ticks, adapted to the visible span:
  //  • daily ranges → divider + label at each new week (≤~6wk) or month, thinned
  //  • intraday, multi-session → divider + date at each new trading day
  //  • intraday, single session → ~5 evenly spaced HH:MM ticks
  const xTicks = useMemo(() => {
    if (!scale || vN < 2) return [];
    const xf = (i: number) => scale.cx(i) / VIEW_W;
    const anchor = (x: number) => (x < 0.06 ? "start" : x > 0.94 ? "end" : "mid");
    const boundaries = (keyOf: (ts: string) => number, label: (ts: string) => string, minGap = 0.12) => {
      const bounds: number[] = [];
      for (let i = 0; i < vAgg.length; i++) {
        if (i === 0 || keyOf(vAgg[i].ts) !== keyOf(vAgg[i - 1].ts)) bounds.push(i);
      }
      let lastLabelX = -Infinity;
      return bounds.map((i) => {
        const x = xf(i);
        const show = x - lastLabelX >= minGap;
        if (show) lastLabelX = x;
        return { i, x, label: show ? label(vAgg[i].ts) : "", divider: i > 0, anchor: anchor(x) };
      });
    };

    if (isDaily) {
      const spanDays = (Date.parse(vAgg[vN - 1].ts) - Date.parse(vAgg[0].ts)) / 86400000;
      if (spanDays <= 45) {
        const week = (ts: string) => Math.floor(Date.parse(ts) / (7 * 86400000));
        return boundaries(week, (ts) => dayLabel(ts));
      }
      const withYear = spanDays > 300;
      // year-tagged labels are wider — give them more breathing room
      return boundaries(monthKey, (ts) => monthLabel(ts, withYear), withYear ? 0.17 : 0.12);
    }

    const dayBounds = boundaries(dayKey, (ts) => dayLabel(ts));
    if (dayBounds.length >= 2) return dayBounds;
    const count = Math.min(5, vN);
    return Array.from({ length: count }, (_, k) => {
      const i = Math.round((k * (vN - 1)) / (count - 1));
      const x = xf(i);
      return { i, x, label: hhmm(vAgg[i].ts), divider: false, anchor: anchor(x) };
    });
  }, [scale, vAgg, vN, isDaily]);

  // ---- gestures: crosshair / pan / pinch-zoom ----
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

  function zoomBy(factor: number, fracX = 0.5) {
    if (N < 2) return;
    setView((v) => {
      const curEff = v.count === 0 ? N : clamp(v.count, MIN_BARS, N);
      const newCount = clamp(Math.round(curEff * factor), MIN_BARS, N);
      const curOffset = clamp(v.offset, 0, N - curEff);
      const curStart = N - curOffset - curEff;
      const anchor = curStart + fracX * curEff; // bar under the focus point
      let newStart = clamp(Math.round(anchor - fracX * newCount), 0, N - newCount);
      return { count: newCount >= N ? 0 : newCount, offset: N - newCount - newStart };
    });
  }

  function updateCrosshair(clientX: number, clientY: number) {
    const el = wrapRef.current;
    if (!el || vN < 1) return;
    const r = el.getBoundingClientRect();
    setHover(clamp(Math.round(((clientX - r.left) / r.width) * (vN - 1)), 0, vN - 1));
    setHoverY(clamp((clientY - r.top) / r.height, 0, 1));
  }

  function onDown(e: React.PointerEvent) {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    ptrs.current.set(e.pointerId, e.clientX);
    if (ptrs.current.size >= 2) {
      const xs = [...ptrs.current.values()];
      gst.current = { kind: "pinch", startX: 0, startOffset: offset, startEff: eff, pinchDist: Math.abs(xs[0] - xs[1]) || 1, startCount: eff };
      setHover(null); setHoverY(null); setPressing(false);
    } else {
      gst.current = { kind: "cross", startX: e.clientX, startOffset: offset, startEff: eff, pinchDist: 1, startCount: eff };
      setPressing(true);
      updateCrosshair(e.clientX, e.clientY);
    }
  }
  function onMove(e: React.PointerEvent) {
    if (ptrs.current.has(e.pointerId)) ptrs.current.set(e.pointerId, e.clientX);
    const g = gst.current;
    const w = wrapRef.current?.getBoundingClientRect().width ?? 1;
    if (g.kind === "pinch" && ptrs.current.size >= 2) {
      const xs = [...ptrs.current.values()];
      const dist = Math.abs(xs[0] - xs[1]) || 1;
      const mid = (xs[0] + xs[1]) / 2;
      const r = wrapRef.current?.getBoundingClientRect();
      const fracX = r ? clamp((mid - r.left) / r.width, 0, 1) : 0.5;
      const target = clamp(Math.round(g.startCount * (g.pinchDist / dist)), MIN_BARS, N);
      const factor = target / (g.startEff || 1);
      g.startEff = target; g.startCount = target; g.pinchDist = dist;
      zoomBy(factor, fracX);
      return;
    }
    if (ptrs.current.size === 1) {
      const dx = e.clientX - g.startX;
      if (g.kind === "pan" || Math.abs(dx) > 6) {
        g.kind = "pan";
        setHover(null); setHoverY(null); setPressing(false);
        const deltaBars = Math.round((dx * g.startEff) / w);
        setView((v) => ({ count: v.count, offset: clamp(g.startOffset + deltaBars, 0, N - g.startEff) }));
        return;
      }
      updateCrosshair(e.clientX, e.clientY);
      return;
    }
    if (ptrs.current.size === 0) updateCrosshair(e.clientX, e.clientY);
  }
  function onUp(e: React.PointerEvent) {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size === 0) { gst.current.kind = "idle"; setPressing(false); }
    else gst.current.kind = "idle";
  }
  function onLeave() {
    ptrs.current.clear();
    gst.current.kind = "idle";
    setHover(null); setHoverY(null); setPressing(false);
  }

  // double-click / double-tap anywhere on the chart resets to the range's window
  function onDoubleClick() {
    setView({ count: RANGES[range].bars, offset: 0 });
  }

  // Mouse-wheel zoom (desktop "squeeze"), focused on the cursor. Attached as a
  // native non-passive listener so we can preventDefault the page scroll; reads
  // the latest zoomBy via a ref so it never goes stale.
  const zoomByRef = useRef(zoomBy);
  zoomByRef.current = zoomBy;
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const fracX = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      zoomByRef.current(e.deltaY > 0 ? 1 / 0.88 : 0.88, fracX);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const ledSpot = spot ?? (N ? closes[N - 1] : null);

  const hb = hover != null ? vAgg[hover] ?? null : null;
  const prevBar = hover != null && hover > 0 ? vAgg[hover - 1] ?? null : null;
  const prevClose = prevBar?.close ?? hb?.open ?? 0;
  const chg = hb ? hb.close - prevClose : 0;

  return (
    <div className="panel">
      <div className="phead">
        <span className="t">SPY — {isDaily ? "Daily" : "Intraday"}</span>
        <span className="phead-right chart-controls chart-controls--top">
          <span className="chart-toggle" role="group" aria-label="chart type">
            <button className={mode === "line" ? "on" : ""} onClick={() => setModePersist("line")} aria-pressed={mode === "line"}>LINE</button>
            <button className={mode === "candles" ? "on" : ""} onClick={() => setModePersist("candles")} aria-pressed={mode === "candles"}>CANDLES</button>
          </span>
          <span className="chart-controls-right">
            {/* desktop-only interval override, shown for the intraday ranges */}
            {!mobile && !isDaily && (
              <span className="seg seg--interval" role="group" aria-label="interval">
                {INTRADAY_TFS.map((m) => {
                  const label = TIMEFRAMES.find((t) => t.minutes === m)?.label ?? `${m}m`;
                  return (
                    <button key={m} className={tf === m ? "on" : ""} onClick={() => setTfPersist(m)} aria-pressed={tf === m}>
                      {label}
                    </button>
                  );
                })}
              </span>
            )}
            <span className="seg seg--range" role="group" aria-label="range">
              {RANGE_KEYS.map((rk) => (
                <button key={rk} className={range === rk ? "on" : ""} onClick={() => setRangePersist(rk)} aria-pressed={range === rk}>
                  {rk}
                </button>
              ))}
            </span>
          </span>
        </span>
      </div>
      <div className="pbody">
        <div
          className="chart-wrap"
          ref={wrapRef}
          onPointerMove={onMove}
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={onLeave}
          onDoubleClick={onDoubleClick}
        >
          {mode === "candles" ? (
            <CandleChart bars={vCandles} vwap={showVwap ? vVwap : undefined} overlays={overlays} />
          ) : (
            <LineChart values={vCloses} vwap={showVwap ? vVwap : undefined} overlays={overlays} id="intraday" />
          )}

          {/* right-hand price axis — always on, so price is readable at a glance */}
          {scale && (
            <div className="price-axis" aria-hidden>
              {ticks.map((p) => (
                <span
                  key={p}
                  className="price-tick"
                  style={{ top: `${(scale.y(p) / scale.H) * 100}%` }}
                >
                  {p.toFixed(2)}
                </span>
              ))}
            </div>
          )}

          {/* session dividers: a faint vertical at each new trading day */}
          {scale &&
            xTicks.map((t) =>
              t.divider ? (
                <span key={`div${t.i}`} className="day-div" style={{ left: `${t.x * 100}%` }} />
              ) : null
            )}

          {/* crosshair: vertical snaps to the candle centre; horizontal tracks Y */}
          {scale && hover != null && (
            <span className="crosshair" style={{ left: `${(scale.cx(hover) / VIEW_W) * 100}%` }} />
          )}
          {scale && hoverY != null && (
            <>
              <span className="crosshair crosshair-h" style={{ top: `${hoverY * 100}%` }} />
              <span className="price-cursor" style={{ top: `${hoverY * 100}%` }}>
                {scale.priceAt(hoverY * scale.H).toFixed(2)}
              </span>
            </>
          )}
          {/* press-and-hold: price bubble pinned at the crosshair intersection */}
          {pressing && scale && hover != null && hoverY != null && (
            <span
              className={`cross-pop${hoverY < 0.22 ? " below" : ""}`}
              style={{
                left: `${(scale.cx(hover) / VIEW_W) * 100}%`,
                top: `${hoverY * 100}%`,
              }}
            >
              {scale.priceAt(hoverY * scale.H).toFixed(2)}
            </span>
          )}

          {/* embedded live SPY price LED, lower-right */}
          {ledSpot != null && (
            <div className="chart-led">
              <LedDisplay value={ledSpot.toFixed(2)} digits={6} caption="spy $" />
            </div>
          )}

          {hb && (
            <div className={`chart-tip ${hover! > vN / 2 ? "left" : "right"}`}>
              <span className="tip-time">{hhmm(hb.ts)}</span>
              <span>O <b>{hb.open.toFixed(2)}</b></span>
              <span>H <b>{hb.high.toFixed(2)}</b></span>
              <span>L <b>{hb.low.toFixed(2)}</b></span>
              <span>C <b className={chg < 0 ? "neg" : "pos"}>{hb.close.toFixed(2)}</b></span>
              <span className={chg < 0 ? "neg" : "pos"}>{chg >= 0 ? "+" : ""}{chg.toFixed(2)}</span>
            </div>
          )}
        </div>
        {/* date / time axis — aligned to the price chart's columns */}
        {scale && xTicks.length > 0 && (
          <div className="x-axis" aria-hidden>
            {xTicks.map((t) =>
              t.label ? (
                <span key={t.i} className={`x-tick x-${t.anchor}`} style={{ left: `${t.x * 100}%` }}>
                  {t.label}
                </span>
              ) : null
            )}
          </div>
        )}
        {showVol && (
          <div className="subchart">
            <span className="subchart-label">VOL</span>
            <VolumeBars bars={vAgg} />
          </div>
        )}
        {showMacd && (
          <div className="subchart">
            <span className="subchart-label">MACD 12·26·9</span>
            <MacdChart macd={vMacd} signal={vSignal} hist={vHist} />
          </div>
        )}
        {/* indicator toggles live below the chart now; EMA carries editable
            periods so 9/21 can become 8/21 or any custom pair */}
        <div className="chart-controls chart-controls--bottom">
          <span className="ind-chips">
            <button className={`ind-chip${showEma ? " on" : ""}`} onClick={persistToggle(EMA_KEY, setShowEma)} aria-pressed={showEma} title="EMA overlay">EMA</button>
            <button className={`ind-chip${showVwap ? " on" : ""}`} onClick={persistToggle(VWAP_KEY, setShowVwap)} aria-pressed={showVwap} title="VWAP">VWAP</button>
            <button className={`ind-chip${showVol ? " on" : ""}`} onClick={persistToggle(VOL_KEY, setShowVol)} aria-pressed={showVol} title="Volume">VOL</button>
            <button className={`ind-chip${showMacd ? " on" : ""}`} onClick={persistToggle(MACD_KEY, setShowMacd)} aria-pressed={showMacd} title="MACD 12/26/9">MACD</button>
          </span>
          {showEma && (
            <span className="ema-cfg" title="EMA periods (fast / slow)">
              <span className="ema-tag">EMA</span>
              <input
                className="ema-in"
                style={{ color: EMA_FAST_COLOR }}
                type="number"
                inputMode="numeric"
                min={EMA_MIN}
                max={EMA_MAX}
                value={emaFastP || ""}
                aria-label="EMA fast period"
                onChange={(e) => setEmaFastP(Math.floor(Number(e.target.value)) || 0)}
                onBlur={(e) => commitEma("fast", Number(e.target.value))}
              />
              <span className="ema-sep">/</span>
              <input
                className="ema-in"
                style={{ color: EMA_SLOW_COLOR }}
                type="number"
                inputMode="numeric"
                min={EMA_MIN}
                max={EMA_MAX}
                value={emaSlowP || ""}
                aria-label="EMA slow period"
                onChange={(e) => setEmaSlowP(Math.floor(Number(e.target.value)) || 0)}
                onBlur={(e) => commitEma("slow", Number(e.target.value))}
              />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
