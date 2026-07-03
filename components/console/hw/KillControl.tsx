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
  return (
    <KillSwitch
      halted={halted}
      armed={armed}
      onArm={() => setArmed((v) => !v)}
      onFire={() => {
        dispatch({ type: "KILL", reason: "manual kill switch" });
        persistFund({ is_halted: true, halted_reason: "manual kill switch" });
        playKit("crash"); // the 909 crash on FLATTEN — alert-only, no-op unless the KIT is on
        setArmed(false);
      }}
      onReset={() => {
        dispatch({ type: "RESET_HALT" });
        persistFund({ is_halted: false, halted_reason: null });
      }}
    />
  );
}
