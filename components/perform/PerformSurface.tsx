"use client";

import "@/app/perform.css";
import "@/app/incident.css";
import "@/app/seve-909.css";
import { IntradayChart } from "@/components/IntradayChart";
import { IncidentBanner } from "@/components/perform/IncidentBanner";
import { PerformRail } from "@/components/perform/PerformRail";
import { PerformDock } from "@/components/perform/PerformDock";
import { PerformMarketsWorkspace } from "@/components/perform/PerformMarketsWorkspace";
import { PerformPositionsWorkspace } from "@/components/perform/PerformPositionsWorkspace";
import { SentinelWorkspace } from "@/components/perform/SentinelWorkspace";
import { ReviewWorkspace } from "@/components/perform/ReviewWorkspace";
import { OpsWorkspace } from "@/components/perform/OpsWorkspace";
import { ShadowResearchWorkspace } from "@/components/perform/ShadowResearchWorkspace";
import { DecisionHomeWorkspace } from "@/components/perform/DecisionHomeWorkspace";
import { derivePerformFocus, type PerformSection } from "@/lib/perform/derivePerformView";
import type { SurfaceProps } from "@/components/surfaceTypes";
import type { WorkspaceDestination } from "@/lib/shell/workspaceDestination";

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
  section = "overview",
  destination,
  onNavigate,
  ...surface
}: SurfaceProps & { section?: PerformSection; destination?: WorkspaceDestination; onNavigate?: (destination: WorkspaceDestination) => void }) {
  const {
    data, view, feed, write, spotUp, symbol, setSymbol, accountChannels, livePnl, liveMarks, sentinel, positionPeaks, incident,
  } = surface;
  const { desk } = view;
  const sent = sentinel; // P5 slice 1 — from the page seam (SurfaceProps), no local subscription

  const channels = accountChannels;
  const focus = section === "positions" ? "positions" : derivePerformFocus(incident.severity, feed.positions.length);

  return (
    <div className="perform" data-incident={incident.severity} data-focus={focus} data-section={section}>
      {/* P5 slice 3 — deterministic incident banner (hidden on normal; critical pre-empts chart space). */}
      <IncidentBanner incident={incident} />
      <main className="pf-stage">
        {data.warning && <div className="market-read-warning" role="status">{data.warning}</div>}
        {section === "market" ? <PerformMarketsWorkspace surface={surface} destination={destination} onNavigate={onNavigate} /> : section === "positions" ? <PerformPositionsWorkspace surface={surface} onNavigate={onNavigate} /> : section === "research" ? <ShadowResearchWorkspace surface={surface} destination={destination} onNavigate={onNavigate} /> : section === "sentinel" ? <SentinelWorkspace sentinel={sentinel} symbol={symbol} activeConfigurationHash={surface.channelWorkspace.release.state === "verified" ? surface.channelWorkspace.release.expectedHash : null} activeControlPlane={surface.channelControlPlane.view} fallbackRootSlugs={surface.channelWorkspace.release.rootSlugs} /> : section === "tape" ? <ReviewWorkspace surface={surface} destination={destination} onNavigate={onNavigate} /> : section === "ops" ? <OpsWorkspace surface={surface} destination={destination} onNavigate={onNavigate} /> : onNavigate ? <DecisionHomeWorkspace surface={surface} onNavigate={onNavigate} /> : <>
          <div className="pf-market-target" tabIndex={-1}>
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
              hideTitle
            />
          </div>
          <PerformRail
            positions={feed.positions}
            strategists={desk.strategists}
            liveMarks={liveMarks}
            peaks={positionPeaks}
            events={data.events}
            symbol={symbol}
            sent={sent}
            incident={incident}
            write={write}
            section={section}
            channelWorkspace={surface.channelWorkspace}
            decisionAtlas={surface.decisionAtlas}
          />
        </>}
      </main>
      <PerformDock channels={channels} livePnl={livePnl} channelWorkspace={surface.channelWorkspace} />
    </div>
  );
}
