"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useFold } from "@/hooks/useFold";
import { signedUsd } from "@/lib/format";
import { useTradeInsight } from "@/hooks/useTradeInsight";
import { useTradeTriggers } from "@/hooks/useTradeTriggers";
import { usePositionPeaks } from "@/hooks/usePositionPeaks";
import { useDeskWrite } from "@/hooks/useDeskWrite";
import { MANUAL_CLOSE_REASONS } from "@/lib/positions/manualClose";
import { useChangeFlash } from "@/hooks/useChangeFlash";
import type { Position, StrategistState } from "@/lib/desk/types";
import { pmVar } from "@/lib/desk/colors";
import { isManualChannel } from "@/lib/desk/manual";

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

const inTradeStr = (opened?: string | null): string => {
  if (!opened) return "";
  const m = Math.round((Date.now() - Date.parse(opened)) / 60000);
  if (!isFinite(m) || m < 0) return "";
  return m < 1 ? "<1m in" : m < 60 ? `${m}m in` : `${Math.floor(m / 60)}h ${m % 60}m in`;
};

// Unreal P&L cell — flashes on a material move (±$10) so an exit-worthy tick
// catches the eye without leaving the chart. The number itself never tweens
// (useChangeFlash rationale); at rest the cell is byte-identical to before.
function PnlCell({ unreal }: { unreal: number }) {
  const flashRef = useChangeFlash<HTMLTableCellElement>(unreal);
  return (
    <td ref={flashRef} className={unreal < 0 ? "neg" : "pos"}>
      {signedUsd(unreal)}
    </td>
  );
}

