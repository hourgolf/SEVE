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
  type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type IPriceLine, type SeriesMarker, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { LedDisplay } from "@/components/console/hw/LedDisplay";
import { aggregateBars, TIMEFRAMES } from "@/lib/bars";
import { ema, macd as computeMacd } from "@/lib/indicators";
import { SUPPORTED_UNDERLYINGS } from "@/lib/desk/strategySpec";
import type { UnderlyingBar } from "@/lib/types";
import type { Position } from "@/lib/desk/types";

type Mode = "line" | "candles";
const MODE_KEY = "seve-chart-mode", TF_KEY = "seve-chart-tf", RANGE_KEY = "seve-chart-range";
const VWAP_KEY = "seve-chart-vwap", EMA_KEY = "seve-chart-ema", VOL_KEY = "seve-chart-vol", MACD_KEY = "seve-chart-macd";
const EMA_FAST_KEY = "seve-chart-ema-fast", EMA_SLOW_KEY = "seve-chart-ema-slow", EMA_THIRD_KEY = "seve-chart-ema-third";
const TRADES_KEY = "seve-chart-trades", LEVELS_KEY = "seve-chart-levels";
const EMA_FAST_DEFAULT = 9, EMA_SLOW_DEFAULT = 21, EMA_THIRD_DEFAULT = 50, EMA_MIN = 2, EMA_MAX = 200;

