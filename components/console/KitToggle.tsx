"use client";

// KitToggle — the KIT pad: toggles the audible 909 fill alerts (lib/desk/kit).
// Two skins: `pad` = compact dark pad on the desktop sequencer bar (the shell
// is at exact width capacity — measured zero slack — so the pad lives with the
// tape it voices); `sheet` = full-width row in the mobile OPS sheet (reuses
// the .push-toggle chrome). Turning it ON plays a confirmation kick — that
// click is also the user gesture that unlocks the AudioContext.

import { useEffect, useState } from "react";
import { kitEnabled, onKitChange, playKit, setKitEnabled } from "@/lib/desk/kit";

const TITLE =
  "909 kit — audible fills: entry kick · win snare · stop rim · EOD hat (alert-only, never an exit path)";

export function KitToggle({ variant = "pad" }: { variant?: "pad" | "sheet" }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(kitEnabled());
    return onKitChange(() => setOn(kitEnabled()));
  }, []);

  const toggle = () => {
    const next = !kitEnabled();
    setKitEnabled(next);
    if (next) playKit("kick", true);
  };

  if (variant === "sheet") {
    return (
      <button type="button" className={`push-toggle${on ? " on" : ""}`} onClick={toggle} title={TITLE}>
        {on ? "● KIT — audible fills on" : "○ KIT — audible fills off"}
      </button>
    );
  }
  return (
    <button type="button" className={`kit-pad${on ? " on" : ""}`} onClick={toggle} title={TITLE} aria-pressed={on}>
      KIT
    </button>
  );
}
