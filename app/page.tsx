"use client";

import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import "./console.css";
import "./mobile.css";
import { useMarketData } from "@/hooks/useMarketData";
import { useDeskState } from "@/hooks/useDeskState";
import { useDeskFeed } from "@/hooks/useDeskFeed";
import { useDeskWrite } from "@/hooks/useDeskWrite";
import { useAccounts } from "@/hooks/useAccounts";
import { useOpsStatus } from "@/hooks/useOpsStatus";
import { usePositionMarks } from "@/hooks/usePositionMarks";
import { channelPnl, liveFundPnl } from "@/lib/desk/derive";
import { useIsMobile } from "@/hooks/useIsMobile";
import { DeskProvider } from "@/components/console/DeskProvider";
import { DesktopSurface } from "@/components/DesktopSurface";
import { MobileApp } from "@/components/mobile/MobileApp";
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

  // Active room (shell tabs) + the DESK market-band collapse — persisted so the
  // operator returns to the same room/layout. Lifted to the seam (passed down).
  const [activeRoom, setActiveRoom] = useState<Room>("desk");
  useEffect(() => {
    const s = localStorage.getItem("seve-room");
    if (s === "desk" || s === "review" || s === "ops") setActiveRoom(s);
  }, []);
  useEffect(() => { localStorage.setItem("seve-room", activeRoom); }, [activeRoom]);
  const [collapsedMarket, setCollapsedMarket] = useState(false);

  const props = { data, view, feed, write, spotUp, selected, setSelected, symbol, setSymbol, theme, setTheme, accounts, acctId, setAcctId, ops, liveMarks, livePnl, liveFund, activeRoom, setActiveRoom, collapsedMarket, setCollapsedMarket };
  return isMobile ? <MobileApp {...props} /> : <DesktopSurface {...props} />;
}

export default function Page() {
  // Chassis theme — cream (default) | blackout. Persisted to localStorage; applied
  // as data-theme on .console-root (the single [data-theme="blackout"] CSS override
  // re-skins the whole subtree). The toggle control lives in the OPS room.
  const [theme, setTheme] = useState<"cream" | "blackout">("cream");
  useEffect(() => {
    const saved = localStorage.getItem("seve-theme");
    if (saved === "blackout" || saved === "cream") setTheme(saved);
  }, []);
  useEffect(() => {
    localStorage.setItem("seve-theme", theme);
  }, [theme]);
  return (
    <div className="console-root" data-theme={theme}>
      <DeskProvider>
        <Surface theme={theme} setTheme={setTheme} />
      </DeskProvider>
    </div>
  );
}
