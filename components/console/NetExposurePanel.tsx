"use client";

import { useMemo } from "react";
import { useFold } from "@/hooks/useFold";
import { computeNetExposure } from "@/lib/desk/netExposure";
import type { Position } from "@/lib/desk/types";

// NET EXPOSURE — the read-only X-ray over the (now clean, row-primary) book. The channels share
// contracts heavily (one netted lot per ATM 0DTE strike), so the roster is a few correlated bets
// stacked, not N independent ones. This SHOWS the real aggregate — per contract (how many channels
// stack it), the directional net per underlying, total notional — and caps NOTHING. Every channel
// still enters/exits at its own discretion; the operator just sees the true correlated concentration.
const k = (v: number) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`);

export function NetExposurePanel({ positions, liveMarks }: { positions: Position[]; liveMarks?: Record<string, number> }) {
  const ex = useMemo(() => computeNetExposure(positions, liveMarks), [positions, liveMarks]);
  const [folded, toggleFold] = useFold("netx"); // before the early return — hooks stay unconditional
  if (ex.occCount === 0) return null; // desk flat → nothing to show

  const stacks = ex.byOcc.filter((e) => e.channels.length >= 2).slice(0, 4);
  const heavy = ex.maxStack && ex.maxStack.channels.length >= 4; // awareness flag (not a cap)

  return (
    <div className="panel netx">
      <div className="phead">
        <span className="t">Net Exposure</span>
        <span className="x" title="the desk's TRUE aggregate per contract — the channels share lots, so this is the real correlated bet. Read-only: no channel is ever capped.">the real correlated lot · no caps</span>
        <button type="button" className="pfold" onClick={toggleFold} aria-expanded={!folded} title={folded ? "expand" : "collapse"}>{folded ? "▸" : "▾"}</button>
      </div>
      {!folded && (
      <div className="pbody">
        <div className="dbk-row">
          <div className="dbk-stat" title="total contracts held across all channels right now">
            <span className="dbk-k">Contracts</span>
            <span className="dbk-v">{ex.totalContracts}</span>
          </div>
          <div className="dbk-stat" title="contracts held by ≥2 channels at once = the netting / correlation. High = the roster is one bet stacked.">
            <span className="dbk-k">Stacked</span>
            <span className={`dbk-v ${ex.stackedOccCount > 0 ? "warn" : ""}`}>{ex.stackedOccCount}/{ex.occCount} OCCs</span>
          </div>
          <div className="dbk-stat" title="|contracts| × live mark × 100, summed">
            <span className="dbk-k">Notional</span>
            <span className="dbk-v">{k(ex.totalNotional)}</span>
          </div>
        </div>

        <div className="netx-dir">
          {ex.byUnderlying.map((d) => (
            <span key={d.underlying} className="netx-u" title={`${d.underlying}: ${d.callContracts} call vs ${d.putContracts} put contracts, ${k(d.notional)} notional`}>
              <b>{d.underlying}</b>
              <span className="pos">{d.callContracts}C</span>
              <span className="netx-sep">/</span>
              <span className="neg">{d.putContracts}P</span>
              <span className="netx-no">{k(d.notional)}</span>
            </span>
          ))}
        </div>

        {stacks.length > 0 && (
          <div className="netx-stacks">
            {stacks.map((e) => (
              <div key={e.occ} className={`netx-stack${e.channels.length >= 4 ? " netx-heavy" : ""}`} title={`${Math.abs(e.contracts)} contracts shared by ${e.channels.length} channels: ${e.channels.join(", ")}`}>
                <span className="netx-occ">{e.underlying} {e.strike.toFixed(0)}{e.optType === "call" ? "C" : "P"}</span>
                <span className="netx-ct">×{Math.abs(e.contracts)}</span>
                <span className="netx-ch">{e.channels.length} ch</span>
                <span className="netx-no2">{k(e.notional)}</span>
              </div>
            ))}
          </div>
        )}

        {heavy && ex.maxStack && (
          <div className="netx-note" title="awareness only — not a limit">
            ⚠ {ex.maxStack.channels.length} channels stacked into one {ex.maxStack.underlying} {ex.maxStack.strike.toFixed(0)}{ex.maxStack.optType === "call" ? "C" : "P"} ({Math.abs(ex.maxStack.contracts)} contracts) — that's {ex.maxStack.channels.length}× the same bet, not diversification.
          </div>
        )}
      </div>
      )}
    </div>
  );
}
