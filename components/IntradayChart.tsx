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
const VWAP_KEY = "seve-chart-vwap";
const EMA_KEY = "seve-chart-ema";
const VOL_KEY = "seve-chart-vol";
const MACD_KEY = "seve-chart-macd";

const EMA_FAST = 9;
const EMA_SLOW = 21;
const EMA_FAST_COLOR = "#45c4d6"; // cyan
const EMA_SLOW_COLOR = "#c061ff"; // violet
// Default visible window: the latest N bars (readable), not the whole history.
const DEFAULT_VIEW = 80;

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
// "May 30" — the date label for a session boundary on the x-axis.
const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
// Local calendar-day key, so we can detect when the tape crosses into a new
// trading session (where the date-axis ticks + dividers go).
const dayKey = (iso: string) => {
  const d = new Date(iso);
  return d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
};

// Monitor intraday chart: line/candles + timeframe + VWAP + EMA(9/21) overlay +
// volume strip + MACD panel + hover crosshair. The indicators come from
// lib/indicators — the same math the strategy engine uses.
export function IntradayChart({
  bars,
  spot,
  onLoadOlder,
  loadingOlder = false,
  hasMoreHistory = false,
}: {
  bars: UnderlyingBar[];
  spot?: number | null;
  /** Pull an older chunk of history (the data hook prepends it). */
  onLoadOlder?: () => void;
  /** True while that fetch is in flight — drives the left-edge indicator. */
  loadingOlder?: boolean;
  /** False once the table's earliest bar is loaded — stops the lazy trigger. */
  hasMoreHistory?: boolean;
}) {
  const [mode, setMode] = useState<Mode>("line");
  const [tf, setTf] = useState<number>(1);
  const [showVwap, setShowVwap] = useState(true);
  const [showEma, setShowEma] = useState(true);
  const [showVol, setShowVol] = useState(false);
  const [showMacd, setShowMacd] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  // Vertical mouse position over the chart (0 = top … 1 = bottom), for the
  // horizontal crosshair + the price tag that reads off the cursor.
  const [hoverY, setHoverY] = useState<number | null>(null);
  // Press-and-hold shows a price bubble pinned at the crosshair intersection.
  const [pressing, setPressing] = useState(false);
  // Zoom/pan window. count = bars shown (0 = fit all); offset = bars from the
  // right edge (0 = latest). Pinch zooms, one-finger drag pans.
  const [view, setView] = useState<{ count: number; offset: number }>({ count: DEFAULT_VIEW, offset: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const ptrs = useRef<Map<number, number>>(new Map()); // pointerId → clientX
  const gst = useRef({ kind: "idle", startX: 0, startOffset: 0, startEff: 0, pinchDist: 1, startCount: 0 });

  useEffect(() => {
    const m = window.localStorage.getItem(MODE_KEY);
    if (m === "candles" || m === "line") setMode(m);
    const t = Number(window.localStorage.getItem(TF_KEY));
    if (TIMEFRAMES.some((x) => x.minutes === t)) setTf(t);
    if (window.localStorage.getItem(VWAP_KEY) === "0") setShowVwap(false);
    if (window.localStorage.getItem(EMA_KEY) === "0") setShowEma(false);
    if (window.localStorage.getItem(VOL_KEY) === "1") setShowVol(true);
    if (window.localStorage.getItem(MACD_KEY) === "1") setShowMacd(true);
  }, []);

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
  const setTfPersist = (m: number) => {
    setTf(m);
    setHover(null);
    setView({ count: DEFAULT_VIEW, offset: 0 });
    try { window.localStorage.setItem(TF_KEY, String(m)); } catch {}
  };

  const agg = useMemo(() => aggregateBars(bars, tf), [bars, tf]);
  const closes = useMemo(() => agg.map((b) => b.close), [agg]);
  const candles = useMemo<Candle[]>(
    () => agg.map((b) => ({ open: b.open, high: b.high, low: b.low, close: b.close })),
    [agg]
  );
  const vwapArr = useMemo(() => agg.map((b) => b.vwap), [agg]);
  const emaFast = useMemo(() => ema(closes, EMA_FAST), [closes]);
  const emaSlow = useMemo(() => ema(closes, EMA_SLOW), [closes]);
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

  // x-axis: when the visible window spans multiple sessions, put a divider +
  // date at each new day (thinned so labels never collide). Within one session,
  // fall back to ~5 evenly spaced time ticks. `anchor` keeps edge labels inside.
  const xTicks = useMemo(() => {
    if (!scale || vN < 2) return [];
    const xf = (i: number) => scale.cx(i) / VIEW_W;
    const anchor = (x: number) => (x < 0.06 ? "start" : x > 0.94 ? "end" : "mid");
    const bounds: number[] = [];
    for (let i = 0; i < vAgg.length; i++) {
      if (i === 0 || dayKey(vAgg[i].ts) !== dayKey(vAgg[i - 1].ts)) bounds.push(i);
    }
    if (bounds.length >= 2) {
      let lastLabelX = -Infinity;
      return bounds.map((i) => {
        const x = xf(i);
        const showLabel = x - lastLabelX >= 0.12;
        if (showLabel) lastLabelX = x;
        return { i, x, label: showLabel ? dayLabel(vAgg[i].ts) : "", divider: i > 0, anchor: anchor(x) };
      });
    }
    const count = Math.min(5, vN);
    return Array.from({ length: count }, (_, k) => {
      const i = Math.round((k * (vN - 1)) / (count - 1));
      const x = xf(i);
      return { i, x, label: hhmm(vAgg[i].ts), divider: false, anchor: anchor(x) };
    });
  }, [scale, vAgg, vN]);

  // Lazy-load: the moment a pan reaches the oldest loaded bar (while zoomed in,
  // so we're genuinely at the left edge), ask the hook for an older chunk.
  useEffect(() => {
    if (onLoadOlder && hasMoreHistory && !loadingOlder && eff < N && visStart === 0) {
      onLoadOlder();
    }
  }, [onLoadOlder, hasMoreHistory, loadingOlder, eff, N, visStart]);

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

  const ledSpot = spot ?? (N ? closes[N - 1] : null);
  const zoomed = eff < N || offset > 0;

  const hb = hover != null ? vAgg[hover] ?? null : null;
  const prevBar = hover != null && hover > 0 ? vAgg[hover - 1] ?? null : null;
  const prevClose = prevBar?.close ?? hb?.open ?? 0;
  const chg = hb ? hb.close - prevClose : 0;

  return (
    <div className="panel">
      <div className="phead">
        <span className="t">SPY — Intraday</span>
        <span className="phead-right chart-controls">
          <button className={`ind-chip${showEma ? " on" : ""}`} onClick={persistToggle(EMA_KEY, setShowEma)} aria-pressed={showEma} title="EMA 9 / 21">EMA</button>
          <button className={`ind-chip${showVwap ? " on" : ""}`} onClick={persistToggle(VWAP_KEY, setShowVwap)} aria-pressed={showVwap} title="VWAP">VWAP</button>
          <button className={`ind-chip${showVol ? " on" : ""}`} onClick={persistToggle(VOL_KEY, setShowVol)} aria-pressed={showVol} title="Volume">VOL</button>
          <button className={`ind-chip${showMacd ? " on" : ""}`} onClick={persistToggle(MACD_KEY, setShowMacd)} aria-pressed={showMacd} title="MACD 12/26/9">MACD</button>
          <span className="seg" role="group" aria-label="timeframe">
            {TIMEFRAMES.map((t) => (
              <button key={t.minutes} className={tf === t.minutes ? "on" : ""} onClick={() => setTfPersist(t.minutes)} aria-pressed={tf === t.minutes}>
                {t.label}
              </button>
            ))}
          </span>
          <span className="chart-toggle" role="group" aria-label="chart type">
            <button className={mode === "line" ? "on" : ""} onClick={() => setModePersist("line")} aria-pressed={mode === "line"}>LINE</button>
            <button className={mode === "candles" ? "on" : ""} onClick={() => setModePersist("candles")} aria-pressed={mode === "candles"}>CANDLES</button>
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

          {/* left-edge lazy-load indicator */}
          {loadingOlder && <span className="loading-older">loading history…</span>}

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

          {/* zoom control — pinch/drag also work; these are the discoverable + testable handles */}
          <div className="chart-zoom" aria-label="zoom" onPointerDown={(e) => e.stopPropagation()}>
            <button onClick={() => zoomBy(1 / 0.7)} aria-label="zoom out">−</button>
            <button onClick={() => setView({ count: 0, offset: 0 })} aria-label="fit" className={zoomed ? "" : "dim"}>⤢</button>
            <button onClick={() => zoomBy(0.7)} aria-label="zoom in">+</button>
          </div>

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
        {showEma && (
          <div className="chart-meta">
            <span style={{ color: EMA_FAST_COLOR }}>EMA{EMA_FAST}</span>{" "}
            <span style={{ color: EMA_SLOW_COLOR }}>EMA{EMA_SLOW}</span>
          </div>
        )}
      </div>
    </div>
  );
}
