"use client";

import { useState } from "react";
import { LineChart } from "@/components/charts/LineChart";
import { useFold } from "@/hooks/useFold";
import { signedUsd, usd0, timeOfDay } from "@/lib/format";
import type { PnlWindow, ChannelStat, WindowedPnl } from "@/hooks/useWindowedPnl";
import { useSentinelDigest } from "@/hooks/useSentinelDigest";
import type { ChannelPnl, StrategistState } from "@/lib/desk/types";
import { pmVar } from "@/lib/desk/colors";
import { summarizePerformanceIssue } from "@/lib/perform/performanceEvidence";

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
  window,
  setWindow,
  windowed,
  scopeLabel,
  todayAttribution,
}: {
  strategists: StrategistState[];
  pnlByStrategist: Record<string, ChannelPnl>;
  fundPnl: { nav: number; dayPnl: number };
  equityCurve: { ts: string; equity: number }[];
  /** Page-owned Review state and evidence. The panel renders without subscribing. */
  window: PnlWindow;
  setWindow: (window: PnlWindow) => void;
  windowed: WindowedPnl | null;
  scopeLabel?: string;
  todayAttribution?: {
    state: "checking" | "ok" | "recovered" | "blocked";
    issues: string[];
  };
}) {
  // Timeframe toggle. "today" uses the live feed props (instant); week/month/all
  // fetch windowed realized P&L (+ open unrealized) + a windowed NAV curve lazily.
  const win = window;
  // era-4 avg-peak/win per channel (the harvest lens) — published nightly by the sentinel
  const { lens } = useSentinelDigest();
  const isToday = win === "today";
  const loading = isToday
    ? todayAttribution?.state === "checking"
    : (windowed?.loading ?? true);
  const blocked = isToday
    ? todayAttribution?.state === "blocked"
    : windowed?.evidenceState === "blocked";
  const recovered = isToday && todayAttribution?.state === "recovered";
  const partial = !isToday && windowed?.evidenceState === "partial";
  const evidenceIssues = isToday
    ? todayAttribution?.issues ?? []
    : (windowed?.issues ?? []).map((issue) => summarizePerformanceIssue(issue));
  const winLabel = WINDOWS.find((w) => w.id === win)!.label.toLowerCase();

  const statFor = (slug: string): ChannelStat => {
    if (isToday) { const p = pnlByStrategist[slug]; return { pnl: p?.dayPnl ?? 0, trades: p?.trades ?? 0, wins: p?.wins ?? 0, pkSum: p?.pkSum ?? 0, pkN: p?.pkN ?? 0 }; }
    return windowed?.statsBySlug[slug] ?? { pnl: 0, trades: 0, wins: 0, pkSum: 0, pkN: 0 };
  };
  const fundVal = isToday ? fundPnl.dayPnl : windowed?.fundPnl;
  const equityValues = isToday ? equityCurve.map((p) => p.equity) : (windowed?.curve ?? []);
  const attributionAvailable = isToday || windowed?.attributionEvidenceState === "ok";

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
        <span className="t">Results · Equity{scopeLabel ? ` · ${scopeLabel}` : ""}</span>
        <span className="x">NAV {usd0(fundPnl.nav)}</span>
        <button type="button" className="pfold" onClick={toggleFold} aria-expanded={!folded} title={folded ? "expand" : "collapse"}>{folded ? "▸" : "▾"}</button>
      </div>
      <div className="pbody">
        {/* hero: the window's fund number leads; the seg picks the window */}
        <div className="pnl-hero">
          <span className={`pnl-big ${blocked || fundVal == null ? "neg" : fundVal < 0 ? "neg" : "pos"}`}>
            {loading ? "…" : fundVal == null ? "UNAVAILABLE" : signedUsd(fundVal)}
          </span>
          <span className="pnl-hero-sub" title={windowed?.sinceNote ? "this bucket's account NAV history starts here; channel rows require independent immutable execution-account attribution" : undefined}>
            {isToday ? "session NAV change" : winLabel}{windowed?.sinceNote ? ` · NAV since ${windowed.sinceNote}` : ""}
            {!isToday && windowed?.fundPnlSource === "immutable_position_attribution" ? " · attributed positions" : ""}
          </span>
          <div className="seg" aria-label="P&L timeframe" style={{ marginLeft: "auto" }}>
            {WINDOWS.map((w) => (
                <button key={w.id} className={win === w.id ? "on" : ""} onClick={() => setWindow(w.id)} aria-pressed={win === w.id}>
                {w.label}
              </button>
            ))}
          </div>
        </div>
        {(blocked || partial) && (
          <div className="review-evidence-blocked" role="alert">
            <b>{isToday
              ? "Current-session attribution unavailable"
              : blocked
                ? "Historical evidence unavailable"
                : "Historical evidence partial"}</b>
            {evidenceIssues.map((issue) => <span key={issue}>{issue}</span>)}
            {!isToday && windowed?.navEvidenceState === "ok" && windowed.attributionEvidenceState === "blocked" && (
              <small>Account NAV remains available; channel rows are withheld.</small>
            )}
            {!isToday && windowed?.navEvidenceState === "blocked" && windowed.attributionEvidenceState === "ok" && (
              <small>Immutable channel attribution remains available; account NAV history is unavailable.</small>
            )}
            <small>No strategist-account fallback was used.</small>
          </div>
        )}
        {recovered && (
          <div className="pf-position-attribution-recovered" role="status">
            <b>Current-session legacy route recovered</b>
            {evidenceIssues.map((issue) => <span key={issue}>{issue}</span>)}
            <small>Channel display uses immutable opportunity and filled-entry evidence; readiness still requires a position-bound receipt.</small>
          </div>
        )}
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
        {attributionAvailable ? <div style={{ marginTop: 8, opacity: loading ? 0.5 : 1, transition: "opacity 0.15s" }}>
          <div className="dvg dvg-hd">
            <span />
            <span />
            <span className="dvg-val">{winLabel}</span>
            <span className="dvg-pk">best</span>
            <span className="dvg-wn">win</span>
          </div>
          {shown.map(({ s, st, lens: L }) => {
            const w = Math.max(2, Math.round((Math.abs(st.pnl) / barMax) * 100) / 2); // half-width %
            // pk·win FOLLOW THE WINDOW (peak_mark on the window's own closed trades);
            // the era-4 lens stays as tooltip context (stable channel character).
            const pk = st.pkN > 0 ? Math.round(st.pkSum / st.pkN) : null;
            const win = st.trades > 0 ? Math.round((100 * st.wins) / st.trades) : null;
            const hot = pk != null && win != null && st.trades >= 5 && pk >= 25 && win < 40;
            return (
              <div className="dvg" key={s.slug} title={`${s.name} · ${st.trades}t in ${winLabel}${L ? ` · historical pattern: best move ${L.p}% · win ${L.w}% (n=${L.n})` : ""}${hot ? " · large moves but low win rate in this window" : ""}`}>
                <span className="dvg-nm">
                  <span className="dvg-dot" style={{ background: pmVar(s.color), boxShadow: `0 0 5px ${pmVar(s.color)}` }} />
                  {s.name}
                </span>
                <span className="dvg-axis">
                  {st.pnl !== 0 && <i className={st.pnl > 0 ? "p" : "n"} style={{ width: `${w}%` }} />}
                </span>
                <span className={`dvg-val ${st.pnl < 0 ? "neg" : st.pnl > 0 ? "pos" : "mut"}`}>{st.pnl === 0 ? "—" : signedUsd(st.pnl)}</span>
                <span className={`dvg-pk${hot ? " hot" : ""}`}>{pk != null ? `${pk}%` : "—"}</span>
                <span className={`dvg-wn ${win != null ? (win >= 40 ? "pos" : "neg") : "mut"}`}>{win ?? "—"}</span>
              </div>
            );
          })}
          {idle.length > 0 && (
            <button type="button" className="dvg-more" onClick={() => setShowIdle((v) => !v)} aria-expanded={showIdle}>
              {showIdle ? "▾ hide" : "▸"} {idle.length} idle channel{idle.length === 1 ? "" : "s"} ($0 · no trades {winLabel})
            </button>
          )}
        </div> : (
          <div className="chart-empty">channel rows withheld — immutable historical account route unavailable</div>
        )}
      </div>
    </div>
  );
}
