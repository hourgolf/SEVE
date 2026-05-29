"use client";

import { Chassis } from "@/components/console/Chassis";
import { PositionsPanel } from "@/components/console/PositionsPanel";
import { PnlPanel } from "@/components/console/PnlPanel";
import { SignalsTape } from "@/components/console/SignalsTape";
import { LedDisplay } from "@/components/console/hw/LedDisplay";
import { FeedBadge } from "@/components/console/FeedBadge";
import { useDeskState } from "@/hooks/useDeskState";
import { useDeskFeed } from "@/hooks/useDeskFeed";

export function DeskScreen() {
  const { desk } = useDeskState();
  const feed = useDeskFeed();

  return (
    <Chassis
      brand={<>SEVE<span> · DESK</span></>}
      sub="POSITIONS · P&L · SIGNALS"
      right={
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <FeedBadge status={feed.status} />
          <LedDisplay value={String(feed.fundPnl.nav)} digits={7} caption="fund nav $" />
        </div>
      }
    >
      <div className="grid">
        <div className="col">
          <PositionsPanel positions={feed.positions} strategists={desk.strategists} />
        </div>
        <div className="col">
          <PnlPanel
            strategists={desk.strategists}
            pnlByStrategist={feed.pnlByStrategist}
            fundPnl={feed.fundPnl}
            equityCurve={feed.equityCurve}
          />
          <SignalsTape signals={feed.signals} />
        </div>
      </div>
    </Chassis>
  );
}
