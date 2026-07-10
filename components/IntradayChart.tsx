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
  type ISeriesPrimitive, type SeriesAttachedParameter, type IPrimitivePaneView, type IPrimitivePaneRenderer,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import { LedDisplay } from "@/components/console/hw/LedDisplay";
import { aggregateBars, TIMEFRAMES } from "@/lib/bars";
import { ema, macd as computeMacd } from "@/lib/indicators";
import { SUPPORTED_UNDERLYINGS } from "@/lib/desk/strategySpec";
import type { UnderlyingBar } from "@/lib/types";
import type { Position } from "@/lib/desk/types";
import { getSupabase } from "@/lib/supabaseClient";

// SENT overlay data — the nightly brief's levels, fetched lazily when the chip first
// turns on. SPY gets the full ladder (confluence levels + gap-arm lines); every symbol
// gets its own dealer γ-walls. One tiny read of the latest sentinel event.
type SentTerrain = { levels: { px: number; label: string }[]; armLo: number | null; armHi: number | null };
type SentData = { byIndex: Record<string, SentTerrain> };

type Mode = "line" | "candles";
const MODE_KEY = "seve-chart-mode", TF_KEY = "seve-chart-tf", RANGE_KEY = "seve-chart-range";
const VWAP_KEY = "seve-chart-vwap", EMA_KEY = "seve-chart-ema", VOL_KEY = "seve-chart-vol", MACD_KEY = "seve-chart-macd";
const EMA_FAST_KEY = "seve-chart-ema-fast", EMA_SLOW_KEY = "seve-chart-ema-slow", EMA_THIRD_KEY = "seve-chart-ema-third";
const TRADES_KEY = "seve-chart-trades", LEVELS_KEY = "seve-chart-levels", BANDS_KEY = "seve-chart-bands", SENT_KEY = "seve-chart-sent";
const EMA_FAST_DEFAULT = 9, EMA_SLOW_DEFAULT = 21, EMA_THIRD_DEFAULT = 50, EMA_MIN = 2, EMA_MAX = 200;

