"use client";

import { useEffect, useRef, useState } from "react";
import { EventTapeWorkspace } from "@/components/perform/EventTapeWorkspace";
import { AutopsyPanel } from "@/components/console/AutopsyPanel";
import { PnlPanel } from "@/components/console/PnlPanel";
import { ForensicsPanel } from "@/components/console/ForensicsPanel";
import { REVIEW_SECTIONS, type ReviewSection } from "@/lib/perform/reviewWorkspace";
import type { SurfaceProps } from "@/components/surfaceTypes";
import { DecisionAtlasFleetPulse } from "@/components/research/DecisionAtlasFleetPulse";
import { ReviewSessionScorecard } from "@/components/perform/ReviewSessionScorecard";
import { buildSessionReviewModel, shouldAnchorHistoricalResults } from "@/lib/perform/sessionReview";
import { SeveEvidenceContext } from "@/components/ui/Seve909";
import type { WorkspaceDestination } from "@/lib/shell/workspaceDestination";
import { signedUsd } from "@/lib/format";

export function ReviewWorkspace({ surface, destination, onNavigate }: { surface: SurfaceProps; destination?: WorkspaceDestination; onNavigate?: (destination: WorkspaceDestination) => void }) {
  const [section, setSection] = useState<ReviewSection>("tape");
  const { data, view, feed, livePnl, liveFund, reviewEvidence } = surface;
  const selectedAccount = surface.accounts.find((account) => account.id === surface.acctId);
  const accountScope = selectedAccount ? `${selectedAccount.name} ACCOUNT` : "ACCOUNT UNSELECTED";
  const historicalResultsInitialized = useRef(false);
  const latestCompletedSession = reviewEvidence.daily.reports[0]?.report_date ?? null;
  const latestSessionModel = reviewEvidence.daily.reports[0] ? buildSessionReviewModel(reviewEvidence.daily.reports[0]) : null;
  const focusedPnl = destination?.channel ? livePnl[destination.channel] : undefined;
  const focusedRows = destination?.channel ? feed.recentTrades.filter((trade) => trade.strategist_slug === destination.channel) : [];
  useEffect(() => {
    if (section !== "performance" || historicalResultsInitialized.current) return;
    historicalResultsInitialized.current = true;
    if (reviewEvidence.pnlWindow === "today" && shouldAnchorHistoricalResults(latestCompletedSession)) {
      reviewEvidence.setPnlWindow("week");
    }
  }, [latestCompletedSession, reviewEvidence, section]);
  useEffect(() => {
    if (destination?.section === "tape" && destination.reviewSection) setSection(destination.reviewSection);
  }, [destination?.reviewSection, destination?.section]);

  return (
    <section className="rvw" id="perform-tape" tabIndex={-1} aria-label="Review workspace">
      <header className="rvw-head">
        <div>
          <small>REVIEW</small>
          <b>SESSION EVIDENCE</b>
        </div>
        <nav role="tablist" aria-label="Review sections">
          {REVIEW_SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              className={section === item.id ? "on" : ""}
              aria-selected={section === item.id}
              onClick={() => { setSection(item.id); onNavigate?.({ section: "tape", reviewSection: item.id, channel: destination?.channel, session: destination?.session }); }}
            >
              <b>{item.label}</b>
              <small>{item.hint}</small>
            </button>
          ))}
        </nav>
      </header>
      <DecisionAtlasFleetPulse reports={surface.decisionAtlas} purpose="review" onNavigate={onNavigate} />
      {destination?.channel && <section className="rvw-channel-context"><span><small>CURRENT SESSION · {destination.channel}</small><b>{signedUsd(focusedPnl?.dayPnl ?? 0)} ATTRIBUTED · {focusedRows.length} POSITION ROWS · {focusedPnl?.openCount ?? 0} OPEN</b></span><button type="button" onClick={() => onNavigate?.({ section: "research", channel: destination.channel, axis: "sources", researchMode: "decisions" })}>OPEN PAIRED REVIEW →</button></section>}
      {latestSessionModel && <SeveEvidenceContext kind="actual" scope={latestSessionModel.scope.replaceAll("_", " ")} asOf={latestSessionModel.reportDate} era="executed session" sample={`${latestSessionModel.observations} ${latestSessionModel.evidenceLabel}`} quality={latestSessionModel.limitation ? "partial" : "complete"} />}

      <div className="rvw-body" role="tabpanel" data-review-section={section}>
        {section === "tape" && (
          <>
            <ReviewSessionScorecard evidence={reviewEvidence.daily} />
            <details className="rvw-system-activity">
              <summary><span><small>SYSTEM ACTIVITY</small><b>Diagnostics and event history</b></span><em>Open only when checking platform behavior</em><i>▾</i></summary>
              <EventTapeWorkspace
                events={data.events}
                health={data.readHealth.events}
                strategists={view.desk.strategists}
                readiness={surface.opsReadiness}
                embedded
              />
            </details>
          </>
        )}
        {section === "autopsy" && (
          <AutopsyPanel
            strategists={view.desk.strategists}
            daily={reviewEvidence.daily}
            weekly={reviewEvidence.weekly}
          />
        )}
        {section === "performance" && (
          <>
            {latestCompletedSession && <div className="rvw-results-anchor"><b>LAST COMPLETED SESSION · {latestCompletedSession}</b><span>Account Results opens to the week through this close; choose Today only for the live session.</span></div>}
            <PnlPanel
              strategists={view.desk.strategists}
              pnlByStrategist={livePnl}
              fundPnl={liveFund}
              equityCurve={feed.equityCurve}
              window={reviewEvidence.pnlWindow}
              setWindow={reviewEvidence.setPnlWindow}
              windowed={reviewEvidence.windowedPnl}
              scopeLabel={accountScope}
              todayAttribution={feed.positionAttribution}
            />
          </>
        )}
        {section === "counterfactuals" && (
          <>
            <div className="rvw-research-boundary">
              <b>DESCRIPTIVE RESEARCH</b>
              <span>Would-have paths cannot alter configuration, readiness, risk, lifecycle, or orders.</span>
            </div>
            <ForensicsPanel
              forensics={reviewEvidence.forensics}
              pyramid={reviewEvidence.pyramid}
              virtualBench={reviewEvidence.virtualBench}
              alwaysOpen
            />
          </>
        )}
      </div>
    </section>
  );
}
