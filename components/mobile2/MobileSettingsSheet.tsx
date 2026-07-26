"use client";

import { AuthControl } from "@/components/AuthControl";
import { PushToggle } from "@/components/console/PushToggle";
import { KitToggle } from "@/components/console/KitToggle";
import { EventLog } from "@/components/EventLog";
import { useDeskWrite } from "@/hooks/useDeskWrite";
import { openThemeLab } from "@/components/theme/ThemeBridge";
import type { MarketEvent } from "@/lib/types";

// =============================================================================
// MOBILE · SETTINGS·LOG sheet (S5) — the cog sheet, re-homed from the old
// MobileApp OPS tab. Keeps the surviving functions: AUTH (sign-in/out — the
// load-bearing one), the frame/skin toggle, push + kit toggles, and the event
// log. Reuses the exact same widgets as the desktop/legacy surfaces.
// =============================================================================

export function MobileSettingsSheet({
  open, onClose, skin, setSkin, events,
}: {
  open: boolean;
  onClose: () => void;
  skin: "cream" | "blackout";
  setSkin: (s: "cream" | "blackout") => void;
  events: MarketEvent[];
}) {
  const { canWrite } = useDeskWrite();
  if (!open) return null;
  return (
    <div className="m2-set-ov" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} role="presentation">
      <div className="m2-set-sheet" role="dialog" aria-modal="true" aria-label="settings and log">
        <div className="m2-set-grab" />
        <div className="m2-set-head">
          <span className="t">SETTINGS · LOG</span>
          <span className="grow" />
          <button type="button" className="m2-set-x" onClick={onClose} aria-label="close">✕</button>
        </div>
        <div className="m2-set-body">
          <div className="m2-set-auth">
            <AuthControl />
            <span className={`m2-write-chip${canWrite ? " on" : ""}`}>{canWrite ? "● operator" : "○ read-only"}</span>
          </div>
          <div className="m2-set-row">
            <span className="m2-set-lbl">Frame</span>
            <span className="m2-set-seg">
              <button type="button" className={skin === "cream" ? "on" : ""} onClick={() => setSkin("cream")}>CREAM</button>
              <button type="button" className={skin === "blackout" ? "on" : ""} onClick={() => setSkin("blackout")}>BLACKOUT</button>
            </span>
          </div>
          <button type="button" className="m2-open-settings" onClick={openThemeLab}>OPEN FIGMA THEME LAB</button>
          <PushToggle />
          <KitToggle variant="sheet" />
          <EventLog events={events} />
        </div>
      </div>
    </div>
  );
}
