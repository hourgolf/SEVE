"use client";

import "@/app/skin-lab.css";
import { useEffect, useMemo, useState } from "react";
import { AccountSwitcher } from "@/components/console/AccountSwitcher";
import { AddChannel } from "@/components/console/AddChannel";
import { KillControl } from "@/components/console/hw/KillControl";
import { AuthControl } from "@/components/AuthControl";
import { ErrorBanner } from "@/components/ErrorBanner";
import { MobileDeskRoom } from "@/components/mobile2/MobileDeskSheet";
import { MobileKillControl } from "@/components/mobile2/MobileKillControl";
import { MobilePerform } from "@/components/mobile2/MobilePerform";
import { MobileSettingsSheet } from "@/components/mobile2/MobileSettingsSheet";
import { MobileStudio } from "@/components/mobile2/MobileStudio";
import { PerformSurface } from "@/components/perform/PerformSurface";
import { StudioSurface } from "@/components/studio/StudioSurface";
import { useShell } from "@/hooks/useShellState";
import { signedUsd, usd0 } from "@/lib/format";
import type { PerformSection } from "@/lib/perform/derivePerformView";
import { deriveBrokerTelemetry, deriveProcessTelemetry } from "@/lib/shell/workstationTelemetry";
import type { SurfaceProps } from "@/components/surfaceTypes";

interface AtlasShellProps {
  surface: SurfaceProps;
  dayChangePct: number | null;
  mobile: boolean;
  onLegacy: () => void;
}

const DESKTOP_NAV: Array<{
  key: string;
  label: string;
  hint: string;
  mode: "perform" | "studio";
  section?: PerformSection;
}> = [
  { key: "overview", label: "Overview", hint: "Live desk", mode: "perform", section: "overview" },
  { key: "market", label: "Markets", hint: "Chart + chain", mode: "perform", section: "market" },
  { key: "positions", label: "Positions", hint: "Book + exits", mode: "perform", section: "positions" },
  { key: "studio", label: "Channels", hint: "Fleet + drafts", mode: "studio" },
  { key: "sentinel", label: "Sentinel", hint: "Evidence", mode: "perform", section: "sentinel" },
  { key: "tape", label: "Review", hint: "Tape + paths", mode: "perform", section: "tape" },
  { key: "ops", label: "Ops", hint: "Readiness", mode: "perform", section: "ops" },
];

type AtlasMobileRoom = "play" | "studio" | "book" | "review" | "ops";
const MOBILE_NAV: Array<{ id: AtlasMobileRoom; label: string }> = [
  { id: "play", label: "Live" },
  { id: "studio", label: "Channels" },
  { id: "book", label: "Book" },
  { id: "review", label: "Review" },
  { id: "ops", label: "Ops" },
];

