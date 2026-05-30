"use client";

import { memo, useState } from "react";
import { Knob } from "@/components/console/hw/Knob";
import { LedDisplay } from "@/components/console/hw/LedDisplay";
import { TransportButton } from "@/components/console/hw/TransportButton";
import { GuardedToggle } from "@/components/console/hw/GuardedToggle";
import { KillSwitch } from "@/components/console/hw/KillSwitch";
import { useDeskDispatch } from "@/hooks/useDeskState";
import { useDeskWrite } from "@/hooks/useDeskWrite";
import { signedUsd, usd0 } from "@/lib/format";
import type { FundState } from "@/lib/desk/types";

export interface MasterStripProps {
  fund: FundState;
  fundPnl: { nav: number; dayPnl: number };
}

function MasterStripImpl({ fund, fundPnl }: MasterStripProps) {
  const dispatch = useDeskDispatch();
  const { persistFund } = useDeskWrite();
  const [armed, setArmed] = useState(false);
  const [showNav, setShowNav] = useState(true);

  // LED value: NAV (digits only) or signed day P&L. Strip the $ / commas for
  // the 7-seg window (it renders digits, '-' and blanks).
  const ledRaw = showNav
    ? String(fund.is_halted ? 0 : fundPnl.nav)
    : (fundPnl.dayPnl < 0 ? "-" : "") + Math.abs(fundPnl.dayPnl);

  return (
    <div className="master">
      <div className="master-title">MASTER</div>

      <div className="master-led" onClick={() => setShowNav((v) => !v)} title="click to toggle NAV / day P&L">
        <LedDisplay
          value={ledRaw}
          digits={7}
          color={fund.is_halted ? "var(--amber)" : "var(--led-red)"}
          caption={showNav ? "fund nav $" : "day p&l $"}
        />
      </div>

      <div className="master-volume">
        <Knob
          value={fund.total_capital_usd}
          min={0}
          max={50000}
          step={500}
          onChange={(v) => dispatch({ type: "SET_FUND", patch: { total_capital_usd: v } })}
          onCommit={(v) => persistFund({ total_capital_usd: v })}
          size="lg"
          label="Capital"
          format={usd0}
        />
        <div className={`master-day ${fundPnl.dayPnl < 0 ? "neg" : "pos"}`}>
          {signedUsd(fundPnl.dayPnl)} day
        </div>
      </div>

      <div className="master-transport">
        <TransportButton
          label="START"
          variant="start"
          active={fund.running && !fund.is_halted}
          onPress={() => dispatch({ type: "START" })}
          disabled={fund.is_halted}
        />
        <TransportButton
          label="STOP"
          variant="stop"
          active={!fund.running}
          onPress={() => dispatch({ type: "STOP" })}
        />
      </div>

      <div className="master-controls">
        <GuardedToggle
          mode={fund.mode}
          onChange={(m) => {
            dispatch({ type: "SET_MODE", mode: m });
            persistFund({ mode: m });
          }}
        />
        <KillSwitch
          halted={fund.is_halted}
          armed={armed}
          onArm={() => setArmed(true)}
          onFire={() => {
            dispatch({ type: "KILL", reason: "manual kill switch" });
            persistFund({ is_halted: true, halted_reason: "manual kill switch" });
            setArmed(false);
          }}
          onReset={() => {
            dispatch({ type: "RESET_HALT" });
            persistFund({ is_halted: false, halted_reason: null });
          }}
        />
      </div>
    </div>
  );
}

// Memoized: a channel-knob drag re-renders Console each frame, but the master
// strip's props (fund, fundPnl) are referentially stable then, so it skips.
export const MasterStrip = memo(MasterStripImpl);
