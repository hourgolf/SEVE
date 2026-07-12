"use client";

import "@/app/mobile2.css";
import { useEffect, useMemo, useState } from "react";
import { LedDisplay } from "@/components/console/hw/LedDisplay";
import { MobilePerform } from "@/components/mobile2/MobilePerform";
import { MobileStudio } from "@/components/mobile2/MobileStudio";
import { MobileDeskRoom } from "@/components/mobile2/MobileDeskSheet";
import { MobileKillControl } from "@/components/mobile2/MobileKillControl";
import { MobileSettingsSheet } from "@/components/mobile2/MobileSettingsSheet";
import { AddChannel } from "@/components/console/AddChannel";
import { AccountSwitcher } from "@/components/console/AccountSwitcher";
import { ErrorBanner } from "@/components/ErrorBanner";
import { useShell } from "@/hooks/useShellState";
import type { SurfaceProps } from "@/components/surfaceTypes";

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
  { id: "play", label: "PLAY", sub: "CHART" },
  { id: "studio", label: "STUDIO", sub: "CHANNELS" },
  { id: "book", label: "BOOK", sub: "POSITIONS" },
  { id: "review", label: "REVIEW", sub: "READ" },
  { id: "ops", label: "OPS", sub: "SYSTEM" },
];

export function MobileShell(props: SurfaceProps) {
  const { data, view, accounts, acctId, setAcctId, spotUp, liveFund, livePnl, symbol } = props;
  const { skin, setSkin } = useShell();
  const sent = props.sentinel; // P5 slice 1 — from the page seam (SurfaceProps), no local subscription

  const [room, setRoom] = useState<MobileRoom>("play");
  const [setOpen, setSetOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [openSlug, setOpenSlug] = useState<string | null>(null); // studio accordion — one at a time
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);

  const { desk } = view;
  const channels = useMemo(
    () => (acctId ? desk.strategists.filter((s) => s.account_id === acctId) : desk.strategists),
    [desk.strategists, acctId],
  );

  const running = desk.fund.running && !desk.fund.is_halted;
  const runLabel = desk.fund.is_halted ? "HALT" : running ? "RUN" : "STOP";
  const runCls = desk.fund.is_halted ? "halt" : running ? "on" : "off";

  const down = liveFund.dayPnl < 0;
  const dayLed = (down ? "-" : "") + Math.abs(Math.round(liveFund.dayPnl));
  const dayColor = down ? "var(--led-red)" : "var(--pm-green)";
  const spotStr = data.spot != null ? data.spot.toFixed(2) : "----";
  const spotColor = spotUp == null ? "var(--led-red)" : spotUp ? "var(--pm-green)" : "var(--led-red)";
  const navK = (liveFund.nav / 1000).toFixed(1);
  const statusOn = props.incident.severity !== "normal";
  const clock = now?.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Los_Angeles",
  }) ?? "--:--";

  return (
    <div className="m2-app" data-mode={room === "studio" ? "studio" : "perform"} data-room={room} data-skin={skin}>
      <span className="m2-screw m2-screw--tl" /><span className="m2-screw m2-screw--tr" />
      <span className="m2-screw m2-screw--bl" /><span className="m2-screw m2-screw--br" />
      <header className="m2-head">
        <div className="m2-head-r1">
          <span className="m2-brand"><b>SEVE DESK</b><small>MOBILE WORKSTATION</small></span>
          <button type="button" className={`m2-status m2-status--${props.incident.severity}`} onClick={() => setRoom("play")}>
            <i /><span><b>{statusOn ? props.incident.title : "SYSTEM NOMINAL"}</b><small>OPEN {props.feed.positions.length} · {props.incident.session.replaceAll("_", " ")}</small></span>
            <em>{clock} PT</em>
          </button>
          <button type="button" className="m2-cog" onClick={() => setSetOpen(true)} aria-label="settings and log"><IcCog /></button>
        </div>
        <div className="m2-head-meta">
          <AccountSwitcher accounts={accounts} selected={acctId} onSelect={setAcctId} />
          <span className="grow" />
          <span className={`m2-pill m2-run ${runCls}`}>{runLabel}</span>
          <span className={`m2-pill m2-md ${desk.fund.mode}`}>{desk.fund.mode === "live" ? "LIVE" : "PAPER"}</span>
          <MobileKillControl halted={desk.fund.is_halted} write={props.write} />
        </div>
        <div className="m2-head-r2">
          <div className="m2-led-mod">
            <LedDisplay value={spotStr} digits={6} color={spotColor} caption={`${symbol} spot`} />
          </div>
          <div className="m2-led-mod">
            <LedDisplay value={dayLed} digits={6} color={dayColor} caption="day p&l $" />
          </div>
          <div className="m2-led-mod">
            <LedDisplay value={navK} digits={5} unit="K" color="var(--led-amber)" caption="nav $" />
          </div>
        </div>
      </header>
      <div className="m2-band"><i /><i /><i /><i /></div>

      <main className="m2-main">
        {data.error && <ErrorBanner message={data.error} isAccessError={data.isAccessError} />}
        {room === "play" ? (
          <MobilePerform props={props} channels={channels} sent={sent} livePnl={livePnl} />
        ) : room === "studio" ? (
          <MobileStudio props={props} channels={channels} livePnl={livePnl} openSlug={openSlug} setOpenSlug={setOpenSlug} onAddChannel={() => setAddOpen(true)} onOpenSettings={() => setSetOpen(true)} />
        ) : <MobileDeskRoom room={room} props={props} channels={channels} livePnl={livePnl} onViewChart={() => setRoom("play")} onOpenSettings={() => setSetOpen(true)} />}
      </main>

      <nav className="m2-padbar" aria-label="rooms">
        {ROOMS.map((item) => <button type="button" key={item.id} className={`m2-modepad m2-roompad${room === item.id ? " on" : ""}`} onClick={() => setRoom(item.id)} aria-pressed={room === item.id}>
          {item.label}<small>{item.sub}</small>
        </button>)}
      </nav>

      <MobileSettingsSheet open={setOpen} onClose={() => setSetOpen(false)} skin={skin} setSkin={setSkin} events={data.events} />
      {addOpen && <AddChannel onClose={() => setAddOpen(false)} existingSlugs={view.desk.strategists.map((channel) => channel.slug)} />}
    </div>
  );
}
