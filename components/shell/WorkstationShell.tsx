"use client";

import "@/app/workstation.css";
import { useEffect, useMemo, useState } from "react";
import { AuthControl } from "@/components/AuthControl";
import { KillControl } from "@/components/console/hw/KillControl";
import { LedDisplay, LedWordmark } from "@/components/console/hw/LedDisplay";
import { SessionSequencer } from "@/components/console/SessionSequencer";
import { PerformSurface } from "@/components/perform/PerformSurface";
import { StudioSurface } from "@/components/studio/StudioSurface";
import { useShell } from "@/hooks/useShellState";
import { openThemeLab } from "@/components/theme/ThemeBridge";
import { signedUsd, usd0 } from "@/lib/format";
import { deriveBrokerTelemetry, deriveProcessTelemetry } from "@/lib/shell/workstationTelemetry";
import type { SurfaceProps } from "@/components/surfaceTypes";
import type { PerformSection } from "@/lib/perform/derivePerformView";

interface WorkstationShellProps {
  surface: SurfaceProps;
  onLegacy: () => void;
}

const NAV = [
  { key: "overview", label: "Dashboard", icon: "▣", group: "trade", mode: "perform" as const, section: "overview" as const },
  { key: "market", label: "Markets", icon: "▤", group: "trade", mode: "perform" as const, section: "market" as const },
  { key: "positions", label: "Positions", icon: "⌁", group: "trade", mode: "perform" as const, section: "positions" as const },
  { key: "studio", label: "Channels", icon: "◉", group: "trade", mode: "studio" as const },
  { key: "research", label: "Research", icon: "∿", group: "evidence", mode: "perform" as const, section: "research" as const },
  { key: "sentinel", label: "Sentinel", icon: "◇", group: "evidence", mode: "perform" as const, section: "sentinel" as const },
  { key: "tape", label: "Review", icon: "≋", group: "evidence", mode: "perform" as const, section: "tape" as const },
  { key: "ops", label: "Ops", icon: "⌘", group: "system", mode: "perform" as const, section: "ops" as const },
];

const compactUsd = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 100_000) return `$${Math.round(value / 1000)}k`;
  return usd0(value);
};

const ledCompact = (value: number): { value: string; digits: number; unit?: string } => {
  const negative = value < 0;
  const absolute = Math.abs(value);
  const trim = (formatted: string) => formatted.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
  let shown: string;
  let unit: string | undefined;
  if (absolute >= 1_000_000) {
    shown = trim((absolute / 1_000_000).toFixed(absolute >= 10_000_000 ? 1 : 2));
    unit = "M";
  } else if (absolute >= 1_000) {
    shown = trim((absolute / 1_000).toFixed(absolute >= 100_000 ? 0 : 1));
    unit = "K";
  } else {
    shown = String(Math.round(absolute));
  }
  const display = `${negative ? "-" : ""}${shown}`;
  return { value: display, digits: display.replace(".", "").length, unit };
};

