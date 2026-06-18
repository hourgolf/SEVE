"use client";

import { useDragValue } from "@/hooks/useDragValue";

export interface FaderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  /** Accent color for the focus ring (e.g. the channel accent). */
  color?: string;
  label?: string;
  format?: (v: number) => string;
  disabled?: boolean;
}

// Vertical TE channel fader (the RISK control). Same useDragValue as the Knob —
// drag up to increase — but rendered as a track + cap instead of a rotary dial.
export function Fader({ value, min, max, step = (max - min) / 100, onChange, onCommit, color, label, format, disabled }: FaderProps) {
  const { dragging, handlers, aria } = useDragValue({ value, min, max, step, onChange, onCommit, disabled, format, pixelsForFullRange: 130 });
  const frac = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  const pct = Number((frac * 100).toFixed(2));
  return (
    <div
      className={`fader${dragging ? " dragging" : ""}${disabled ? " disabled" : ""}`}
      style={{ ["--ind" as string]: color ?? "var(--accent)" }}
      title={label}
      {...handlers}
      {...aria}
    >
      <div className="fader-track">
        <div className="fader-fill" style={{ height: `${pct}%` }} />
        <div className="fader-cap" style={{ bottom: `${pct}%` }} />
      </div>
      <div className="knob-caption">
        {label && <span className="knob-label">{label}</span>}
        <span className="knob-val">{format ? format(value) : value}</span>
      </div>
    </div>
  );
}
