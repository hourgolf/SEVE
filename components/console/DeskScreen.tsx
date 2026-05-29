"use client";

import { PositionsPanel } from "@/components/console/PositionsPanel";
import { PnlPanel } from "@/components/console/PnlPanel";
import { SignalsTape } from "@/components/console/SignalsTape";
import { useDeskState } from "@/hooks/useDeskState";
import { useDeskSampleData } from "@/hooks/useDeskSampleData";

export function DeskScreen() {
  const { desk } = useDeskState();
  const feed = useDeskSampleData();

  return (
    <div className="wrap">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <div>
          <h1 style={{ fontSize: 14, fontWeight: 600 }}>
            SEVE <span className="muted" style={{ fontWeight: 400 }}>/ desk</span>
          </h1>
          <div
            style={{
              fontSize: 10.5,
              color: "var(--muted)",
              fontFamily: "var(--mono)",
              letterSpacing: 0.5,
            }}
          >
            POSITIONS · P&amp;L · SIGNALS
          </div>
        </div>
        <span className="sample-badge">● SAMPLE DATA — not live</span>
      </div>

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
    </div>
  );
}
