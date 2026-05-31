"use client";

import { LineChart } from "@/components/charts/LineChart";
import { signedUsd, usd0 } from "@/lib/format";
import type { ChannelPnl, PmColor, StrategistState } from "@/lib/desk/types";

const PM_VAR: Record<PmColor, string> = {
  green: "var(--pm-green)",
  blue: "var(--pm-blue)",
  amber: "var(--pm-amber)",
  cyan: "var(--pm-cyan)",
};

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
  const equityValues = equityCurve.map((p) => p.equity);
  // A flat line (no trades yet → NAV constant) reads as a broken chart. Only
  // draw the curve once there's genuine variation to show.
  const hasCurve =
    equityValues.length >= 2 &&
    Math.max(...equityValues) !== Math.min(...equityValues);

  return (
    <div className="panel">
      <div className="phead">
        <span className="t">P&amp;L · Equity</span>
        <span className="x">NAV {usd0(fundPnl.nav)}</span>
      </div>
      <div className="pbody">
        <div className="pnl-equity">
          {hasCurve ? (
            <LineChart values={equityValues} height={90} id="equity" />
          ) : (
            <div className="chart-empty">awaiting equity history</div>
          )}
        </div>
        <div className="pnl-rows" style={{ display: "flex", flexDirection: "column", gap: 0, marginTop: 8 }}>
          {strategists.map((s) => {
            const p = pnlByStrategist[s.slug];
            const day = p?.dayPnl ?? 0;
            return (
              <div className="stat" key={s.slug}>
                <span className="k" style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: PM_VAR[s.color],
                      boxShadow: `0 0 6px ${PM_VAR[s.color]}`,
                    }}
                  />
                  {s.name}
                </span>
                <span className={`v num ${day < 0 ? "neg" : "pos"}`}>{signedUsd(day)}</span>
              </div>
            );
          })}
          <div className="stat" style={{ borderTop: "1px solid var(--border-bright)" }}>
            <span className="k" style={{ fontWeight: 600, color: "var(--text)" }}>
              Fund (day)
            </span>
            <span className={`v num ${fundPnl.dayPnl < 0 ? "neg" : "pos"}`}>
              {signedUsd(fundPnl.dayPnl)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
