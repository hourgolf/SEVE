"use client";

export interface KillSwitchProps {
  halted: boolean;
  armed: boolean; // protective cover lifted?
  onArm: () => void;
  onFire: () => void;
  onReset: () => void;
}

// Red guarded KILL switch. Lift the cover to arm, then strike to halt the desk.
// (UI-first: flips local fund_state.is_halted only.)
export function KillSwitch({ halted, armed, onArm, onFire, onReset }: KillSwitchProps) {
  if (halted) {
    return (
      <div className="kill halted">
        <div className="kill-status">HALTED</div>
        <button type="button" className="kill-reset" onClick={onReset}>
          RESET
        </button>
      </div>
    );
  }
  return (
    <div className={`kill${armed ? " armed" : ""}`}>
      <button
        type="button"
        className="kill-cover"
        onClick={onArm}
        aria-label={armed ? "kill armed" : "lift cover to arm kill switch"}
      >
        <span className="kill-cover-grip" />
      </button>
      <button
        type="button"
        className="kill-fire"
        onClick={onFire}
        disabled={!armed}
        aria-label="halt the desk"
      >
        KILL
      </button>
    </div>
  );
}
