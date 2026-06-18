"use client";

import { Knob } from "@/components/console/hw/Knob";
import { useDeskDispatch } from "@/hooks/useDeskState";
import { useDeskWrite } from "@/hooks/useDeskWrite";
import { usd0 } from "@/lib/format";
import type { FundState } from "@/lib/desk/types";

// OPS · RISK — the desk-wide master daily-stop. Writes fund_state.master_daily_
// stop_usd (the account-level loss halt) via the same SET_FUND dispatch +
// persistFund path the other master controls use. Previously SQL/seed-only.
export function MasterStopControl({ fund }: { fund: FundState }) {
  const dispatch = useDeskDispatch();
  const { canWrite, persistFund } = useDeskWrite();
  const v = fund.master_daily_stop_usd ?? 0;
  return (
    <div className="panel mstop">
      <div className="phead">
        <span className="t">Risk · Master Stop</span>
        <span className="x">desk-wide</span>
      </div>
      <div className="pbody mstop-body">
        <Knob
          value={v}
          min={0}
          max={5000}
          step={100}
          onChange={(val) => dispatch({ type: "SET_FUND", patch: { master_daily_stop_usd: val } })}
          onCommit={(val) => persistFund({ master_daily_stop_usd: val })}
          size="lg"
          label="Stop / day"
          format={usd0}
          cap="var(--knob-dark)"
          tick="#d7d5cb"
          disabled={!canWrite}
        />
        <div className="mstop-note">
          <div className="mstop-v">{usd0(v)}</div>
          <div className="mstop-hint">the whole desk halts after this realized loss on the day{!canWrite ? " · sign in to change" : ""}</div>
        </div>
      </div>
    </div>
  );
}
