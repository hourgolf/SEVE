"use client";

import { useState } from "react";
import { EventTapeWorkspace } from "@/components/perform/EventTapeWorkspace";
import { AutopsyPanel } from "@/components/console/AutopsyPanel";
import { PnlPanel } from "@/components/console/PnlPanel";
import { ForensicsPanel } from "@/components/console/ForensicsPanel";
import { REVIEW_SECTIONS, type ReviewSection } from "@/lib/perform/reviewWorkspace";
import type { SurfaceProps } from "@/components/surfaceTypes";

export function ReviewWorkspace({ surface }: { surface: SurfaceProps }) {
  const [section, setSection] = useState<ReviewSection>("tape");
  const { data, view, feed, livePnl, liveFund, reviewEvidence } = surface;
  const selectedAccount = surface.accounts.find((account) => account.id === surface.acctId);
  const accountScope = selectedAccount ? `${selectedAccount.name} ACCOUNT` : "ACCOUNT UNSELECTED";

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
              onClick={() => setSection(item.id)}
            >
              <b>{item.label}</b>
              <small>{item.hint}</small>
            </button>
          ))}
        </nav>
      </header>

      <div className="rvw-body" role="tabpanel" data-review-section={section}>
        {section === "tape" && (
          <EventTapeWorkspace
            events={data.events}
            health={data.readHealth.events}
            strategists={view.desk.strategists}
            readiness={surface.opsReadiness}
            embedded
          />
        )}
        {section === "autopsy" && (
          <AutopsyPanel
            strategists={view.desk.strategists}
            daily={reviewEvidence.daily}
            weekly={reviewEvidence.weekly}
          />
        )}
        {section === "performance" && (
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
