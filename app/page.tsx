"use client";

import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import "./console.css";
import "./mobile.css";
import "./shell.css";
import { useMarketData } from "@/hooks/useMarketData";
import { useDeskState } from "@/hooks/useDeskState";
import { useDeskFeed } from "@/hooks/useDeskFeed";
import { useDeskWrite } from "@/hooks/useDeskWrite";
import { useAccounts } from "@/hooks/useAccounts";
import { useOpsStatus } from "@/hooks/useOpsStatus";
import { usePositionMarks } from "@/hooks/usePositionMarks";
import { usePositionPeaks } from "@/hooks/usePositionPeaks";
import { useSentinelDigest } from "@/hooks/useSentinelDigest";
import { useWorkerRuns } from "@/hooks/useWorkerRuns";
import { useKitSounds } from "@/hooks/useKitSounds";
import { channelPnl, liveFundPnl } from "@/lib/desk/derive";
import { useIsMobile } from "@/hooks/useIsMobile";
import { DeskProvider } from "@/components/console/DeskProvider";
import { DesktopSurface } from "@/components/DesktopSurface";
import { MobileShell } from "@/components/mobile2/MobileShell";
import { DeskShell } from "@/components/shell/DeskShell";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { PerformSurface } from "@/components/perform/PerformSurface";
import { StudioSurface } from "@/components/studio/StudioSurface";
import { ShellProvider, useShell } from "@/hooks/useShellState";
import { marketSummary } from "@/lib/marketSummary";
import type { Room } from "@/components/surfaceTypes";

