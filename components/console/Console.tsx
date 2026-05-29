"use client";

import { ChannelStrip } from "@/components/console/ChannelStrip";
import { MasterStrip } from "@/components/console/MasterStrip";
import { StepRow } from "@/components/console/hw/StepRow";
import { Bezel } from "@/components/console/hw/Bezel";
import { useDeskState } from "@/hooks/useDeskState";
import { useDeskSampleData } from "@/hooks/useDeskSampleData";

export function Console() {
  const { desk, anySolo, isActive } = useDeskState();
  const feed = useDeskSampleData();

  return (
    <div className="chassis">
      <div className="chassis-head">
        <div className="chassis-brand">
          <div className="mark">
            SEVE<span> · STRATEGY COMPOSER</span>
          </div>
          <div className="sub">SPY · 0DTE / 1DTE · paper desk</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span className="sample-badge">● SAMPLE DATA — not live</span>
          <div className="stripes">
            <i className="s1" />
            <i className="s2" />
            <i className="s3" />
          </div>
        </div>
      </div>

      <div className="console-grid">
        <div className="channels">
          {desk.strategists.map((s) => (
            <ChannelStrip
              key={s.slug}
              strategist={s}
              pnl={feed.pnlByStrategist[s.slug]}
              active={isActive(s.slug)}
              ducked={anySolo && !s.config.soloed && !s.config.muted}
            />
          ))}
        </div>
        <MasterStrip fund={desk.fund} fundPnl={feed.fundPnl} />
      </div>

      <Bezel label="16-Step Tape · recent signals" className="tape">
        <StepRow steps={feed.steps} />
      </Bezel>
    </div>
  );
}
