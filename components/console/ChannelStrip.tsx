"use client";

import { memo, useRef, useState } from "react";
import { Knob } from "@/components/console/hw/Knob";
import { Fader } from "@/components/console/hw/Fader";
import { LedMeter } from "@/components/console/hw/LedMeter";
import { PadButton } from "@/components/console/hw/PadButton";
import { useDeskDispatch } from "@/hooks/useDeskState";
import { useDeskWrite } from "@/hooks/useDeskWrite";
import { signedUsd, usd0 } from "@/lib/format";
import type { ChannelPnl, PmColor, StrategistState } from "@/lib/desk/types";
import { PM_COLORS, pmVar } from "@/lib/desk/colors";

export interface ChannelStripProps {
  strategist: StrategistState;
  pnl: ChannelPnl | undefined;
  active: boolean; // effectively trading right now
  ducked: boolean; // dimmed because another channel is soloed
  mobile?: boolean; // phone: 4 knobs in a row, each with an LED volume meter
  /** dnd-kit drag handle props (listeners + attributes) — desktop composer only.
   *  Spread onto the grip so ONLY the grip starts a drag (knobs stay interactive). */
  dragHandle?: Record<string, unknown>;
  dragging?: boolean; // lifted while being dragged
  /** Mobile grid: render the condensed overview card (no draggable knobs — values as
   *  read-only meters). Tapping the card body calls onExpand to open the full strip. */
  compact?: boolean;
  onExpand?: () => void;
}

// Compact-card Risk/Stop meter fill: a GLOBAL green→red heat by AMOUNT (not the channel's
// swatch) — low = green (safe), high = red (hot). hue 130 (green) → 0 (red).
const meterColor = (f: number) => `hsl(${Math.round(130 * (1 - Math.max(0, Math.min(1, f))))} 72% 48%)`;

// The ONLY channels the worker pyramids (decide.ts PYRAMID_SLUGS) — the validated convex tail
// (pyramid-roster-faithful). The pyramid control is shown only here; elsewhere it's a no-op.
const PYRAMID_ELIGIBLE = new Set(["breakout-alt-v3", "breakout-smart-entries"]);
// The validated cap12 arm = add up to 3 lots + a 12-contract total-stack cap.
const PYRAMID_ADDS_ON = 3;
const PYRAMID_CAP = 12;

// An inline-editable pill for the FIRES readout — click to set the value as a plain
// number (the worker's real TP / stop %). Read-only span when signed out (identical
// to the static readout). Commit on Enter/blur, Esc cancels, ↑/↓ nudge by 1.
export function FiresPill({
  value, display, onCommit, min, max, className, canWrite, label, title, maxDigits = 3,
}: {
  value: number;
  display: string; // read-mode text, e.g. "+22%" / "ride" / "−30%"
  onCommit: (v: number) => void;
  min: number;
  max: number;
  className: string; // "chf-take" | "chf-ride" | "chf-stop"
  canWrite: boolean;
  label: string;
  title: string;
  maxDigits?: number; // digit cap for the edit input (3 for %, more for $ fields)
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (!canWrite) return <span className={`chf ${className}`} title={title}>{display}</span>;

  if (!editing) {
    return (
      <button
        type="button"
        className={`chf chf-edit ${className}`}
        title={`${title} — click to set`}
        aria-label={`${label}: ${display}. Click to edit.`}
        onClick={(e) => { e.stopPropagation(); setDraft(String(value)); setEditing(true); }}
      >
        {display}
      </button>
    );
  }

  const commit = () => {
    setEditing(false);
    const t = draft.trim();
    if (t === "") return; // empty = cancel (never silently zero a stop)
    const n = Math.round(Number(t));
    if (!Number.isFinite(n)) return;
    const clamped = Math.max(min, Math.min(max, n));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <input
      className={`chf chf-input ${className}`}
      type="text"
      inputMode="numeric"
      autoFocus
      size={maxDigits}
      value={draft}
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, "").slice(0, maxDigits))}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        else if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setDraft(String(Math.min(max, (Number(draft) || 0) + 1))); }
        else if (e.key === "ArrowDown") { e.preventDefault(); setDraft(String(Math.max(min, (Number(draft) || 0) - 1))); }
      }}
    />
  );
}

