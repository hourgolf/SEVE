"use client";

import { memo } from "react";
import { play909, VOICE_LABELS, VOICE_NAMES } from "@/lib/audio/drum909";
import type { Step } from "@/lib/desk/types";
import { pmVar } from "@/lib/desk/colors";

export interface StepRowProps {
  steps: Step[]; // expected length 16
  onStep?: (index: number) => void;
}

// The 16-step sequencer row — the console's showpiece. Each cell lights in a
// strategist's color as signals land; tapping a pad also plays its TR-909 voice
// so the tape doubles as a playable drum machine. `pulse` animates a recent hit.
function StepRowImpl({ steps, onStep }: StepRowProps) {
  // Trigger on pointer-down for low latency; flash the pad without a re-render.
  const hit = (e: React.PointerEvent<HTMLButtonElement>, i: number) => {
    play909(i);
    const el = e.currentTarget;
    el.classList.remove("hit");
    void el.offsetWidth; // restart the flash animation
    el.classList.add("hit");
    onStep?.(i);
  };
  return (
    <div className="steprow">
      {steps.map((s, i) => {
        const c = s.color ? pmVar(s.color) : "var(--amber)";
        return (
          <button
            type="button"
            key={i}
            className={`step${s.lit ? " lit" : ""}${s.pulse ? " pulse" : ""}`}
            style={{ ["--step" as string]: c }}
            onPointerDown={(e) => hit(e, i)}
            aria-label={`step ${i + 1} — ${VOICE_NAMES[i] ?? ""}`}
            title={VOICE_NAMES[i]}
          >
            <span className="step-num">{i + 1}</span>
            <span className="step-voice">{VOICE_LABELS[i]}</span>
          </button>
        );
      })}
    </div>
  );
}

// Memoized: `steps` is a stable useMemo reference, so the tape doesn't re-render
// on every channel-knob drag frame.
export const StepRow = memo(StepRowImpl);
