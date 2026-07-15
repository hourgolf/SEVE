"use client";

import "@/app/workstation.css";
import { useEffect, useMemo, useState } from "react";
import { AccountSwitcher } from "@/components/console/AccountSwitcher";
import { AuthControl } from "@/components/AuthControl";
import { KillControl } from "@/components/console/hw/KillControl";
import { PerformSurface } from "@/components/perform/PerformSurface";
import { StudioSurface } from "@/components/studio/StudioSurface";
import { useDeskDispatch } from "@/hooks/useDeskState";
import { useShell } from "@/hooks/useShellState";
import { signedUsd, usd0 } from "@/lib/format";
import type { SurfaceProps } from "@/components/surfaceTypes";
import type { PerformSection } from "@/lib/perform/derivePerformView";

interface WorkstationShellProps {
  surface: SurfaceProps;
  dayChangePct: number | null;
  onLegacy: () => void;
}

const NAV = [
  { key: "overview", label: "Dashboard", icon: "▣", mode: "perform" as const, section: "overview" as const },
  { key: "market", label: "Markets", icon: "▤", mode: "perform" as const, section: "market" as const },
  { key: "positions", label: "Positions", icon: "⌁", mode: "perform" as const, section: "positions" as const },
  { key: "studio", label: "Channels", icon: "◉", mode: "studio" as const },
  { key: "sentinel", label: "Sentinel", icon: "◇", mode: "perform" as const, section: "sentinel" as const },
  { key: "tape", label: "Event Tape", icon: "≋", mode: "perform" as const, section: "tape" as const },
];

const compactUsd = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 100_000) return `$${Math.round(value / 1000)}k`;
  return usd0(value);
};

const sessionStep = (now: Date): number => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return Math.max(0, Math.min(15, Math.floor(((hour * 60 + minute) - 570) / (390 / 16))));
};

