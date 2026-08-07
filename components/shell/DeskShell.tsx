"use client";

import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { LedDisplay } from "@/components/console/hw/LedDisplay";
import { KillControl } from "@/components/console/hw/KillControl";
import { AccountSwitcher } from "@/components/console/AccountSwitcher";
import { useShell } from "@/hooks/useShellState";
import type { FundState } from "@/lib/desk/types";
import type { OpsStatus } from "@/hooks/useOpsStatus";
import type { useAccounts } from "@/hooks/useAccounts";

// =============================================================================
// DeskShell — the shared top bar over both rooms (PERFORM/STUDIO rebuild · S1).
// A faithful lift of mock F's #topbar: brand · MODE switch · SPY/DAY LEDs · NAV
// LCD · FRAME switch · RUN/PAPER pills · KILL · PT clock · ⌘K/D affordances.
// Desktop only (rendered from Surface's desktop branch). The LEDs/KILL/account
// switch REUSE the existing hardware components + the live desk state — no new
// data path, no new kill logic. ⌘K is an S4 stub (broadcasts an event).
// =============================================================================

export interface DeskShellProps {
  fund: FundState;
  liveFund: { nav: number; dayPnl: number };
  ops: OpsStatus;
  accounts: ReturnType<typeof useAccounts>["accounts"];
  acctId: string | null;
  setAcctId: Dispatch<SetStateAction<string | null>>;
  /** §01 instrument spot + day direction/percent (from the market hook). */
  symbol: string;
  spot: number | null;
  spotUp: boolean | null;
  dayChangePct: number | null;
}

