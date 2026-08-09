"use client";

import "@/app/mobile2.css";
import "@/app/seve-909.css";
import { useEffect, useMemo, useState } from "react";
import { LedDisplay, LedWordmark } from "@/components/console/hw/LedDisplay";
import { MobilePerform, type MobileMarketView } from "@/components/mobile2/MobilePerform";
import { MobileStudio } from "@/components/mobile2/MobileStudio";
import { MobileDeskRoom } from "@/components/mobile2/MobileDeskSheet";
import { MobileKillControl } from "@/components/mobile2/MobileKillControl";
import { MobileSettingsSheet } from "@/components/mobile2/MobileSettingsSheet";
import { AddChannel } from "@/components/console/AddChannel";
import { AccountSwitcher } from "@/components/console/AccountSwitcher";
import { ErrorBanner } from "@/components/ErrorBanner";
import { useShell } from "@/hooks/useShellState";
import type { SurfaceProps } from "@/components/surfaceTypes";
import { useWorkspaceDestination } from "@/hooks/useWorkspaceDestination";
import type { WorkspaceDestination } from "@/lib/shell/workspaceDestination";

// =============================================================================
// MOBILE SHELL — a phone-native 909 desk. The legacy mobile information
// architecture is deliberate here: PLAY (chart + actionable book), STUDIO,
// BOOK, REVIEW and OPS are direct rooms. Mobile does not mirror the desktop
// navigation or hide primary operator jobs behind a command palette.
// The shell is scroll-locked (height:100dvh, overflow hidden); only the mode
// screen scrolls. The cog opens the Settings·Log sheet (auth survives there).
// =============================================================================

const IcCog = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2v2.4M12 19.6V22M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2 12h2.4M19.6 12H22M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7" />
  </svg>
);

type MobileRoom = "play" | "studio" | "book" | "review" | "ops";
const ROOMS: { id: MobileRoom; label: string; sub: string }[] = [
  { id: "play", label: "HOME", sub: "MARKET" },
  { id: "studio", label: "CHANNELS", sub: "ROSTER" },
  { id: "book", label: "POSITIONS", sub: "BOOK" },
  { id: "review", label: "REVIEW", sub: "RESEARCH" },
  { id: "ops", label: "SYSTEM", sub: "STATUS" },
];

