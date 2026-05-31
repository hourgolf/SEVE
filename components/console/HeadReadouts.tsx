"use client";

import { LedDisplay } from "@/components/console/hw/LedDisplay";
import type { FundState } from "@/lib/desk/types";

// The inline readout cluster that sits in the nav bar: run/mode state pills +
// two SPY-style 7-seg LEDs — the day fund P&L (green up / red down) and the SPY
// spot (green if up on the day, red if down). Read-only; controls live in the
// header master strip.
export function HeadReadouts({
  fund,
  fundPnl,
  spot,
  spotUp,
}: {
  fund: FundState;
  fundPnl: { nav: number; dayPnl: number };
  spot: number | null;
  spotUp: boolean | null;
}) {
  const running = fund.running && !fund.is_halted;
  const runLabel = fund.is_halted ? "HALT" : running ? "RUN" : "STOP";
  const runCls = fund.is_halted ? "halt" : running ? "on" : "off";

  const down = fundPnl.dayPnl < 0;
  const dayLed = (down ? "-" : "") + Math.abs(Math.round(fundPnl.dayPnl));
  const dayColor = down ? "var(--led-red)" : "var(--pm-green)";
  // SPY LED: green when up on the day, red when down (or unknown).
  const spyColor = spotUp ? "var(--pm-green)" : "var(--led-red)";

  return (
    <div className="head-readouts">
      <div className="mm-state">
        <span className={`mm-pill mm-run ${runCls}`}>{runLabel}</span>
        <span className={`mm-pill mm-mode ${fund.mode}`}>
          {fund.mode === "live" ? "LIVE" : "PAPER"}
        </span>
      </div>
      <LedDisplay value={dayLed} digits={6} color={dayColor} caption="day p&l $" />
      <LedDisplay
        value={spot != null ? spot.toFixed(2) : "----"}
        digits={6}
        color={spyColor}
        caption="spy $"
      />
    </div>
  );
}