export function WorkstationShell({ surface, dayChangePct, onLegacy }: WorkstationShellProps) {
  const { mode, setMode, skin, toggleSkin, density, toggleDensity } = useShell();
  const dispatch = useDeskDispatch();
  const [now, setNow] = useState<Date | null>(null);
  const [performSection, setPerformSection] = useState<PerformSection>("overview");
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  const { view, feed, liveFund, livePnl, accounts, acctId, setAcctId, incident, workerRuns, write } = surface;
  const fund = view.desk.fund;
  const selectedAccount = accounts.find((account) => account.id === acctId);
  const roster = acctId ? view.desk.strategists.filter((s) => s.account_id === acctId) : view.desk.strategists;
  const exposure = useMemo(() => Object.values(livePnl).reduce((sum, pnl) => sum + pnl.exposure, 0), [livePnl]);
  const riskUsed = liveFund.nav > 0 ? (exposure / liveFund.nav) * 100 : 0;
  const processObserved = workerRuns.query.state === "ok" && workerRuns.currentHeartbeatAtMs != null;
  const incidentOn = incident.severity !== "normal";
  const step = now ? sessionStep(now) : 0;
  const clock = now?.toLocaleTimeString("en-US", { hour12: false, timeZone: "America/Los_Angeles" }) ?? "--:--:--";
  const navigate = (item: (typeof NAV)[number]) => {
    setMode(item.mode);
    if (item.mode !== "perform" || !("section" in item)) return;
    setPerformSection(item.section);
    if (item.section === "overview") return;
    window.setTimeout(() => document.getElementById(`perform-${item.section}`)?.focus({ preventScroll: true }), 0);
  };

  return (
    <div className="shell-root ws909" data-mode={mode} data-skin={skin} data-density={density} data-incident={incident.severity}>
      <span className="ws-screw ws-screw--tl" /><span className="ws-screw ws-screw--tr" />
      <span className="ws-screw ws-screw--bl" /><span className="ws-screw ws-screw--br" />

      <header className="ws-top">
        <div className="ws-brand"><strong>SEVE DESK</strong><span>TRADING WORKSTATION</span></div>
        <div className="ws-mode-tabs" role="tablist" aria-label="workstation mode">
          <button type="button" className={mode === "perform" ? "on" : ""} onClick={() => setMode("perform")}>PERFORM</button>
          <button type="button" className={mode === "studio" ? "on" : ""} onClick={() => setMode("studio")}>STUDIO</button>
        </div>
        <button type="button" className={`ws-alert ws-alert--${incident.severity}`} onClick={() => { setMode("perform"); setPerformSection("overview"); }}>
          <span>{incidentOn ? "▲" : "●"}</span><b>{incidentOn ? incident.title : "SYSTEM NOMINAL"}</b>
          <small>{incidentOn ? incident.facts[0] : `${roster.length} channels · process ${processObserved ? "observed" : "checking"}`}</small>
          <em>{incidentOn ? "VIEW INCIDENT" : "LIVE"}</em>
        </button>
        <div className="ws-utility">
          <button type="button" title="frame skin" onClick={toggleSkin}>{skin === "cream" ? "☼" : "◐"}</button>
          <button type="button" title="command palette" onClick={() => window.dispatchEvent(new CustomEvent("seve:command-palette"))}>⌘K</button>
          <button
            type="button"
            className={write.canWrite ? "op on" : "op"}
            title={write.canWrite ? "operator authenticated" : "sign in for operator controls"}
            aria-expanded={authOpen}
            aria-controls="workstation-operator-access"
            onClick={() => setAuthOpen(true)}
          >{write.canWrite ? "OP" : "LOGIN"}</button>
        </div>
      </header>

      <section className="ws-telemetry" aria-label="Desk telemetry">
        <div className="ws-account">
          <small>ACCOUNT</small>
          <AccountSwitcher accounts={accounts} selected={acctId} onSelect={setAcctId} />
          <b>{selectedAccount?.mode.toUpperCase() ?? fund.mode.toUpperCase()}</b>
        </div>
        <div className="ws-metric"><small>NAV</small><strong>{compactUsd(liveFund.nav)}</strong></div>
        <div className={`ws-metric ${liveFund.dayPnl < 0 ? "neg" : "pos"}`}><small>DAY P&amp;L</small><strong>{signedUsd(liveFund.dayPnl)}</strong><span>{dayChangePct != null ? `${dayChangePct >= 0 ? "+" : ""}${dayChangePct.toFixed(2)}%` : "—"}</span></div>
        <div className="ws-metric"><small>DESK CAPACITY</small><strong>{compactUsd(Math.max(0, liveFund.nav - exposure))}</strong></div>
        <div className="ws-metric"><small>OPEN POSITIONS</small><strong>{feed.positions.length}</strong></div>
        <div className="ws-metric"><small>RISK USED</small><strong>{riskUsed.toFixed(1)}%</strong></div>
        <div className="ws-metric ws-state"><small>DATA</small><strong>{processObserved ? "LIVE" : "CHECK"}<i /></strong></div>
        <div className="ws-metric ws-state"><small>BROKER</small><strong>UNRECONCILED<i className="amber" /></strong></div>
        <div className="ws-clock"><strong>{clock} PT</strong><span>{incident.session.replaceAll("_", " ")}</span></div>
      </section>

      <main className="ws-main">
        <nav className="ws-left" aria-label="Workstation sections">
          <div className="ws-left-label"><i />SECTIONS<span /></div>
          {NAV.map((item) => (
            <button key={item.key} type="button" className={mode === item.mode && (item.mode === "studio" || ("section" in item && performSection === item.section)) ? "on" : ""} onClick={() => navigate(item)}>
              <span>{item.icon}</span><b>{item.label}</b>
            </button>
          ))}
          <button type="button" onClick={onLegacy}><span>⌗</span><b>Legacy Rooms</b></button>
          <button type="button" className="ws-auth-launch" onClick={() => setAuthOpen(true)}>
            <span>OP</span><b>{write.canWrite ? "Operator" : "Sign In"}</b>
          </button>
          <div className="ws-system">
            <small>SYSTEM</small>
            <span>BOOT {workerRuns.boots16h}</span><span>ABRUPT {workerRuns.abrupt16h}</span>
            <span>VER 2026.07.11</span><span>{processObserved ? "CONNECTED" : "CHECKING"}</span>
          </div>
        </nav>

        <section className="ws-display" aria-label={`${mode} workstation display`}>
          {mode === "perform" ? <PerformSurface {...surface} section={performSection} /> : <StudioSurface {...surface} />}
        </section>
      </main>

      <footer className="ws-deck">
        <section className="ws-deck-mode"><small>MODE</small><div>
          <button type="button" className={mode === "perform" ? "on" : ""} onClick={() => { setMode("perform"); setPerformSection("overview"); }}><i />PERFORM</button>
          <button type="button" className={mode === "studio" ? "on" : ""} onClick={() => setMode("studio")}><i />STUDIO</button>
          <button type="button" onClick={onLegacy}><i />ROOMS</button>
        </div></section>
        <section className="ws-transport"><small>TRANSPORT</small><div>
          <button type="button" disabled={!write.canWrite} className={!fund.running ? "on" : ""} onClick={() => dispatch({ type: "STOP" })}>■<span>STOP</span></button>
          <button type="button" disabled={!write.canWrite || fund.is_halted} className={fund.running && !fund.is_halted ? "play on" : "play"} onClick={() => dispatch({ type: "START" })}>▶<span>PLAY</span></button>
          <button type="button" className="rec" disabled><i /><span>{fund.mode.toUpperCase()}</span></button>
        </div></section>
        <section className="ws-sequencer"><small>SESSION SEQUENCER</small><div>{Array.from({ length: 16 }, (_, i) => <i key={i} className={i === step ? "on" : i < step ? "past" : ""}><span>{i + 1}</span></i>)}</div></section>
        <section className="ws-controls"><small>CONTROL</small><div>
          <span className={`ws-dial ${incidentOn ? "hot" : "ok"}`}><i /><b>CHECK</b><em>{incident.severity}</em></span>
          <span className="ws-dial blue"><i style={{ transform: `rotate(${Math.min(130, -130 + riskUsed * 8)}deg)` }} /><b>RISK</b><em>{riskUsed.toFixed(1)}%</em></span>
          <span className="ws-dial amber"><i /><b>SIZE</b><em>{feed.positions.length} open</em></span>
          <button type="button" className="ws-density" onClick={toggleDensity}><b>{density === "compact" ? "CMP" : "COM"}</b><span>DENSITY</span></button>
        </div></section>
        <section className="ws-master"><small>MASTER</small><div className="ws-master-knob"><i /></div><KillControl halted={fund.is_halted} /></section>
      </footer>

      {authOpen && (
        <div className="ws-auth-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAuthOpen(false); }}>
          <section id="workstation-operator-access" className="ws-auth-panel" role="dialog" aria-modal="true" aria-label="operator access">
            <header>
              <div><b>OPERATOR ACCESS</b><span>{write.canWrite ? "authenticated · writes enabled" : "read only · sign in to control the desk"}</span></div>
              <button type="button" aria-label="close operator access" onClick={() => setAuthOpen(false)}>×</button>
            </header>
            <AuthControl defaultOpen />
            <p>Closing positions, changing channel controls, transport, and KILL remain unavailable until an authorized operator session is verified.</p>
          </section>
        </div>
      )}
    </div>
  );
}
