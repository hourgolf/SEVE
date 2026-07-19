"use client";

import { memo, useState } from "react";
import { Knob } from "@/components/console/hw/Knob";
import { LedDisplay } from "@/components/console/hw/LedDisplay";
import { TransportButton } from "@/components/console/hw/TransportButton";
import { GuardedToggle } from "@/components/console/hw/GuardedToggle";
import { useDeskDispatch } from "@/hooks/useDeskState";
import { useDeskWrite } from "@/hooks/useDeskWrite";
import { signedUsd, usd0 } from "@/lib/format";
import type { FundState } from "@/lib/desk/types";

export interface MasterStripProps {
  fund: FundState;
  fundPnl: { nav: number; dayPnl: number };
  /** Header mirror: drop the capital knob, keep NAV + transport + paper/kill. */
  compact?: boolean;
}

function MasterStripImpl({ fund, fundPnl, compact = false }: MasterStripProps) {
  const dispatch = useDeskDispatch();
  const { canWrite, persistFund } = useDeskWrite();
  const [showNav, setShowNav] = useState(true);

  // LED value: NAV (digits only) or signed day P&L. Strip the $ / commas for
  // the 7-seg window (it renders digits, '-' and blanks).
  const ledRaw = showNav
    ? String(fund.is_halted ? 0 : fundPnl.nav)
    : (fundPnl.dayPnl < 0 ? "-" : "") + Math.abs(fundPnl.dayPnl);
  // Compact (header) NAV: abbreviated thousands, e.g. 100000 → "100.0" + "K".
  const navK = ((fund.is_halted ? 0 : fundPnl.nav) / 1000).toFixed(1);

  return (
    <div className={`master${compact ? " master--compact" : ""}`}>
      <div className="master-title">MASTER</div>

      {/* compact mirror always shows NAV (day P&L has its own LED beside it) */}
      <div
        className="master-led"
        onClick={compact ? undefined : () => setShowNav((v) => !v)}
        title={compact ? undefined : "click to toggle NAV / day P&L"}
      >
        <LedDisplay
          value={compact ? navK : ledRaw}
          digits={compact ? 4 : 7}
          unit={compact ? "K" : undefined}
          color={fund.is_halted ? "var(--amber)" : "var(--led-red)"}
          caption={compact ? "fund nav $" : showNav ? "fund nav $" : "day p&l $"}
        />
      </div>

      {!compact && (
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
      )}

      <div className={`master-ctrls${canWrite ? "" : " master-ctrls--locked"}`}>
        {!canWrite && (
          <div className="master-lock" title="Desk controls (START/STOP, paper/live, KILL) only take effect when signed in — they write to the DB. Sign in via the top-right.">
            ⊘ sign in to control the desk
          </div>
        )}
        <div className="master-transport">
          <TransportButton
            label="AUTO"
            variant="start"
            active={!fund.is_halted}
            onPress={() => undefined}
            disabled
          />
          <TransportButton
            label="PAUSE"
            variant="stop"
            onPress={() => undefined}
            disabled
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
        </div>
      </div>
    </div>
  );
}

// Memoized: a channel-knob drag re-renders Console each frame, but the master
// strip's props (fund, fundPnl) are referentially stable then, so it skips.
export const MasterStrip = memo(MasterStripImpl);
