"use client";

import { memo } from "react";
import { Knob } from "@/components/console/hw/Knob";
import { PadButton } from "@/components/console/hw/PadButton";
import { FiresPill, TradeShapeBar } from "@/components/console/ChannelStrip";
import { useDeskDispatch } from "@/hooks/useDeskState";
import { useDeskWrite } from "@/hooks/useDeskWrite";
import { signedUsd, usd0 } from "@/lib/format";
import { pmVar } from "@/lib/desk/colors";
import type { ChannelPnl, StrategistState, StrategistConfig } from "@/lib/desk/types";

// =============================================================================
// STUDIO · CHANNEL RACK ROW (PERFORM/STUDIO rebuild · slice S3)
// One channel as a horizontal hardware row — the ChannelStrip's controls
// RE-LAID-OUT into the rack grid (mock F #rackRows). Every control is the
// REUSED one with its REAL write path: FiresPill + TradeShapeBar (imported from
// ChannelStrip), Knob ×2 (STOP/day · RISK), PadButton ×2 (MUTE · BOOST), and the
// LOCK/RIDE matched-pair write mirrored from ChannelStrip.applyLock/applyRide.
// Nothing here re-implements a control's behaviour; the layout is the only new
// thing. Writes are optimistic dispatch(SET_CONFIG) + auth-gated persistConfig,
// anon = read-only (the pills/pads/dials render static, same as the strip).
// =============================================================================

// The channels the worker actually pyramids — used only for the row sub-line badge.
const PYRAMID_ELIGIBLE = new Set(["breakout-alt-v3", "breakout-smart-entries"]);

interface ChannelRackRowProps {
  strategist: StrategistState;
  pnl: ChannelPnl | undefined;
  active: boolean; // effectively trading right now
  selected: boolean;
  onSelect: () => void;
}

