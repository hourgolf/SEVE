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
  /** CSS color (e.g. "var(--pm-green)") for the indicator + glow. */
  color?: string;
  label?: string;
  format?: (v: number) => string;
  disabled?: boolean;
}

// Knob sweeps 270°: -135° (min) → +135° (max).
const SWEEP = 270;
const START = -135;

// Tick marks around the dial (constant geometry). Coordinates are rounded so
// the SSR (Node) and client (browser) Math.cos/sin — which can differ by one
// ULP — stringify identically and don't trip a hydration mismatch.
const round3 = (n: number) => Number(n.toFixed(3));
const TICK_LINES = Array.from({ length: 11 }, (_, i) => {
  const t = START + (i * SWEEP) / 10;
  const rad = ((t - 90) * Math.PI) / 180;
  const r1 = 48;
  const r2 = i % 5 === 0 ? 41 : 44;
  return {
    x1: round3(50 + r1 * Math.cos(rad)),
    y1: round3(50 + r1 * Math.sin(rad)),
    x2: round3(50 + r2 * Math.cos(rad)),
    y2: round3(50 + r2 * Math.sin(rad)),
    major: i % 5 === 0,
  };
});

export function Knob({
  value,
  min,
  max,
  step = (max - min) / 100,
  onChange,
  onCommit,
  size = "md",
  color,
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
  const angle = START + frac * SWEEP;
  const indicator = color ?? "#e6e4da";

  return (
    <div
      className={`knob knob-${size}${dragging ? " dragging" : ""}${disabled ? " disabled" : ""}`}
      style={{ ["--ind" as string]: indicator }}
      title={label}
      {...handlers}
      {...aria}
    >
      <div className="knob-well">
        <svg viewBox="0 0 100 100" className="knob-cap">
          <defs>
            <radialGradient id="knobMetal" cx="38%" cy="32%" r="75%">
              <stop offset="0%" stopColor="var(--knob-metal-hi)" />
              <stop offset="55%" stopColor="var(--knob-metal)" />
              <stop offset="100%" stopColor="#161719" />
            </radialGradient>
          </defs>
          {/* tick marks on the skirt */}
          {TICK_LINES.map((t, i) => (
            <line
              key={i}
              x1={t.x1}
              y1={t.y1}
              x2={t.x2}
              y2={t.y2}
              stroke="#8d8b82"
              strokeWidth={t.major ? 2 : 1}
              strokeLinecap="round"
            />
          ))}
          {/* cap */}
          <circle cx="50" cy="50" r="36" fill="url(#knobMetal)" stroke="#0c0d0e" strokeWidth="1.5" />
          <circle cx="50" cy="50" r="36" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
          {/* indicator */}
          <g transform={`rotate(${angle} 50 50)`}>
            <rect
              x="47.5"
              y="16"
              width="5"
              height="22"
              rx="2.5"
              fill="var(--ind)"
              style={{
                filter: `drop-shadow(0 0 3px var(--ind))`,
              }}
            />
          </g>
        </svg>
      </div>
      {label && <div className="knob-label">{label}</div>}
      <div className="knob-val">{format ? format(value) : value}</div>
    </div>
  );
}
