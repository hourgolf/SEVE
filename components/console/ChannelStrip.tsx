"use client";

import { memo } from "react";
import { Knob } from "@/components/console/hw/Knob";
import { PadButton } from "@/components/console/hw/PadButton";
import { useDeskDispatch } from "@/hooks/useDeskState";
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
}

function ChannelStripImpl({ strategist, pnl, active, ducked }: ChannelStripProps) {
  const dispatch = useDeskDispatch();
  const { slug, name, regime, color, config } = strategist;
  const cssColor = PM_VAR[color];

  const day = pnl?.dayPnl ?? 0;
  // VU meter: signed fill, capped at ±$500 for the bar geometry.
  const mag = Math.min(1, Math.abs(day) / 500);

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
          onClick={() => dispatch({ type: "TOGGLE_MUTE", slug })}
          title="mute this strategist"
        />
        <PadButton
          label="SOLO"
          lit={config.soloed}
          color={cssColor}
          onClick={() => dispatch({ type: "TOGGLE_SOLO", slug })}
          title="solo this strategist"
        />
      </div>
    </div>
  );
}

// Memo so dragging one strip's knob doesn't re-render the others.
export const ChannelStrip = memo(ChannelStripImpl);
