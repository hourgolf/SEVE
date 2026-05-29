"use client";

import { useState } from "react";

export interface GuardedToggleProps {
  mode: "paper" | "live";
  onChange: (mode: "paper" | "live") => void;
}

// PAPER ↔ LIVE switch. Switching to LIVE is guarded by a two-step confirm so it
// can't happen on a stray click. (UI-first: this only flips local state.)
export function GuardedToggle({ mode, onChange }: GuardedToggleProps) {
  const [arming, setArming] = useState(false);

  const click = () => {
    if (mode === "live") {
      onChange("paper");
      setArming(false);
      return;
    }
    if (!arming) {
      setArming(true);
      return;
    }
    onChange("live");
    setArming(false);
  };

  return (
    <div className="guarded">
      <button
        type="button"
        className={`mode-switch mode-${mode}${arming ? " arming" : ""}`}
        onClick={click}
        onBlur={() => setArming(false)}
        aria-label={`mode: ${mode}`}
      >
        <span className="mode-track">
          <span className="mode-knob" />
        </span>
        <span className="mode-labels">
          <span className="ml-paper">PAPER</span>
          <span className="ml-live">LIVE</span>
        </span>
      </button>
      <div className="mode-hint">
        {arming ? "click again to confirm LIVE" : mode === "live" ? "LIVE — real orders" : "paper trading"}
      </div>
    </div>
  );
}