// Reuses the monitor's .panel / table CSS (globals.css).
export function PositionsPanel({
  positions,
  strategists,
  recentTrades = [],
  liveMarks,
  onOpenTrade,
  loading: syncing = false,
}: {
  positions: Position[];
  strategists: StrategistState[];
  /** Today's closed trades (newest first) — so fast scalps are visible. */
  recentTrades?: Position[];
  /** True until the feed's first fetch lands — shows "syncing" instead of a
   *  false "flat — desk is idle" flash on load. */
  loading?: boolean;
  /** occ_symbol → live mid from the option chain. When present, Mark + Unreal
   *  P&L are computed live off the chain instead of the worker's last write
   *  (which only updates ~once a minute, and not at all for orphaned rows). */
  liveMarks?: Record<string, number>;
  /** Expand/collapse of a Today's-trade row — the surface uses it to highlight
   *  that fill on the chart (null when collapsed). */
  onOpenTrade?: (trade: Position | null) => void;
}) {
  const [folded, toggleFold] = useFold("book");
  const colorOf = (slug: string) =>
    pmVar(strategists.find((s) => s.slug === slug)?.color ?? "green");
  const nameOf = (slug: string) => strategists.find((s) => s.slug === slug)?.name ?? slug;
  const triggers = useTradeTriggers(recentTrades);
  const realizedToday = recentTrades.reduce((a, t) => a + (t.realized_pnl ?? 0), 0);
  // Peak premium since entry per held contract — feeds the giveback read below
  // (the number the operator's manual exits actually run on).
  const peaks = usePositionPeaks(positions, liveMarks);

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

  // Manual close (signed-in only). Tapping ✕ ARMS a confirm (✓ + a cancel ✕); you
  // can always back out — explicit cancel, OR it auto-disarms after 4s. Only the
  // explicit ✓ sells. The row drops from `positions` on the next feed refresh.
  const { canWrite, closePosition, tagClose } = useDeskWrite();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closeErr, setCloseErr] = useState<string | null>(null);
  // Close-reason chips (31_close_reason.sql): offered AFTER a successful close —
  // the fill is already booked, so tagging adds zero friction to the exit itself.
  // Untagged stays 'manual'; a tap refines it to 'manual:<tag>'. The vocabulary is
  // the exit-study's: target (banked the pop) / reversal (tape turned) / risk
  // (defensive cut) / stall (no follow-through).
  const [tagPrompt, setTagPrompt] = useState<{ id: string; label: string } | null>(null);
  const [tagging, setTagging] = useState(false);
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearDisarm = () => { if (disarmTimer.current) { clearTimeout(disarmTimer.current); disarmTimer.current = null; } };
  useEffect(() => () => clearDisarm(), []); // clear on unmount
  const arm = (id: string) => {
    setCloseErr(null);
    setConfirmId(id);
    clearDisarm();
    disarmTimer.current = setTimeout(() => setConfirmId((cur) => (cur === id ? null : cur)), 4000);
  };
  const cancelClose = () => { clearDisarm(); setConfirmId(null); };
  const confirmClose = async (id: string) => {
    clearDisarm();
    setConfirmId(null);
    setClosingId(id);
    setCloseErr(null);
    const p = positions.find((x) => x.id === id); // capture before the row leaves the feed
    const res = await closePosition(id);
    setClosingId(null);
    if (!res.ok) setCloseErr(res.error ?? "close failed");
    else setTagPrompt({ id, label: p ? `${p.strike.toFixed(0)}${p.opt_type === "call" ? "C" : "P"}` : "position" });
  };
  const applyTag = async (tag: string) => {
    if (!tagPrompt) return;
    setTagging(true);
    const result = await tagClose(tagPrompt.id, tag);
    setTagging(false);
    if (!result.ok) { setCloseErr(result.error ?? "reason tag failed"); return; }
    setTagPrompt(null);
  };

  return (
    <div className="panel">
      <div className="phead">
        <span className="t">Open Positions</span>
        <span className="x">
          {anyLive && <span className="live-dot" title="mark + P&L live from the option chain" />}
          {positions.length} legs
        </span>
        <button type="button" className="pfold" onClick={toggleFold} aria-expanded={!folded} title={folded ? "expand" : "collapse"}>{folded ? "▸" : "▾"}</button>
      </div>
      {!folded && (<>
      <div className="table-scroll table-scroll--fit">
        <table>
          {/* pinned widths (+ table-layout:fixed) — live ticks can't reflow the table */}
          <colgroup>
            <col style={{ width: 30 }} />
            <col />
            <col style={{ width: 50 }} />
            <col style={{ width: 64 }} />
            <col style={{ width: 64 }} />
            <col style={{ width: 92 }} />
            {canWrite && <col style={{ width: 42 }} />}
          </colgroup>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>PM</th>
              <th style={{ textAlign: "left" }}>Contract</th>
              <th>Qty</th>
              <th>Entry</th>
              <th>Mark</th>
              <th>Unreal P&amp;L</th>
              {canWrite && <th aria-label="close" />}
            </tr>
          </thead>
          <tbody>
          {positions.length === 0 ? (
            <tr>
              <td colSpan={canWrite ? 7 : 6}>
                <div className="empty-state">
                  <span className="es-dot" />
                  <span>{syncing ? "syncing book…" : "flat — no open positions"}</span>
                  <span className="es-sub">{syncing ? "loading positions" : "desk is idle"}</span>
                </div>
              </td>
            </tr>
          ) : (
            positions.map((p) => {
              const { mark, unreal } = live(p);
              // Decision context: where the trade IS in its lifecycle. ret% off
              // entry; peak/giveback when it has been in profit (giveback ≥50%
              // of the peak gain lights amber — the manual-exit trigger); the
              // −50% catastrophic stop level for distance-at-a-glance.
              const entry = p.avg_entry_price;
              const retPct = entry > 0 && mark > 0 ? ((mark - entry) / entry) * 100 : null;
              const peak = peaks[p.occ_symbol] ?? 0;
              const peakPct = entry > 0 && peak > entry ? ((peak - entry) / entry) * 100 : null;
              const gavePct = peakPct != null && mark < peak ? Math.min(999, ((peak - mark) / (peak - entry)) * 100) : null;
              const stopPx = entry * 0.5;
              return (
              <Fragment key={p.id}>
              <tr className="pos-main">
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
                  {isManualChannel(p.strategist_slug) && (
                    <span
                      title="manual-exit twin — yours to close"
                      style={{ marginLeft: 5, fontSize: 9, fontWeight: 700, color: "var(--amber, #d9b54a)", letterSpacing: 0.3, verticalAlign: "middle" }}
                    >✋MAN</span>
                  )}
                </td>
                <td>{p.qty > 0 ? `+${p.qty}` : p.qty}</td>
                <td>{p.avg_entry_price.toFixed(2)}</td>
                <td>{mark.toFixed(2)}</td>
                <PnlCell unreal={unreal} />
                {canWrite && (
                  <td className="pos-act">
                    {closingId === p.id ? (
                      <span className="pos-closing" title="closing…">…</span>
                    ) : confirmId === p.id ? (
                      <span className="pos-confirm">
                        <button className="pos-close armed" onClick={() => confirmClose(p.id)} title="confirm market close" aria-label="confirm close">✓</button>
                        <button className="pos-cancel" onClick={cancelClose} title="cancel" aria-label="cancel close">✕</button>
                      </span>
                    ) : (
                      <button
                        className="pos-close"
                        onClick={() => arm(p.id)}
                        title="close position (market sell)"
                        aria-label={`close ${p.strike.toFixed(0)}${p.opt_type === "call" ? "C" : "P"}`}
                      >
                        ✕
                      </button>
                    )}
                  </td>
                )}
              </tr>
              <tr className="pos-ctx">
                <td colSpan={canWrite ? 7 : 6}>
                  <span className="ctx-line">
                    <span className="ctx-bit ctx-ch" title="channel">{nameOf(p.strategist_slug)}</span>
                    {inTradeStr(p.opened_at) && <span className="ctx-bit">{inTradeStr(p.opened_at)}</span>}
                    {retPct != null && (
                      <span className={`ctx-bit ${retPct < 0 ? "neg" : "pos"}`}>{retPct >= 0 ? "+" : ""}{retPct.toFixed(0)}%</span>
                    )}
                    {peakPct != null && (
                      <span className="ctx-bit" title="peak premium since entry">peak +{peakPct.toFixed(0)}%</span>
                    )}
                    {gavePct != null && gavePct >= 5 && (
                      <span className={`ctx-bit${gavePct >= 50 ? " ctx-hot" : ""}`} title="share of the peak gain given back — ≥50% is the manual-exit tell">
                        gave {gavePct.toFixed(0)}%
                      </span>
                    )}
                    <span className="ctx-bit ctx-dim" title="−50% catastrophic premium stop level">stop {stopPx.toFixed(2)}</span>
                  </span>
                </td>
              </tr>
              </Fragment>
              );
            })
          )}
          </tbody>
        </table>
      </div>
      {closeErr && <div className="pos-close-err">close failed — {closeErr}</div>}
      {tagPrompt && (
        <div className="pos-tagbar">
          <span className="tb-lbl">{tagPrompt.label} closed — why?</span>
          {MANUAL_CLOSE_REASONS.map((reason) => (
            <button key={reason.value} className="tb-chip" disabled={tagging} title={reason.hint} onClick={() => applyTag(reason.value)}>{reason.label}</button>
          ))}
          <button className="tb-x" onClick={() => setTagPrompt(null)} title="skip — stays untagged" aria-label="dismiss tag chips">✕</button>
        </div>
      )}

      {recentTrades.length > 0 && (
        <div className="recent-trades">
          <div className="rt-head">
            <span>Today&apos;s trades</span>
            <span
              className={realizedToday < 0 ? "neg" : "pos"}
              title="Σ per-channel fill-net realized = ATTRIBUTION. Channels sharing a netted contract make per-channel rows approximate — Fund (today) on the NAV is the headline truth."
            >
              attribution {signedUsd(realizedToday)} · {recentTrades.length}
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
                          {/* the avg-peak lens per trade: best mark since entry + how fast it printed (peak_mark/peak_at, A7) */}
                          {(() => {
                            const pk = t.peak_mark != null ? Number(t.peak_mark) : null;
                            if (pk == null || !(entry > 0) || pk <= entry) return null;
                            const pkPct = ((pk - entry) / entry) * 100;
                            const ttp = t.peak_at && t.opened_at ? Math.max(0, Math.round((Date.parse(t.peak_at) - Date.parse(t.opened_at)) / 60000)) : null;
                            const gave = pk > entry && exit < pk ? Math.min(999, Math.round(((pk - exit) / (pk - entry)) * 100)) : 0;
                            return (
                              <span className={`rtd-dim rtd-peak${gave >= 50 ? " rtd-peak--hot" : ""}`}
                                title={`peaked $${pk.toFixed(2)}${ttp != null ? ` after ${ttp}m` : ""} · exit kept ${100 - gave}% of the peak gain`}>
                                peak +{pkPct.toFixed(0)}%{ttp != null ? ` @${ttp}m` : ""}{gave >= 50 ? ` · gave ${gave}%` : ""}
                              </span>
                            );
                          })()}
                          {(t.close_reason || insight?.exitReason) && (
                            <span className="rtd-exit">
                              {t.close_reason
                                ? (t.close_reason.startsWith("manual") ? `✋ ${t.close_reason.replace(/^manual:?/, "") || "manual"}` : t.close_reason)
                                : insight!.exitReason}
                            </span>
                          )}
                          <span className={realized < 0 ? "neg" : "pos"}>{signedUsd(realized)} · {retPct >= 0 ? "+" : ""}{retPct.toFixed(0)}% · {R >= 0 ? "+" : ""}{R.toFixed(1)}R</span>
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {/* the tooltip caveat, visible where tooltips don't exist (touch) */}
          <div className="rt-note">Σ per-channel fill-net = attribution; shared-strike rows are approximate — Fund (NAV) is the headline truth.</div>
        </div>
      )}
      </>)}
    </div>
  );
}
