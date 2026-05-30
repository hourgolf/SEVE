"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LineChart } from "@/components/charts/LineChart";
import { CandleChart, type Candle } from "@/components/charts/CandleChart";
import { aggregateBars, TIMEFRAMES } from "@/lib/bars";
import type { UnderlyingBar } from "@/lib/types";

type Mode = "line" | "candles";
const MODE_KEY = "seve-chart-mode";
const TF_KEY = "seve-chart-tf";
const VWAP_KEY = "seve-chart-vwap";

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

// Monitor intraday chart: line/candles + timeframe (1m–1h) + VWAP overlay +
// hover crosshair. Choices persist in localStorage (set after mount to avoid an
// SSR/client hydration mismatch).
export function IntradayChart({ bars }: { bars: UnderlyingBar[] }) {
  const [mode, setMode] = useState<Mode>("line");
  const [tf, setTf] = useState<number>(1);
  const [showVwap, setShowVwap] = useState(true);
  const [hover, setHover] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const m = window.localStorage.getItem(MODE_KEY);
    if (m === "candles" || m === "line") setMode(m);
    const t = Number(window.localStorage.getItem(TF_KEY));
    if (TIMEFRAMES.some((x) => x.minutes === t)) setTf(t);
    if (window.localStorage.getItem(VWAP_KEY) === "0") setShowVwap(false);
  }, []);

  const setModePersist = (m: Mode) => {
    setMode(m);
    try { window.localStorage.setItem(MODE_KEY, m); } catch {}
  };
  const setTfPersist = (m: number) => {
    setTf(m);
    setHover(null);
    try { window.localStorage.setItem(TF_KEY, String(m)); } catch {}
  };
  const toggleVwap = () => {
    setShowVwap((v) => {
      try { window.localStorage.setItem(VWAP_KEY, v ? "0" : "1"); } catch {}
      return !v;
    });
  };

  const agg = useMemo(() => aggregateBars(bars, tf), [bars, tf]);
  const closes = useMemo(() => agg.map((b) => b.close), [agg]);
  const candles = useMemo<Candle[]>(
    () => agg.map((b) => ({ open: b.open, high: b.high, low: b.low, close: b.close })),
    [agg]
  );
  const vwapArr = useMemo(() => agg.map((b) => b.vwap), [agg]);
  const N = agg.length;

  function onMove(e: React.PointerEvent) {
    const el = wrapRef.current;
    if (!el || N < 1) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHover(Math.min(N - 1, Math.max(0, Math.round(frac * (N - 1)))));
  }

  // Null-safe: `hover` can briefly outlive a timeframe change that shrank `agg`.
  const hb = hover != null ? agg[hover] ?? null : null;
  const prevBar = hover != null && hover > 0 ? agg[hover - 1] ?? null : null;
  const prevClose = prevBar?.close ?? hb?.open ?? 0;
  const chg = hb ? hb.close - prevClose : 0;

  return (
    <div className="panel">
      <div className="phead">
        <span className="t">SPY — Intraday</span>
        <span className="phead-right chart-controls">
          <button
            className={`vwap-chip${showVwap ? " on" : ""}`}
            onClick={toggleVwap}
            aria-pressed={showVwap}
            title="toggle VWAP"
          >
            VWAP
          </button>
          <span className="seg" role="group" aria-label="timeframe">
            {TIMEFRAMES.map((t) => (
              <button
                key={t.minutes}
                className={tf === t.minutes ? "on" : ""}
                onClick={() => setTfPersist(t.minutes)}
                aria-pressed={tf === t.minutes}
              >
                {t.label}
              </button>
            ))}
          </span>
          <span className="chart-toggle" role="group" aria-label="chart type">
            <button className={mode === "line" ? "on" : ""} onClick={() => setModePersist("line")} aria-pressed={mode === "line"}>
              LINE
            </button>
            <button className={mode === "candles" ? "on" : ""} onClick={() => setModePersist("candles")} aria-pressed={mode === "candles"}>
              CANDLES
            </button>
          </span>
        </span>
      </div>
      <div className="pbody">
        <div
          className="chart-wrap"
          ref={wrapRef}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {mode === "candles" ? (
            <CandleChart bars={candles} vwap={showVwap ? vwapArr : undefined} />
          ) : (
            <LineChart values={closes} vwap={showVwap ? vwapArr : undefined} id="intraday" />
          )}
          {hb && N > 1 && (
            <span
              className="crosshair"
              style={{ left: `${(hover! / (N - 1)) * 100}%` }}
            />
          )}
          {hb && (
            <div
              className={`chart-tip ${hover! > N / 2 ? "left" : "right"}`}
            >
              <span className="tip-time">{hhmm(hb.ts)}</span>
              <span>O <b>{hb.open.toFixed(2)}</b></span>
              <span>H <b>{hb.high.toFixed(2)}</b></span>
              <span>L <b>{hb.low.toFixed(2)}</b></span>
              <span>C <b className={chg < 0 ? "neg" : "pos"}>{hb.close.toFixed(2)}</b></span>
              <span className={chg < 0 ? "neg" : "pos"}>{chg >= 0 ? "+" : ""}{chg.toFixed(2)}</span>
            </div>
          )}
        </div>
        <div className="chart-meta">{N} × {TIMEFRAMES.find((t) => t.minutes === tf)?.label} bars</div>
      </div>
    </div>
  );
}
