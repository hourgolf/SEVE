"use client";

export interface KillSwitchProps {
  halted: boolean;
  armed: boolean; // protective cover lifted?
  onArm: () => void; // toggles the cover open/closed (arm / disarm)
  onFire: () => void;
  onReset: () => void;
  busy?: boolean;
}

// Red guarded KILL switch. Click the cover to lift (arm) it; click again to
// close (disarm). Strike KILL while armed to halt the desk.
// ⚠ SEMANTICS since worker stream-2026-07-01d (operator's word): KILL = FLATTEN —
// the worker market-closes EVERY open position within ~10s (or at the next open),
// then freezes entries until RESET. The old freeze-everything is gone; the label
// and tooltips below say so, so muscle memory can't assume a freeze.
// (UI-first: flips local fund_state.is_halted; the worker does the flatten.)
export function KillSwitch({ halted, armed, onArm, onFire, onReset, busy = false }: KillSwitchProps) {
  if (halted) {
    return (
      <div className="kill halted">
        <div className="kill-status" title="desk halted — open positions were flattened at market; entries frozen until RESET">HALTED</div>
        <button type="button" className="kill-reset" disabled={busy} onClick={onReset} title="clear the halt — entries resume next cycle">
          {busy ? "…" : "RESET"}
        </button>
      </div>
    );
  }
  return (
    <div className={`kill${armed ? " armed" : ""}`}>
      <button
        type="button"
        className="kill-cover"
        disabled={busy}
        onClick={onArm}
        aria-label={armed ? "close cover (disarm kill switch)" : "lift cover to arm kill switch"}
        title={armed ? "close cover (disarm)" : "lift cover to arm — KILL closes ALL open positions at market"}
      >
        <span className="kill-cover-grip" />
      </button>
      <button
        type="button"
        className="kill-fire"
        onClick={onFire}
        disabled={!armed || busy}
        aria-label="KILL — flatten every open position at market and freeze entries"
        title="KILL = FLATTEN: market-closes every open position (~10s in RTH) and freezes entries until RESET"
      >
        {busy ? "…" : "KILL"}
      </button>
    </div>
  );
}
