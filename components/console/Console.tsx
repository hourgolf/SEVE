"use client";

import { ChannelStrip } from "@/components/console/ChannelStrip";
import { MasterStrip } from "@/components/console/MasterStrip";
import { Chassis } from "@/components/console/Chassis";
import { StepRow } from "@/components/console/hw/StepRow";
import { Bezel } from "@/components/console/hw/Bezel";
import { FeedBadge } from "@/components/console/FeedBadge";
import { useDeskState } from "@/hooks/useDeskState";
import { useDeskFeed } from "@/hooks/useDeskFeed";
import { useDeskWrite } from "@/hooks/useDeskWrite";

export function Console() {
  const { desk, anySolo, isActive } = useDeskState();
  const feed = useDeskFeed();
  const { canWrite } = useDeskWrite();

  return (
    <Chassis
      brand={<>SEVE<span> · STRATEGY COMPOSER</span></>}
      sub="SPY · 0DTE / 1DTE · paper desk"
      right={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <FeedBadge status={feed.status} />
          <span
            className={`write-chip${canWrite ? " on" : ""}`}
            title={canWrite ? "changes persist to the desk" : "sign in (top right) to save changes"}
          >
            {canWrite ? "● operator" : "○ read-only"}
          </span>
        </div>
      }
    >
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
    </Chassis>
  );
}
