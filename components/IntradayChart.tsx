"use client";

// SPY intraday/daily chart — TradingView Lightweight-Charts rendering OUR Supabase
// tape (data-seam preserved). Native crosshair / pan / zoom / wheel-zoom come from
// the library; this component owns the 909 chrome: line/candle, range presets
// (1D…Max over the intraday + daily sources), VWAP/EMA/VOL/MACD toggles with
// editable EMA periods, a live-edge forming candle, the embedded spot LED, and —
// the reason we keep our own data — TRADE MARKERS (entries/exits on the price).

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart, CandlestickSeries, AreaSeries, LineSeries, HistogramSeries,
  createSeriesMarkers, ColorType, CrosshairMode, LineStyle,
  type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { LedDisplay } from "@/components/console/hw/LedDisplay";
import { aggregateBars, TIMEFRAMES } from "@/lib/bars";
import { ema, macd as computeMacd } from "@/lib/indicators";
import type { UnderlyingBar } from "@/lib/types";
import type { Position } from "@/lib/desk/types";

type Mode = "line" | "candles";
const MODE_KEY = "seve-chart-mode", TF_KEY = "seve-chart-tf", RANGE_KEY = "seve-chart-range";
const VWAP_KEY = "seve-chart-vwap", EMA_KEY = "seve-chart-ema", VOL_KEY = "seve-chart-vol", MACD_KEY = "seve-chart-macd";
const EMA_FAST_KEY = "seve-chart-ema-fast", EMA_SLOW_KEY = "seve-chart-ema-slow";
const EMA_FAST_DEFAULT = 9, EMA_SLOW_DEFAULT = 21, EMA_MIN = 2, EMA_MAX = 200;

const C = {
  bg: "#0f1619", text: "#6f828a", grid: "#161f23", border: "#2a3a42",
  up: "#2fd573", down: "#f0563f", vwap: "#ffb224", emaFast: "#45c4d6", emaSlow: "#c061ff",
  area: "rgba(47,213,115,0.28)", areaBottom: "rgba(47,213,115,0.01)", areaLine: "#2fd573",
  macd: "#45c4d6", macdSig: "#ffb224",
};

const DAILY_TF = 1440;
type RangeKey = "1D" | "1W" | "1M" | "3M" | "1Y" | "Max";
const RANGES: Record<RangeKey, { src: "intraday" | "daily"; tf: number; bars: number }> = {
  "1D": { src: "intraday", tf: 1, bars: 390 },
  "1W": { src: "intraday", tf: 15, bars: 130 },
  "1M": { src: "daily", tf: DAILY_TF, bars: 22 },
  "3M": { src: "daily", tf: DAILY_TF, bars: 66 },
  "1Y": { src: "daily", tf: DAILY_TF, bars: 252 },
  "Max": { src: "daily", tf: DAILY_TF, bars: 0 },
};
const RANGE_KEYS = Object.keys(RANGES) as RangeKey[];
const INTRADAY_TFS = [1, 5, 15, 30, 60];
const tSec = (iso: string) => Math.floor(Date.parse(iso) / 1000) as UTCTimestamp;

