"use client";

import "@/app/perform.css";
import { IntradayChart } from "@/components/IntradayChart";
import { useSentinelDigest } from "@/hooks/useSentinelDigest";
import { PerformRail } from "@/components/perform/PerformRail";
import { PerformDock } from "@/components/perform/PerformDock";
import type { SurfaceProps } from "@/components/surfaceTypes";

// =============================================================================
// PERFORM surface (PERFORM/STUDIO rebuild · slice S2) — the watching room.
// Full-viewport grid under the shared DeskShell top bar: chart hero (~65%) left,
// the positions/sentinel/tape rail right, the channel-chicklet dock along the
// bottom. Mounts INSIDE .shell-root[data-mode="perform"] (a sibling of the
// legacy chassis), so all styling is scoped there and STUDIO stays untouched.
//
// DATA: every source is REUSED from the seam — IntradayChart (bars/overlays/SENT
// chip/markers), feed.positions + usePositionPeaks (rail book), useSentinelDigest
// (verdict + brief levels + era-4 lens), data.events (tape), useDeskState roster
// (dock). No new subscriptions; nothing re-forks the feed.
// =============================================================================

export function PerformSurface({
  data, view, feed, spotUp, symbol, setSymbol, acctId, livePnl, liveMarks,
}: SurfaceProps) {
  const { desk } = view;
  const sent = useSentinelDigest(); // one fetch — lens → dock, judge/brief → rail

  // Scope the roster to the selected account (same rule as DesktopSurface).
  const channels = acctId ? desk.strategists.filter((s) => s.account_id === acctId) : desk.strategists;

  return (
    <div className="perform">
      <main className="pf-stage">
        <IntradayChart
          bars={data.bars}
          dailyBars={data.dailyBars}
          spot={data.spot}
          spotUp={spotUp}
          trades={feed.recentTrades}
          openPositions={feed.positions}
          symbol={symbol}
          onSymbolChange={setSymbol}
          fill
        />
        <PerformRail
          positions={feed.positions}
          strategists={desk.strategists}
          liveMarks={liveMarks}
          events={data.events}
          symbol={symbol}
          sent={sent}
        />
      </main>
      <PerformDock channels={channels} livePnl={livePnl} lens={sent.lens} />
    </div>
  );
}
