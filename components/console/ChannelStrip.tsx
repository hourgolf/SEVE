"use client";

import { memo } from "react";
import { Knob } from "@/components/console/hw/Knob";
import { LedMeter } from "@/components/console/hw/LedMeter";
import { PadButton } from "@/components/console/hw/PadButton";
import { useDeskDispatch } from "@/hooks/useDeskState";
import { useDeskWrite } from "@/hooks/useDeskWrite";
import { pct, signedUsd, usd0 } from "@/lib/format";
import type { ChannelPnl, PmColor, StrategistState } from "@/lib/desk/types";

const PM_VAR: Record<PmColor, string> = {
  green: "var(--pm-green)",
  blue: "var(--pm-blue)",
  amber: "var(--pm-amber)",
  cyan: "var(--pm-cyan)",
};

export interface ChannelStripProps {
  strategist: StrategistState;
  pnl: ChannelPnl | undefined;
  active: boolean; // effectively trading right now
  ducked: boolean; // dimmed because another channel is soloed
  mobile?: boolean; // phone: 4 knobs in a row, each with an LED volume meter
}

function ChannelStripImpl({ strategist, pnl, active, ducked, mobile }: ChannelStripProps) {
  const dispatch = useDeskDispatch();
  const { persistConfig } = useDeskWrite();
  const { id, slug, name, regime, color, config } = strategist;
  const cssColor = PM_VAR[color];

  const day = pnl?.dayPnl ?? 0;
  // VU meter: signed fill, capped at ±$500 for the bar geometry.
  const mag = Math.min(1, Math.abs(day) / 500);

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

  if (mobile) {
    return (
      <div className={`channel channel--m pm-${color}${ducked ? " ducked" : ""}`}>
        <div className="ch-top">
          <div className="ch-head">
            <span className={`ch-dot${active ? " on" : ""}`} />
            <div className="ch-name">{name}</div>
          </div>
          <div className="ch-regime">{regime}</div>
        </div>

        <div className="ch-knobrow">
          <div className="ch-kunit">
            <LedMeter frac={config.capital_pct / 100} count={22} />
            <Knob value={config.capital_pct} min={0} max={100} step={1}
              onChange={(v) => dispatch({ type: "SET_CONFIG", slug, patch: { capital_pct: v } })}
              onCommit={(v) => persistConfig(id, { capital_pct: v })}
              size="md" color={cssColor} label="Level" format={pct} />
          </div>
          <div className="ch-kunit">
            <LedMeter frac={config.aggression / 100} count={22} />
            <Knob value={config.aggression} min={0} max={100} step={1}
              onChange={(v) => dispatch({ type: "SET_CONFIG", slug, patch: { aggression: v } })}
              onCommit={(v) => persistConfig(id, { aggression: v })}
              size="md" color={cssColor} label="Aggr" format={pct} />
          </div>
          <div className="ch-kunit">
            <LedMeter frac={config.max_contracts / 10} count={22} />
            <Knob value={config.max_contracts} min={0} max={10} step={1}
              onChange={(v) => dispatch({ type: "SET_CONFIG", slug, patch: { max_contracts: v } })}
              onCommit={(v) => persistConfig(id, { max_contracts: v })}
              size="md" color={cssColor} label="Max" />
          </div>
          <div className="ch-kunit">
            <LedMeter frac={config.daily_stop_usd / 500} count={22} />
            <Knob value={config.daily_stop_usd} min={0} max={500} step={10}
              onChange={(v) => dispatch({ type: "SET_CONFIG", slug, patch: { daily_stop_usd: v } })}
              onCommit={(v) => persistConfig(id, { daily_stop_usd: v })}
              size="md" color={cssColor} label="Stop" format={usd0} />
          </div>
        </div>

        <div className="ch-foot">
          <div className={`ch-pnl ${day < 0 ? "neg" : "pos"}`}>{signedUsd(day)}</div>
          {pads}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`channel pm-${color}${ducked ? " ducked" : ""}`}
    >
      <div className="ch-head">
        <span className={`ch-dot${active ? " on" : ""}`} />
        <div className="ch-name">{name}</div>
      </div>
      <div className="ch-regime">{regime}</div>

      <div className="ch-knobs">
        <Knob
          value={config.capital_pct}
          min={0}
          max={100}
          step={1}
          onChange={(v) => dispatch({ type: "SET_CONFIG", slug, patch: { capital_pct: v } })}
          onCommit={(v) => persistConfig(id, { capital_pct: v })}
          size="md"
          color={cssColor}
          label="Level"
          format={pct}
        />
        <Knob
          value={config.aggression}
          min={0}
          max={100}
          step={1}
          onChange={(v) => dispatch({ type: "SET_CONFIG", slug, patch: { aggression: v } })}
          onCommit={(v) => persistConfig(id, { aggression: v })}
          size="md"
          color={cssColor}
          label="Aggr"
          format={pct}
        />
      </div>

      <div className="ch-dials">
        <Knob
          value={config.max_contracts}
          min={0}
          max={10}
          step={1}
          onChange={(v) => dispatch({ type: "SET_CONFIG", slug, patch: { max_contracts: v } })}
          onCommit={(v) => persistConfig(id, { max_contracts: v })}
          size="sm"
          color={cssColor}
          label="Max"
        />
        <Knob
          value={config.daily_stop_usd}
          min={0}
          max={500}
          step={10}
          onChange={(v) => dispatch({ type: "SET_CONFIG", slug, patch: { daily_stop_usd: v } })}
          onCommit={(v) => persistConfig(id, { daily_stop_usd: v })}
          size="sm"
          color={cssColor}
          label="Stop"
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
    </div>
  );
}

// Memo so dragging one strip's knob doesn't re-render the others.
export const ChannelStrip = memo(ChannelStripImpl);