// The trade's SHAPE, to scale — a red stop zone (left of entry) + a green target zone
// (right of entry), widths proportional to the premium stop / take %. Seeing the two
// side-by-side makes the per-trade risk:reward legible (e.g. −30% risked vs +22% target).
// Drag a handle to set the value (the same tp / premium_stop the pills edit); no take =
// no green zone (riding). Read-only visual when signed out (no handles).
const SHAPE_FULL = 100; // the % that fills half the track (visual scale; larger values clamp)
export function TradeShapeBar({
  tp, premStop, canWrite, onChange, onCommit,
}: {
  tp: number;
  premStop: number;
  canWrite: boolean;
  onChange: (patch: { take_profit_pct?: number; premium_stop_pct?: number }) => void;
  onCommit: (patch: { take_profit_pct?: number; premium_stop_pct?: number }) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const drag = useRef<null | "tp" | "stop">(null);
  const live = useRef<{ take_profit_pct?: number; premium_stop_pct?: number } | null>(null);
  const tpFrac = Math.min(1, tp / SHAPE_FULL);
  const stopFrac = Math.min(1, premStop / SHAPE_FULL);

  const valueFromX = (clientX: number, side: "tp" | "stop") => {
    const el = ref.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const center = r.left + r.width / 2;
    const half = r.width / 2 || 1;
    const frac = side === "tp" ? (clientX - center) / half : (center - clientX) / half;
    return Math.round(Math.max(0, Math.min(1, frac)) * SHAPE_FULL);
  };
  const start = (side: "tp" | "stop") => (e: React.PointerEvent) => {
    if (!canWrite) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = side;
  };
  const move = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const v = valueFromX(e.clientX, drag.current);
    if (drag.current === "tp") { live.current = { take_profit_pct: v }; onChange({ take_profit_pct: v }); }
    else { const s = Math.max(10, Math.min(90, v)); live.current = { premium_stop_pct: s }; onChange({ premium_stop_pct: s }); }
  };
  const end = (e: React.PointerEvent) => {
    if (drag.current && live.current) onCommit(live.current);
    drag.current = null;
    live.current = null;
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };

  const rr = tp > 0 ? (tp / premStop).toFixed(2) : null; // reward-to-risk, per-trade
  return (
    <div className="ch-shape" title={tp > 0 ? `per-trade shape — risk −${premStop}% to make +${tp}% (${rr}R)` : `per-trade shape — riding (no target), risk −${premStop}%`}>
      <div className="shp-track" ref={ref}>
        <div className="shp-stop" style={{ width: `${stopFrac * 50}%` }} />
        <div className="shp-take" style={{ width: `${tpFrac * 50}%` }} />
        <div className="shp-entry" />
      </div>
      {canWrite && (
        <>
          <button type="button" className="shp-h shp-h-stop" style={{ left: `${50 - stopFrac * 50}%` }}
            onPointerDown={start("stop")} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
            title="drag to set the stop %" aria-label={`stop ${premStop}%, drag to change`} />
          <button type="button" className="shp-h shp-h-take" style={{ left: `${50 + tpFrac * 50}%` }}
            onPointerDown={start("tp")} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
            title="drag to set the take-profit % (all the way to entry = ride)" aria-label={`take ${tp}%, drag to change`} />
        </>
      )}
      <span className="shp-rr">{rr ? `${rr}R` : "ride"}</span>
    </div>
  );
}

