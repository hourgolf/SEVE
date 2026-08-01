"use client";

import { useState } from "react";
import { MasterStrip } from "@/components/console/MasterStrip";
import { SessionSequencer } from "@/components/console/SessionSequencer";
import type { FundState, Position, StrategistState } from "@/lib/desk/types";

// =============================================================================
// STUDIO · BOTTOM BAND (PERFORM/STUDIO rebuild · slice S3)
// Compact context bar. MASTER and the SESSION TAPE remain reachable in drawers
// but no longer consume the STUDIO floorplan. The former hard-coded experiment
// registry was removed: static documentation is not operational state.
// =============================================================================

export function StudioBand({ fund, fundPnl, positions, recentTrades, strategists }: {
  fund: FundState;
  fundPnl: { nav: number; dayPnl: number };
  positions: Position[];
  recentTrades: Position[];
  strategists: StrategistState[];
}) {
  const [panel, setPanel] = useState<"master" | "session" | null>(null);
  return (
    <div className="sband">
      <button type="button" className={panel === "master" ? "on" : ""} onClick={() => setPanel(panel === "master" ? null : "master")}>
        <small>DESK CONTROL</small><b>{fund.running && !fund.is_halted ? "RUNNING" : fund.is_halted ? "HALTED" : "STOPPED"}</b><span>{fund.mode.toUpperCase()}</span>
      </button>
      <button type="button" className={panel === "session" ? "on" : ""} onClick={() => setPanel(panel === "session" ? null : "session")}>
        <small>SESSION TAPE</small><b>{positions.length} open rows · {recentTrades.length} closed rows</b><span>EXPAND</span>
      </button>
      {panel && (
        <section className={`sband-pop sband-pop--${panel}`} aria-label={panel === "master" ? "Desk controls" : "Session tape"}>
          <div className="sband-pop-head"><b>{panel === "master" ? "DESK CONTROL" : "SESSION TAPE"}</b><button type="button" onClick={() => setPanel(null)}>CLOSE</button></div>
          {panel === "master"
            ? <MasterStrip fund={fund} fundPnl={fundPnl} />
            : <SessionSequencer positions={positions} recentTrades={recentTrades} strategists={strategists} />}
        </section>
      )}
    </div>
  );
}
