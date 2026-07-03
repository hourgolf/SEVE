"use client";

// The TODAY readiness strip — a morning-glance of what's live: each traded index's
// gap vs the desk's gap gate (gap day ✓ / flat ✗ / no tape / pre-open) + the event
// calendar (event day stand-down, or the next FOMC). Read-only; reads the same gate
// (0.25%) the gap-gated channels (V3/ALT) use, so "gap day" == those channels eligible.

import { useTodayReadiness } from "@/hooks/useTodayReadiness";

export const GAP_MIN = 0.25; // V3/ALT gap_min — a session ≥ this |gap| clears the gate (mobile ticker pills read it too)

function fmtDate(d: string): string {
  const dt = new Date(d + "T12:00:00");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
const SIGN = (n: number) => (n > 0 ? "+" : "");

export function TodayStrip({ underlyings }: { underlyings: string[] }) {
  const { gaps, todayET, todayEvent, nextEvent, loading } = useTodayReadiness();
  if (loading && Object.keys(gaps).length === 0) return null;
  if (underlyings.length === 0) return null;

  return (
    <div className="today-strip" role="status" aria-label="today readiness">
      <span className="ts-label">TODAY</span>
      <div className="ts-syms">
        {underlyings.map((sym) => {
          const g = gaps[sym];
          if (!g) {
            return (
              <span key={sym} className="ts-sym ts-notape" title={`${sym} — no live tape reaching the dashboard`}>
                <b>{sym}</b> no tape
              </span>
            );
          }
          if (g.sessionDate !== todayET) {
            return (
              <span key={sym} className="ts-sym ts-pre" title={`${sym} — no session today yet (last session ${g.sessionDate})`}>
                <b>{sym}</b> pre-open
              </span>
            );
          }
          if (g.gapPct == null) {
            return (
              <span key={sym} className="ts-sym ts-pending" title={`${sym} — tape live (${g.barsToday} bars today), gap computes from the next full session`}>
                <b>{sym}</b> gap pending
              </span>
            );
          }
          const isGap = Math.abs(g.gapPct) >= GAP_MIN;
          const dir = g.gapPct >= 0 ? "up" : "down";
          return (
            <span
              key={sym}
              className={`ts-sym ${isGap ? `ts-gap ts-${dir}` : "ts-flat"}`}
              title={
                isGap
                  ? `${sym} gapped ${SIGN(g.gapPct)}${g.gapPct}% — GAP DAY (clears the ${GAP_MIN}% gate; V3/ALT eligible)`
                  : `${sym} ${SIGN(g.gapPct)}${g.gapPct}% — flat open (under the ${GAP_MIN}% gate; V3/ALT stand down)`
              }
            >
              <b>{sym}</b> {SIGN(g.gapPct)}{g.gapPct.toFixed(2)}%{" "}
              {isGap ? <span className="ts-tag">gap {dir === "up" ? "↑" : "↓"}</span> : <span className="ts-tag">flat</span>}
            </span>
          );
        })}
      </div>
      <div className="ts-evt">
        {todayEvent ? (
          <span className="ts-evt-on" title="event day — event-policy channels stand down 13:50–14:30 ET">
            ⚑ {todayEvent.label} — stand-down
          </span>
        ) : (
          <span className="ts-evt-off">
            no events today{nextEvent ? ` · next FOMC ${fmtDate(nextEvent.date)}` : ""}
          </span>
        )}
      </div>
    </div>
  );
}
