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
  const [writeState, setWriteState] = useState<"idle" | "writing" | "error">("idle");
  const [writeError, setWriteError] = useState<string | null>(null);
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
    if (!write.canWrite || halted || writeState === "writing" || frame.current != null) return;
    setWriteState("idle");
    setWriteError(null);
    const startedAt = performance.now();
    fired.current = false;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / HOLD_MS);
      setHold(progress);
      if (progress >= 1) {
        frame.current = null;
        fired.current = true;
        setWriteState("writing");
        void write.persistFund({ is_halted: true, halted_reason: "mobile kill switch" }).then((result) => {
          setHold(0);
          if (!result.ok) {
            setWriteError(result.error ?? "halt write failed");
            setWriteState("error");
            return;
          }
          dispatch({ type: "KILL", reason: "mobile kill switch" });
          playKit("crash");
          setWriteState("idle");
        });
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };

  const reset = () => {
    if (!write.canWrite || writeState === "writing") return;
    setWriteState("writing"); setWriteError(null);
    void write.persistFund({ is_halted: false, halted_reason: null }).then((result) => {
      if (!result.ok) { setWriteError(result.error ?? "reset write failed"); setWriteState("error"); return; }
      dispatch({ type: "RESET_HALT" });
      setWriteState("idle");
    });
  };

  if (halted) return <span className="m2-kill-wrap"><button type="button" className="m2-kill halted" disabled={!write.canWrite || writeState === "writing"} onClick={reset}>{writeState === "writing" ? "…" : writeState === "error" ? "FAILED" : "RESET"}</button>{writeError && <small title={writeError}>WRITE FAILED</small>}</span>;

  return <span className="m2-kill-wrap"><button
    type="button"
    className="m2-kill"
    disabled={!write.canWrite || writeState === "writing"}
    aria-label={write.canWrite ? "hold two seconds to flatten every open position and halt the desk" : "sign in to use the kill switch"}
    title={write.canWrite ? "KILL = FLATTEN · hold two seconds" : "sign in to use KILL"}
    onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); start(); }}
    onPointerUp={() => { if (!fired.current) cancel(); }}
    onPointerCancel={cancel}
    onPointerLeave={() => { if (!fired.current) cancel(); }}
  >
    <span>{writeState === "writing" ? "…" : writeState === "error" ? "FAILED" : "KILL"}</span><i style={{ width: `${hold * 100}%` }} />
  </button>{writeError && <small title={writeError}>WRITE FAILED</small>}</span>;
}
