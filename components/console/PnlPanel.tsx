"use client";

import { useState } from "react";
import { LineChart } from "@/components/charts/LineChart";
import { useFold } from "@/hooks/useFold";
import { signedUsd, usd0, timeOfDay } from "@/lib/format";
import { useWindowedPnl, type PnlWindow, type ChannelStat } from "@/hooks/useWindowedPnl";
import { useSentinelDigest } from "@/hooks/useSentinelDigest";
import type { ChannelPnl, StrategistState } from "@/lib/desk/types";
import { pmVar } from "@/lib/desk/colors";

const WINDOWS: { id: PnlWindow; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "all", label: "All" },
];

export function PnlPanel({
  strategists,
  pnlByStrategist,
  fundPnl,
  equityCurve,
  acctId = null,
}: {
  strategists: StrategistState[];
  pnlByStrategist: Record<string, ChannelPnl>;
  fundPnl: { nav: number; dayPnl: number };
  equityCurve: { ts: string; equity: number }[];
  /** Selected cockpit bucket — scopes the windowed stats + NAV curve (null = desk total). */
  acctId?: string | null;
}) {
  // Timeframe toggle. "today" uses the live feed props (instant); week/month/all
  // fetch windowed realized P&L (+ open unrealized) + a windowed NAV curve lazily.
  const [win, setWin] = useState<PnlWindow>("today");
  const windowed = useWindowedPnl(win, acctId);
  // era-4 avg-peak/win per channel (the harvest lens) — published nightly by the sentinel
  const { lens } = useSentinelDigest();
  const isToday = win === "today";
  const loading = !isToday && (windowed?.loading ?? true);
  const winLabel = WINDOWS.find((w) => w.id === win)!.label.toLowerCase();

  const statFor = (slug: string): ChannelStat => {
    if (isToday) { const p = pnlByStrategist[slug]; return { pnl: p?.dayPnl ?? 0, trades: p?.trades ?? 0, wins: p?.wins ?? 0 }; }
    return windowed?.statsBySlug[slug] ?? { pnl: 0, trades: 0, wins: 0 };
  };
  const fundVal = isToday ? fundPnl.dayPnl : (windowed?.fundPnl ?? 0);
  const equityValues = isToday ? equityCurve.map((p) => p.equity) : (windowed?.curve ?? []);

  const hasCurve =
    equityValues.length >= 2 && Math.max(...equityValues) !== Math.min(...equityValues);
  const [folded, toggleFold] = useFold("pnl");
  const [showIdle, setShowIdle] = useState(false);

  // Rows sorted by |window P&L| (the movers first); idle channels (no trades, $0 in
  // window) collapse behind a count line so the glance is only what moved.
  const rows = strategists
    .map((s) => ({ s, st: statFor(s.slug), lens: lens?.[s.slug] ?? null }))
    .sort((a, b) => Math.abs(b.st.pnl) - Math.abs(a.st.pnl));
  const active = rows.filter((r) => r.st.trades > 0 || r.st.pnl !== 0);
  const idle = rows.filter((r) => r.st.trades === 0 && r.st.pnl === 0);
  const shown = showIdle ? rows : active;
  const barMax = Math.max(1, ...active.map((r) => Math.abs(r.st.pnl)));

  return (
    <div className={`panel${folded ? " folded" : ""}`}>
      <div className="phead">
        <span className="t">P&amp;L · Equity</span>
        <span className="x">NAV {usd0(fundPnl.nav)}</span>
        <button type="button" className="pfold" onClick={toggleFold} aria-expanded={!folded} title={folded ? "expand" : "collapse"}>{folded ? "▸" : "▾"}</button>
      </div>
      <div className="pbody">
        {/* hero: the window's fund number leads; the seg picks the window */}
        <div className="pnl-hero">
          <span className={`pnl-big ${fundVal < 0 ? "neg" : "pos"}`}>{loading ? "…" : signedUsd(fundVal)}</span>
          <span className="pnl-hero-sub" title={windowed?.sinceNote ? "this bucket's NAV history starts here — the fund number + curve span this range; the channel rows below cover the full window" : undefined}>
            {winLabel}{windowed?.sinceNote ? ` · NAV since ${windowed.sinceNote}` : ""}
          </span>
          <div className="seg" aria-label="P&L timeframe" style={{ marginLeft: "auto" }}>
            {WINDOWS.map((w) => (
              <button key={w.id} className={win === w.id ? "on" : ""} onClick={() => setWin(w.id)} aria-pressed={win === w.id}>
                {w.label}
              </button>
            ))}
          </div>
        </div>
        <div className="pnl-equity">
          {hasCurve ? (
            <LineChart
              values={equityValues}
              height={90}
              id="equity"
              hover
              format={usd0}
              formatDelta={signedUsd}
              baseline={equityValues[0]}
              // Today: Δ vs the open (running intraday P&L). Week/Month/All: the curve is
              // a daily NAV rollup, so Δ vs the prior point = that DAY's P&L (matches the
              // Day-P&L LED + daily autopsy), not the cumulative run since the window start.
              segmentDelta={!isToday}
              labels={isToday ? equityCurve.map((p) => timeOfDay(p.ts)) : windowed?.curveLabels}
            />
          ) : (
            <div className="chart-empty">{loading ? "loading…" : isToday ? "awaiting equity history" : "no equity history in window"}</div>
          )}
        </div>
        {/* channels — diverging bar (loss left / gain right) + the harvest lens (era-4 pk · win).
            amber pk = high peak / low win → spike-carried (fix, don't promote). */}
        <div style={{ marginTop: 8, opacity: loading ? 0.5 : 1, transition: "opacity 0.15s" }}>
          <div className="dvg dvg-hd">
            <span />
            <span />
            <span className="dvg-val">{winLabel}</span>
            <span className="dvg-pk">pk</span>
            <span className="dvg-wn">win</span>
          </div>
          {shown.map(({ s, st, lens: L }) => {
            const w = Math.max(2, Math.round((Math.abs(st.pnl) / barMax) * 100) / 2); // half-width %
            const hot = L != null && L.p >= 25 && L.w < 40;
            return (
              <div className="dvg" key={s.slug} title={`${s.name} · ${st.trades}t in ${winLabel}${L ? ` · era-4 avg peak ${L.p}% · win ${L.w}% (n=${L.n})` : ""}${hot ? " · high peak / low win — spike-carried" : ""}`}>
                <span className="dvg-nm">
                  <span className="dvg-dot" style={{ background: pmVar(s.color), boxShadow: `0 0 5px ${pmVar(s.color)}` }} />
                  {s.name}
                </span>
                <span className="dvg-axis">
                  {st.pnl !== 0 && <i className={st.pnl > 0 ? "p" : "n"} style={{ width: `${w}%` }} />}
                </span>
                <span className={`dvg-val ${st.pnl < 0 ? "neg" : st.pnl > 0 ? "pos" : "mut"}`}>{st.pnl === 0 ? "—" : signedUsd(st.pnl)}</span>
                <span className={`dvg-pk${hot ? " hot" : ""}`}>{L ? `${Math.round(L.p)}%` : "—"}</span>
                <span className={`dvg-wn ${L ? (L.w >= 40 ? "pos" : "neg") : "mut"}`}>{L ? L.w : "—"}</span>
              </div>
            );
          })}
          {idle.length > 0 && (
            <button type="button" className="dvg-more" onClick={() => setShowIdle((v) => !v)} aria-expanded={showIdle}>
              {showIdle ? "▾ hide" : "▸"} {idle.length} idle channel{idle.length === 1 ? "" : "s"} ($0 · no trades {winLabel})
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
