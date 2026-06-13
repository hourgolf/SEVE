"use client";

import { memo, useState } from "react";
import { Knob } from "@/components/console/hw/Knob";
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

function ChannelStripImpl({ strategist, pnl, active, ducked, mobile, dragHandle, dragging, compact, onExpand }: ChannelStripProps) {
  const dispatch = useDeskDispatch();
  const { persistConfig, renameChannel, setChannelAccent, setChannelStatus, setChannelExecutor, duplicateChannel, deleteChannel, canWrite } = useDeskWrite();
  const { id, slug, underlying, name, regime, color, status, config } = strategist;
  const executor = strategist.executor ?? "cron";
  const ustop = config.underlying_stop_pct ?? 0;
  const dte = config.entry_dte ?? 0;
  const eventPolicy = config.event_policy ?? "standdown";

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
      {ustop > 0 && <span className="chl chl-us" title={`underlying stop ${ustop}%`}>uS {ustop}%</span>}
      {eventPolicy === "ignore" && <span className="chl chl-evt" title="ignores scheduled-event stand-downs (event-native)">evt:ignore</span>}
      {inTrade && <span className="chl chl-live" title={`${pnl?.openCount} open position(s)`}>● in trade</span>}
      {atStop && <span className="chl chl-stop" title="day P&L at/through the STOP — entries halted">STOP</span>}
    </div>
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
          <span className="cfg-k" title="hidden hard ceiling on contracts per trade">Max contracts</span>
          <input className="cfg-num" type="number" inputMode="numeric" min={1} max={50} step={1} value={config.max_contracts}
            onChange={(e) => setCfg({ max_contracts: Math.max(1, Math.min(50, Math.floor(Number(e.target.value)) || 1)) })} aria-label="max contracts" />
        </div>
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
        label="SOLO"
        lit={config.soloed}
        color={cssColor}
        onClick={() => {
          dispatch({ type: "TOGGLE_SOLO", slug });
          persistConfig(id, { soloed: !config.soloed });
        }}
        title="solo this strategist"
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
        title={`${name} — tap to adjust`}
      >
        <div className="mc-head">
          <div className="mc-head-l">
            <span className={`ch-dot${active ? " on" : ""}`} />
            <div className="ch-name">{name}</div>
            {statusBadge}
          </div>
          <div className="mc-head-r">
            <div className={`mc-pnl ${day < 0 ? "neg" : "pos"}`}>{signedUsd(day)}</div>
            <span className="ch-ticker" title={`trades ${underlying}`}>{underlying}</span>
          </div>
        </div>
        <div className="mc-row">
          {/* indicator knob — non-interactive (pointer-events:none); a "tap to adjust" cue
              that mirrors the channel color + risk fill. Tapping it falls through to expand. */}
          <div className="mc-knob" aria-hidden="true">
            <Knob value={config.capital_pct} min={0} max={500} onChange={() => {}} color={cssColor} size="sm" />
          </div>
          <div className="mc-meters">
            <div className="mc-meter"><span className="mc-lbl">RISK</span><span className="mc-bar"><span className="mc-fill" style={{ width: `${Math.min(100, config.capital_pct / 5)}%`, background: meterColor(config.capital_pct / 500) }} /></span><span className="mc-val">{usd0(config.capital_pct)}</span></div>
            <div className="mc-meter"><span className="mc-lbl">STOP</span><span className="mc-bar"><span className="mc-fill" style={{ width: `${Math.min(100, config.daily_stop_usd / 5)}%`, background: meterColor(config.daily_stop_usd / 500) }} /></span><span className="mc-val">{usd0(config.daily_stop_usd)}</span></div>
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
        </div>

        <div className="ch-knobrow">
          <div className="ch-kunit">
            <LedMeter frac={config.capital_pct / 500} count={22} />
            <Knob value={config.capital_pct} min={0} max={500} step={25}
              onChange={(v) => dispatch({ type: "SET_CONFIG", slug, patch: { capital_pct: v } })}
              onCommit={(v) => persistConfig(id, { capital_pct: v })}
              size="md" color={cssColor} label="Risk/trade" format={usd0} />
          </div>
          <div className="ch-kunit">
            <LedMeter frac={config.daily_stop_usd / 500} count={22} />
            <Knob value={config.daily_stop_usd} min={0} max={500} step={25}
              onChange={(v) => dispatch({ type: "SET_CONFIG", slug, patch: { daily_stop_usd: v } })}
              onCommit={(v) => persistConfig(id, { daily_stop_usd: v })}
              size="md" color={cssColor} label="Stop/day" format={usd0} />
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
      className={`channel pm-${color}${ducked ? " ducked" : ""}${dragging ? " ch-dragging" : ""}`}
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
        <span className="ch-ticker" title={`trades ${underlying}`}>{underlying}</span>
        {statusBadge}
      </div>
      <div className="ch-regime">{regime}</div>
      {lights}

      <div className="ch-knobs">
        <Knob
          value={config.capital_pct}
          min={0}
          max={500}
          step={25}
          onChange={(v) => dispatch({ type: "SET_CONFIG", slug, patch: { capital_pct: v } })}
          onCommit={(v) => persistConfig(id, { capital_pct: v })}
          size="md"
          color={cssColor}
          label="Risk/trade"
          format={usd0}
        />
        <Knob
          value={config.daily_stop_usd}
          min={0}
          max={500}
          step={25}
          onChange={(v) => dispatch({ type: "SET_CONFIG", slug, patch: { daily_stop_usd: v } })}
          onCommit={(v) => persistConfig(id, { daily_stop_usd: v })}
          size="md"
          color={cssColor}
          label="Stop/day"
          format={usd0}
        />
      </div>

      <div className="ch-meter">
        <div className="ch-meter-track">
          <div
            className={`ch-meter-fill ${day < 0 ? "neg" : "pos"}`}
            style={{ height: `${mag * 100}%` }}
          />
        </div>
        <div className={`ch-pnl ${day < 0 ? "neg" : "pos"}`}>{signedUsd(day)}</div>
      </div>

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
          label="SOLO"
          lit={config.soloed}
          color={cssColor}
          onClick={() => {
            dispatch({ type: "TOGGLE_SOLO", slug });
            persistConfig(id, { soloed: !config.soloed });
          }}
          title="solo this strategist"
        />
      </div>
      {editOverlay}
    </div>
  );
}

// Memo so dragging one strip's knob doesn't re-render the others.
export const ChannelStrip = memo(ChannelStripImpl);