// One set of data hooks, two layouts: the wide desktop chassis or the phone
// tab-shell. The data-seam pattern means neither layout re-subscribes.
function Surface({
  theme,
  setTheme,
}: {
  theme: "cream" | "blackout";
  setTheme: Dispatch<SetStateAction<"cream" | "blackout">>;
}) {
  // §01 market instrument (SPY default, QQQ live). One state drives the single
  // market hook + the chart/chain/spot toggle — the desk (§02/§03) is per-channel.
  const [symbol, setSymbol] = useState("SPY");
  const data = useMarketData(symbol);
  const view = useDeskState();
  // Multi-account (cockpit P3): the selected bucket scopes the live feed (NAV / signals /
  // positions / day-P&L) as well as the roster. Declared ABOVE useDeskFeed so the feed reads
  // the selected account's data, not the desk total.
  const { accounts } = useAccounts();
  const [acctId, setAcctId] = useState<string | null>(null);
  const feed = useDeskFeed(acctId);
  const write = useDeskWrite();
  const isMobile = useIsMobile();
  const { mode, density } = useShell();
  const [selected, setSelected] = useState<string | null>(null);

  // SPY up/down on the day: spot vs the PRIOR session's close (the conventional
  // day-change reference). Using today's first bar mis-colored it — that bar can
  // be a noisy pre-market print well above the prior close. null until ready.
  const spotUp = useMemo<boolean | null>(() => {
    const bars = data.bars;
    if (!bars.length || data.spot == null) return null;
    const today = bars[bars.length - 1].ts.slice(0, 10);
    let priorClose: number | null = null;
    for (let i = bars.length - 1; i >= 0; i--) {
      if (bars[i].ts.slice(0, 10) < today) { priorClose = bars[i].close; break; }
    }
    return priorClose != null ? data.spot >= priorClose : null;
  }, [data.bars, data.spot]);

  // Lifted to the seam — called ONCE here so the persistent shell AND both layouts
  // share one accounts/ops poll + one live-marked P&L derivation (no re-subscribe).
  const ops = useOpsStatus();
  useEffect(() => { if (!acctId && accounts.length) setAcctId(accounts[0].id); }, [accounts, acctId]);
  const liveMarks = usePositionMarks(feed.positions);
  const livePnl = channelPnl([...feed.positions, ...feed.recentTrades], liveMarks);
  const liveFund = liveFundPnl(feed.fundPnl, feed.positions, liveMarks);
  // P5 slice 1 — shared remote reads LIFTED to the seam (called ONCE here, carried through
  // SurfaceProps). PERFORM + mobile leaves consumed these directly before; now they never
  // subscribe. sentinel (brief/scan/judge/lens), workerRuns (crash-attribution ledger, wired
  // for the incident banner — not rendered yet, that's slice 3), positionPeaks (ratcheted MFE).
  const sentinel = useSentinelDigest();
  const workerRuns = useWorkerRuns();
  const positionPeaks = usePositionPeaks(feed.positions, liveMarks);
  // 909 KIT — audible fills (opt-in via the KIT pad; inert while off). At the
  // seam so desktop + mobile share one diff of the same feed.
  useKitSounds(feed.positions, feed.recentTrades);

  // Active room (shell tabs) + the DESK market-band collapse — persisted so the
  // operator returns to the same room/layout. Lifted to the seam (passed down).
  const [activeRoom, setActiveRoom] = useState<Room>("play");
  useEffect(() => {
    const s = localStorage.getItem("seve-room");
    if (s === "play" || s === "mix" || s === "write" || s === "tape" || s === "ops") setActiveRoom(s);
  }, []);
  useEffect(() => { localStorage.setItem("seve-room", activeRoom); }, [activeRoom]);
  const [collapsedMarket, setCollapsedMarket] = useState(false);

  const props = { data, view, feed, write, spotUp, selected, setSelected, symbol, setSymbol, theme, setTheme, accounts, acctId, setAcctId, ops, liveMarks, livePnl, liveFund, activeRoom, setActiveRoom, collapsedMarket, setCollapsedMarket, sentinel, workerRuns, positionPeaks };

  // P5 slice 2 — the legacy §01–§04 product (DesktopSurface) is no longer MOUNTED beneath
  // STUDIO (that duplicated the header/transport/KILL/chart/book/sequencer/nav on one page).
  // It moves behind ONE explicit entry: a "Legacy rooms" link at the foot of STUDIO opens it
  // as a full replacement view (reusing the single seam — no re-subscription), with a way back.
  const [legacyOpen, setLegacyOpen] = useState(false);

  // Mobile (S5 rework) — the PERFORM/STUDIO phone shell. Shares the same seam
  // props + the persisted mode/skin (useShell) as desktop; MobileApp is retained
  // on disk (reviewer decides deletion at S6) but no longer mounted.
  if (isMobile) return <MobileShell {...props} />;

  // DESKTOP — the new DeskShell top bar spans both rooms; MODE branches the
  // body under it. .shell-root is a SIBLING of the legacy chassis (not an
  // ancestor) so the shell's skin tokens never leak into the untouched STUDIO
  // rooms. STUDIO renders today's DesktopSurface verbatim; PERFORM = the S2 stub.
  const mkt = marketSummary(data.bars, data.spot);

  // LEGACY VIEW (P5 slice 2) — the full DesktopSurface as a REPLACEMENT (not a sibling
  // beneath STUDIO), so only one product/header/transport/KILL is ever on screen. Rendered
  // OUTSIDE .shell-root (its own cream chassis; shell skin tokens must not leak in). The seam
  // hooks live in Surface (above), so DesktopSurface still gets the single-subscription props.
  if (legacyOpen) {
    return (
      <div className="legacy-view">
        <button type="button" className="legacy-back" onClick={() => setLegacyOpen(false)}>← Back to desk</button>
        <DesktopSurface {...props} />
      </div>
    );
  }

  return (
    <div className="shell-root" data-mode={mode} data-skin={theme} data-density={density}>
      <DeskShell
        fund={view.desk.fund}
        liveFund={liveFund}
        ops={ops}
        accounts={accounts}
        acctId={acctId}
        setAcctId={setAcctId}
        symbol={symbol}
        spot={data.spot}
        spotUp={spotUp}
        dayChangePct={mkt.dayChangePct}
      />
      {mode === "perform" && <PerformSurface {...props} />}
      {mode === "studio" && <StudioSurface {...props} />}
      {/* Named destination for the legacy §01–§04 rooms — one explicit link, at the foot of
          STUDIO, opening the full legacy desk as a replacement view. No functionality lost;
          removed wholesale at slice 7 once each room is natively migrated. */}
      {mode === "studio" && (
        <button type="button" className="legacy-entry" onClick={() => setLegacyOpen(true)}>
          Legacy rooms · §01 live market · §02 composer · §03 book &amp; P&amp;L · §04 tape ▸
        </button>
      )}
      {/* ⌘K COMMAND palette (S4) — mounted ONCE inside .shell-root so it floats over EITHER
          room. Opens on the shared `seve:command-palette` event; roster scoped to the account. */}
      <CommandPalette
        channels={acctId ? view.desk.strategists.filter((s) => s.account_id === acctId) : view.desk.strategists}
        setActiveRoom={setActiveRoom}
        setSelected={setSelected}
      />
    </div>
  );
}

// The chassis theme (cream | blackout) is now the shell SKIN — the same union,
// one source of truth. The FRAME switch (`F`) and the OPS settings toggle both
// flip it; the page stamps it as data-theme on .console-root (the legacy
// [data-theme="blackout"] override still re-skins the whole chassis) and the
// shell mirrors it as data-skin. ShellProvider owns the persisted state.
function PageInner() {
  const { skin, setSkin } = useShell();
  // Dispatch-shaped adapter so the shared SurfaceProps type is unchanged — the
  // OPS/mobile toggles call it value-form, but honour functional updaters too.
  const setTheme: Dispatch<SetStateAction<"cream" | "blackout">> = (v) =>
    setSkin(typeof v === "function" ? v(skin) : v);
  return (
    <div className="console-root" data-theme={skin}>
      <DeskProvider>
        <Surface theme={skin} setTheme={setTheme} />
      </DeskProvider>
    </div>
  );
}

export default function Page() {
  return (
    <ShellProvider>
      <PageInner />
    </ShellProvider>
  );
}
