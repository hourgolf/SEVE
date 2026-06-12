"use client";

import { signedUsd } from "@/lib/format";
import type { ChannelPnl, StrategistState } from "@/lib/desk/types";

// DAY · BOOKS — the numbers-first EOD trust strip atop §03 (consultant item:
// "NAV-delta is the headline; per-channel rows are attribution and should look
// subordinate"). One row, always-on, no LLM:
//   DAY P&L   the NAV-based day number (account truth + live marks) — THE number
//   ATTRIB Σ  the per-channel attribution sum (shared-OCC approximation)
//   BOOKS Δ   NAV − attribution — small = clean books; amber/red = go look
//   TRADES    closed round-trips today · open legs now
//   TOP       the day's biggest absolute mover
// The LLM autopsies render BELOW this strip as commentary, not as the headline.
export function DayBooksStrip({
  strategists,
  pnl,
  fund,
  closedToday,
  openCount,
}: {
  strategists: StrategistState[];
  pnl: Record<string, ChannelPnl>;
  fund: { nav: number; dayPnl: number };
  closedToday: number;
  openCount: number;
}) {
  const attrib = Object.values(pnl).reduce((a, c) => a + (c.dayPnl || 0), 0);
  const delta = Math.round(fund.dayPnl - attrib);
  const dTone = Math.abs(delta) < 100 ? "ok" : Math.abs(delta) < 500 ? "warn" : "bad";
  let topSlug = "", topVal = 0;
  for (const [slug, c] of Object.entries(pnl)) if (Math.abs(c.dayPnl || 0) > Math.abs(topVal)) { topSlug = slug; topVal = c.dayPnl || 0; }
  const topName = strategists.find((s) => s.slug === topSlug)?.name ?? topSlug;

  return (
    <div className="panel dbk">
      <div className="phead">
        <span className="t">Day · Books</span>
        <span className="x" title="the NAV-delta is account truth; per-channel rows are relative attribution (shared-OCC)">NAV is truth</span>
      </div>
      <div className="pbody dbk-row">
        <div className="dbk-stat" title="account-truth day P&L (NAV delta, re-marked live)">
          <span className="dbk-k">Day P&L (NAV)</span>
          <span className={`dbk-v ${fund.dayPnl < 0 ? "neg" : "pos"}`}>{signedUsd(fund.dayPnl)}</span>
        </div>
        <div className="dbk-stat" title="Σ per-channel day P&L — the attribution view (approximate under shared OCCs)">
          <span className="dbk-k">Attribution Σ</span>
          <span className={`dbk-v ${attrib < 0 ? "neg" : "pos"}`}>{signedUsd(attrib)}</span>
        </div>
        <div className="dbk-stat" title="NAV − attribution. Small = the books reconcile; large = a booking leak — check coverage in the day report">
          <span className="dbk-k">Books Δ</span>
          <span className={`dbk-v dbk-d-${dTone}`}>{signedUsd(delta)}</span>
        </div>
        <div className="dbk-stat" title="closed round-trips today · open legs right now">
          <span className="dbk-k">Trades</span>
          <span className="dbk-v">{closedToday} closed · {openCount} open</span>
        </div>
        {topSlug && (
          <div className="dbk-stat" title="the day's biggest absolute mover (attribution)">
            <span className="dbk-k">Top mover</span>
            <span className={`dbk-v ${topVal < 0 ? "neg" : "pos"}`}>{topName} {signedUsd(topVal)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
