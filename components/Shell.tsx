"use client";

import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { KillControl } from "@/components/console/hw/KillControl";
import { AccountSwitcher } from "@/components/console/AccountSwitcher";
import { KitToggle } from "@/components/console/KitToggle";
import { sessionStep } from "@/components/console/SessionSequencer";
import { useDeskWrite } from "@/hooks/useDeskWrite";
import { signedUsd } from "@/lib/format";
import type { FundState } from "@/lib/desk/types";
import type { OpsStatus } from "@/hooks/useOpsStatus";
import type { useAccounts } from "@/hooks/useAccounts";
import type { Room } from "@/components/surfaceTypes";

const ROOMS: { id: Room; label: string; jp: string }[] = [
  { id: "desk", label: "DESK", jp: "操作" },
  { id: "review", label: "REVIEW", jp: "検証" },
  { id: "ops", label: "OPS", jp: "運用" },
];

// ET market-hours gate so the health dot isn't red all weekend (a quiet worker
// off-hours is normal, not an alarm).
function inRth(): boolean {
  const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const d = et.getDay(), m = et.getHours() * 60 + et.getMinutes();
  return d >= 1 && d <= 5 && m >= 570 && m < 960;
}

export interface ShellProps {
  fund: FundState;
  liveFund: { nav: number; dayPnl: number };
  booksDelta: number;
  ops: OpsStatus;
  accounts: ReturnType<typeof useAccounts>["accounts"];
  acctId: string | null;
  setAcctId: Dispatch<SetStateAction<string | null>>;
  activeRoom: Room;
  setActiveRoom: Dispatch<SetStateAction<Room>>;
}

// The persistent shell: wordmark + account + health + NAV/DAY/BOOKS LEDs + room
// tabs + the ONE always-visible KILL. (Settings live in the OPS room tab — no
// separate cog.) Owns the kill wiring (local arm state + KILL/RESET_HALT dispatch).
export function Shell({ fund, liveFund, booksDelta, ops, accounts, acctId, setAcctId, activeRoom, setActiveRoom }: ShellProps) {
  const { canWrite } = useDeskWrite();

  // STEP readout — the session sequencer's clock, mirrored on the transport
  // (set in an effect + 30s tick so SSR/hydration can't disagree on the time).
  const [stepNow, setStepNow] = useState<number | null>(null);
  useEffect(() => {
    setStepNow(sessionStep());
    const iv = window.setInterval(() => setStepNow(sessionStep()), 30_000);
    return () => window.clearInterval(iv);
  }, []);

  const running = fund.running && !fund.is_halted;
  const runLabel = fund.is_halted ? "HALT" : running ? "RUN" : "STOP";
  const runCls = fund.is_halted ? "halt" : running ? "on" : "off";

  const down = liveFund.dayPnl < 0;
  const dayColor = down ? "var(--led-red)" : "var(--pm-green)";
  const navK = ((fund.is_halted ? 0 : liveFund.nav) / 1000).toFixed(1);
  const dTone = Math.abs(booksDelta) < 100 ? "ok" : Math.abs(booksDelta) < 500 ? "warn" : "bad";

  // Composite HEALTH dot — stream heartbeat (RTH-gated), the one glanceable
  // "is the machine alive?" so the operator never leaves the cockpit to check OPS.
  const rth = inRth();
  let hTone: "ok" | "warn" | "bad" | "dim" = "dim";
  let hLabel = "—";
  if (ops.loaded) {
    if (ops.hbAgeSec == null) { hTone = rth && ops.streamArmed > 0 ? "bad" : "dim"; hLabel = ops.streamArmed > 0 ? "no beat" : "idle"; }
    else if (ops.hbAgeSec < 60) { hTone = "ok"; hLabel = "live"; }
    else if (ops.hbAgeSec < 300) { hTone = "warn"; hLabel = "lagging"; }
    else { hTone = rth && ops.streamArmed > 0 ? "bad" : "dim"; hLabel = rth && ops.streamArmed > 0 ? "STALE" : "idle"; }
  }

  return (
    <header className="shell">
      <div className="shell-l">
        <span className="shell-mark">$EVE</span>
        <AccountSwitcher accounts={accounts} selected={acctId} onSelect={setAcctId} />
        <span className={`mm-pill mm-run ${runCls}`}>{runLabel}</span>
        <span className={`mm-pill mm-mode ${fund.mode}`}>{fund.mode === "live" ? "LIVE" : "PAPER"}</span>
        <span className={`shell-health sh-${hTone}`} title={ops.hbNote ? `worker: ${ops.hbNote}` : "stream/cron health (heartbeat)"}>
          <i />{hLabel}
        </span>
      </div>

      <div className="shell-leds">
        <span className="shell-led">
          <span className="sl-cap">NAV</span>
          <span className="sl-v" style={{ color: fund.is_halted ? "var(--amber)" : "var(--nav-orange)" }}>{`$${navK}k`}</span>
        </span>
        <span className="shell-led">
          <span className="sl-cap">DAY</span>
          <span className="sl-v" style={{ color: dayColor }}>{signedUsd(liveFund.dayPnl)}</span>
        </span>
        <span className={`shell-books shb-${dTone}`} title="NAV − attribution Σ (small = the books reconcile)">
          <span className="shb-k">BOOKS</span>
          <span className="shb-v">{`Δ${signedUsd(booksDelta)}`}</span>
        </span>
        <span className="shell-led shell-step" title="session step — 16 steps map 9:30→16:00 ET (the sequencer under the Live Book)">
          <span className="sl-cap">STEP</span>
          <span className="sl-v" style={{ color: stepNow != null ? "var(--led-red)" : "#8a8c8e" }}>
            {stepNow != null ? `${stepNow + 1}·16` : "—"}
          </span>
        </span>
      </div>

      <nav className="shell-tabs" aria-label="rooms">
        {ROOMS.map((r) => (
          <button
            key={r.id}
            type="button"
            className={`shell-tab${activeRoom === r.id ? " on" : ""}`}
            onClick={() => setActiveRoom(r.id)}
            aria-pressed={activeRoom === r.id}
          >
            {r.label}<span className="jp">{r.jp}</span>
          </button>
        ))}
      </nav>

      <div className="shell-r">
        <span className={`shell-write${canWrite ? " on" : ""}`} title={canWrite ? "changes persist to the desk" : "read-only — sign in via OPS to control the desk"}>
          {canWrite ? "● operator" : "○ read-only"}
        </span>
        <KitToggle />
        <KillControl halted={fund.is_halted} />
      </div>
    </header>
  );
}