const C = {
  bg: "#0f1619", text: "#6f828a", grid: "#161f23", border: "#2a3a42",
  up: "#2fd573", down: "#f0563f", vwap: "#ffb224", emaFast: "#45c4d6", emaSlow: "#c061ff", emaThird: "#ff8f6b",
  area: "rgba(47,213,115,0.28)", areaBottom: "rgba(47,213,115,0.01)", areaLine: "#2fd573",
  macd: "#45c4d6", macdSig: "#ffb224",
  pdc: "#aab6bc", pdh: "#6fbf73", pdl: "#e0795f", orb: "#d9b54a", // level lines: prior close · prior-day high/low · opening range
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

// ET wall-clock parts (DST-correct) for level math (opening range / prior day).
const ET_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
function etParts(ms: number): { date: string; min: number } {
  let y = "", mo = "", d = "", h = 0, mi = 0;
  for (const p of ET_FMT.formatToParts(new Date(ms))) {
    if (p.type === "year") y = p.value; else if (p.type === "month") mo = p.value; else if (p.type === "day") d = p.value;
    else if (p.type === "hour") h = Number(p.value) % 24; else if (p.type === "minute") mi = Number(p.value);
  }
  return { date: `${y}-${mo}-${d}`, min: h * 60 + mi };
}

export function IntradayChart({
  bars, dailyBars = [], spot, spotUp = null, mobile = false, trades = [], openPositions = [], highlightTrade = null,
  symbol = "SPY", onSymbolChange,
}: {
  bars: UnderlyingBar[];
  dailyBars?: UnderlyingBar[];
  spot?: number | null;
  spotUp?: boolean | null;
  mobile?: boolean;
  /** §01 instrument label (SPY/QQQ) — titles the chart + the spot LED caption. */
  symbol?: string;
  /** When provided, renders the SPY/QQQ toggle in the chart header. */
  onSymbolChange?: (s: string) => void;
  /** Today's closed trades + open positions → entry/exit markers (intraday only). */
  trades?: Position[];
  openPositions?: Position[];
  /** A trade the operator opened in the Today's-trades list → emphasize its marker
   *  and center the view on it (so the fill is shown on the chart). */
  highlightTrade?: Position | null;
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
  const [emaThirdP, setEmaThirdP] = useState(EMA_THIRD_DEFAULT);
  const [showTrades, setShowTrades] = useState(true);
  const [showLevels, setShowLevels] = useState(true);

  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const areaRef = useRef<ISeriesApi<"Area"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const vwapRef = useRef<ISeriesApi<"Line"> | null>(null);
  const fastRef = useRef<ISeriesApi<"Line"> | null>(null);
  const slowRef = useRef<ISeriesApi<"Line"> | null>(null);
  const thirdRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdRef = useRef<{ hist: ISeriesApi<"Histogram">; macd: ISeriesApi<"Line">; sig: ISeriesApi<"Line"> } | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const markersOnRef = useRef<Mode | null>(null);
  const levelLinesRef = useRef<{ series: ISeriesApi<"Candlestick"> | ISeriesApi<"Area">; line: IPriceLine }[]>([]);
  const lastRangeRef = useRef<RangeKey | null>(null); // only reset the window on a RANGE change
  const pendingCenterRef = useRef<Position | null>(null); // center on this trade after the next setData

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
    const et = Number(g(EMA_THIRD_KEY)); if (et >= EMA_MIN && et <= EMA_MAX) setEmaThirdP(et);
    if (g(TRADES_KEY) === "0") setShowTrades(false);
    if (g(LEVELS_KEY) === "0") setShowLevels(false);
  }, []);

  const persist = (k: string, v: string) => { try { window.localStorage.setItem(k, v); } catch { /* */ } };
  const toggle = (key: string, set: React.Dispatch<React.SetStateAction<boolean>>) => () => set((v) => { persist(key, v ? "0" : "1"); return !v; });
  const setModeP = (m: Mode) => { setMode(m); persist(MODE_KEY, m); };
  const setRangeP = (rk: RangeKey) => { setRange(rk); setTf(RANGES[rk].tf); persist(RANGE_KEY, rk); };
  const setTfP = (m: number) => { setTf(m); persist(TF_KEY, String(m)); };
  const commitEma = (which: "fast" | "slow" | "third", raw: number) => {
    const fb = which === "fast" ? EMA_FAST_DEFAULT : which === "slow" ? EMA_SLOW_DEFAULT : EMA_THIRD_DEFAULT;
    const v = Math.round(Math.min(EMA_MAX, Math.max(EMA_MIN, raw || fb)));
    if (which === "fast") { setEmaFastP(v); persist(EMA_FAST_KEY, String(v)); }
    else if (which === "slow") { setEmaSlowP(v); persist(EMA_SLOW_KEY, String(v)); }
    else { setEmaThirdP(v); persist(EMA_THIRD_KEY, String(v)); }
  };

  const isDaily = RANGES[range].src === "daily";

  // ---- live-edge: fold the live spot into the forming bar ----
  // `sym` in the accumulator so a SPY↔QQQ toggle RESETS the forming bar — otherwise the prior
  // ticker's accumulated high/low carries into the new ticker's candle within the same minute
  // (the cross-symbol wick: a SPY chart spiking to QQQ's price and vice versa).
  const formingRef = useRef<{ min: number; sym: string; open: number; high: number; low: number } | null>(null);
  const liveSource = useMemo<UnderlyingBar[]>(() => {
    const src = isDaily ? dailyBars : bars;
    if (spot == null || !src.length) return src;
    const last = src[src.length - 1];
    const lc = last.close ?? spot, lh = last.high ?? spot, ll = last.low ?? spot;
    if (isDaily) return [...src.slice(0, -1), { ...last, close: spot, high: Math.max(lh, spot), low: Math.min(ll, spot) }];
    // drop a spot wildly off the last 1-min close (a glitch /api/spot tick or a mid-toggle
    // stale value) — a >2% move in under a minute isn't real, so don't let it set high/low.
    if (lc > 0 && Math.abs(spot - lc) / lc > 0.02) return src;
    const minStart = Math.floor(Date.now() / 60000) * 60000;
    if (Date.parse(last.ts) >= minStart) return src;
    const acc = formingRef.current;
    // Re-seed on a new minute / symbol toggle — AND when the accumulator's open has gone
    // STALE vs the current last-close (>2%). On a SPY↔QQQ toggle the `symbol` prop flips a
    // render BEFORE `bars`/`spot` refetch, so the sym-reset seeds `open` from the OLD ticker's
    // price; once the new ticker's bars arrive (same sym, same minute) the plain reset no longer
    // fires and that stale open folds with the new spot into a 738→700 cross-symbol wick. The
    // staleness re-seed discards it. (Within a real minute acc.open≈lc, so this never false-fires.)
    const accStale = !!acc && lc > 0 && Math.abs(acc.open - lc) / lc > 0.02;
    if (!acc || acc.min !== minStart || acc.sym !== symbol || accStale) formingRef.current = { min: minStart, sym: symbol, open: lc, high: Math.max(lc, spot), low: Math.min(lc, spot) };
    else { acc.high = Math.max(acc.high, spot); acc.low = Math.min(acc.low, spot); }
    const a = formingRef.current!;
    return [...src, { ts: new Date(minStart).toISOString(), open: a.open, high: a.high, low: a.low, close: spot, volume: 0, vwap: spot }];
  }, [isDaily, dailyBars, bars, spot, symbol]);

  const agg = useMemo(() => aggregateBars(liveSource, isDaily ? DAILY_TF : tf), [liveSource, isDaily, tf]);
  const efN = Math.min(EMA_MAX, Math.max(EMA_MIN, emaFastP || EMA_FAST_DEFAULT));
  const esN = Math.min(EMA_MAX, Math.max(EMA_MIN, emaSlowP || EMA_SLOW_DEFAULT));
  const etN = Math.min(EMA_MAX, Math.max(EMA_MIN, emaThirdP || EMA_THIRD_DEFAULT));

  // ---- key levels for the LVL overlay — from the SAME Supabase tape ----
  // prior close + prior-day high/low (dailyBars) and today's opening range
  // (first 30 min RTH, 1-min bars). All rendered as horizontal price lines.
  const levels = useMemo(() => {
    let priorClose: number | null = null, pdh: number | null = null, pdl: number | null = null;
    if (dailyBars.length >= 2) {
      const prev = dailyBars[dailyBars.length - 2];
      priorClose = prev.close ?? null; pdh = prev.high ?? null; pdl = prev.low ?? null;
    }
    let orbHi: number | null = null, orbLo: number | null = null;
    if (bars.length) {
      const todayET = etParts(Date.parse(bars[bars.length - 1].ts)).date;
      for (let i = bars.length - 1; i >= 0; i--) {
        const p = etParts(Date.parse(bars[i].ts));
        if (p.date !== todayET) break;             // bars ascending → older session, stop
        if (p.min >= 570 && p.min < 600) {         // 09:30–10:00 ET opening range
          const h = bars[i].high ?? bars[i].close, l = bars[i].low ?? bars[i].close;
          if (h != null) orbHi = orbHi == null ? h : Math.max(orbHi, h);
          if (l != null) orbLo = orbLo == null ? l : Math.min(orbLo, l);
        }
      }
    }
    return { priorClose, pdh, pdl, orbHi, orbLo };
  }, [bars, dailyBars]);

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
    vwapRef.current = line(C.vwap); fastRef.current = line(C.emaFast); slowRef.current = line(C.emaSlow); thirdRef.current = line(C.emaThird);
    chartRef.current = chart;
    return () => { chart.remove(); chartRef.current = null; macdRef.current = null; markersRef.current = null; markersOnRef.current = null; levelLinesRef.current = []; };
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
      const ef = ema(closes, efN), es = ema(closes, esN), et = ema(closes, etN);
      fastRef.current?.setData(rows.map((r, i) => ({ time: r.t, value: ef[i] })));
      slowRef.current?.setData(rows.map((r, i) => ({ time: r.t, value: es[i] })));
      thirdRef.current?.setData(rows.map((r, i) => ({ time: r.t, value: et[i] })));
    } else { fastRef.current?.setData([]); slowRef.current?.setData([]); thirdRef.current?.setData([]); }

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
    // Drilling into a trade from the list lights up ONLY that position; with no
    // drill-down, the TRADES toggle shows every fill.
    if ((showTrades || highlightTrade) && !isDaily && rows.length) {
      const lo = rows[0].t as number, hi = rows[rows.length - 1].t as number;
      const inRange = (iso?: string | null) => { if (!iso) return false; const s = Math.floor(Date.parse(iso) / 1000); return s >= lo && s <= hi; };
      const hlKey = highlightTrade ? `${highlightTrade.occ_symbol}|${highlightTrade.opened_at}` : null;
      for (const p of (highlightTrade ? [highlightTrade] : [...trades, ...openPositions])) {
        const up = p.opt_type === "call";
        const sz = hlKey && `${p.occ_symbol}|${p.opened_at}` === hlKey ? 2.4 : 1; // emphasize the opened trade
        if (inRange(p.opened_at)) markers.push({ time: tSec(p.opened_at!), position: up ? "belowBar" : "aboveBar", color: up ? C.up : C.down, shape: up ? "arrowUp" : "arrowDown", text: `${p.strike.toFixed(0)}${up ? "C" : "P"}`, size: sz });
        if (p.status === "closed" && inRange(p.closed_at)) { const win = (p.realized_pnl ?? 0) >= 0; markers.push({ time: tSec(p.closed_at!), position: up ? "aboveBar" : "belowBar", color: win ? C.up : C.down, shape: "circle", text: (win ? "+" : "") + Math.round(p.realized_pnl ?? 0), size: sz }); }
      }
      markers = markers.sort((a, b) => (a.time as number) - (b.time as number));
    }
    mk.setMarkers(markers);

    // ---- key level lines (intraday only): PDC / PDH / PDL / opening range ----
    // Rebuild each pass (cheap) so they track the active series + live data.
    for (const { series, line } of levelLinesRef.current) { try { series.removePriceLine(line); } catch { /* */ } }
    levelLinesRef.current = [];
    if (showLevels && !isDaily) {
      const tgt = activeSeries;
      const add = (price: number | null, color: string, title: string, lineStyle: LineStyle) => {
        if (price == null || !Number.isFinite(price)) return;
        const line = tgt.createPriceLine({ price, color, lineWidth: 1, lineStyle, axisLabelVisible: true, title });
        levelLinesRef.current.push({ series: tgt, line });
      };
      add(levels.priorClose, C.pdc, "PDC", LineStyle.Dashed);
      add(levels.pdh, C.pdh, "PDH", LineStyle.Dotted);
      add(levels.pdl, C.pdl, "PDL", LineStyle.Dotted);
      add(levels.orbHi, C.orb, "ORH", LineStyle.Dashed);
      add(levels.orbLo, C.orb, "ORL", LineStyle.Dashed);
    }

    // Default visible window — set ONLY when the range preset changes, not on every
    // live data poll, so polls don't reset the user's zoom/pan or a trade-highlight
    // centering. (A poll's setData preserves the current visible range on its own.)
    if (rows.length && lastRangeRef.current !== range) {
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, rows.length - (RANGES[range].bars || rows.length)), to: rows.length });
      lastRangeRef.current = range;
    }
    // Center on a highlighted trade AFTER setData (so it can't be overridden), once —
    // but ONLY when the fill is outside the current visible window, so clicking a
    // trade that's already on screen doesn't yank the chart around.
    if (pendingCenterRef.current && rows.length) {
      const ht = pendingCenterRef.current;
      const t0 = ht.opened_at ? Math.floor(Date.parse(ht.opened_at) / 1000) : null;
      const t1 = ht.closed_at ? Math.floor(Date.parse(ht.closed_at) / 1000) : t0;
      if (t0) {
        const vr = chart.timeScale().getVisibleRange();
        const onScreen = vr != null && t0 >= (vr.from as number) && t0 <= (vr.to as number);
        if (!onScreen) { try { chart.timeScale().setVisibleRange({ from: (t0 - 1800) as UTCTimestamp, to: ((t1 ?? t0) + 1800) as UTCTimestamp }); } catch { /* off-screen */ } }
      }
      pendingCenterRef.current = null;
    }
  }, [agg, mode, showVwap, showEma, showVol, showMacd, efN, esN, etN, showTrades, showLevels, levels, isDaily, range, trades, openPositions, highlightTrade, mobile]);

  // ---- highlight a trade drilled into from the Today's-trades list: switch to
  // intraday if needed and (only if off-screen) center the chart on the fill. Lights
  // up ONLY that position — the marker block keys off highlightTrade — and does NOT
  // toggle the all-trades layer or scroll the page. ----
  useEffect(() => {
    if (!highlightTrade) { pendingCenterRef.current = null; return; }
    if (isDaily) setRangeP("1D");           // intraday so the marker exists
    pendingCenterRef.current = highlightTrade; // the data effect centers (off-screen only) after setData
  }, [highlightTrade, isDaily]); // eslint-disable-line react-hooks/exhaustive-deps

  const ledSpot = spot ?? (agg.length ? agg[agg.length - 1].close : null);

  return (
    <div className="panel">
      <div className="phead">
        <span className="t">{symbol} — {isDaily ? "Daily" : "Intraday"}</span>
        <span className="phead-right chart-controls chart-controls--top">
          {onSymbolChange && (
            <span className="chart-toggle sym-toggle" role="group" aria-label="instrument">
              {SUPPORTED_UNDERLYINGS.map((sy) => (
                <button key={sy} className={symbol === sy ? "on" : ""} onClick={() => onSymbolChange(sy)} aria-pressed={symbol === sy}>{sy}</button>
              ))}
            </span>
          )}
          {/* duration (top) over candle-interval (bottom), stacked + right-justified on mobile */}
          <span className="chart-controls-right">
            <span className="seg seg--range" role="group" aria-label="range">
              {RANGE_KEYS.map((rk) => (
                <button key={rk} className={range === rk ? "on" : ""} onClick={() => setRangeP(rk)} aria-pressed={range === rk}>{rk}</button>
              ))}
            </span>
            {!isDaily && (
              <span className="seg seg--interval" role="group" aria-label="interval">
                {INTRADAY_TFS.map((m) => (
                  <button key={m} className={tf === m ? "on" : ""} onClick={() => setTfP(m)} aria-pressed={tf === m}>
                    {TIMEFRAMES.find((t) => t.minutes === m)?.label ?? `${m}m`}
                  </button>
                ))}
              </span>
            )}
          </span>
        </span>
      </div>
      <div className="pbody">
        <div className="chart-wrap chart-wrap--lw" style={{ position: "relative" }}>
          <div ref={elRef} style={{ height: mobile ? 260 : (showMacd ? 360 : 300), width: "100%" }} />
          {ledSpot != null && (
            <div className="chart-led">
              <LedDisplay value={ledSpot.toFixed(2)} digits={6} caption={`${symbol.toLowerCase()} $`} color={spotUp == null ? undefined : spotUp ? "var(--pm-green)" : "var(--led-red)"} />
            </div>
          )}
        </div>
        <div className="chart-controls chart-controls--bottom">
          <span className="ind-chips">
            <button className={`ind-chip${showEma ? " on" : ""}`} onClick={toggle(EMA_KEY, setShowEma)} aria-pressed={showEma} title="EMA overlay">EMA</button>
            <button className={`ind-chip${showVwap ? " on" : ""}`} onClick={toggle(VWAP_KEY, setShowVwap)} aria-pressed={showVwap} title="VWAP">VWAP</button>
            <button className={`ind-chip${showVol ? " on" : ""}`} onClick={toggle(VOL_KEY, setShowVol)} aria-pressed={showVol} title="Volume">VOL</button>
            <button className={`ind-chip${showMacd ? " on" : ""}`} onClick={toggle(MACD_KEY, setShowMacd)} aria-pressed={showMacd} title="MACD 12/26/9">MACD</button>
            <button className={`ind-chip${showTrades ? " on" : ""}`} onClick={toggle(TRADES_KEY, setShowTrades)} aria-pressed={showTrades} title="Show trade entry/exit markers">TRADES</button>
            <button className={`ind-chip${showLevels ? " on" : ""}`} onClick={toggle(LEVELS_KEY, setShowLevels)} aria-pressed={showLevels} title="Key levels: prior close (PDC), prior-day high/low (PDH/PDL), opening range (ORH/ORL) — intraday">LVL</button>
          </span>
          {/* right-justified: editable EMA periods (desktop) + the LINE/CANDLES toggle,
              dropped here from the header so it sits beside the indicator chips, but separated. */}
          <span className="chart-foot-right">
            {showEma && (
              <span className="ema-cfg" title="EMA periods (fast / slow)">
                <span className="ema-tag">EMA</span>
                <input className="ema-in" style={{ color: C.emaFast }} type="number" inputMode="numeric" min={EMA_MIN} max={EMA_MAX} value={emaFastP || ""} aria-label="EMA fast period" onChange={(e) => setEmaFastP(Math.floor(Number(e.target.value)) || 0)} onBlur={(e) => commitEma("fast", Number(e.target.value))} />
                <span className="ema-sep">/</span>
                <input className="ema-in" style={{ color: C.emaSlow }} type="number" inputMode="numeric" min={EMA_MIN} max={EMA_MAX} value={emaSlowP || ""} aria-label="EMA slow period" onChange={(e) => setEmaSlowP(Math.floor(Number(e.target.value)) || 0)} onBlur={(e) => commitEma("slow", Number(e.target.value))} />
                <span className="ema-sep">/</span>
                <input className="ema-in" style={{ color: C.emaThird }} type="number" inputMode="numeric" min={EMA_MIN} max={EMA_MAX} value={emaThirdP || ""} aria-label="EMA third period" onChange={(e) => setEmaThirdP(Math.floor(Number(e.target.value)) || 0)} onBlur={(e) => commitEma("third", Number(e.target.value))} />
              </span>
            )}
            <span className="chart-toggle" role="group" aria-label="chart type">
              <button className={mode === "line" ? "on" : ""} onClick={() => setModeP("line")} aria-pressed={mode === "line"}>LINE</button>
              <button className={mode === "candles" ? "on" : ""} onClick={() => setModeP("candles")} aria-pressed={mode === "candles"}>CANDLES</button>
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
