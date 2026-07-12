"use client";

import { useState } from "react";
import { KillSwitch } from "@/components/console/hw/KillSwitch";
import { playKit } from "@/lib/desk/kit";
import { useDeskDispatch } from "@/hooks/useDeskState";
import { useDeskWrite } from "@/hooks/useDeskWrite";

// The KILL fire control + its wiring (arm state + KILL/RESET_HALT dispatch +
// persistFund). Mounted ONCE per surface — the desktop Shell and the mobile
// vitals header each render one, and only one surface mounts at a time.
export function KillControl({ halted }: { halted: boolean }) {
  const dispatch = useDeskDispatch();
  const { persistFund } = useDeskWrite();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="kill-wrap">
      <KillSwitch
        halted={halted}
        armed={armed}
        busy={busy}
        onArm={() => { setError(null); setArmed((v) => !v); }}
        onFire={() => {
          setBusy(true); setError(null);
          void persistFund({ is_halted: true, halted_reason: "manual kill switch" }).then((result) => {
            setBusy(false);
            if (!result.ok) { setError(result.error ?? "halt write failed"); return; }
            dispatch({ type: "KILL", reason: "manual kill switch" });
            playKit("crash");
            setArmed(false);
          });
        }}
        onReset={() => {
          setBusy(true); setError(null);
          void persistFund({ is_halted: false, halted_reason: null }).then((result) => {
            setBusy(false);
            if (!result.ok) { setError(result.error ?? "reset write failed"); return; }
            dispatch({ type: "RESET_HALT" });
          });
        }}
      />
      {error && <span className="kill-write-error" role="alert" title={error}>WRITE FAILED</span>}
    </div>
  );
}