function ChannelRackRowImpl({ strategist, pnl, active, selected, onSelect }: ChannelRackRowProps) {
  const dispatch = useDeskDispatch();
  const { persistConfig, canDirectConfigure: canWrite } = useDeskWrite();
  const { id, slug, underlying, color, status, config } = strategist;

  const tp = config.take_profit_pct ?? 0;
  const premStop = config.premium_stop_pct ?? 50; // the binding downside (policy default −50)
  const boosted = config.boosted ?? false;
  const exitMode = tp > 0 ? "lock" : "ride";
  const day = pnl?.dayPnl ?? 0;
  const pnlCls = day > 0 ? "pos" : day < 0 ? "neg" : "flat";
  const cssColor = pmVar(color);

  // Same write helper as the strip: optimistic dispatch + auth-gated persist.
  const setCfg = (patch: Partial<StrategistConfig>) => {
    dispatch({ type: "SET_CONFIG", slug, patch });
    persistConfig(id, patch);
  };

  // LOCK/RIDE writes the MATCHED PAIR in one move (giveback doctrine) — verbatim
  // from ChannelStrip so the two surfaces stay coherent.
  const applyLock = () => {
    const nextTp = tp > 0 ? tp : 22; // keep a tuned take; else the canonical directional 22
    if (nextTp !== tp || premStop !== 30) setCfg({ take_profit_pct: nextTp, premium_stop_pct: 30 });
    onSelect();
  };
  const applyRide = () => {
    if (tp !== 0 || premStop !== 50) setCfg({ take_profit_pct: 0, premium_stop_pct: 50 });
    onSelect();
  };

  // Lifecycle tag on the id cell (muted / benched / disabled) — read-only signal.
  const tag =
    config.muted ? { txt: "MUTED", cls: "mgrey" } :
    status === "draft" ? { txt: "BENCH", cls: "dgrey" } :
    status === "disabled" ? { txt: "OFF", cls: "dgrey" } :
    null;
  const dot = active && status === "armed" && !config.muted;
  const pyr = (config.pyramid_adds ?? 0) > 0 && PYRAMID_ELIGIBLE.has(slug);

  return (
    <div
      className={`rrow rgrid${selected ? " sel" : ""}${config.muted ? " mut" : ""}`}
      style={{ ["--pm" as string]: cssColor }}
      onClick={onSelect}
    >
      {/* channel id — click selects (whole row also selects) */}
      <button type="button" className="r-id" onClick={onSelect} title={`select ${slug}`}>
        <span className={`r-dot${dot ? " on" : ""}`} />
        <b className="r-slug">{slug}</b>
        <span className="r-tk">{underlying}</span>
        {pyr && <span className="r-tag">PYR</span>}
        {tag && <span className={`r-tag ${tag.cls}`}>{tag.txt}</span>}
      </button>

      {/* LOCK/RIDE — matched-pair write */}
      <div className="r-mode" role="group" aria-label="exit mode">
        {canWrite ? (
          <>
            <button type="button" className={`chm chm-lock${exitMode === "lock" ? " on" : ""}`}
              onClick={(e) => { e.stopPropagation(); applyLock(); }}
              title="LOCK — take profit + a tight −30% stop (find-and-surrender book)">LOCK</button>
            <button type="button" className={`chm chm-ride${exitMode === "ride" ? " on" : ""}`}
              onClick={(e) => { e.stopPropagation(); applyRide(); }}
              title="RIDE — no take, loose −50% stop (let the convex tail run)">RIDE</button>
          </>
        ) : (
          <span className={`chm on chm-${exitMode}`}>{exitMode === "lock" ? "LOCK" : "RIDE"}</span>
        )}
      </div>

      {/* FIRES — stop · take · EOD (left→right, the number-line convention) */}
      <div className="r-fires" onClick={(e) => e.stopPropagation()}>
        <FiresPill
          value={premStop}
          display={`−${premStop}%`}
          onCommit={(v) => setCfg({ premium_stop_pct: v })}
          min={10} max={90}
          className="chf-stop"
          canWrite={canWrite}
          label="premium stop percent"
          title="premium stop % — the binding downside"
        />
        <FiresPill
          value={tp}
          display={tp > 0 ? `+${tp}%` : "ride"}
          onCommit={(v) => setCfg({ take_profit_pct: v })}
          min={0} max={300}
          className={tp > 0 ? "chf-take" : "chf-take ridep"}
          canWrite={canWrite}
          label="take profit percent"
          title="take-profit % (0 = ride)"
        />
        <span className="chf-flat">EOD</span>
      </div>

      {/* to-scale trade shape — the REUSED draggable bar */}
      <div className="r-shape" onClick={(e) => e.stopPropagation()}>
        <TradeShapeBar
          tp={tp}
          premStop={premStop}
          canWrite={canWrite}
          onChange={(patch) => dispatch({ type: "SET_CONFIG", slug, patch })}
          onCommit={(patch) => persistConfig(id, patch)}
        />
      </div>

      {/* two-dial sizing — HALT/day · RISK (reused Knob, real drag + write) */}
      <div className="r-dial" onClick={(e) => e.stopPropagation()} title="daily realized-loss LATCH — halts NEW entries for the day once realized P&L ≤ −$X; does NOT cap an open trade's loss">
        <Knob
          value={config.daily_stop_usd}
          min={0} max={5000} step={25}
          onChange={(v) => dispatch({ type: "SET_CONFIG", slug, patch: { daily_stop_usd: v } })}
          onCommit={(v) => persistConfig(id, { daily_stop_usd: v })}
          size="sm" color={cssColor} cap="var(--knob-dark)" tick="#d7d5cb"
          label="HALT/day" format={usd0} disabled={!canWrite}
        />
      </div>
      <div className="r-dial" onClick={(e) => e.stopPropagation()}>
        <Knob
          value={config.capital_pct}
          min={0} max={5000} step={25}
          onChange={(v) => dispatch({ type: "SET_CONFIG", slug, patch: { capital_pct: v } })}
          onCommit={(v) => persistConfig(id, { capital_pct: v })}
          size="sm" color={cssColor} cap="var(--knob-cream)" tick="#2a2a24"
          label="RISK" format={usd0} disabled={!canWrite}
        />
      </div>

      <div className={`r-pnl ${pnlCls}`}>{signedUsd(day)}</div>

      {/* MUTE · BOOST — reused PadButton, real write paths */}
      <div className="r-pads" onClick={(e) => e.stopPropagation()}>
        <PadButton
          label="MUTE"
          lit={config.muted}
          color="var(--led-red)"
          onClick={() => { dispatch({ type: "TOGGLE_MUTE", slug }); persistConfig(id, { muted: !config.muted }); }}
          title="mute this strategist"
        />
        <PadButton
          label="BOOST"
          lit={boosted}
          color="var(--led-amber)"
          onClick={() => { const next = !boosted; dispatch({ type: "SET_CONFIG", slug, patch: { boosted: next } }); persistConfig(id, { boosted: next }); }}
          title={boosted ? "BOOST on — 2× size today; auto-clears after the close" : "BOOST — run this channel at 2× size for today"}
        />
      </div>
    </div>
  );
}

export const ChannelRackRow = memo(ChannelRackRowImpl);