export function MobileShell(props: SurfaceProps) {
  const { data, view, accounts, acctId, setAcctId, liveFund, livePnl } = props;
  const { skin, setSkin, setMode } = useShell();
  const sent = props.sentinel; // P5 slice 1 — from the page seam (SurfaceProps), no local subscription

  const [room, setRoom] = useState<MobileRoom>("play");
  const [marketView, setMarketView] = useState<MobileMarketView>("chart");
  const [setOpen, setSetOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [openSlug, setOpenSlug] = useState<string | null>(null); // studio accordion — one at a time
  const { destination, navigate } = useWorkspaceDestination("overview");

  const roomFor = (next: WorkspaceDestination): MobileRoom => next.section === "studio" ? "studio"
    : next.section === "positions" ? "book"
      : next.section === "research" || next.section === "tape" ? "review"
        : next.section === "ops" ? "ops" : "play";
  useEffect(() => {
    setRoom(roomFor(destination));
    if (destination.channel && destination.section === "studio") setOpenSlug(destination.channel);
    if (destination.section === "market") {
      setMarketView("chain");
      if (destination.occ) {
        const root = destination.occ.match(/^([A-Z]+)/)?.[1];
        if (root) props.setSymbol(root);
        props.setSelected(destination.occ);
      }
    }
  }, [destination, props.setSelected, props.setSymbol]);

  // REVIEW enables the bounded page-owned research ledger. Hidden phone rooms
  // remain quiet, while every leaf stays subscription-free.
  useEffect(() => {
    // Keep the shared shell mode aligned with the phone-native room. Page-owned
    // Studio hooks use this mode as their subscription gate.
    setMode(room === "studio" ? "studio" : "perform");
    props.setActiveRoom(
      room === "studio" ? "mix" : room === "review" ? "tape" : room === "ops" ? "ops" : "play",
    );
  }, [room, props.setActiveRoom, setMode]);

  const { desk } = view;
  const channels = useMemo(
    () => (acctId ? desk.strategists.filter((s) => s.account_id === acctId) : desk.strategists),
    [desk.strategists, acctId],
  );

  const down = liveFund.dayPnl < 0;
  const dayLed = `${down ? "-" : "+"}$${Math.abs(Math.round(liveFund.dayPnl))}`;
  const dayColor = down ? "var(--led-red)" : "var(--pm-green)";
  const statusOn = props.incident.severity !== "normal";
  const openMarket = (next: MobileMarketView) => {
    setMarketView(next);
    setRoom("play");
    navigate({ section: "market" });
  };
  const openStudioChannel = (slug: string) => {
    setOpenSlug(slug);
    setRoom("studio");
    navigate({ section: "studio", channel: slug });
  };
  const navigateMobile = (next: WorkspaceDestination) => {
    setRoom(roomFor(next));
    navigate(next);
  };
  return (
    <div className="m2-app" data-mode={room === "studio" ? "studio" : "perform"} data-room={room} data-skin={skin}>
      <span className="m2-screw m2-screw--tl" /><span className="m2-screw m2-screw--tr" />
      <span className="m2-screw m2-screw--bl" /><span className="m2-screw m2-screw--br" />
      <header className="m2-head">
        <div className="m2-head-r1">
          <button type="button" className={`m2-status m2-status--${props.incident.severity}`} onClick={() => setRoom("play")}>
            <span className="m2-brand m2-brand--led">
              <LedWordmark value="$EVE" color={dayColor} label={`$EVE desk ${down ? "down" : "up"} for the day`} />
            </span>
            <span className="m2-status-center">
              <i />
              <span className="m2-status-copy"><b>{statusOn ? props.incident.title : "SYSTEM NOMINAL"}</b><small>OPEN {props.feed.positions.length} · {props.incident.session.replaceAll("_", " ")}</small></span>
            </span>
          </button>
          <MobileKillControl halted={desk.fund.is_halted} write={props.write} />
          <button type="button" className="m2-cog" onClick={() => setSetOpen(true)} aria-label="settings and log"><IcCog /></button>
        </div>
        <div className="m2-head-meta">
          <AccountSwitcher accounts={accounts} selected={acctId} onSelect={setAcctId} />
          <div className="m2-account-pnl" role="img" aria-label={`Selected account session NAV change ${dayLed}`}>
            <b>SESSION<br />NAV Δ</b>
            <LedDisplay value={dayLed} digits={6} color={dayColor} />
          </div>
        </div>
      </header>

      <main className="m2-main">
        {(destination.channel || destination.check || destination.occ) && <button type="button" className="m2-context-back" onClick={() => window.history.back()}>← BACK</button>}
        {data.error && <ErrorBanner message={data.error} isAccessError={data.isAccessError} />}
        {data.warning && (room === "play" || room === "ops") && <div className="market-read-warning" role="status">{data.warning}</div>}
        {room === "play" ? (
          <MobilePerform props={props} channels={channels} sent={sent} livePnl={livePnl} marketView={marketView} onMarketViewChange={setMarketView} onOpenChannel={openStudioChannel} />
        ) : room === "studio" ? (
          <MobileStudio props={props} channels={channels} livePnl={livePnl} openSlug={openSlug} setOpenSlug={setOpenSlug} destination={destination} onNavigate={navigateMobile} onAddChannel={() => setAddOpen(true)} onOpenSettings={() => setSetOpen(true)} />
        ) : <MobileDeskRoom room={room} props={props} channels={channels} livePnl={livePnl} destination={destination} onNavigate={navigateMobile} onViewMarket={openMarket} onOpenSettings={() => setSetOpen(true)} />}
      </main>

      <nav className="m2-padbar" aria-label="rooms">
        {ROOMS.map((item) => <button type="button" key={item.id} className={`m2-modepad m2-roompad${room === item.id ? " on" : ""}`} onClick={() => navigateMobile({ section: item.id === "studio" ? "studio" : item.id === "book" ? "positions" : item.id === "review" ? "tape" : item.id === "ops" ? "ops" : "overview" })} aria-pressed={room === item.id} aria-current={room === item.id ? "page" : undefined}>
          {item.label}<small>{item.sub}</small>
        </button>)}
      </nav>

      <MobileSettingsSheet open={setOpen} onClose={() => setSetOpen(false)} skin={skin} setSkin={setSkin} events={data.events} />
      {addOpen && <AddChannel onClose={() => setAddOpen(false)} existingSlugs={view.desk.strategists.map((channel) => channel.slug)} />}
    </div>
  );
}
