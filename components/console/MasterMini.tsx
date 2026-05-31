"use client";

import { LedDisplay } from "@/components/console/hw/LedDisplay";
import type { FundState } from "@/lib/desk/types";

// A read-only mirror of the master strip, sized for the chassis head: run/mode/
// halt state + a SPY-style LED for the day's fund P&L (green up, red down). The
// full interactive master strip lives in section 02.
export function MasterMini({
  fund,
  fundPnl,
}: {
  fund: FundState;
  fundPnl: { nav: number; dayPnl: number };
}) {
  const running = fund.running && !fund.is_halted;
  const runLabel = fund.is_halted ? "HALT" : running ? "RUN" : "STOP";
  const runCls = fund.is_halted ? "halt" : running ? "on" : "off";

  const down = fundPnl.dayPnl < 0;
  const dayLed = (down ? "-" : "") + Math.abs(Math.round(fundPnl.dayPnl));

  return (
    <div className="master-mini">
      <div className="mm-state">
        <span className={`mm-pill mm-run ${runCls}`}>{runLabel}</span>
        <span className={`mm-pill mm-mode ${fund.mode}`}>
          {fund.mode === "live" ? "LIVE" : "PAPER"}
        </span>
      </div>
      <LedDisplay
        value={dayLed}
        digits={6}
        color={down ? "var(--led-red)" : "var(--pm-green)"}
        caption="day p&l $"
      />
    </div>
  );
}
