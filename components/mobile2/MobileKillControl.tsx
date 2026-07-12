"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDeskDispatch } from "@/hooks/useDeskState";
import { playKit } from "@/lib/desk/kit";
import type { SurfaceProps } from "@/components/surfaceTypes";

const HOLD_MS = 2_000;

// The phone keeps the emergency action direct, but deliberately difficult to
// trigger: press and hold for two seconds. This is the KILL command's existing
// behavior extracted from the retired mobile command sheet.
export function MobileKillControl({ halted, write }: {
  halted: boolean;
  write: SurfaceProps["write"];
}) {
  const dispatch = useDeskDispatch();
  const [hold, setHold] = useState(0);
  const frame = useRef<number | null>(null);
  const fired = useRef(false);

  const cancel = useCallback(() => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = null;
    fired.current = false;
    setHold(0);
  }, []);

  useEffect(() => cancel, [cancel]);

  const start = () => {
    if (!write.canWrite || halted || frame.current != null) return;
    const startedAt = performance.now();
    fired.current = false;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / HOLD_MS);
      setHold(progress);
      if (progress >= 1) {
        frame.current = null;
        fired.current = true;
        dispatch({ type: "KILL", reason: "mobile kill switch" });
        void write.persistFund({ is_halted: true, halted_reason: "mobile kill switch" });
        playKit("crash");
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };

  const reset = () => {
    if (!write.canWrite) return;
    dispatch({ type: "RESET_HALT" });
    void write.persistFund({ is_halted: false, halted_reason: null });
  };

  if (halted) return <button type="button" className="m2-kill halted" disabled={!write.canWrite} onClick={reset}>RESET</button>;

  return <button
    type="button"
    className="m2-kill"
    disabled={!write.canWrite}
    aria-label={write.canWrite ? "hold two seconds to flatten every open position and halt the desk" : "sign in to use the kill switch"}
    title={write.canWrite ? "KILL = FLATTEN · hold two seconds" : "sign in to use KILL"}
    onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); start(); }}
    onPointerUp={() => { if (!fired.current) cancel(); }}
    onPointerCancel={cancel}
    onPointerLeave={() => { if (!fired.current) cancel(); }}
  >
    <span>KILL</span><i style={{ width: `${hold * 100}%` }} />
  </button>;
}