export function WorkstationShell({ surface, onLegacy }: WorkstationShellProps) {
  const { mode, setMode, skin, toggleSkin, density } = useShell();
  const [now, setNow] = useState<Date | null>(null);
  const [performSection, setPerformSection] = useState<PerformSection>("overview");
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  // The 909 shell owns visual workspace navigation, while remote subscriptions
  // remain page-owned. Keep the existing seam room signal aligned with what is
  // actually visible so deep OPS ledgers run only in OPS (and do run there).
  useEffect(() => {
    surface.setActiveRoom(
      mode === "perform" && performSection === "ops"
        ? "ops"
        : mode === "perform" && (performSection === "research" || performSection === "tape")
          ? "tape"
          : mode === "studio"
            ? "mix"
            : "play",
    );
  }, [mode, performSection, surface.setActiveRoom]);

  const { view, feed, liveFund, livePnl, accounts, acctId, setAcctId, incident, workerRuns, write } = surface;
  const fund = view.desk.fund;
  const exposure = useMemo(() => Object.values(livePnl).reduce((sum, pnl) => sum + pnl.exposure, 0), [livePnl]);
  const deskCapacity = Math.max(0, liveFund.nav - exposure);
  const riskUsed = liveFund.nav > 0 ? (exposure / liveFund.nav) * 100 : 0;
  const startOfDayNav = liveFund.nav - liveFund.dayPnl;
  const dayPnlPct = startOfDayNav > 0 ? (liveFund.dayPnl / startOfDayNav) * 100 : null;
  const processTelemetry = deriveProcessTelemetry(workerRuns, now?.getTime() ?? 0);
  const brokerTelemetry = deriveBrokerTelemetry(surface.opsReadiness.evidence.find((item) => item.id === "reconciliation"));
  const incidentOn = incident.severity !== "normal";
  const railTone = incidentOn
    ? incident.severity
    : processTelemetry.tone === "red" || brokerTelemetry.tone === "red"
      ? "critical"
      : processTelemetry.tone === "amber" || processTelemetry.tone === "dim" || brokerTelemetry.tone === "amber" || brokerTelemetry.tone === "dim"
        ? "checking"
        : "normal";
  const railLabel = incidentOn ? incident.title : railTone === "normal" ? "SYSTEM NOMINAL" : "SYSTEM CHECK";
  const railDetail = `DATA ${processTelemetry.label} · BROKER ${brokerTelemetry.label} · ${incident.session.replaceAll("_", " ")}`;
  const navLed = ledCompact(liveFund.nav);
  const dayLed = ledCompact(liveFund.dayPnl);
  const dayPctLed = dayPnlPct == null
    ? null
    : `${dayPnlPct >= 0 ? "+" : "-"}${Math.abs(dayPnlPct).toFixed(2)}`;
  const capacityLed = ledCompact(deskCapacity);
  const positionsLed = ledCompact(feed.positions.length);
  const positionAttributionBlocked = feed.positionAttribution.state === "blocked";
  const riskLedValue = riskUsed.toFixed(1);
  const dayLedColor = liveFund.dayPnl < 0 ? "var(--led-red)" : "var(--pm-green)";
  const activeNav = NAV.find((item) => mode === item.mode && (item.mode === "studio" || ("section" in item && performSection === item.section))) ?? NAV[0];
  const navigate = (item: (typeof NAV)[number]) => {
    setMode(item.mode);
    if (item.mode !== "perform" || !("section" in item)) return;
    setPerformSection(item.section);
    if (item.section === "overview") return;
    window.setTimeout(() => document.getElementById(`perform-${item.section}`)?.focus({ preventScroll: true }), 0);
  };

  return (
    <div className="shell-root ws909" data-mode={mode} data-section={activeNav.key} data-skin={skin} data-density={density} data-incident={incident.severity}>
      <span className="ws-screw ws-screw--tl" /><span className="ws-screw ws-screw--tr" />
      <span className="ws-screw ws-screw--bl" /><span className="ws-screw ws-screw--br" />

      <header className="ws-rail" aria-label="Desk command rail">
        <div className="ws-brand ws-brand--led"><LedWordmark value="$EVE" color={dayLedColor} label="$EVE" /></div>
        <div className="ws-account">
          <div className="ws-account-bank" role="group" aria-label="account">
            {accounts.map((account, index) => {
              const active = acctId === account.id;
              const color = account.mode === "live"
                ? "var(--hw-red-soft)"
                : active
                  ? "var(--hw-green)"
                  : "var(--ws-led-neutral)";
              return (
                <button
                  key={account.id}
                  type="button"
                  className={`ws-account-key${active ? " on" : ""}${account.mode === "live" ? " live" : ""}`}
                  aria-label={`Account ${index + 1}: ${account.name}`}
                  aria-pressed={active}
                  title={`${account.name} (${account.mode})`}
                  onClick={() => setAcctId(account.id)}
                >
                  <LedDisplay value={String(index + 1)} digits={1} color={color} />
                </button>
              );
            })}
          </div>
        </div>
        <div className="ws-metric ws-metric--led ws-metric--nav"><small>NAV</small><div className="ws-led-readout neutral" role="img" aria-label={`NAV ${compactUsd(liveFund.nav)}`}><span aria-hidden="true">$</span><LedDisplay value={navLed.value} digits={navLed.digits} color="var(--ws-led-neutral)" unit={navLed.unit} /></div></div>
        <div className={`ws-metric ws-metric--led ws-metric--pnl ${liveFund.dayPnl < 0 ? "neg" : "pos"}`}>
          <small>DAY P&amp;L</small>
          <div className="ws-day-readouts">
            <div className="ws-led-readout" role="img" aria-label={`Day P and L ${signedUsd(liveFund.dayPnl)}`} style={{ color: dayLedColor }}><span aria-hidden="true">$</span><LedDisplay value={dayLed.value} digits={dayLed.digits} color={dayLedColor} unit={dayLed.unit} /></div>
            <div className="ws-led-percent" role="img" aria-label={dayPnlPct == null ? "Day P and L percentage unavailable" : `Day P and L ${dayPnlPct.toFixed(2)} percent`}>
              {dayPctLed ? <LedDisplay value={dayPctLed} digits={dayPctLed.replace(".", "").length} color={dayLedColor} unit="%" /> : <span>—</span>}
            </div>
          </div>
        </div>
        <div className="ws-metric ws-metric--led ws-metric--capacity"><small>DESK CAPACITY</small><div className="ws-led-readout neutral" role="img" aria-label={`Desk capacity ${compactUsd(deskCapacity)}`}><span aria-hidden="true">$</span><LedDisplay value={capacityLed.value} digits={capacityLed.digits} color="var(--ws-led-neutral)" unit={capacityLed.unit} /></div></div>
        <div className="ws-metric ws-metric--led ws-metric--positions"><small>OPEN POSITIONS</small><div className="ws-led-readout neutral" role="img" aria-label={positionAttributionBlocked ? "Open positions unavailable because immutable account attribution is blocked" : `${feed.positions.length} open positions`}>{positionAttributionBlocked ? <span className="ws-led-unknown">—</span> : <LedDisplay value={positionsLed.value} digits={Math.max(2, positionsLed.digits)} color="var(--ws-led-neutral)" />}</div></div>
        <div className="ws-metric ws-metric--led ws-metric--risk"><small>RISK USED</small><div className="ws-led-readout neutral" role="img" aria-label={positionAttributionBlocked ? "Risk used unavailable because immutable account attribution is blocked" : `Risk used ${riskLedValue} percent`}>{positionAttributionBlocked ? <span className="ws-led-unknown">—</span> : <LedDisplay value={riskLedValue} digits={riskLedValue.replace(".", "").length} color="var(--ws-led-neutral)" unit="%" />}</div></div>
        <button type="button" className={`ws-health ws-health--${railTone}`} title={incidentOn ? incident.facts.join(" · ") : railDetail} aria-label={`${railLabel}. ${railDetail}.`} onClick={() => { setMode("perform"); setPerformSection("overview"); }}>
          <i aria-hidden="true" /><span><b>{railLabel}</b><small>{railDetail}</small></span>
        </button>
        <div className="ws-rail-actions">
          <details className="ws-utility-menu">
            <summary aria-label="Open workstation utilities" title="workstation utilities">•••</summary>
            <div>
              <button type="button" onClick={toggleSkin}>{skin === "cream" ? "BLACKOUT" : "CREAM"}</button>
              <button type="button" onClick={openThemeLab}>THEME LAB</button>
              <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("seve:command-palette"))}>COMMAND ⌘K</button>
            </div>
          </details>
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

      <main className="ws-main">
        <nav className="ws-left" aria-label="Workstation sections">
          <div className="ws-left-label"><i />SECTIONS<span /></div>
          {NAV.map((item, index) => {
            const active = item.key === activeNav.key;
            const newGroup = index > 0 && NAV[index - 1].group !== item.group;
            return (
              <button key={item.key} type="button" className={`${active ? "on" : ""}${newGroup ? " group-start" : ""}`} aria-current={active ? "page" : undefined} onClick={() => navigate(item)}>
                <span aria-hidden="true">{item.icon}</span><span className="ws-left-copy"><b>{item.label}</b></span>
              </button>
            );
          })}
          <button type="button" className="group-start" onClick={onLegacy}><span aria-hidden="true">⌗</span><span className="ws-left-copy"><b>Legacy Rooms</b></span></button>
          <button type="button" className="ws-auth-launch" onClick={() => setAuthOpen(true)}>
            <span aria-hidden="true">OP</span><span className="ws-left-copy"><b>{write.canWrite ? "Operator" : "Sign In"}</b></span>
          </button>
        </nav>

        <section className="ws-display" aria-label={`${activeNav.label} workspace`}>
          {mode === "perform" ? <PerformSurface {...surface} section={performSection} /> : <StudioSurface {...surface} />}
        </section>
      </main>

      <footer className="ws-deck">
        <section className="ws-sequencer">
          <small>SESSION SEQUENCER</small>
          <SessionSequencer
            variant="dock"
            positions={feed.positions}
            recentTrades={feed.recentTrades}
            strategists={view.desk.strategists}
          />
        </section>
        <section className="ws-master"><small>MASTER</small><KillControl halted={fund.is_halted} /></section>
      </footer>

      {authOpen && (
        <div className="ws-auth-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAuthOpen(false); }}>
          <section id="workstation-operator-access" className="ws-auth-panel" role="dialog" aria-modal="true" aria-label="operator access">
            <header>
              <div><b>OPERATOR ACCESS</b><span>{write.canWrite ? "authenticated · writes enabled" : "read only · sign in to control the desk"}</span></div>
              <button type="button" aria-label="close operator access" onClick={() => setAuthOpen(false)}>×</button>
            </header>
            <AuthControl defaultOpen />
            <p>Closing positions, changing channel controls, and KILL remain unavailable until an authorized operator session is verified. Session admission is automatic; PAUSE is not connected yet.</p>
          </section>
        </div>
      )}
    </div>
  );
}