const C = {
  bg: "#0f1619", text: "#6f828a", grid: "#161f23", border: "#2a3a42",
  up: "#2fd573", down: "#f0563f", vwap: "#ffb224", emaFast: "#45c4d6", emaSlow: "#c061ff", emaThird: "#ff8f6b",
  area: "rgba(47,213,115,0.28)", areaBottom: "rgba(47,213,115,0.01)", areaLine: "#2fd573",
  macd: "#45c4d6", macdSig: "#ffb224",
  pdc: "#aab6bc", pdh: "#6fbf73", pdl: "#e0795f", orb: "#d9b54a", // level lines: prior close · prior-day high/low · opening range
  hod: "#57b97f", lod: "#d9755b", // today's running high/low (solid, vs dotted prior-day)
  sessSep: "rgba(170,182,188,0.22)", sessPre: "rgba(111,130,138,0.10)", // session separators + premarket tint
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
// Memoized per minute — the session layer calls this for EVERY loaded bar on each
// data pass (up to ~6k 1-min rows), and Intl.formatToParts is the expensive bit.
const ET_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const ET_CACHE = new Map<number, { date: string; min: number }>();
function etParts(ms: number): { date: string; min: number } {
  const key = Math.floor(ms / 60000);
  const hit = ET_CACHE.get(key);
  if (hit) return hit;
  let y = "", mo = "", d = "", h = 0, mi = 0;
  for (const p of ET_FMT.formatToParts(new Date(ms))) {
    if (p.type === "year") y = p.value; else if (p.type === "month") mo = p.value; else if (p.type === "day") d = p.value;
    else if (p.type === "hour") h = Number(p.value) % 24; else if (p.type === "minute") mi = Number(p.value);
  }
  const v = { date: `${y}-${mo}-${d}`, min: h * 60 + mi };
  if (ET_CACHE.size > 30000) ET_CACHE.clear();
  ET_CACHE.set(key, v);
  return v;
}

// ---- session layer: day separators + premarket shading ----
// lightweight-charts has no built-in vertical lines/zones, so this custom series
// primitive paints (a) a 1px separator at each session's 09:30 ET bar when the
// loaded data spans >1 session and (b) a faint tint over pre-09:30 bars — both
// UNDER the candles (zOrder "bottom"). Times are bar times; timeToCoordinate
// returns null off-viewport, so spans clamp to the pane edges.
class SessionLayer implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private requestUpdate: (() => void) | null = null;
  private seps: UTCTimestamp[] = [];
  private shades: Array<{ from: UTCTimestamp; to: UTCTimestamp }> = [];
  private readonly view: IPrimitivePaneView;

  constructor() {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target: CanvasRenderingTarget2D) => {
        const chart = this.chart;
        if (!chart || (!this.seps.length && !this.shades.length)) return;
        const ts = chart.timeScale();
        const vr = ts.getVisibleRange();
        target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: hpr }) => {
          ctx.fillStyle = C.sessPre;
          for (const s of this.shades) {
            const x0m = ts.timeToCoordinate(s.from);
            const x1m = ts.timeToCoordinate(s.to);
            if (x0m === null && x1m === null) {
              // both ends off-screen — shade everything only if the viewport sits INSIDE the span
              if (vr && (vr.from as number) >= (s.from as number) && (vr.to as number) <= (s.to as number)) {
                ctx.fillRect(0, 0, bitmapSize.width, bitmapSize.height);
              }
              continue;
            }
            const x0 = x0m === null ? 0 : x0m * hpr;
            const x1 = x1m === null ? bitmapSize.width : x1m * hpr;
            if (x1 >= x0) ctx.fillRect(Math.max(0, x0), 0, Math.max(2, x1 - x0), bitmapSize.height);
          }
          ctx.fillStyle = C.sessSep;
          for (const t of this.seps) {
            const xm = ts.timeToCoordinate(t);
            if (xm === null) continue;
            ctx.fillRect(Math.round(xm * hpr), 0, Math.max(1, Math.round(hpr)), bitmapSize.height);
          }
        });
      },
    };
    this.view = { zOrder: () => "bottom", renderer: () => renderer };
  }

  attached(p: SeriesAttachedParameter<Time>) { this.chart = p.chart; this.requestUpdate = p.requestUpdate; }
  detached() { this.chart = null; this.requestUpdate = null; }
  paneViews(): readonly IPrimitivePaneView[] { return [this.view]; }
  setSessions(seps: UTCTimestamp[], shades: Array<{ from: UTCTimestamp; to: UTCTimestamp }>) {
    this.seps = seps; this.shades = shades; this.requestUpdate?.();
  }
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
  // mobile: the control chrome collapses behind a CFG chip (one row instead of
  // ~121px of wrapping toggles above the exit-timing canvas — tidy pass B6)
  const [cfgOpen, setCfgOpen] = useState(false);
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
  const [showBands, setShowBands] = useState(false); // VWAP ±σ bands (default off)
  const [showSent, setShowSent] = useState(false); // SENT: the nightly brief's levels (γ-walls / PD confluences / gap-arm lines)

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
  const sentLinesRef = useRef<{ series: ISeriesApi<"Candlestick"> | ISeriesApi<"Area">; line: IPriceLine }[]>([]); // SENT overlay lines
  const bandRefs = useRef<ISeriesApi<"Line">[]>([]); // VWAP ±1σ/±2σ (4 thin lines)
  const posLinesRef = useRef<{ series: ISeriesApi<"Candlestick"> | ISeriesApi<"Area">; line: IPriceLine }[]>([]); // open-position entry lines
  const lastRangeRef = useRef<RangeKey | null>(null); // only reset the window on a RANGE change
  const pendingCenterRef = useRef<Position | null>(null); // center on this trade after the next setData
  const [showJump, setShowJump] = useState(false); // "→ LIVE" chip: panned away / manual price scale
  const rowsLenRef = useRef(0); // rows count from the LAST data pass (live-edge + view-save math)
  const lastSymbolRef = useRef(symbol);
  const viewBySymbolRef = useRef<Record<string, { fromT: number; toT: number }>>({}); // per-symbol zoom memory (TIME-anchored — survives history prepends)
  // Restore this symbol's view when its rows land. `sawEmpty` gates the apply:
  // useMarketData clears bars between symbols, so the first rows>0 pass AFTER an
  // empty pass is the new symbol's data — applying any earlier would anchor the
  // restore against the OLD symbol's still-rendered rows. `tries` caps the wait
  // for deep history (the fast 200-bar poll lands ~1s before the paginated
  // 15-day history; restoring against the poll snapshot and letting the prepend
  // re-anchor it was the original sin here — hence TIME anchoring + coverage gate).
  const pendingSymRestoreRef = useRef<{ sym: string; sawEmpty: boolean; tries: number } | null>(null);
  const sessionLayerRef = useRef<SessionLayer | null>(null);
  const sessionHostRef = useRef<ISeriesApi<"Candlestick"> | ISeriesApi<"Area"> | null>(null);

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
    if (g(BANDS_KEY) === "1") setShowBands(true);
    if (g(SENT_KEY) === "1") setShowSent(true);
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
    // INTRADAY ranges plot 1-min bars → filter to RTH (09:30–16:00 ET). Pre/post-market bars
    // (~19% of the feed) are sparse, low-volume and render as overnight-gap / spike candles
    // (e.g. the QQQ 08:59 bar that gaps 1.3% off the prior close). Daily ranges use dailyBars,
    // an RTH rollup, so they're untouched.
    const src = isDaily ? dailyBars : bars.filter((b) => { const m = etParts(Date.parse(b.ts)).min; return m >= 570 && m < 960; });
    if (spot == null || !src.length) return src;
    const last = src[src.length - 1];
    const lc = last.close ?? spot, lh = last.high ?? spot, ll = last.low ?? spot;
    if (isDaily) return [...src.slice(0, -1), { ...last, close: spot, high: Math.max(lh, spot), low: Math.min(ll, spot) }];
    // no forming bar outside RTH — the live spot keeps polling after the close, which would
    // append an extended-hours candle to an otherwise RTH-clean chart.
    const nowMin = etParts(Date.now()).min;
    if (nowMin < 570 || nowMin >= 960) return src;
    // drop a spot wildly off the last 1-min close (a glitch /api/spot tick or a mid-toggle
    // stale value) — a >2% move in under a minute isn't real, so don't let it set high/low.
    if (lc > 0 && Math.abs(spot - lc) / lc > 0.02) return src;
    // AND drop a SUB-2% bad tick that falls outside the recent established range. A single glitch
    // /api/spot print (e.g. 738 while the session has held 743-746) is only ~0.9% off — it clears
    // the 2% guard, then STICKS in the forming bar's Math.min/max low/high and renders a giant wick
    // BELOW the day's LOD for the whole minute (the recurring "giant candle" bug). A genuine new
    // extreme arrives incrementally (just past the recent low/high, and confirmed by the next
    // completed bar); a 5-point spike past the last ~30 RTH bars' range + a 0.4% tolerance does not.
    if (src.length >= 10) {
      let rLo = Infinity, rHi = -Infinity;
      for (const b of src.slice(-30)) { const h = b.high ?? b.close, l = b.low ?? b.close; if (h != null) rHi = Math.max(rHi, h); if (l != null) rLo = Math.min(rLo, l); }
      const band = (lc > 0 ? lc : spot) * 0.004;
      if (Number.isFinite(rLo) && Number.isFinite(rHi) && (spot < rLo - band || spot > rHi + band)) return src;
    }
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
    let hod: number | null = null, lod: number | null = null;
    if (bars.length) {
      const todayET = etParts(Date.parse(bars[bars.length - 1].ts)).date;
      for (let i = bars.length - 1; i >= 0; i--) {
        const p = etParts(Date.parse(bars[i].ts));
        if (p.date !== todayET) break;             // bars ascending → older session, stop
        const h = bars[i].high ?? bars[i].close, l = bars[i].low ?? bars[i].close;
        if (p.min >= 570 && p.min < 600) {         // 09:30–10:00 ET opening range
          if (h != null) orbHi = orbHi == null ? h : Math.max(orbHi, h);
          if (l != null) orbLo = orbLo == null ? l : Math.min(orbLo, l);
        }
        if (p.min >= 570 && p.min < 960) {         // today's running RTH high/low
          if (h != null) hod = hod == null ? h : Math.max(hod, h);
          if (l != null) lod = lod == null ? l : Math.min(lod, l);
        }
      }
    }
    return { priorClose, pdh, pdl, orbHi, orbLo, hod, lod };
  }, [bars, dailyBars]);

  // ---- SENT overlay data (lazy: fetched once, the first time the chip turns on) ----
  const [sentData, setSentData] = useState<SentData | null>(null);
  useEffect(() => {
    if (!showSent || sentData) return;
    let alive = true;
    (async () => {
      try {
        const { data } = await getSupabase()
          .from("events").select("meta")
          .like("message", "sentinel:%").order("created_at", { ascending: false }).limit(1);
        if (!alive) return;
        type Lvl = { px: number; label: string };
        const brief = (data?.[0]?.meta as { brief?: {
          sentLevels?: Record<string, { above?: Lvl[]; below?: Lvl[]; armLo?: number | null; armHi?: number | null }>;
          carry?: { above?: Lvl[]; below?: Lvl[]; bandLo?: number | null; bandHi?: number | null };
          dealer?: { sym: string; walls: number[] }[];
        } } | undefined)?.brief;
        const byIndex: Record<string, SentTerrain> = {};
        if (brief?.sentLevels) {
          // NEW path: each index's own full ladder + gap-arm band
          for (const [sym, t] of Object.entries(brief.sentLevels)) {
            byIndex[sym] = { levels: [...(t.above ?? []), ...(t.below ?? [])], armLo: t.armLo ?? null, armHi: t.armHi ?? null };
          }
        } else if (brief) {
          // legacy fallback: SPY ladder from carry, others walls-only from dealer
          byIndex.SPY = { levels: [...(brief.carry?.above ?? []), ...(brief.carry?.below ?? [])], armLo: brief.carry?.bandLo ?? null, armHi: brief.carry?.bandHi ?? null };
          for (const d of brief.dealer ?? []) if (d.sym !== "SPY") byIndex[d.sym] = { levels: (d.walls ?? []).map((px) => ({ px, label: "γ-wall" })), armLo: null, armHi: null };
        }
        setSentData({ byIndex });
      } catch { if (alive) setSentData({ byIndex: {} }); }
    })();
    return () => { alive = false; };
  }, [showSent, sentData]);

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
    // VWAP σ-bands: ±1σ (brighter) and ±2σ (fainter) around the session VWAP —
    // thin amber companions to the VWAP line, empty until the ±σ chip is on.
    bandRefs.current = ["rgba(255,178,36,0.55)", "rgba(255,178,36,0.55)", "rgba(255,178,36,0.28)", "rgba(255,178,36,0.28)"].map((c) => line(c));
    sessionLayerRef.current = new SessionLayer();
    // "→ LIVE" affordance: show when panned away from the live edge OR the price
    // axis was manually scaled (a drag silently latches autoScale off — the
    // "candles vanished" failure mode).
    const onRange = () => {
      const lr = chart.timeScale().getVisibleLogicalRange();
      const away = !!lr && rowsLenRef.current > 0 && lr.to < rowsLenRef.current - 3;
      const manual = chart.priceScale("right").options().autoScale === false;
      setShowJump(away || manual);
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    chartRef.current = chart;
    if (process.env.NODE_ENV !== "production") (window as unknown as { __seveChart?: IChartApi }).__seveChart = chart; // dev console probe
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chart.remove(); chartRef.current = null; macdRef.current = null; markersRef.current = null; markersOnRef.current = null; levelLinesRef.current = [];
      sessionLayerRef.current = null; sessionHostRef.current = null;
    };
  }, []);

  // ---- feed data / overlays / markers / MACD pane ----
  useEffect(() => {
    const chart = chartRef.current, candle = candleRef.current, area = areaRef.current;
    if (!chart || !candle || !area) return;

    // ---- SPY↔QQQ switch: save the outgoing symbol's view as a WALL-CLOCK window
    // (times survive both the bar-clear and the late history prepend; SPY/QQQ share
    // the same session grid), re-arm price autoscale (a manual axis drag latches it
    // OFF, which left QQQ's candles stranded outside SPY's price window), and queue
    // the incoming symbol's restore.
    if (lastSymbolRef.current !== symbol) {
      const vr = chart.timeScale().getVisibleRange();
      if (vr && rowsLenRef.current > 0) {
        viewBySymbolRef.current[lastSymbolRef.current] = { fromT: vr.from as number, toT: vr.to as number };
      }
      chart.priceScale("right").applyOptions({ autoScale: true });
      pendingSymRestoreRef.current = { sym: symbol, sawEmpty: false, tries: 0 };
      lastSymbolRef.current = symbol;
    }

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
    // TRUE session VWAP — cumulative Σ(pv)/Σv per ET day (the per-bar `vwap` field is
    // the within-bar average: the right WEIGHT, never the session line itself). The old
    // line plotted that raw per-bar value, which hugs the close — the display-side twin
    // of the worker's known vwap quirk; fixed here. ±σ bands are volume-weighted stdev
    // around the running VWAP (intraday only; daily rows carry no vwap).
    {
      const vRows: { time: Time; value: number }[] = [];
      const b1: { time: Time; value: number }[] = [], b1n: { time: Time; value: number }[] = [];
      const b2: { time: Time; value: number }[] = [], b2n: { time: Time; value: number }[] = [];
      if ((showVwap || showBands) && !isDaily) {
        let day = "", sv = 0, svw = 0, svw2 = 0;
        for (const r of rows) {
          const d = etParts((r.t as number) * 1000).date;
          if (d !== day) { day = d; sv = 0; svw = 0; svw2 = 0; }
          const w = r.w != null ? Number(r.w) : r.c;
          if (r.v > 0 && Number.isFinite(w)) { sv += r.v; svw += r.v * w; svw2 += r.v * w * w; }
          if (sv <= 0) continue;
          const V = svw / sv;
          vRows.push({ time: r.t, value: V });
          if (showBands) {
            const sd = Math.sqrt(Math.max(0, svw2 / sv - V * V));
            b1.push({ time: r.t, value: V + sd }); b1n.push({ time: r.t, value: V - sd });
            b2.push({ time: r.t, value: V + 2 * sd }); b2n.push({ time: r.t, value: V - 2 * sd });
          }
        }
      }
      vwapRef.current?.setData(showVwap ? vRows : []);
      const [u1, l1, u2, l2] = bandRefs.current;
      u1?.setData(b1); l1?.setData(b1n); u2?.setData(b2); l2?.setData(b2n);
    }
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
      add(levels.hod, C.hod, "HOD", LineStyle.Solid);
      add(levels.lod, C.lod, "LOD", LineStyle.Solid);
    }

    // ---- SENT overlay (intraday): the nightly brief's terrain where price lives ----
    // γ-walls amber · confluence levels grey (label carries the sources) · gap-arm lines
    // green (open beyond → that index's gap book arms). Per-index: each symbol draws its
    // OWN ladder (pivots + prior-day + round grid + its dealer walls) + arm band. Levels are
    // the BRIEF's (from last close) — they don't move intraday: pre-committed terrain, not a repaint.
    for (const { series, line } of sentLinesRef.current) { try { series.removePriceLine(line); } catch { /* */ } }
    sentLinesRef.current = [];
    if (showSent && !isDaily && sentData) {
      const tgt = activeSeries;
      const addSent = (price: number | null | undefined, color: string, title: string, lineStyle: LineStyle) => {
        if (price == null || !Number.isFinite(price)) return;
        const line = tgt.createPriceLine({ price, color, lineWidth: 1, lineStyle, axisLabelVisible: true, title });
        sentLinesRef.current.push({ series: tgt, line });
      };
      const t = sentData.byIndex[symbol];
      if (t) {
        for (const lv of t.levels) {
          const isWall = lv.label.includes("γ");
          addSent(lv.px, isWall ? "#d9a13c" : "rgba(232,230,227,0.45)", lv.label.slice(0, 18), LineStyle.Dashed);
        }
        addSent(t.armHi, "#5fbf7f", "▲ calls arm", LineStyle.Dotted);
        addSent(t.armLo, "#5fbf7f", "▼ puts arm", LineStyle.Dotted);
      }
    }

    // ---- OPEN-POSITION entry lines (intraday): the underlying at entry — the
    // ride/giveback reference — direction-colored, labeled with the contract.
    // Rides the TRADES toggle: the marker shows WHEN you got in, the line shows
    // WHERE the tape was. Underlying-at-entry = the bar at opened_at (exact);
    // strike is the ATM fallback (the desk's entry-underlying proxy).
    for (const { series, line } of posLinesRef.current) { try { series.removePriceLine(line); } catch { /* removed with series */ } }
    posLinesRef.current = [];
    if (showTrades && !isDaily && rows.length) {
      for (const p of openPositions) {
        // ticker = the OCC root (SPY260612C00741000 → SPY) — Position carries no underlying field
        if ((p.occ_symbol.match(/^([A-Z]+)\d/)?.[1] ?? "SPY").toUpperCase() !== symbol) continue;
        let price: number | null = null;
        if (p.opened_at) {
          const ts = Math.floor(Date.parse(p.opened_at) / 1000);
          for (let i = rows.length - 1; i >= 0; i--) { if ((rows[i].t as number) <= ts) { price = rows[i].c; break; } }
        }
        if (price == null && Number.isFinite(p.strike)) price = p.strike;
        if (price == null) continue;
        const up = p.opt_type === "call";
        const line = activeSeries.createPriceLine({ price, color: up ? C.up : C.down, lineWidth: 1, lineStyle: LineStyle.SparseDotted, axisLabelVisible: true, title: `${up ? "▲" : "▼"}${p.strike.toFixed(0)}${up ? "C" : "P"}×${p.qty}` });
        posLinesRef.current.push({ series: activeSeries, line });
      }
    }

    // ---- session separators + premarket shading (intraday only) ----
    // The primitive rides the ACTIVE series (line/candles), so re-home it on a
    // mode flip; marks rebuild each pass from the rows' ET dates (cheap — etParts
    // is minute-memoized).
    if (sessionLayerRef.current) {
      if (sessionHostRef.current !== activeSeries) {
        try { sessionHostRef.current?.detachPrimitive(sessionLayerRef.current); } catch { /* detached with series */ }
        activeSeries.attachPrimitive(sessionLayerRef.current);
        sessionHostRef.current = activeSeries;
      }
      const seps: UTCTimestamp[] = [];
      const shades: Array<{ from: UTCTimestamp; to: UTCTimestamp }> = [];
      if (!isDaily && rows.length) {
        let lastDate = "";
        let preFrom: UTCTimestamp | null = null, preTo: UTCTimestamp | null = null, opened = false;
        const flushPre = () => { if (preFrom != null && preTo != null) shades.push({ from: preFrom, to: preTo }); preFrom = preTo = null; };
        for (const r of rows) {
          const p = etParts((r.t as number) * 1000);
          if (p.date !== lastDate) { flushPre(); lastDate = p.date; opened = false; }
          if (p.min < 570) { if (preFrom == null) preFrom = r.t; preTo = r.t; }
          else if (!opened) { seps.push(r.t); opened = true; }
        }
        flushPre();
      }
      // a lone session needs no separator; the premarket tint is useful even on 1D
      sessionLayerRef.current.setSessions(seps.length > 1 ? seps : [], shades);
    }

    // Default visible window — set ONLY when the range preset changes, not on every
    // live data poll, so polls don't reset the user's zoom/pan or a trade-highlight
    // centering. (A poll's setData preserves the current visible range on its own.)
    if (rows.length && lastRangeRef.current !== range) {
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, rows.length - (RANGES[range].bars || rows.length)), to: rows.length });
      lastRangeRef.current = range;
    } else if (rows.length && rowsLenRef.current > 0 && rows.length - rowsLenRef.current > 300 && !pendingSymRestoreRef.current) {
      // Deep history just PREPENDED: the paginated 15-day load lands a beat after
      // the fast ~200-bar poll, so the mount-time default window was computed
      // against the poll snapshot (the "1D shows half a session" quirk). Re-anchor
      // the preset default against the full count. Can't fire mid-session (live
      // bars append singly) and the symbol-restore path above takes precedence.
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, rows.length - (RANGES[range].bars || rows.length)), to: rows.length });
    }
    // Symbol restore: bring back the incoming symbol's saved wall-clock window, or
    // snap to the live edge when it has none. Applies only after the bar-clear
    // (sawEmpty) AND once the loaded history reaches back to the saved window —
    // the fast poll lands ~200 recent bars a beat before the deep history, and a
    // restore anchored on that snapshot gets dragged to the live edge by the
    // prepend. `tries` caps the wait so a saved window older than the loaded
    // history can't stall the restore forever.
    const pendingSym = pendingSymRestoreRef.current;
    if (pendingSym && pendingSym.sym === symbol) {
      if (!rows.length) {
        pendingSym.sawEmpty = true;
      } else if (pendingSym.sawEmpty) {
        pendingSym.tries++;
        const saved = viewBySymbolRef.current[symbol];
        const coverageOk = !saved || (rows[0].t as number) <= saved.fromT || pendingSym.tries > 6;
        if (coverageOk) {
          if (saved) {
            try { chart.timeScale().setVisibleRange({ from: saved.fromT as UTCTimestamp, to: saved.toT as UTCTimestamp }); } catch { /* window outside data */ }
          } else {
            chart.timeScale().scrollToRealTime();
          }
          chart.priceScale("right").applyOptions({ autoScale: true });
          pendingSymRestoreRef.current = null;
        }
      }
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

    // Live-edge bookkeeping + keep the "→ LIVE" chip honest on data passes too
    // (a vertical-only price-axis drag never fires the logical-range subscription).
    rowsLenRef.current = rows.length;
    {
      const lr = chart.timeScale().getVisibleLogicalRange();
      const away = !!lr && rows.length > 0 && lr.to < rows.length - 3;
      const manual = chart.priceScale("right").options().autoScale === false;
      setShowJump(away || manual);
    }
  }, [agg, mode, showVwap, showBands, showEma, showVol, showMacd, efN, esN, etN, showTrades, showLevels, levels, showSent, sentData, isDaily, range, trades, openPositions, highlightTrade, mobile, symbol]);

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

  // "→ LIVE": snap back to the latest bar and re-arm price autoscale.
  const jumpLive = () => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.priceScale("right").applyOptions({ autoScale: true });
    chart.timeScale().scrollToRealTime();
    setShowJump(false);
  };

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
          {mobile && (
            <button
              type="button"
              className={`chart-cfg-chip${cfgOpen ? " on" : ""}`}
              onClick={() => setCfgOpen((o) => !o)}
              aria-expanded={cfgOpen}
              title="chart settings — interval · indicators · line/candles"
            >
              CFG
            </button>
          )}
          {/* duration (top) over candle-interval (bottom), stacked + right-justified on mobile */}
          <span className="chart-controls-right">
            <span className="seg seg--range" role="group" aria-label="range">
              {RANGE_KEYS.map((rk) => (
                <button key={rk} className={range === rk ? "on" : ""} onClick={() => setRangeP(rk)} aria-pressed={range === rk}>{rk}</button>
              ))}
            </span>
            {!isDaily && (!mobile || cfgOpen) && (
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
          {/* the exit-timing instrument — sized up (operator: the chart was undersized for how much it's read) */}
          <div ref={elRef} style={{ height: mobile ? (showMacd ? 420 : 380) : (showMacd ? 500 : 420), width: "100%" }} />
          {ledSpot != null && (
            <div className="chart-led">
              <LedDisplay value={ledSpot.toFixed(2)} digits={6} caption={`${symbol.toLowerCase()} $`} color={spotUp == null ? undefined : spotUp ? "var(--pm-green)" : "var(--led-red)"} />
            </div>
          )}
          {showJump && (
            <button className="chart-live-jump" onClick={jumpLive} aria-label="Jump to the latest bar" title="Jump to the latest bar + re-arm autoscale">→ LIVE</button>
          )}
        </div>
        {(!mobile || cfgOpen) && (
        <div className="chart-controls chart-controls--bottom">
          <span className="ind-chips">
            <button className={`ind-chip${showEma ? " on" : ""}`} onClick={toggle(EMA_KEY, setShowEma)} aria-pressed={showEma} title="EMA overlay">EMA</button>
            <button className={`ind-chip${showVwap ? " on" : ""}`} onClick={toggle(VWAP_KEY, setShowVwap)} aria-pressed={showVwap} title="Session VWAP (cumulative, volume-weighted)">VWAP</button>
            <button className={`ind-chip${showBands ? " on" : ""}`} onClick={toggle(BANDS_KEY, setShowBands)} aria-pressed={showBands} title="VWAP ±1σ / ±2σ bands (volume-weighted, per session) — intraday">±σ</button>
            <button className={`ind-chip${showVol ? " on" : ""}`} onClick={toggle(VOL_KEY, setShowVol)} aria-pressed={showVol} title="Volume">VOL</button>
            <button className={`ind-chip${showMacd ? " on" : ""}`} onClick={toggle(MACD_KEY, setShowMacd)} aria-pressed={showMacd} title="MACD 12/26/9">MACD</button>
            <button className={`ind-chip${showTrades ? " on" : ""}`} onClick={toggle(TRADES_KEY, setShowTrades)} aria-pressed={showTrades} title="Show trade entry/exit markers">TRADES</button>
            <button className={`ind-chip${showLevels ? " on" : ""}`} onClick={toggle(LEVELS_KEY, setShowLevels)} aria-pressed={showLevels} title="Key levels: prior close (PDC), prior-day high/low (PDH/PDL), opening range (ORH/ORL), today's high/low (HOD/LOD) — intraday">LVL</button>
            <button className={`ind-chip${showSent ? " on" : ""}`} onClick={toggle(SENT_KEY, setShowSent)} aria-pressed={showSent} title="Sentinel brief levels — the nightly terrain: swing/PD confluences (grey), dealer γ-walls (amber), gap-arm lines (green: open beyond → the gap book arms)">SENT</button>
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
        )}
      </div>
    </div>
  );
}
