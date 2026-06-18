"use client";

import { useDragValue } from "@/hooks/useDragValue";

export interface KnobProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  size?: "lg" | "md" | "sm";
  /** Focus-ring / accent color (e.g. the channel accent "var(--pm-green)"). */
  color?: string;
  /** TE flat-cap FILL — per role: silver RISK/U-STOP, dark STOP, orange TP. */
  cap?: string;
  /** Indicator-tick color (chosen to contrast the cap). */
  tick?: string;
  label?: string;
  format?: (v: number) => string;
  disabled?: boolean;
}

// Knob sweeps 270°: -135° (min) → +135° (max). round3 keeps the rotation angle
// byte-identical between SSR (Node) and the client so hydration doesn't mismatch.
const SWEEP = 270;
const START = -135;
const round3 = (n: number) => Number(n.toFixed(3));

export function Knob({
  value,
  min,
  max,
  step = (max - min) / 100,
  onChange,
  onCommit,
  size = "md",
  color,
  cap,
  tick,
  label,
  format,
  disabled,
}: KnobProps) {
  const { dragging, handlers, aria } = useDragValue({
    value,
    min,
    max,
    step,
    onChange,
    onCommit,
    disabled,
    format,
  });

  const frac = (value - min) / (max - min || 1);
  const angle = round3(START + frac * SWEEP);

  // Teenage-Engineering flat knob: one fill disc + a single indicator tick. No
  // skirt ticks, no LED ring, no metal gradient — the level reads off the tick.
  return (
    <div
      className={`knob knob-${size}${dragging ? " dragging" : ""}${disabled ? " disabled" : ""}`}
      style={{
        ["--ind" as string]: color ?? "var(--accent)",
        ["--kcap" as string]: cap ?? "var(--knob-cream)",
        ["--ktick" as string]: tick ?? "#2a2a24",
      }}
      title={label}
      {...handlers}
      {...aria}
    >
      <div className="knob-well">
        <svg viewBox="0 0 100 100" className="knob-cap">
          <circle cx="50" cy="50" r="43" fill="var(--kcap)" stroke="var(--knob-edge)" strokeWidth="2" />
          <g transform={`rotate(${angle} 50 50)`}>
            <rect x="46.5" y="10" width="7" height="28" rx="3.5" fill="var(--ktick)" />
          </g>
        </svg>
      </div>
      {label && (
        <div className="knob-caption">
          <span className="knob-label">{label}</span>
          <span className="knob-val">{format ? format(value) : value}</span>
        </div>
      )}
    </div>
  );
}
