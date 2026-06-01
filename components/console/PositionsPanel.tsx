"use client";

import { signedUsd } from "@/lib/format";
import type { PmColor, Position, StrategistState } from "@/lib/desk/types";

const PM_VAR: Record<PmColor, string> = {
  green: "var(--pm-green)",
  blue: "var(--pm-blue)",
  amber: "var(--pm-amber)",
  cyan: "var(--pm-cyan)",
};

const hhmm = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "";

// Reuses the monitor's .panel / table CSS (globals.css).
export function PositionsPanel({
  positions,
  strategists,
  recentTrades = [],
}: {
  positions: Position[];
  strategists: StrategistState[];
  /** Today's closed trades (newest first) — so fast scalps are visible. */
  recentTrades?: Position[];
}) {
  const colorOf = (slug: string) =>
    PM_VAR[strategists.find((s) => s.slug === slug)?.color ?? "green"];
  const realizedToday = recentTrades.reduce((a, t) => a + (t.realized_pnl ?? 0), 0);

  return (
    <div className="panel">
      <div className="phead">
        <span className="t">Open Positions</span>
        <span className="x">{positions.length} legs</span>
      </div>
      <div className="table-scroll table-scroll--fit">
        <table>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>PM</th>
              <th style={{ textAlign: "left" }}>Contract</th>
              <th>Qty</th>
              <th>Entry</th>
              <th>Mark</th>
              <th>Unreal P&amp;L</th>
            </tr>
          </thead>
          <tbody>
          {positions.length === 0 ? (
            <tr>
              <td colSpan={6}>
                <div className="empty-state">
                  <span className="es-dot" />
                  <span>flat — no open positions</span>
                  <span className="es-sub">desk is idle</span>
                </div>
              </td>
            </tr>
          ) : (
            positions.map((p) => (
              <tr key={p.id}>
                <td style={{ textAlign: "left" }}>
                  <span
                    style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: colorOf(p.strategist_slug),
                      boxShadow: `0 0 6px ${colorOf(p.strategist_slug)}`,
                    }}
                  />
                </td>
                <td style={{ textAlign: "left" }}>
                  {p.strike.toFixed(0)}
                  {p.opt_type === "call" ? "C" : "P"}
                </td>
                <td>{p.qty > 0 ? `+${p.qty}` : p.qty}</td>
                <td>{p.avg_entry_price.toFixed(2)}</td>
                <td>{p.current_mark.toFixed(2)}</td>
                <td className={p.unrealized_pnl < 0 ? "neg" : "pos"}>
                  {signedUsd(p.unrealized_pnl)}
                </td>
              </tr>
            ))
          )}
          </tbody>
        </table>
      </div>

      {recentTrades.length > 0 && (
        <div className="recent-trades">
          <div className="rt-head">
            <span>Today&apos;s trades</span>
            <span className={realizedToday < 0 ? "neg" : "pos"}>
              realized {signedUsd(realizedToday)} · {recentTrades.length}
            </span>
          </div>
          <div className="rt-list">
            {recentTrades.slice(0, 8).map((t) => (
              <div className="rt-row" key={t.id}>
                <span className="rt-dot" style={{ background: colorOf(t.strategist_slug), boxShadow: `0 0 5px ${colorOf(t.strategist_slug)}` }} />
                <span className="rt-sym">{t.strike.toFixed(0)}{t.opt_type === "call" ? "C" : "P"} ×{t.qty}</span>
                <span className="rt-time">{hhmm(t.closed_at)}</span>
                <span className={`rt-pnl ${(t.realized_pnl ?? 0) < 0 ? "neg" : "pos"}`}>{signedUsd(t.realized_pnl ?? 0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