export function IntradayChart({
  bars, dailyBars = [], spot, spotUp = null, mobile = false, trades = [], openPositions = [],
}: {
  bars: UnderlyingBar[];
  dailyBars?: UnderlyingBar[];
  spot?: number | null;
  spotUp?: boolean | null;
  mobile?: boolean;
  /** Today's closed trades + open positions → entry/exit markers (intraday only). */
  trades?: Position[];
  openPositions?: Position[];
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

  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const areaRef = useRef<ISeriesApi<"Area"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const vwapRef = useRef<ISeriesApi<"Line"> | null>(null);
  const fastRef = useRef<ISeriesApi<"Line"> | null>(null);
  const slowRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdRef = useRef<{ hist: ISeriesApi<"Histogram">; macd: ISeriesApi<"Line">; sig: ISeriesApi<"Line"> } | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const markersOnRef = useRef<Mode | null>(null);

  // ---- persistence (restore on mount) ----
  useEffect(() => {
    const g = (k: string) => { try { return window.localStorage.getItem(k); } catch { return null; } };
    const m = g(MODE_KEY); if (m === "candles" || m === "line") setMode(m);
    const r = g(RANGE_KEY) as RangeKey | null; const rk: RangeKey = r && r in RANGES ? r : "1D";
    setRange(rk);
    let initTf = RANGES[rk].tf;
    if (RANGES[rk].src === "intraday") { const t = Number(g(TF_KEY)); if (INTRADAY_TFS.includes(t)) initTf = t; }
    setTf(initTf);
    if (g(VWAP_KEY) === "0") setShowVwap(false);
    if (g(EMA_KEY) === "0") setShowEma(false);
    if (g(VOL_KEY) === "1") setShowVol(true);
    if (g(MACD_KEY) === "1") setShowMacd(true);
    const ef = Number(g(EMA_FAST_KEY)); if (ef >= EMA_MIN && ef <= EMA_MAX) setEmaFastP(ef);
    const es = Number(g(EMA_SLOW_KEY)); if (es >= EMA_MIN && es <= EMA_MAX) setEmaSlowP(es);
  }, []);

  const persist = (k: string, v: string) => { try { window.localStorage.setItem(k, v); } catch { /* */ } };
  const toggle = (key: string, set: React.Dispatch<React.SetStateAction<boolean>>) => () => set((v) => { persist(key, v ? "0" : "1"); return !v; });
  const setModeP = (m: Mode) => { setMode(m); persist(MODE_KEY, m); };
  const setRangeP = (rk: RangeKey) => { setRange(rk); setTf(RANGES[rk].tf); persist(RANGE_KEY, rk); };
  const setTfP = (m: number) => { setTf(m); persist(TF_KEY, String(m)); };
  const commitEma = (which: "fast" | "slow", raw: number) => {
    const fb = which === "fast" ? EMA_FAST_DEFAULT : EMA_SLOW_DEFAULT;
    const v = Math.round(Math.min(EMA_MAX, Math.max(EMA_MIN, raw || fb)));
    if (which === "fast") { setEmaFastP(v); persist(EMA_FAST_KEY, String(v)); } else { setEmaSlowP(v); persist(EMA_SLOW_KEY, String(v)); }
  };

  const isDaily = RANGES[range].src === "daily";

  // ---- live-edge: fold the live spot into the forming bar ----
  const formingRef = useRef<{ min: number; open: number; high: number; low: number } | null>(null);
  const liveSource = useMemo<UnderlyingBar[]>(() => {
    const src = isDaily ? dailyBars : bars;
    if (spot == null || !src.length) return src;
    const last = src[src.length - 1];
    const lc = last.close ?? spot, lh = last.high ?? spot, ll = last.low ?? spot;
    if (isDaily) return [...src.slice(0, -1), { ...last, close: spot, high: Math.max(lh, spot), low: Math.min(ll, spot) }];
    const minStart = Math.floor(Date.now() / 60000) * 60000;
    if (Date.parse(last.ts) >= minStart) return src;
    const acc = formingRef.current;
    if (!acc || acc.min !== minStart) formingRef.current = { min: minStart, open: lc, high: Math.max(lc, spot), low: Math.min(lc, spot) };
    else { acc.high = Math.max(acc.high, spot); acc.low = Math.min(acc.low, spot); }
    const a = formingRef.current!;
    return [...src, { ts: new Date(minStart).toISOString(), open: a.open, high: a.high, low: a.low, close: spot, volume: 0, vwap: spot }];
  }, [isDaily, dailyBars, bars, spot]);

  const agg = useMemo(() => aggregateBars(liveSource, isDaily ? DAILY_TF : tf), [liveSource, isDaily, tf]);
  const efN = Math.min(EMA_MAX, Math.max(EMA_MIN, emaFastP || EMA_FAST_DEFAULT));
  const esN = Math.min(EMA_MAX, Math.max(EMA_MIN, emaSlowP || EMA_SLOW_DEFAULT));

  // ---- create chart + base series once ----
  useEffect(() => {
    if (!elRef.current) return;
    const chart = createChart(elRef.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: C.bg }, textColor: C.text, fontFamily: "JetBrains Mono, ui-monospace, monospace", fontSize: 10, attributionLogo: false },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: C.border, labelBackgroundColor: "#223038" }, horzLine: { color: C.border, labelBackgroundColor: "#223038" } },
      rightPriceScale: { borderColor: C.border, scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { borderColor: C.border, timeVisible: true, secondsVisible: false, rightOffset: 3 },
    });
    candleRef.current = chart.addSeries(CandlestickSeries, { upColor: C.up, downColor: C.down, borderVisible: false, wickUpColor: C.up, wickDownColor: C.down });
    areaRef.current = chart.addSeries(AreaSeries, { lineColor: C.areaLine, topColor: C.area, bottomColor: C.areaBottom, lineWidth: 2, priceLineVisible: false, crosshairMarkerVisible: true });
    volRef.current = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol" });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    const line = (color: string) => chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    vwapRef.current = line(C.vwap); fastRef.current = line(C.emaFast); slowRef.current = line(C.emaSlow);
    chartRef.current = chart;
    return () => { chart.remove(); chartRef.current = null; macdRef.current = null; markersRef.current = null; markersOnRef.current = null; };
  }, []);

  // ---- feed data / overlays / markers / MACD pane ----
  useEffect(() => {
    const chart = chartRef.current, candle = candleRef.current, area = areaRef.current;
    if (!chart || !candle || !area) return;

    // dedupe + ascending by second-resolution time
    const seen = new Set<number>();
    const rows = agg
      .map((b) => ({ t: tSec(b.ts), o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume, w: b.vwap }))
      .sort((a, b) => (a.t as number) - (b.t as number))
      .filter((r) => (seen.has(r.t as number) ? false : (seen.add(r.t as number), true)));

    if (mode === "candles") {
      candle.setData(rows.map((r) => ({ time: r.t, open: r.o, high: r.h, low: r.l, close: r.c })));
      area.setData([]);
    } else {
      area.setData(rows.map((r) => ({ time: r.t, value: r.c })));
      candle.setData([]);
    }
    volRef.current?.setData(showVol ? rows.map((r) => ({ time: r.t, value: r.v, color: r.c >= r.o ? "rgba(47,213,115,0.32)" : "rgba(240,86,63,0.32)" })) : []);
    vwapRef.current?.setData(showVwap ? rows.filter((r) => r.w != null).map((r) => ({ time: r.t, value: Number(r.w) })) : []);
    if (showEma) {
      const closes = rows.map((r) => r.c);
      const ef = ema(closes, efN), es = ema(closes, esN);
      fastRef.current?.setData(rows.map((r, i) => ({ time: r.t, value: ef[i] })));
      slowRef.current?.setData(rows.map((r, i) => ({ time: r.t, value: es[i] })));
    } else { fastRef.current?.setData([]); slowRef.current?.setData([]); }

    // MACD pane (create lazily, remove when toggled off)
    if (showMacd) {
      if (!macdRef.current) {
        const hist = chart.addSeries(HistogramSeries, { priceFormat: { type: "price", precision: 3, minMove: 0.001 }, priceLineVisible: false }, 1);
        const macd = chart.addSeries(LineSeries, { color: C.macd, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, 1);
        const sig = chart.addSeries(LineSeries, { color: C.macdSig, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, 1);
        macdRef.current = { hist, macd, sig };
        chart.panes()[1]?.setHeight(mobile ? 70 : 88);
      }
      const md = computeMacd(rows.map((r) => r.c));
      macdRef.current.hist.setData(rows.map((r, i) => ({ time: r.t, value: md.hist[i] ?? 0, color: (md.hist[i] ?? 0) >= 0 ? "rgba(47,213,115,0.5)" : "rgba(240,86,63,0.5)" })));
      macdRef.current.macd.setData(rows.map((r, i) => ({ time: r.t, value: md.macd[i] ?? 0 })));
      macdRef.current.sig.setData(rows.map((r, i) => ({ time: r.t, value: md.signal[i] ?? 0 })));
    } else if (macdRef.current) {
      chart.removeSeries(macdRef.current.hist); chart.removeSeries(macdRef.current.macd); chart.removeSeries(macdRef.current.sig);
      macdRef.current = null;
    }

    // ---- trade markers (intraday ranges only) ----
    const activeSeries = mode === "candles" ? candle : area;
    if (markersOnRef.current !== mode) { markersRef.current = null; markersOnRef.current = mode; }
    const mk = markersRef.current ?? (markersRef.current = createSeriesMarkers(activeSeries, []));
    let markers: SeriesMarker<Time>[] = [];
    if (!isDaily && rows.length) {
      const lo = rows[0].t as number, hi = rows[rows.length - 1].t as number;
      const inRange = (iso?: string | null) => { if (!iso) return false; const s = Math.floor(Date.parse(iso) / 1000); return s >= lo && s <= hi; };
      for (const p of [...trades, ...openPositions]) {
        const up = p.opt_type === "call";
        if (inRange(p.opened_at)) markers.push({ time: tSec(p.opened_at!), position: up ? "belowBar" : "aboveBar", color: up ? C.up : C.down, shape: up ? "arrowUp" : "arrowDown", text: `${p.strike.toFixed(0)}${up ? "C" : "P"}` });
        if (p.status === "closed" && inRange(p.closed_at)) { const win = (p.realized_pnl ?? 0) >= 0; markers.push({ time: tSec(p.closed_at!), position: up ? "aboveBar" : "belowBar", color: win ? C.up : C.down, shape: "circle", text: (win ? "+" : "") + Math.round(p.realized_pnl ?? 0) }); }
      }
      markers = markers.sort((a, b) => (a.time as number) - (b.time as number));
    }
    mk.setMarkers(markers);

    // visible window for the range
    if (rows.length) chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, rows.length - (RANGES[range].bars || rows.length)), to: rows.length });
  }, [agg, mode, showVwap, showEma, showVol, showMacd, efN, esN, isDaily, range, trades, openPositions, mobile]);

  const ledSpot = spot ?? (agg.length ? agg[agg.length - 1].close : null);

  return (
    <div className="panel">
      <div className="phead">
        <span className="t">SPY — {isDaily ? "Daily" : "Intraday"}</span>
        <span className="phead-right chart-controls chart-controls--top">
          <span className="chart-toggle" role="group" aria-label="chart type">
            <button className={mode === "line" ? "on" : ""} onClick={() => setModeP("line")} aria-pressed={mode === "line"}>LINE</button>
            <button className={mode === "candles" ? "on" : ""} onClick={() => setModeP("candles")} aria-pressed={mode === "candles"}>CANDLES</button>
          </span>
          <span className="chart-controls-right">
            {!mobile && !isDaily && (
              <span className="seg seg--interval" role="group" aria-label="interval">
                {INTRADAY_TFS.map((m) => (
                  <button key={m} className={tf === m ? "on" : ""} onClick={() => setTfP(m)} aria-pressed={tf === m}>
                    {TIMEFRAMES.find((t) => t.minutes === m)?.label ?? `${m}m`}
                  </button>
                ))}
              </span>
            )}
            <span className="seg seg--range" role="group" aria-label="range">
              {RANGE_KEYS.map((rk) => (
                <button key={rk} className={range === rk ? "on" : ""} onClick={() => setRangeP(rk)} aria-pressed={range === rk}>{rk}</button>
              ))}
            </span>
          </span>
        </span>
      </div>
      <div className="pbody">
        <div className="chart-wrap chart-wrap--lw" style={{ position: "relative" }}>
          <div ref={elRef} style={{ height: mobile ? 260 : (showMacd ? 360 : 300), width: "100%" }} />
          {ledSpot != null && (
            <div className="chart-led">
              <LedDisplay value={ledSpot.toFixed(2)} digits={6} caption="spy $" color={spotUp == null ? undefined : spotUp ? "var(--pm-green)" : "var(--led-red)"} />
            </div>
          )}
        </div>
        <div className="chart-controls chart-controls--bottom">
          <span className="ind-chips">
            <button className={`ind-chip${showEma ? " on" : ""}`} onClick={toggle(EMA_KEY, setShowEma)} aria-pressed={showEma} title="EMA overlay">EMA</button>
            <button className={`ind-chip${showVwap ? " on" : ""}`} onClick={toggle(VWAP_KEY, setShowVwap)} aria-pressed={showVwap} title="VWAP">VWAP</button>
            <button className={`ind-chip${showVol ? " on" : ""}`} onClick={toggle(VOL_KEY, setShowVol)} aria-pressed={showVol} title="Volume">VOL</button>
            <button className={`ind-chip${showMacd ? " on" : ""}`} onClick={toggle(MACD_KEY, setShowMacd)} aria-pressed={showMacd} title="MACD 12/26/9">MACD</button>
          </span>
          {showEma && (
            <span className="ema-cfg" title="EMA periods (fast / slow)">
              <span className="ema-tag">EMA</span>
              <input className="ema-in" style={{ color: C.emaFast }} type="number" inputMode="numeric" min={EMA_MIN} max={EMA_MAX} value={emaFastP || ""} aria-label="EMA fast period" onChange={(e) => setEmaFastP(Math.floor(Number(e.target.value)) || 0)} onBlur={(e) => commitEma("fast", Number(e.target.value))} />
              <span className="ema-sep">/</span>
              <input className="ema-in" style={{ color: C.emaSlow }} type="number" inputMode="numeric" min={EMA_MIN} max={EMA_MAX} value={emaSlowP || ""} aria-label="EMA slow period" onChange={(e) => setEmaSlowP(Math.floor(Number(e.target.value)) || 0)} onBlur={(e) => commitEma("slow", Number(e.target.value))} />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
