"use client";

import { MobileBookView } from "@/components/mobile2/MobileDeskSheet";
import { BrokerReconciliationStrip } from "@/components/ops/OpsReadinessPanel";
import { AggregateExposure, RecentExits } from "@/components/perform/PerformPositionsWorkspace";
import { PositionsSection } from "@/components/perform/PerformRail";
import type { SurfaceProps } from "@/components/surfaceTypes";
import { computeNetExposure } from "@/lib/desk/netExposure";
import { signedUsd } from "@/lib/format";
import { derivePositionsWorkspace } from "@/lib/perform/derivePositionsWorkspace";

export function FolioBookDesktop({ surface }: { surface: SurfaceProps }) {
  const exposure = computeNetExposure(surface.feed.positions, surface.liveMarks);
  const reconciliation = surface.opsReadiness.evidence.find((item) => item.id === "reconciliation");
  const unrealized = derivePositionsWorkspace(surface.feed.positions, surface.feed.recentTrades, surface.liveMarks).open.unrealized;

  return (
    <div className="folio-book folio-book-desktop" data-nav-target="true" tabIndex={-1}>
      <header className="folio-workspace-title">
        <span><small>LIVE BOOK</small><b>Positions before exposure</b><em>Manual exits use the guarded operator flow.</em></span>
        <div>
          <span><small>OPEN</small><b>{surface.feed.positions.length}</b></span>
          <span><small>CONTRACTS</small><b>{exposure.totalContracts}</b></span>
          <span><small>UNREALIZED</small><b className={unrealized < 0 ? "neg" : unrealized > 0 ? "pos" : ""}>{signedUsd(unrealized)}</b></span>
        </div>
      </header>
      <BrokerReconciliationStrip model={surface.opsReadiness} />
      <div className="folio-book-grid">
        <section className="folio-book-open">
          <PositionsSection
            positions={surface.feed.positions}
            strategists={surface.view.desk.strategists}
            liveMarks={surface.liveMarks}
            peaks={surface.positionPeaks}
            write={surface.write}
            targeted
            reconciliation={reconciliation}
          />
        </section>
        <aside className="folio-book-context">
          <AggregateExposure surface={surface} />
          <RecentExits surface={surface} />
        </aside>
      </div>
    </div>
  );
}

export function FolioBookMobile({ surface, onViewMarket }: { surface: SurfaceProps; onViewMarket: (view: "chart" | "chain") => void }) {
  return <div className="folio-book folio-book-mobile"><MobileBookView props={surface} onViewMarket={onViewMarket} /></div>;
}
