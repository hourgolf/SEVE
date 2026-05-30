"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LineChart, type Overlay } from "@/components/charts/LineChart";
import { CandleChart, type Candle } from "@/components/charts/CandleChart";
import { VolumeBars } from "@/components/charts/VolumeBars";
import { MacdChart } from "@/components/charts/MacdChart";
import { aggregateBars, TIMEFRAMES } from "@/lib/bars";
import { ema, macd as computeMacd } from "@/lib/indicators";
import type { UnderlyingBar } from "@/lib/types";

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

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

// Monitor intraday chart: line/candles + timeframe + VWAP + EMA(9/21) overlay +
// volume strip + MACD panel + hover crosshair. The indicators come from
// lib/indicators — the same math the strategy engine uses.
export function IntradayChart({ bars }: { bars: UnderlyingBar[] }) {
  const [mode, setMode] = useState<Mode>("line");
  const [tf, setTf] = useState<number>(1);
  const [showVwap, setShowVwap] = useState(true);
  const [showEma, setShowEma] = useState(true);
  const [showVol, setShowVol] = useState(false);
  const [showMacd, setShowMacd] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

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

  const overlays = useMemo<Overlay[]>(() => {
    if (!showEma || N < 2) return [];
    return [
      { values: emaFast, color: EMA_FAST_COLOR },
      { values: emaSlow, color: EMA_SLOW_COLOR },
    ];
  }, [showEma, emaFast, emaSlow, N]);

  function onMove(e: React.PointerEvent) {
    const el = wrapRef.current;
    if (!el || N < 1) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHover(Math.min(N - 1, Math.max(0, Math.round(frac * (N - 1)))));
  }

  const hb = hover != null ? agg[hover] ?? null : null;
  const prevBar = hover != null && hover > 0 ? agg[hover - 1] ?? null : null;
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
        <div className="chart-wrap" ref={wrapRef} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
          {mode === "candles" ? (
            <CandleChart bars={candles} vwap={showVwap ? vwapArr : undefined} overlays={overlays} />
          ) : (
            <LineChart values={closes} vwap={showVwap ? vwapArr : undefined} overlays={overlays} id="intraday" />
          )}
          {hb && N > 1 && <span className="crosshair" style={{ left: `${(hover! / (N - 1)) * 100}%` }} />}
          {hb && (
            <div className={`chart-tip ${hover! > N / 2 ? "left" : "right"}`}>
              <span className="tip-time">{hhmm(hb.ts)}</span>
              <span>O <b>{hb.open.toFixed(2)}</b></span>
              <span>H <b>{hb.high.toFixed(2)}</b></span>
              <span>L <b>{hb.low.toFixed(2)}</b></span>
              <span>C <b className={chg < 0 ? "neg" : "pos"}>{hb.close.toFixed(2)}</b></span>
              <span className={chg < 0 ? "neg" : "pos"}>{chg >= 0 ? "+" : ""}{chg.toFixed(2)}</span>
            </div>
          )}
        </div>
        {showVol && (
          <div className="subchart">
            <span className="subchart-label">VOL</span>
            <VolumeBars bars={agg} />
          </div>
        )}
        {showMacd && (
          <div className="subchart">
            <span className="subchart-label">MACD 12·26·9</span>
            <MacdChart macd={md.macd} signal={md.signal} hist={md.hist} />
          </div>
        )}
        <div className="chart-meta">
          {N} × {TIMEFRAMES.find((t) => t.minutes === tf)?.label} bars
          {showEma && (
            <>
              {" · "}
              <span style={{ color: EMA_FAST_COLOR }}>EMA{EMA_FAST}</span>{" "}
              <span style={{ color: EMA_SLOW_COLOR }}>EMA{EMA_SLOW}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
