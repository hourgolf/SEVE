"use client";

import { useState } from "react";
import { LineChart } from "@/components/charts/LineChart";
import { useFold } from "@/hooks/useFold";
import { signedUsd, usd0, timeOfDay } from "@/lib/format";
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
  acctId = null,
}: {
  strategists: StrategistState[];
  pnlByStrategist: Record<string, ChannelPnl>;
  fundPnl: { nav: number; dayPnl: number };
  equityCurve: { ts: string; equity: number }[];
  /** Selected cockpit bucket — scopes the windowed stats + NAV curve (null = desk total). */
  acctId?: string | null;
}) {
  // Timeframe toggle. "today" uses the live feed props (instant); week/month/all
  // fetch windowed realized P&L (+ open unrealized) + a windowed NAV curve lazily.
  const [win, setWin] = useState<PnlWindow>("today");
  const windowed = useWindowedPnl(win, acctId);
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
  const [folded, toggleFold] = useFold("pnl");

  return (
    <div className={`panel${folded ? " folded" : ""}`}>
      <div className="phead">
        <span className="t">P&amp;L · Equity</span>
        <span className="x">NAV {usd0(fundPnl.nav)}</span>
        <button type="button" className="pfold" onClick={toggleFold} aria-expanded={!folded} title={folded ? "expand" : "collapse"}>{folded ? "▸" : "▾"}</button>
      </div>
      <div className="pbody">
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <div className="seg" aria-label="P&L timeframe">
            {WINDOWS.map((w) => (
              <button key={w.id} className={win === w.id ? "on" : ""} onClick={() => setWin(w.id)} aria-pressed={win === w.id}>
                {w.label}
              </button>
            ))}
          </div>
        </div>
        <div className="pnl-equity">
          {hasCurve ? (
            <LineChart
              values={equityValues}
              height={90}
              id="equity"
              hover
              format={usd0}
              formatDelta={signedUsd}
              baseline={equityValues[0]}
              // Today: Δ vs the open (running intraday P&L). Week/Month/All: the curve is
              // a daily NAV rollup, so Δ vs the prior point = that DAY's P&L (matches the
              // Day-P&L LED + daily autopsy), not the cumulative run since the window start.
              segmentDelta={!isToday}
              labels={isToday ? equityCurve.map((p) => timeOfDay(p.ts)) : windowed?.curveLabels}
            />
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
