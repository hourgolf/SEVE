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
import type { SurfaceProps } from "@/components/surfaceTypes";
import { useShell } from "@/hooks/useShellState";
import { signedUsd, usd0 } from "@/lib/format";
import type { PerformSection } from "@/lib/perform/derivePerformView";
import { deriveBrokerTelemetry, deriveProcessTelemetry } from "@/lib/shell/workstationTelemetry";

interface FolioShellProps {
  surface: SurfaceProps;
  dayChangePct: number | null;
  mobile: boolean;
  onLegacy: () => void;
}

type DesktopItem = {
  key: string;
  label: string;
  hint: string;
  mark: string;
  mode: "perform" | "studio";
  section?: PerformSection;
};

const DESKTOP_NAV: DesktopItem[] = [
  { key: "overview", label: "Home", hint: "Live desk", mark: "●", mode: "perform", section: "overview" },
  { key: "market", label: "Markets", hint: "Chart + chain", mark: "↗", mode: "perform", section: "market" },
  { key: "positions", label: "Book", hint: "Positions + exits", mark: "▣", mode: "perform", section: "positions" },
  { key: "studio", label: "Channels", hint: "Fleet + drafts", mark: "◫", mode: "studio" },
  { key: "sentinel", label: "Sentinel", hint: "Terrain", mark: "◇", mode: "perform", section: "sentinel" },
  { key: "tape", label: "Review", hint: "Tape + paths", mark: "≡", mode: "perform", section: "tape" },
  { key: "ops", label: "Ops", hint: "Readiness", mark: "⚙", mode: "perform", section: "ops" },
];

type FolioMobileRoom = "play" | "studio" | "book" | "review" | "ops";
const MOBILE_NAV: Array<{ id: FolioMobileRoom; label: string; mark: string }> = [
  { id: "play", label: "Home", mark: "⌂" },
  { id: "studio", label: "Channels", mark: "◫" },
  { id: "book", label: "Book", mark: "▣" },
  { id: "review", label: "Review", mark: "≡" },
  { id: "ops", label: "Ops", mark: "⚙" },
];

