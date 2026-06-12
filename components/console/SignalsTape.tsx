"use client";

import { timeOfDay } from "@/lib/format";
import type { Signal } from "@/lib/desk/types";

// Reuses the EventLog .log CSS + EventLevel color palette (globals.css).
// CONSECUTIVE repeats (same channel + type + message — the cost_gate /
// time_window block spam re-fired every cycle) collapse into ONE line with a
// ×N counter, so the tape reads as information instead of scrolling itself
// to death. The newest occurrence's timestamp is shown.
export function SignalsTape({ signals }: { signals: Signal[] }) {
  const rows: { s: Signal; n: number }[] = [];
  for (const s of signals) {
    const last = rows[rows.length - 1];
    if (last && last.s.strategist_slug === s.strategist_slug && last.s.signal_type === s.signal_type && last.s.message === s.message) last.n++;
    else rows.push({ s, n: 1 });
  }
  return (
    <div className="panel">
      <div className="phead">
        <span className="t">Signals Tape</span>
        <span className="x">live</span>
      </div>
      <div className="pbody">
        <div className="log">
          {rows.length === 0 ? (
            <div className="empty-state">
              <span className="es-dot" />
              <span>listening for signals</span>
              <span className="es-sub">live tape · nothing yet</span>
            </div>
          ) : (
            rows.map(({ s, n }) => (
              <div className="line" key={s.id}>
                <span className="ts">{timeOfDay(s.created_at)}</span>
                <span className={`lv ${s.level}`}>{s.level}</span>
                <span className="msg">
                  <strong style={{ color: "var(--muted)" }}>{s.signal_type}</strong>{" "}
                  {s.message}
                  {n > 1 && <span className="sig-xn" title={`${n} consecutive identical signals collapsed`}>×{n}</span>}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
