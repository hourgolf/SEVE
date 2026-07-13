"use client";

import { Knob } from "@/components/console/hw/Knob";
import { useFold } from "@/hooks/useFold";
import { usd0 } from "@/lib/format";
import type { FundState } from "@/lib/desk/types";

// OPS · RISK — historical master-stop field. The live cron/stream decision path
// intentionally does NOT enforce fund.master_daily_stop_usd; entries are latched
// by each channel's strategist_config.daily_stop_usd. Keep the stored value
// visible for provenance, but never present it as an operable safety control.
export function MasterStopControl({ fund }: { fund: FundState }) {
  const v = fund.master_daily_stop_usd ?? 0;
  const [folded, toggleFold] = useFold("masterstop");
  return (
    <div className={`panel mstop${folded ? " folded" : ""}`}>
      <div className="phead">
        <span className="t">Risk · Legacy Master</span>
        <span className="x">not enforced</span>
        <button type="button" className="pfold" onClick={toggleFold} aria-expanded={!folded} title={folded ? "expand" : "collapse"}>{folded ? "▸" : "▾"}</button>
      </div>
      <div className="pbody mstop-body">
        <Knob
          value={v}
          min={0}
          max={20000}
          step={100}
          onChange={() => undefined}
          onCommit={() => undefined}
          size="lg"
          label="Stored value"
          format={usd0}
          cap="var(--knob-dark)"
          tick="#d7d5cb"
          disabled
        />
        <div className="mstop-note">
          <div className="mstop-v">{usd0(v)}</div>
          <div className="mstop-hint">stored legacy value only · live entries use each channel&apos;s ENTRY LATCH in STUDIO · KILL/HALT remains desk-wide</div>
        </div>
      </div>
    </div>
  );
}
