"use client";

import type { PmColor, Step } from "@/lib/desk/types";

const COLOR_VAR: Record<PmColor, string> = {
  green: "var(--pm-green)",
  blue: "var(--pm-blue)",
  amber: "var(--pm-amber)",
  cyan: "var(--pm-cyan)",
};

export interface StepRowProps {
  steps: Step[]; // expected length 16
  onStep?: (index: number) => void;
}

// The 16-step sequencer row — the console's showpiece. Each cell lights in a
// strategist's color; `pulse` animates a recent hit.
export function StepRow({ steps, onStep }: StepRowProps) {
  return (
    <div className="steprow">
      {steps.map((s, i) => {
        const c = s.color ? COLOR_VAR[s.color] : "var(--amber)";
        return (
          <button
            type="button"
            key={i}
            className={`step${s.lit ? " lit" : ""}${s.pulse ? " pulse" : ""}`}
            style={{ ["--step" as string]: c }}
            onClick={() => onStep?.(i)}
            aria-label={`step ${i + 1}`}
          >
            <span className="step-num">{i + 1}</span>
          </button>
        );
      })}
    </div>
  );
}
