"use client";

import { useState } from "react";
import { signedUsd } from "@/lib/format";
import { useTradeInsight } from "@/hooks/useTradeInsight";
import { useTradeTriggers } from "@/hooks/useTradeTriggers";
import type { Position, StrategistState } from "@/lib/desk/types";
import { pmVar } from "@/lib/desk/colors";

// Rationale → readable chips (only the features that are present).
function tradeChips(r?: Record<string, unknown> | null): string[] {
  if (!r) return [];
  const num = (k: string) => (typeof r[k] === "number" && isFinite(r[k] as number) ? (r[k] as number) : undefined);
  const out: string[] = [];
  if (num("atr") != null) out.push(`ATR ${num("atr")!.toFixed(2)}`);
  if (num("er") != null) out.push(`ER ${num("er")!.toFixed(2)}`);
  if (num("relVol") != null) out.push(`vol ${num("relVol")!.toFixed(1)}×`);
  if (num("delta") != null) out.push(`δ ${num("delta")!.toFixed(2)}`);
  if (num("expectedMove") != null && num("roundTrip") != null) out.push(`move $${num("expectedMove")!.toFixed(0)} vs cost $${num("roundTrip")!.toFixed(0)}`);
  return out;
}
const holdStr = (o?: string | null, c?: string | null): string => {
  if (!o || !c) return "";
  const m = Math.round((Date.parse(c) - Date.parse(o)) / 60000);
  if (!isFinite(m) || m < 0) return "";
  return m < 1 ? "<1m" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

const hhmm = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "";

// Reuses the monitor's .panel / table CSS (globals.css).
export function PositionsPanel({
  positions,
  strategists,
  recentTrades = [],
  liveMarks,
  onOpenTrade,
}: {
  positions: Position[];
  strategists: StrategistState[];
  /** Today's closed trades (newest first) — so fast scalps are visible. */
  recentTrades?: Position[];
  /** occ_symbol → live mid from the option chain. When present, Mark + Unreal
   *  P&L are computed live off the chain instead of the worker's last write
   *  (which only updates ~once a minute, and not at all for orphaned rows). */
  liveMarks?: Record<string, number>;
  /** Expand/collapse of a Today's-trade row — the surface uses it to highlight
   *  that fill on the chart (null when collapsed). */
  onOpenTrade?: (trade: Position | null) => void;
}) {
  const colorOf = (slug: string) =>
    pmVar(strategists.find((s) => s.slug === slug)?.color ?? "green");
  const nameOf = (slug: string) => strategists.find((s) => s.slug === slug)?.name ?? slug;
  const triggers = useTradeTriggers(recentTrades);
  const realizedToday = recentTrades.reduce((a, t) => a + (t.realized_pnl ?? 0), 0);

  // Live mark for a position if the chain has a fresh quote; else the stored mark.
  const live = (p: Position): { mark: number; unreal: number; isLive: boolean } => {
    const m = liveMarks?.[p.occ_symbol];
    if (m != null && Number.isFinite(m) && m > 0) {
      return { mark: m, unreal: (m - p.avg_entry_price) * p.qty * 100, isLive: true };
    }
    return { mark: p.current_mark, unreal: p.unrealized_pnl, isLive: false };
  };
  const anyLive = positions.some((p) => live(p).isLive);

  // Click-to-drill-down on a recent trade: one expanded at a time; its trigger +
  // exit reason are fetched lazily (useTradeInsight); performance is from the row.
  const [openId, setOpenId] = useState<string | null>(null);
  const openTrade = recentTrades.find((t) => t.id === openId) ?? null;
  const { insight, loading } = useTradeInsight(openTrade);

  return (
    <div className="panel panel--screws">
      <div className="phead">
        <span className="t">Open Positions</span>
        <span className="x">
          {anyLive && <span className="live-dot" title="mark + P&L live from the option chain" />}
          {positions.length} legs
        </span>
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
            positions.map((p) => {
              const { mark, unreal } = live(p);
              return (
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
                <td>{mark.toFixed(2)}</td>
                <td className={unreal < 0 ? "neg" : "pos"}>
                  {signedUsd(unreal)}
                </td>
              </tr>
              );
            })
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
            {recentTrades.map((t) => {
              const open = t.id === openId;
              const entry = t.avg_entry_price, exit = t.current_mark, realized = t.realized_pnl ?? 0;
              const retPct = entry > 0 ? ((exit - entry) / entry) * 100 : 0;
              const risk = 0.5 * entry * Math.abs(t.qty) * 100;       // R = the −50% premium risk
              const R = risk > 0 ? realized / risk : 0;
              const chips = open ? tradeChips(insight?.trigger?.rationale) : [];
              return (
                <div key={t.id}>
                  <button
                    className={`rt-row${open ? " open" : ""}`}
                    onClick={() => { const next = open ? null : t.id; setOpenId(next); onOpenTrade?.(next ? t : null); }}
                    aria-expanded={open}
                  >
                    <span className="rt-dot" style={{ background: colorOf(t.strategist_slug), boxShadow: `0 0 5px ${colorOf(t.strategist_slug)}` }} />
                    <span className="rt-sym">{t.strike.toFixed(0)}{t.opt_type === "call" ? "C" : "P"} ×{t.qty}</span>
                    <span className="rt-meta">
                      <span className="rt-ch">{nameOf(t.strategist_slug)}</span>
                      {triggers[`${t.strategist_slug}|${t.occ_symbol}`] && (
                        <span className="rt-trig" title={triggers[`${t.strategist_slug}|${t.occ_symbol}`]}>
                          {triggers[`${t.strategist_slug}|${t.occ_symbol}`].replace(/_/g, " ")}
                        </span>
                      )}
                    </span>
                    <span className="rt-time">{hhmm(t.closed_at)}</span>
                    <span className={`rt-pnl ${realized < 0 ? "neg" : "pos"}`}>{signedUsd(realized)}</span>
                    <span className="rt-caret">{open ? "▾" : "▸"}</span>
                  </button>
                  {open && (
                    <div className="rt-detail">
                      <div className="rtd-sec">
                        <span className="rtd-lbl">trigger</span>
                        {loading && !insight ? (
                          <span className="rtd-dim">loading…</span>
                        ) : insight?.trigger ? (
                          <span className="rtd-line">
                            <b className="rtd-sig">{insight.trigger.signal_type}</b>
                            {insight.trigger.direction && <span className={`rtd-dir rtd-${insight.trigger.direction}`}>{insight.trigger.direction}</span>}
                            {insight.trigger.underlying_price != null && <span className="rtd-dim">SPY ${insight.trigger.underlying_price.toFixed(2)}</span>}
                          </span>
                        ) : (
                          <span className="rtd-dim">no matching signal in window</span>
                        )}
                        {chips.length > 0 && <span className="rtd-chips">{chips.map((c) => <span key={c} className="rtd-chip">{c}</span>)}</span>}
                      </div>
                      <div className="rtd-sec">
                        <span className="rtd-lbl">result</span>
                        <span className="rtd-line">
                          <span className="rtd-perf">${entry.toFixed(2)} → ${exit.toFixed(2)}</span>
                          {holdStr(t.opened_at, t.closed_at) && <span className="rtd-dim">held {holdStr(t.opened_at, t.closed_at)}</span>}
                          {insight?.exitReason && <span className="rtd-exit">{insight.exitReason}</span>}
                          <span className={realized < 0 ? "neg" : "pos"}>{signedUsd(realized)} · {retPct >= 0 ? "+" : ""}{retPct.toFixed(0)}% · {R >= 0 ? "+" : ""}{R.toFixed(1)}R</span>
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