const compactUsd = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}m`;
  if (abs >= 100_000) return `$${Math.round(value / 1000)}k`;
  return usd0(value);
};

function FolioMark() {
  return <span className="folio-mark" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>;
}

function FolioDesktop({ surface, dayChangePct, onLegacy }: Omit<FolioShellProps, "mobile">) {
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

  const navigate = (item: DesktopItem) => {
    setMode(item.mode);
    if (item.mode === "perform" && item.section) setSection(item.section);
  };

  return (
    <div className="shell-root ws909 folio-shell" data-mode={mode} data-skin={skin} data-incident={incident.severity}>
      <header className="folio-head">
        <a className="folio-brand" href="/skin-lab" aria-label="Folio skin lab home"><FolioMark /><span><b>SEVE</b><small>FOLIO / SKIN 02</small></span></a>
        <button type="button" className={`folio-incident ${incident.severity}`} onClick={() => { setMode("perform"); setSection("overview"); }}>
          <i /><span><b>{incident.severity === "normal" ? "SYSTEM NOMINAL" : incident.title}</b><small>{incident.severity === "normal" ? `${process.label.toLowerCase()} · ${broker.label.toLowerCase()}` : incident.facts[0]}</small></span>
        </button>
        <div className="folio-clock"><b>{clock}</b><small>PT · {incident.session.replaceAll("_", " ")}</small></div>
        <nav className="folio-head-actions" aria-label="Skin lab controls">
          <a href="/">909</a>
          <button type="button" onClick={toggleSkin}>{skin === "cream" ? "DARK" : "LIGHT"}</button>
          <button type="button" className={write.canWrite ? "operator on" : "operator"} onClick={() => setAuthOpen(true)}>{write.canWrite ? "OP" : "SIGN IN"}</button>
        </nav>
      </header>

      <section className="folio-summary" aria-label="Desk summary">
        <article className="folio-hero">
          <div className="folio-hero-top"><span>PORTFOLIO</span><em>{selectedAccount?.mode ?? view.desk.fund.mode}</em></div>
          <div className="folio-hero-value"><small>Net asset value</small><b>{compactUsd(liveFund.nav)}</b></div>
          <div className="folio-hero-meta"><span><small>DAY P&amp;L</small><b className={liveFund.dayPnl < 0 ? "neg" : "pos"}>{signedUsd(liveFund.dayPnl)}</b></span><span><small>MOVE</small><b>{dayChangePct == null ? "—" : `${dayChangePct >= 0 ? "+" : ""}${dayChangePct.toFixed(2)}%`}</b></span></div>
          <FolioMark />
        </article>
        <article className="folio-account-card"><small>ACCOUNT</small><AccountSwitcher accounts={accounts} selected={acctId} onSelect={setAcctId} /><span>Paper-only routing</span></article>
        <article className="folio-stat coral"><small>OPEN POSITIONS</small><b>{feed.positions.length}</b><span>{feed.positions.length === 0 ? "Desk is flat" : "Manager active"}</span></article>
        <article className="folio-stat teal"><small>RISK USED</small><b>{riskUsed.toFixed(1)}%</b><span>{usd0(exposure)} desk exposure</span></article>
        <article className="folio-state-card"><span><small>PROCESS</small><b className={process.tone}>{process.label}</b></span><span><small>BROKER</small><b className={broker.tone}>{broker.label}</b></span></article>
      </section>

      <nav className="folio-nav" aria-label="Folio workspaces">
        <div className="folio-nav-links">
          {DESKTOP_NAV.map((item) => {
            const active = mode === item.mode && (item.mode === "studio" || section === item.section);
            return <button type="button" key={item.key} className={active ? "on" : ""} onClick={() => navigate(item)} aria-label={`${item.label} ${item.hint}`}><i>{item.mark}</i><span><b>{item.label}</b><small>{item.hint}</small></span></button>;
          })}
        </div>
        <button type="button" className="folio-legacy" onClick={onLegacy}>ROOMS</button>
        <div className="folio-kill"><span><small>AUTO</small><b>PAPER</b></span><KillControl halted={view.desk.fund.is_halted} /></div>
      </nav>

      <main className="folio-display" aria-label={`${mode} Folio workspace`}>
        {mode === "perform" ? <PerformSurface {...surface} section={section} /> : <StudioSurface {...surface} />}
      </main>

      <footer className="folio-foot"><span>FOLIO IS A PREVIEW-ONLY PRESENTATION STUDY</span><span>SAME DATA · SAME ACTIONS · NO RC5 CHANGES</span></footer>

      {authOpen && <div className="folio-auth" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAuthOpen(false); }}>
        <section role="dialog" aria-modal="true" aria-label="operator access"><header><b>Operator access</b><button type="button" onClick={() => setAuthOpen(false)} aria-label="close operator access">×</button></header><AuthControl defaultOpen /></section>
      </div>}
    </div>
  );
}

function FolioMobile({ surface }: { surface: SurfaceProps }) {
  const { skin, setSkin } = useShell();
  const [room, setRoom] = useState<FolioMobileRoom>("play");
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
  const status = surface.incident.severity === "normal" ? "Nominal" : surface.incident.title;

  return (
    <div className="m2-app folio-mobile" data-mode={room === "studio" ? "studio" : "perform"} data-room={room} data-skin={skin}>
      <header className="folio-mobile-head">
        <div className="folio-mobile-bar"><a href="/skin-lab" aria-label="Folio skin lab home"><FolioMark /><span><b>SEVE</b><small>FOLIO</small></span></a><div><span>{clock} PT</span><MobileKillControl halted={surface.view.desk.fund.is_halted} write={surface.write} /><button type="button" onClick={() => setSettingsOpen(true)} aria-label="open settings">•••</button></div></div>
        <button type="button" className={`folio-mobile-hero ${surface.incident.severity}`} onClick={() => setRoom("ops")} aria-label={`${status}; open Operations`}>
          <span className="folio-mobile-hero-top"><b>{status}</b><em>{surface.feed.positions.length} open · {surface.incident.session.replaceAll("_", " ")}</em></span>
          <span className="folio-mobile-hero-value"><small>Net asset value</small><strong>{compactUsd(surface.liveFund.nav)}</strong></span>
          <span className="folio-mobile-hero-meta"><span><small>DAY P&amp;L</small><b className={surface.liveFund.dayPnl < 0 ? "neg" : "pos"}>{signedUsd(surface.liveFund.dayPnl)}</b></span><span><small>{surface.symbol}</small><b>{surface.data.spot?.toFixed(2) ?? "—"}</b></span></span>
          <FolioMark />
        </button>
        <div className="folio-mobile-account"><AccountSwitcher accounts={surface.accounts} selected={surface.acctId} onSelect={surface.setAcctId} /><span>PAPER ONLY</span></div>
      </header>

      <main className="folio-mobile-main">
        {surface.data.error && <ErrorBanner message={surface.data.error} isAccessError={surface.data.isAccessError} />}
        {surface.data.warning && (room === "play" || room === "ops") && <div className="market-read-warning" role="status">{surface.data.warning}</div>}
        {room === "play" ? <MobilePerform props={surface} channels={channels} sent={surface.sentinel} livePnl={surface.livePnl} />
          : room === "studio" ? <MobileStudio props={surface} channels={channels} livePnl={surface.livePnl} openSlug={openSlug} setOpenSlug={setOpenSlug} onAddChannel={() => setAddOpen(true)} onOpenSettings={() => setSettingsOpen(true)} />
            : <MobileDeskRoom room={room} props={surface} channels={channels} livePnl={surface.livePnl} onViewChart={() => setRoom("play")} onOpenSettings={() => setSettingsOpen(true)} />}
      </main>

      <nav className="folio-mobile-nav" aria-label="Folio mobile workspaces">
        {MOBILE_NAV.map((item) => <button type="button" key={item.id} className={room === item.id ? "on" : ""} onClick={() => setRoom(item.id)} aria-label={item.label}><i>{item.mark}</i><span>{item.label}</span></button>)}
      </nav>
      <MobileSettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} skin={skin} setSkin={setSkin} events={surface.data.events} />
      {addOpen && <AddChannel onClose={() => setAddOpen(false)} existingSlugs={surface.view.desk.strategists.map((channel) => channel.slug)} />}
    </div>
  );
}

export function FolioShell({ mobile, ...props }: FolioShellProps) {
  return mobile ? <FolioMobile surface={props.surface} /> : <FolioDesktop {...props} />;
}