const compactUsd = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}m`;
  if (abs >= 100_000) return `$${Math.round(value / 1000)}k`;
  return usd0(value);
};

function AtlasDesktop({ surface, dayChangePct, onLegacy }: Omit<AtlasShellProps, "mobile">) {
  const { mode, setMode, skin, toggleSkin } = useShell();
  const [section, setSection] = useState<PerformSection>("overview");
  const [authOpen, setAuthOpen] = useState(false);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  const { accounts, acctId, setAcctId, feed, incident, liveFund, livePnl, opsReadiness, view, workerRuns, write } = surface;
  const exposure = useMemo(() => Object.values(livePnl).reduce((sum, row) => sum + row.exposure, 0), [livePnl]);
  const riskUsed = liveFund.nav > 0 ? (100 * exposure) / liveFund.nav : 0;
  const process = deriveProcessTelemetry(workerRuns, now?.getTime() ?? 0);
  const broker = deriveBrokerTelemetry(opsReadiness.evidence.find((item) => item.id === "reconciliation"));
  const selectedAccount = accounts.find((account) => account.id === acctId);
  const clock = now?.toLocaleTimeString("en-US", { hour12: false, timeZone: "America/Los_Angeles" }) ?? "--:--:--";

  const navigate = (item: (typeof DESKTOP_NAV)[number]) => {
    setMode(item.mode);
    if (item.mode === "perform" && item.section) setSection(item.section);
  };

  return (
    <div className="shell-root ws909 atlas-shell" data-mode={mode} data-skin={skin} data-incident={incident.severity}>
      <header className="atlas-head">
        <a className="atlas-brand" href="/skin-lab" aria-label="Atlas skin lab home">
          <b>SEVE</b><span>ATLAS / SKIN LAB 01</span>
        </a>
        <button type="button" className={`atlas-incident ${incident.severity}`} onClick={() => { setMode("perform"); setSection("overview"); }}>
          <i /><span><b>{incident.severity === "normal" ? "SYSTEM NOMINAL" : incident.title}</b><small>{incident.severity === "normal" ? "same live models · alternate presentation" : incident.facts[0]}</small></span>
        </button>
        <nav className="atlas-head-actions" aria-label="Skin lab controls">
          <a href="/">909 DESK</a>
          <button type="button" onClick={toggleSkin}>{skin === "cream" ? "DARK" : "LIGHT"}</button>
          <button type="button" className={write.canWrite ? "operator on" : "operator"} onClick={() => setAuthOpen(true)}>{write.canWrite ? "OPERATOR" : "SIGN IN"}</button>
        </nav>
      </header>

      <section className="atlas-vitals" aria-label="Desk telemetry">
        <div className="atlas-account"><small>ACCOUNT</small><AccountSwitcher accounts={accounts} selected={acctId} onSelect={setAcctId} /><em>{selectedAccount?.mode ?? view.desk.fund.mode}</em></div>
        <div><small>NAV</small><b>{compactUsd(liveFund.nav)}</b></div>
        <div className={liveFund.dayPnl < 0 ? "neg" : "pos"}><small>DAY</small><b>{signedUsd(liveFund.dayPnl)}</b><em>{dayChangePct == null ? "—" : `${dayChangePct >= 0 ? "+" : ""}${dayChangePct.toFixed(2)}%`}</em></div>
        <div><small>OPEN</small><b>{feed.positions.length}</b></div>
        <div><small>RISK USED</small><b>{riskUsed.toFixed(1)}%</b></div>
        <div className={`state ${process.tone}`} title={process.detail}><small>PROCESS</small><b>{process.label}</b></div>
        <div className={`state ${broker.tone}`} title={broker.detail}><small>BROKER</small><b>{broker.label}</b></div>
        <div className="atlas-time"><b>{clock}</b><small>PT · {incident.session.replaceAll("_", " ")}</small></div>
      </section>

      <div className="atlas-workspace">
        <aside className="atlas-nav">
          <div className="atlas-nav-title"><span>Workspace</span><small>PREVIEW ONLY</small></div>
          {DESKTOP_NAV.map((item) => {
            const active = mode === item.mode && (item.mode === "studio" || section === item.section);
            return <button type="button" key={item.key} className={active ? "on" : ""} onClick={() => navigate(item)}><b>{item.label}</b><small>{item.hint}</small></button>;
          })}
          <button type="button" onClick={onLegacy}><b>Legacy Rooms</b><small>Retained fallback</small></button>
          <div className="atlas-safety">
            <span><small>SESSION</small><b>AUTO · PAPER</b></span>
            <KillControl halted={view.desk.fund.is_halted} />
          </div>
        </aside>
        <main className="atlas-display" aria-label={`${mode} Atlas workspace`}>
          {mode === "perform" ? <PerformSurface {...surface} section={section} /> : <StudioSurface {...surface} />}
        </main>
      </div>

      <footer className="atlas-foot"><span>ATLAS IS A PRESENTATION PROTOTYPE</span><span>NO NEW FETCHES · NO RC5 CHANGES · 909 REMAINS PRODUCTION DEFAULT</span></footer>

      {authOpen && <div className="atlas-auth" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAuthOpen(false); }}>
        <section role="dialog" aria-modal="true" aria-label="operator access"><header><b>OPERATOR ACCESS</b><button type="button" onClick={() => setAuthOpen(false)}>×</button></header><AuthControl defaultOpen /></section>
      </div>}
    </div>
  );
}

function AtlasMobile({ surface }: { surface: SurfaceProps }) {
  const { skin, setSkin } = useShell();
  const [room, setRoom] = useState<AtlasMobileRoom>("play");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);

  const channels = useMemo(
    () => (surface.acctId ? surface.view.desk.strategists.filter((row) => row.account_id === surface.acctId) : surface.view.desk.strategists),
    [surface.view.desk.strategists, surface.acctId],
  );
  const clock = now?.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Los_Angeles" }) ?? "--:--";
  const status = surface.incident.severity === "normal" ? "NOMINAL" : surface.incident.severity.toUpperCase();

  return (
    <div className="m2-app atlas-mobile" data-mode={room === "studio" ? "studio" : "perform"} data-room={room} data-skin={skin}>
      <header className="atlas-mobile-head">
        <div className="atlas-mobile-brand"><span><b>SEVE</b><small>ATLAS LAB</small></span><a href="/">909</a></div>
        <button type="button" className={`atlas-mobile-status ${surface.incident.severity}`} onClick={() => setRoom("ops")}><i /><span><b>{status}</b><small>{surface.feed.positions.length} OPEN · {surface.incident.session.replaceAll("_", " ")}</small></span><em>{clock} PT</em></button>
        <div className="atlas-mobile-controls"><AccountSwitcher accounts={surface.accounts} selected={surface.acctId} onSelect={surface.setAcctId} /><span>{surface.view.desk.fund.mode.toUpperCase()}</span><MobileKillControl halted={surface.view.desk.fund.is_halted} write={surface.write} /><button type="button" onClick={() => setSettingsOpen(true)}>MENU</button></div>
        <div className="atlas-mobile-metrics"><span><small>{surface.symbol}</small><b>{surface.data.spot?.toFixed(2) ?? "—"}</b></span><span><small>DAY</small><b className={surface.liveFund.dayPnl < 0 ? "neg" : "pos"}>{signedUsd(surface.liveFund.dayPnl)}</b></span><span><small>NAV</small><b>{compactUsd(surface.liveFund.nav)}</b></span></div>
      </header>

      <main className="atlas-mobile-main">
        {surface.data.error && <ErrorBanner message={surface.data.error} isAccessError={surface.data.isAccessError} />}
        {surface.data.warning && (room === "play" || room === "ops") && <div className="market-read-warning" role="status">{surface.data.warning}</div>}
        {room === "play" ? <MobilePerform props={surface} channels={channels} sent={surface.sentinel} livePnl={surface.livePnl} />
          : room === "studio" ? <MobileStudio props={surface} channels={channels} livePnl={surface.livePnl} openSlug={openSlug} setOpenSlug={setOpenSlug} onAddChannel={() => setAddOpen(true)} onOpenSettings={() => setSettingsOpen(true)} />
            : <MobileDeskRoom room={room} props={surface} channels={channels} livePnl={surface.livePnl} onViewChart={() => setRoom("play")} onOpenSettings={() => setSettingsOpen(true)} />}
      </main>

      <nav className="atlas-mobile-nav" aria-label="Atlas mobile workspaces">
        {MOBILE_NAV.map((item) => <button type="button" key={item.id} className={room === item.id ? "on" : ""} onClick={() => setRoom(item.id)}>{item.label}</button>)}
      </nav>
      <MobileSettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} skin={skin} setSkin={setSkin} events={surface.data.events} />
      {addOpen && <AddChannel onClose={() => setAddOpen(false)} existingSlugs={surface.view.desk.strategists.map((channel) => channel.slug)} />}
    </div>
  );
}

export function AtlasShell({ mobile, ...props }: AtlasShellProps) {
  return mobile ? <AtlasMobile surface={props.surface} /> : <AtlasDesktop {...props} />;
}