function ChannelStripImpl({ strategist, pnl, active, ducked, mobile, dragHandle, dragging, compact, onExpand }: ChannelStripProps) {
  const dispatch = useDeskDispatch();
  const {
    persistConfig,
    renameChannel,
    setChannelAccent,
    setChannelStatus,
    setChannelExecutor,
    duplicateChannel,
    deleteChannel,
    canDirectConfigure: canWrite,
  } = useDeskWrite();
  const { id, slug, underlying, name, regime, color, status, config } = strategist;
  const executor = strategist.executor ?? "cron";
  const ustop = config.underlying_stop_pct ?? 0;
  const dte = config.entry_dte ?? 0;
  const eventPolicy = config.event_policy ?? "standdown";
  const tp = config.take_profit_pct ?? 0;
  const premStop = config.premium_stop_pct ?? 50; // the binding downside (policy default −50); has no knob today
  const ustopInert = ustop > 0 && ustop * 180 >= premStop; // 0.5% ≈ −90% premium → the −premStop% premium stop fires first
  const pyr = config.pyramid_adds ?? 0;
  const pyrEligible = PYRAMID_ELIGIBLE.has(slug);
  const boosted = config.boosted ?? false; // BOOST: 2× sizing for the day (replaces SOLO)

  // Flip-card editor: rename + delete. Opens an overlay over the card.
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState(false); // play the flip-OUT before unmounting
  const [draftName, setDraftName] = useState(name);
  const [confirmDel, setConfirmDel] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);
  const [editMsg, setEditMsg] = useState<string | null>(null); // success feedback (duplicate)
  const [dupBusy, setDupBusy] = useState(false);

  const openEdit = () => { setDraftName(name); setConfirmDel(false); setEditErr(null); setClosing(false); setEditing(true); };
  // Flip back to the front (animate, THEN unmount) — keeps it mounted for the
  // 0.3s ch-flip-out so it doesn't just flash away.
  const closeEdit = () => { setClosing(true); window.setTimeout(() => { setEditing(false); setClosing(false); }, 300); };
  const saveName = async () => {
    const nm = draftName.trim();
    if (!nm || nm === name) return;
    dispatch({ type: "RENAME", slug, name: nm });
    const res = await renameChannel(id, nm);
    if (!res.ok) setEditErr(res.error ?? "rename failed");
  };
  const doDelete = async () => {
    const res = await deleteChannel(id);
    if (res.ok) { setEditing(false); dispatch({ type: "REMOVE", slug }); }
    else { setConfirmDel(false); setEditErr(res.error ?? "remove failed"); }
  };
  // Bench ⇄ re-arm (the 86'd shelf): draft = no entries, open positions wind down.
  // Optimistic; on a failed write the status snaps back.
  const toggleBench = async () => {
    const next = status === "armed" ? "draft" : "armed";
    dispatch({ type: "SET_STATUS", slug, status: next });
    const res = await setChannelStatus(id, next);
    if (!res.ok) { dispatch({ type: "SET_STATUS", slug, status }); setEditErr(res.error ?? "status change failed"); }
  };
  const recolor = async (c: PmColor) => {
    if (c === color) return;
    dispatch({ type: "RECOLOR", slug, color: c }); // optimistic
    const res = await setChannelAccent(id, c);
    if (!res.ok) setEditErr(res.error ?? "recolor failed");
  };
  // Duplicate → a DRAFT clone (the A/B primitive). The realtime sub brings the copy onto the
  // bench; the operator then tweaks the copy (DTE / U-stop) and arms both for the head-to-head.
  const doDuplicate = async () => {
    setEditErr(null); setEditMsg(null); setDupBusy(true);
    const res = await duplicateChannel(id);
    setDupBusy(false);
    if (res.ok) setEditMsg(`✓ ${res.name} — drafted on the bench. Tweak DTE / U-stop, then arm both.`);
    else setEditErr(res.error ?? "duplicate failed");
  };
  // Live-attribute setters (the new strip controls). Each is optimistic (dispatch) +
  // an auth-gated persist; both the cron and stream worker read these every cycle.
  const flipExecutor = async () => {
    const next = executor === "stream" ? "cron" : "stream";
    dispatch({ type: "SET_EXECUTOR", slug, executor: next });
    const res = await setChannelExecutor(id, next);
    if (!res.ok) { dispatch({ type: "SET_EXECUTOR", slug, executor }); setEditErr(res.error ?? "executor change failed"); }
  };
  const setCfg = (patch: Partial<typeof config>) => { dispatch({ type: "SET_CONFIG", slug, patch }); persistConfig(id, patch); };

  // ---- STATUS LIGHTS (read-only observability) — the dynamic state of a live channel.
  const inTrade = (pnl?.openCount ?? 0) > 0;
  const atStop = config.daily_stop_usd > 0 && (pnl?.dayPnl ?? 0) <= -config.daily_stop_usd;
  const lights = (
    <div className="ch-lights" aria-label="channel state">
      <span className={`chl chl-exec chl-${executor}`} title={`orders placed by the ${executor} worker`}>{executor}</span>
      {dte === 1 && <span className="chl chl-dte" title="enters next-session (1DTE) expiry">1DTE</span>}
      {ustop > 0 && <span className={`chl chl-us${ustopInert ? " chl-inert" : ""}`} title={ustopInert ? `u-stop ${ustop}% never fires — the −${premStop}% premium stop hits first` : `underlying stop ${ustop}%`}>uS {ustop}%{ustopInert ? " ·off" : ""}</span>}
      {eventPolicy === "ignore" && <span className="chl chl-evt" title="ignores scheduled-event stand-downs (event-native)">evt:ignore</span>}
      {pyr > 0 && <span className="chl chl-pyr" title={`pyramiding: adds up to ${pyr} lot(s) to a winner, stack capped at ${config.max_contracts}`}>PYR ×{pyr}</span>}
      {inTrade && <span className="chl chl-live" title={`${pnl?.openCount} open position(s)`}>● in trade</span>}
      {atStop && <span className="chl chl-stop" title="day P&L at/through the STOP — entries halted">STOP</span>}
    </div>
  );

  // Exit MODE — the matched TP+stop pair as one control. LOCK = take profit + a tight
  // −30% stop (the find-and-surrender book); RIDE = no take + a loose −50% stop (let the
  // convex tail run, e.g. MOMO). Read from whether a take is set; picking a mode writes
  // BOTH values so the pair always stays coherent, and the pills fine-tune from there.
  const exitMode = tp > 0 ? "lock" : "ride";
  const applyLock = () => {
    const nextTp = tp > 0 ? tp : 22; // keep a tuned take; else default the canonical directional 22
    if (nextTp !== tp || premStop !== 30) setCfg({ take_profit_pct: nextTp, premium_stop_pct: 30 });
  };
  const applyRide = () => {
    if (tp !== 0 || premStop !== 50) setCfg({ take_profit_pct: 0, premium_stop_pct: 50 });
  };

  // "What fires" — the binding exits in plain terms + (auth) the LOCK/RIDE mode picker.
  // Reads the same config the worker exits on, so what you see is what actually happens.
  const firesReadout = (
    <>
      {canWrite && (
        <div className="ch-mode" role="group" aria-label="exit mode">
          <button type="button" className={`chm chm-lock${exitMode === "lock" ? " on" : ""}`}
            onClick={applyLock} title="LOCK — take profit + a tight −30% stop (find-and-surrender book)">LOCK</button>
          <button type="button" className={`chm chm-ride${exitMode === "ride" ? " on" : ""}`}
            onClick={applyRide} title="RIDE — no take, loose −50% stop (let the convex tail run)">RIDE</button>
        </div>
      )}
      {/* order = stop · take · EOD — left→right matches the shape bar (loss left, gain right) */}
      <div className="ch-fires" title="what actually fires — the binding exits (reads the live worker config)">
        <span className="chf-lbl">fires</span>
        <FiresPill
          value={premStop}
          display={`−${premStop}%`}
          onCommit={(v) => setCfg({ premium_stop_pct: v })}
          min={10}
          max={90}
          className="chf-stop"
          canWrite={canWrite}
          label="premium stop percent"
          title="premium stop % — the binding downside"
        />
        <FiresPill
          value={tp}
          display={tp > 0 ? `+${tp}%` : "ride"}
          onCommit={(v) => setCfg({ take_profit_pct: v })}
          min={0}
          max={300}
          className={tp > 0 ? "chf-take" : "chf-ride"}
          canWrite={canWrite}
          label="take profit percent"
          title="take-profit % (0 = ride)"
        />
        <span className="chf chf-flat">EOD</span>
      </div>
      <TradeShapeBar
        tp={tp}
        premStop={premStop}
        canWrite={canWrite}
        onChange={(patch) => dispatch({ type: "SET_CONFIG", slug, patch })}
        onCommit={(patch) => persistConfig(id, patch)}
      />
    </>
  );

  const editBtn = canWrite ? (
    <button
      type="button"
      className="ch-edit-btn"
      onClick={openEdit}
      title={`edit ${name}`}
      aria-label={`edit ${name}`}
    >
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"
        strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
      </svg>
    </button>
  ) : null;

  const editOverlay = editing ? (
    <div className={`ch-edit${closing ? " closing" : ""}`}>
      <div className="ch-edit-head">Edit · <span className="ch-edit-slug">{slug}</span></div>
      <label className="ch-edit-label">Name</label>
      <input
        className="ch-edit-input"
        value={draftName}
        onChange={(e) => setDraftName(e.target.value)}
        spellCheck={false}
        maxLength={40}
        aria-label="channel name"
      />
      <button className="ch-edit-save" disabled={!draftName.trim() || draftName.trim() === name} onClick={saveName}>
        Save name
      </button>

      <label className="ch-edit-label">Accent</label>
      <div className="ch-edit-accent">
        {PM_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={`ac-swatch${color === c ? " on" : ""}`}
            style={{ background: pmVar(c), color: pmVar(c) }}
            onClick={() => recolor(c)}
            aria-label={`accent ${c}`}
            title={c}
          />
        ))}
      </div>

      <label className="ch-edit-label">Live config</label>
      <div className="ch-edit-cfg">
        <div className="cfg-row">
          <span className="cfg-k" title="which engine places this channel's orders">Executor</span>
          <span className="cfg-seg">
            <button className={executor === "cron" ? "on" : ""} onClick={() => executor !== "cron" && flipExecutor()}>cron</button>
            <button className={executor === "stream" ? "on" : ""} onClick={() => executor !== "stream" && flipExecutor()}>stream</button>
          </span>
        </div>
        <div className="cfg-row">
          <span className="cfg-k" title="0DTE = today's expiry (+cutoff roll); 1DTE = next session's expiry">Entry DTE</span>
          <span className="cfg-seg">
            <button className={dte === 0 ? "on" : ""} onClick={() => dte !== 0 && setCfg({ entry_dte: 0 })}>0DTE</button>
            <button className={dte === 1 ? "on" : ""} onClick={() => dte !== 1 && setCfg({ entry_dte: 1 })}>1DTE</button>
          </span>
        </div>
        <div className="cfg-row">
          <span className="cfg-k" title="scheduled-event (FOMC) posture: stand down vs trade through">Events</span>
          <span className="cfg-seg">
            <button className={eventPolicy === "standdown" ? "on" : ""} onClick={() => eventPolicy !== "standdown" && setCfg({ event_policy: "standdown" })}>stand-down</button>
            <button className={eventPolicy === "ignore" ? "on" : ""} onClick={() => eventPolicy !== "ignore" && setCfg({ event_policy: "ignore" })}>ignore</button>
          </span>
        </div>
        <div className="cfg-row">
          <span className="cfg-k" title="underlying stop %: exit when the underlying moves this % against entry (0 = off)">U-stop %</span>
          <input className="cfg-num" type="number" inputMode="decimal" min={0} max={2} step={0.05} value={ustop}
            onChange={(e) => setCfg({ underlying_stop_pct: Math.max(0, Math.min(2, Number(e.target.value) || 0)) })} aria-label="underlying stop percent" />
        </div>
        <div className="cfg-row">
          <span className="cfg-k" title="take-profit %: exit at +this % of premium then re-enter on the next signal (compound). 0 = off (ride)">Take-profit %</span>
          <input className="cfg-num" type="number" inputMode="numeric" min={0} max={300} step={5} value={tp}
            onChange={(e) => setCfg({ take_profit_pct: Math.max(0, Math.min(300, Math.floor(Number(e.target.value)) || 0)) })} aria-label="take profit percent" />
        </div>
        <div className="cfg-row">
          <span className="cfg-k" title="hidden hard ceiling on contracts per trade">Max contracts</span>
          <input className="cfg-num" type="number" inputMode="numeric" min={1} max={50} step={1} value={config.max_contracts}
            onChange={(e) => setCfg({ max_contracts: Math.max(1, Math.min(50, Math.floor(Number(e.target.value)) || 1)) })} aria-label="max contracts" />
        </div>
        {pyrEligible && (
          <div className="cfg-row">
            <span className="cfg-k" title="pyramid: add to a winning position as it runs (never average down, ≥+30% off base). The validated arm = +3 lots at a 12-contract stack cap (cap12). Off = Phase-A shadow only.">Pyramid</span>
            <span className="cfg-seg">
              <button className={pyr === 0 ? "on" : ""} onClick={() => pyr !== 0 && setCfg({ pyramid_adds: 0 })} title="off — shadow only (no live adds)">OFF</button>
              <button className={pyr > 0 ? "on" : ""} onClick={() => pyr === 0 && setCfg({ pyramid_adds: PYRAMID_ADDS_ON, max_contracts: Math.max(config.max_contracts, PYRAMID_CAP) })} title={`arm cap12 — +${PYRAMID_ADDS_ON} lots, raise the stack cap to ${PYRAMID_CAP}`}>+{PYRAMID_ADDS_ON} · cap{PYRAMID_CAP}</button>
            </span>
          </div>
        )}
      </div>

      <label className="ch-edit-label">Lifecycle</label>
      <div className="ch-edit-life">
        <button
          className="ch-edit-bench"
          onClick={toggleBench}
          title={status === "armed" ? "bench: stop entries; open positions wind down" : "re-arm: channel trades again next cycle"}
        >
          {status === "armed" ? "86 it (bench)" : "Re-arm channel"}
        </button>
        <button
          className="ch-edit-dup"
          onClick={doDuplicate}
          disabled={dupBusy}
          title="clone this channel as a draft — for an A/B variant (e.g. 0DTE vs 1DTE, a different U-stop)"
        >
          {dupBusy ? "Duplicating…" : "Duplicate"}
        </button>
      </div>

      <div className="ch-edit-danger">
        {!confirmDel ? (
          <button className="ch-edit-del" onClick={() => setConfirmDel(true)}>Delete channel</button>
        ) : (
          <div className="ch-edit-confirm">
            <span>Remove {name}?</span>
            <button className="ch-edit-del confirm" onClick={doDelete}>Yes, remove</button>
            <button className="ch-edit-cancel" onClick={() => setConfirmDel(false)}>Cancel</button>
          </div>
        )}
      </div>
      {editErr && <div className="ch-edit-err">{editErr}</div>}
      {editMsg && <div className="ch-edit-ok">{editMsg}</div>}
      <button className="ch-edit-done" onClick={closeEdit}>Done</button>
    </div>
  ) : null;
  const cssColor = pmVar(color);

  // Lifecycle pill — only shown for channels that are NOT live in the dispatcher
  // (a compiled channel sits 'draft' until backtest-gated + armed).
  const statusBadge =
    status !== "armed" ? (
      <span className={`ch-status ch-status--${status}`} title={`channel is ${status} — not trading`}>
        {status}
      </span>
    ) : null;

  const day = pnl?.dayPnl ?? 0;
  // VU meter: signed fill, capped at ±$500 for the bar geometry.
  const mag = Math.min(1, Math.abs(day) / 500);

  // Restore this channel's faders to the trader's factory defaults (knobs only —
  // mute/solo are left as deliberate operational state). Guards an accidental
  // no-op write when already at default.
  const d = strategist.defaults;
  const atDefault =
    config.capital_pct === d.capital_pct &&
    config.aggression === d.aggression &&
    config.max_contracts === d.max_contracts &&
    config.daily_stop_usd === d.daily_stop_usd;
  const resetChannel = () => {
    if (atDefault) return;
    const patch = {
      capital_pct: d.capital_pct,
      aggression: d.aggression,
      max_contracts: d.max_contracts,
      daily_stop_usd: d.daily_stop_usd,
    };
    dispatch({ type: "SET_CONFIG", slug, patch });
    persistConfig(id, patch);
  };
  const resetBtn = (
    <button
      type="button"
      className={`ch-reset${atDefault ? " is-default" : ""}`}
      onClick={resetChannel}
      title={`reset ${name} to default settings`}
      aria-label={`reset ${name} to default settings`}
    >
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
        strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <polyline points="1 4 1 10 7 10" />
        <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
      </svg>
    </button>
  );

  const pads = (
    <div className="ch-pads">
      <PadButton
        label="MUTE"
        lit={config.muted}
        color="var(--led-red)"
        onClick={() => {
          dispatch({ type: "TOGGLE_MUTE", slug });
          persistConfig(id, { muted: !config.muted });
        }}
        title="mute this strategist"
      />
      <PadButton
        label="BOOST"
        lit={boosted}
        color="var(--led-amber)"
        onClick={() => {
          const next = !boosted;
          dispatch({ type: "SET_CONFIG", slug, patch: { boosted: next } });
          persistConfig(id, { boosted: next });
        }}
        title={boosted ? "BOOST on — 2× size today (RISK + cap + daily-stop); auto-clears after the close" : "BOOST — run this channel at 2× size for today"}
      />
    </div>
  );

  // Mobile GRID card — condensed overview (no draggable knobs; Risk/Stop as read-only
  // LED meters + values). Tapping the body expands to the full strip; the mute/solo pads
  // stop propagation so they stay tappable without expanding.
  if (mobile && compact) {
    return (
      <div
        className={`channel channel--mc pm-${color}${ducked ? " ducked" : ""}${active ? " ch-on" : ""}`}
        role="button"
        tabIndex={0}
        onClick={onExpand}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onExpand?.(); } }}
        title={`${name} · ${underlying} — tap to adjust`}
      >
        <div className="mc-head">
          <div className="mc-head-l">
            <span className={`ch-dot${active ? " on" : ""}`} />
            <div className="ch-name">{name}</div>
            {statusBadge}
          </div>
          <div className="mc-head-r">
            <div className={`mc-pnl ${day < 0 ? "neg" : "pos"}`}>{signedUsd(day)}</div>
          </div>
        </div>
        {/* the binding exits at a glance (read-only here — tap expands to the editable pills) */}
        <div className="mc-fires" aria-hidden="true">
          <span className="chf-lbl">fires</span>
          <span className="chf chf-stop">−{premStop}%</span>
          <span className={`chf ${tp > 0 ? "chf-take" : "chf-ride"}`}>{tp > 0 ? `+${tp}%` : "ride"}</span>
          <span className="chf chf-flat">EOD</span>
          <span className="mc-tick">{underlying}</span>
        </div>
        <div className="mc-row">
          {/* indicator knob — non-interactive (pointer-events:none); a "tap to adjust" cue
              that mirrors the channel color + risk fill. Tapping it falls through to expand. */}
          <div className="mc-knob" aria-hidden="true">
            <Knob value={config.capital_pct} min={0} max={5000} onChange={() => {}} color={cssColor} size="sm" />
          </div>
          <div className="mc-meters">
            <div className="mc-meter"><span className="mc-lbl">RISK</span><span className="mc-bar"><span className="mc-fill" style={{ width: `${Math.min(100, config.capital_pct / 50)}%`, background: meterColor(config.capital_pct / 5000) }} /></span><span className="mc-val">{usd0(config.capital_pct)}</span></div>
            <div className="mc-meter"><span className="mc-lbl">STOP</span><span className="mc-bar"><span className="mc-fill" style={{ width: `${Math.min(100, config.daily_stop_usd / 50)}%`, background: meterColor(config.daily_stop_usd / 5000) }} /></span><span className="mc-val">{usd0(config.daily_stop_usd)}</span></div>
          </div>
          <div className="mc-pads" onClick={(e) => e.stopPropagation()}>{pads}</div>
        </div>
        {editOverlay}
      </div>
    );
  }

  if (mobile) {
    return (
      <div className={`channel channel--m pm-${color}${ducked ? " ducked" : ""}`}>
        {resetBtn}
        {editBtn}
        <div className="ch-top">
          <div className="ch-head">
            <span className={`ch-dot${active ? " on" : ""}`} />
            <div className="ch-name">{name}</div>
            <span className="ch-ticker" title={`trades ${underlying}`}>{underlying}</span>
            {statusBadge}
          </div>
          <div className="ch-regime">{regime}</div>
        {lights}
        {firesReadout}
        </div>

        <div className="ch-knobrow">
          <div className="ch-kunit">
            <LedMeter frac={config.capital_pct / 5000} count={22} />
            <Knob value={config.capital_pct} min={0} max={5000} step={25}
              onChange={(v) => dispatch({ type: "SET_CONFIG", slug, patch: { capital_pct: v } })}
              onCommit={(v) => persistConfig(id, { capital_pct: v })}
              size="md" color={cssColor} cap="var(--knob-cream)" tick="#2a2a24" label="Risk/trade" format={usd0} />
          </div>
          <div className="ch-kunit" title="daily realized-loss LATCH — halts NEW entries for the day once realized P&L ≤ −$X; does NOT cap an open trade's loss (that's the premium stop)">
            <LedMeter frac={config.daily_stop_usd / 5000} count={22} />
            <Knob value={config.daily_stop_usd} min={0} max={5000} step={25}
              onChange={(v) => dispatch({ type: "SET_CONFIG", slug, patch: { daily_stop_usd: v } })}
              onCommit={(v) => persistConfig(id, { daily_stop_usd: v })}
              size="md" color={cssColor} cap="var(--knob-dark)" tick="#d7d5cb" label="HALT/day" format={usd0} />
          </div>
        </div>

        <div className="ch-foot">
          <div className={`ch-pnl ${day < 0 ? "neg" : "pos"}`}>{signedUsd(day)}</div>
          {pads}
        </div>
        {editOverlay}
      </div>
    );
  }

  return (
    <div
      className={`channel ch-col pm-${color}${ducked ? " ducked" : ""}${config.muted ? " ch-muted" : ""}${dragging ? " ch-dragging" : ""}`}
    >
      {dragHandle && (
        <button
          type="button"
          className="ch-grip"
          {...dragHandle}
          title="drag to reorder"
          aria-label={`drag ${name} to reorder`}
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden>
            <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
            <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
          </svg>
        </button>
      )}
      {resetBtn}
      {editBtn}
      <div className="ch-head">
        <span className={`ch-dot${active ? " on" : ""}`} />
        <div className="ch-name">{name}</div>
        {statusBadge}
      </div>
      <div className="ch-sub">{config.muted ? "muted" : `${executor} · ${dte}DTE${pyr > 0 ? ` · PYR×${pyr}` : ""}`}</div>
      {firesReadout}

      <div className="ch-lcd">
        <div className={`ch-lcd-v ${day < 0 ? "neg" : "pos"}`}>{signedUsd(day)}</div>
        <div className="ch-lcd-bar"><i className={day < 0 ? "neg" : "pos"} style={{ width: `${mag * 100}%` }} /></div>
      </div>

      {/* Two-dial sizing (RISK $/trade + STOP $/day). Exits (TP / premium stop) live in the
          LOCK/RIDE toggle + pills + shape bar above; u-stop / max-contracts in the edit drawer. */}
      <div className="ch-stack ch-stack--sizing" title="daily realized-loss LATCH — halts NEW entries for the day once realized P&L ≤ −$X; does NOT cap an open trade's loss (that's the premium stop)">
        <Knob
          value={config.daily_stop_usd}
          min={0}
          max={5000}
          step={25}
          onChange={(v) => dispatch({ type: "SET_CONFIG", slug, patch: { daily_stop_usd: v } })}
          onCommit={(v) => persistConfig(id, { daily_stop_usd: v })}
          size="md"
          cap="var(--knob-dark)"
          tick="#d7d5cb"
          label="HALT/day"
          format={usd0}
        />
      </div>

      <Fader
        value={config.capital_pct}
        min={0}
        max={5000}
        step={25}
        onChange={(v) => dispatch({ type: "SET_CONFIG", slug, patch: { capital_pct: v } })}
        onCommit={(v) => persistConfig(id, { capital_pct: v })}
        label="RISK"
        format={usd0}
      />

      {pads}
      {editOverlay}
    </div>
  );
}

// Memo so dragging one strip's knob doesn't re-render the others.
export const ChannelStrip = memo(ChannelStripImpl);