// Compact NAV — $1.94M above a million, else $NNNk (mirrors the mock's LCD).
function navCompact(n: number): string {
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${Math.round(n / 1000)}k`;
}

export function DeskShell({ fund, liveFund, ops, accounts, acctId, setAcctId, symbol, spot, spotUp, dayChangePct }: DeskShellProps) {
  const { mode, setMode, skin, toggleSkin, density, toggleDensity } = useShell();
  const cream = skin === "cream";
  const running = fund.running && !fund.is_halted;

  // Pacific desk clock — ticks every second (effect-only so SSR/first paint agree).
  const [clock, setClock] = useState<string | null>(null);
  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString("en-US", { hour12: false, timeZone: "America/Los_Angeles" }));
    tick();
    const iv = window.setInterval(tick, 1000);
    return () => window.clearInterval(iv);
  }, []);

  // Patch-switch strike on mode flip (quick brightness pulse, per mock F).
  const [strike, setStrike] = useState(false);
  const flipMode = (m: typeof mode) => {
    if (m === mode) return;
    setMode(m);
    setStrike(false);
    requestAnimationFrame(() => setStrike(true));
  };
  useEffect(() => { if (strike) { const t = setTimeout(() => setStrike(false), 200); return () => clearTimeout(t); } }, [strike]);

  const spotStr = spot != null ? spot.toFixed(2) : "----";
  const dayVal = Math.round(liveFund.dayPnl);
  const dayColor = dayVal < 0 ? "var(--hw-red-soft)" : "var(--hw-green)";
  const navStr = navCompact(fund.is_halted ? 0 : liveFund.nav);
  const worker = ops.hbNote ? ops.hbNote.slice(0, 16) : "—";

  return (
    <>
      <header className={`shell-bar${strike ? " shell-strike" : ""}`}>
        {/* brand + account scope */}
        <div className="brand">
          <div className="stripes"><i /><i /><i /></div>
          <div className="btxt"><b>SEVE</b><span>0DTE DESK</span></div>
        </div>
        <AccountSwitcher accounts={accounts} selected={acctId} onSelect={setAcctId} />

        {/* MODE — segmented switch (also `S`) */}
        <div className="tb-mod tb-mode">
          <div className="modesw" role="tablist" aria-label="desk mode">
            <button type="button" className={mode === "studio" ? "on" : ""} onClick={() => flipMode("studio")} aria-pressed={mode === "studio"}>STUDIO</button>
            <button type="button" className={mode === "perform" ? "on" : ""} onClick={() => flipMode("perform")} aria-pressed={mode === "perform"}>PERFORM</button>
          </div>
          <span className="silk">MODE · S</span>
        </div>

        <div className="vsep" />

        {/* SPY spot LED */}
        <div className="tb-mod tb-spot">
          <div className="ledwin red"><LedDisplay value={spotStr} digits={spotStr.replace(".", "").length} color="var(--led-red)" /></div>
          <span className="silk">
            {symbol}&nbsp;
            {dayChangePct != null && (
              <span className={dayChangePct < 0 ? "cap-neg" : "cap-pos"}>
                {dayChangePct >= 0 ? "+" : ""}{dayChangePct.toFixed(2)}%
              </span>
            )}
          </span>
        </div>

        {/* DAY P&L LED */}
        <div className="tb-mod tb-day">
          <div className={`ledwin ${dayVal < 0 ? "red" : "grn"}`}>
            <span className="led-dollar" style={{ color: dayColor }}>$</span>
            <LedDisplay value={String(dayVal)} digits={String(Math.abs(dayVal)).length + (dayVal < 0 ? 1 : 0)} color={dayColor} />
          </div>
          <span className="silk">SESSION NAV Δ</span>
        </div>

        {/* NAV LCD */}
        <div className="tb-mod tb-nav">
          <div className="ledwin neu"><span className={`lcdtxt ${fund.is_halted ? "amb" : ""} sm num`}>{navStr}</span></div>
          <span className="silk">NAV{acctId ? "" : " · ALL"}</span>
        </div>

        <div className="tb-spacer" />

        {/* FRAME switch — GLOBAL blackout⇄cream (also `F`) */}
        <div className="tb-mod tb-frame">
          <button
            type="button"
            className="framesw"
            role="switch"
            aria-checked={cream}
            aria-label="frame skin — blackout or cream"
            title="frame + hardware skin — BLACKOUT ⇄ CREAM · global"
            onClick={toggleSkin}
          >
            <span className={`fsw-lab${!cream ? " lit" : ""}`}>BLACKOUT</span>
            <span className="fsw-track"><span className="fsw-thumb" /></span>
            <span className={`fsw-lab${cream ? " lit" : ""}`}>CREAM</span>
          </button>
          <span className="silk">FRAME · F</span>
        </div>

        <div className="vsep" />

        {/* RUN / PAPER indicators */}
        <div className="tb-mod tb-run">
          {fund.is_halted ? (
            <span className="pill halt">HALT</span>
          ) : running ? (
            <span className="pill run"><span className="pdot" />RUN</span>
          ) : (
            <span className="pill">STOP</span>
          )}
          <span className="silk">{worker}</span>
        </div>
        <div className="tb-mod tb-exec">
          <span className="pill">{fund.mode === "live" ? "LIVE" : "PAPER"}</span>
          <span className="silk">EXEC</span>
        </div>

        {/* KILL — reuses the existing arm/fire KillControl + halt dispatch */}
        <div className="tb-mod tb-mod--kill">
          <KillControl halted={fund.is_halted} />
          <span className="silk">KILL = FLATTEN</span>
        </div>

        <div className="vsep" />

        {/* Pacific desk clock */}
        <div className="tb-mod tb-clock">
          <div className="ledwin neu"><span className="lcdtxt num">{clock ?? "--:--:--"}</span></div>
          <span className="silk">PT</span>
        </div>

        {/* ⌘K palette (S4) + DENSITY (`D`, real) — the keycap fires the same
            `seve:command-palette` event the global ⌘K keydown broadcasts; the
            CommandPalette mounted at the shell level listens + owns open/close. */}
        <div className="tb-mod tb-palette">
          <button type="button" className="keycap" title="command palette (⌘K)" onClick={() => window.dispatchEvent(new CustomEvent("seve:command-palette"))}>⌘K</button>
          <span className="silk">PALETTE</span>
        </div>
        <div className="tb-mod tb-density">
          <button type="button" className={`keycap${density === "compact" ? " lit" : ""}`} title="data density — comfortable ⇄ compact" onClick={toggleDensity}>D</button>
          <span className="silk">DENSITY</span>
        </div>
      </header>
      <div className="shell-band"><i /><i /><i /><i /></div>
    </>
  );
}
