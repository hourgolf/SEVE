"use client";

import { useState } from "react";
import { LineChart } from "@/components/charts/LineChart";
import { signedUsd, usd0 } from "@/lib/format";
import { useWindowedPnl, type PnlWindow, type ChannelStat } from "@/hooks/useWindowedPnl";
import type { ChannelPnl, StrategistState } from "@/lib/desk/types";
import { pmVar } from "@/lib/desk/colors";

const WINDOWS: { id: PnlWindow; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "all", label: "All" },
];

export function PnlPanel({
  strategists,
  pnlByStrategist,
  fundPnl,
  equityCurve,
}: {
  strategists: StrategistState[];
  pnlByStrategist: Record<string, ChannelPnl>;
  fundPnl: { nav: number; dayPnl: number };
  equityCurve: { ts: string; equity: number }[];
}) {
  // Timeframe toggle. "today" uses the live feed props (instant); week/month/all
  // fetch windowed realized P&L (+ open unrealized) + a windowed NAV curve lazily.
  const [win, setWin] = useState<PnlWindow>("today");
  const windowed = useWindowedPnl(win);
  const isToday = win === "today";
  const loading = !isToday && (windowed?.loading ?? true);
  const winLabel = WINDOWS.find((w) => w.id === win)!.label.toLowerCase();

  const statFor = (slug: string): ChannelStat => {
    if (isToday) { const p = pnlByStrategist[slug]; return { pnl: p?.dayPnl ?? 0, trades: p?.trades ?? 0, wins: p?.wins ?? 0 }; }
    return windowed?.statsBySlug[slug] ?? { pnl: 0, trades: 0, wins: 0 };
  };
  const fundVal = isToday ? fundPnl.dayPnl : (windowed?.fundPnl ?? 0);
  const equityValues = isToday ? equityCurve.map((p) => p.equity) : (windowed?.curve ?? []);

  const hasCurve =
    equityValues.length >= 2 && Math.max(...equityValues) !== Math.min(...equityValues);

  return (
    <div className="panel panel--screws">
      <div className="phead">
        <span className="t">P&amp;L · Equity</span>
        <span className="x">NAV {usd0(fundPnl.nav)}</span>
      </div>
      <div className="pbody">
        <div className="seg" style={{ marginBottom: 8 }} aria-label="P&L timeframe">
          {WINDOWS.map((w) => (
            <button key={w.id} className={win === w.id ? "on" : ""} onClick={() => setWin(w.id)} aria-pressed={win === w.id}>
              {w.label}
            </button>
          ))}
        </div>
        <div className="pnl-equity">
          {hasCurve ? (
            <LineChart values={equityValues} height={90} id="equity" />
          ) : (
            <div className="chart-empty">{loading ? "loading…" : isToday ? "awaiting equity history" : "no equity history in window"}</div>
          )}
        </div>
        <div className="pnl-rows" style={{ display: "flex", flexDirection: "column", gap: 0, marginTop: 8, opacity: loading ? 0.5 : 1, transition: "opacity 0.15s" }}>
          {strategists.map((s) => {
            const st = statFor(s.slug);
            const wr = st.trades > 0 ? Math.round((st.wins / st.trades) * 100) : null;
            return (
              <div className="stat" key={s.slug}>
                <span className="k" style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: pmVar(s.color),
                      boxShadow: `0 0 6px ${pmVar(s.color)}`,
                    }}
                  />
                  {s.name}
                </span>
                <span className={`v num ${st.pnl < 0 ? "neg" : "pos"}`}>
                  {wr != null && <span className="pnl-wr">{wr}% · {st.trades}t</span>}
                  {signedUsd(st.pnl)}
                </span>
              </div>
            );
          })}
          <div className="stat" style={{ borderTop: "1px solid var(--border-bright)" }}>
            <span className="k" style={{ fontWeight: 600, color: "var(--text)" }}>
              Fund ({winLabel})
            </span>
            <span className={`v num ${fundVal < 0 ? "neg" : "pos"}`}>{signedUsd(fundVal)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
