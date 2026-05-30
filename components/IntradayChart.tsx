"use client";

import { useEffect, useState } from "react";
import { LineChart } from "@/components/charts/LineChart";
import { CandleChart, type Candle } from "@/components/charts/CandleChart";
import type { UnderlyingBar } from "@/lib/types";

const KEY = "seve-chart-mode";
type Mode = "line" | "candles";

// Monitor intraday chart: line or candlestick view of the last ~60 SPY bars.
// Mode persists in localStorage; defaults to "line" (set after mount to avoid
// an SSR/client hydration mismatch).
export function IntradayChart({ bars }: { bars: UnderlyingBar[] }) {
  const [mode, setMode] = useState<Mode>("line");

  useEffect(() => {
    const saved = window.localStorage.getItem(KEY);
    if (saved === "candles" || saved === "line") setMode(saved);
  }, []);

  function choose(m: Mode) {
    setMode(m);
    try {
      window.localStorage.setItem(KEY, m);
    } catch {
      /* private mode — ignore */
    }
  }

  const closes = bars
    .map((b) => b.close)
    .filter((v): v is number => v != null)
    .map(Number);
  const candles: Candle[] = bars
    .filter((b) => b.open != null && b.high != null && b.low != null && b.close != null)
    .map((b) => ({
      open: Number(b.open),
      high: Number(b.high),
      low: Number(b.low),
      close: Number(b.close),
    }));

  return (
    <div className="panel">
      <div className="phead">
        <span className="t">SPY — Intraday (1-min)</span>
        <span className="phead-right">
          <span className="chart-toggle" role="group" aria-label="chart type">
            <button
              className={mode === "line" ? "on" : ""}
              onClick={() => choose("line")}
              aria-pressed={mode === "line"}
            >
              LINE
            </button>
            <button
              className={mode === "candles" ? "on" : ""}
              onClick={() => choose("candles")}
              aria-pressed={mode === "candles"}
            >
              CANDLES
            </button>
          </span>
          <span className="x">{bars.length} bars</span>
        </span>
      </div>
      <div className="pbody">
        {mode === "candles" ? (
          <CandleChart bars={candles} />
        ) : (
          <LineChart values={closes} id="intraday" />
        )}
      </div>
    </div>
  );
}
