"use client";

import { timeOfDay } from "@/lib/format";
import type { Signal } from "@/lib/desk/types";

// Reuses the EventLog .log CSS + EventLevel color palette (globals.css).
export function SignalsTape({ signals }: { signals: Signal[] }) {
  return (
    <div className="panel">
      <div className="phead">
        <span className="t">Signals Tape</span>
        <span className="x">live</span>
      </div>
      <div className="pbody">
        <div className="log">
          {signals.length === 0 ? (
            <div className="empty-state">
              <span className="es-dot" />
              <span>listening for signals</span>
              <span className="es-sub">live tape · nothing yet</span>
            </div>
          ) : (
            signals.map((s) => (
              <div className="line" key={s.id}>
                <span className="ts">{timeOfDay(s.created_at)}</span>
                <span className={`lv ${s.level}`}>{s.level}</span>
                <span className="msg">
                  <strong style={{ color: "var(--muted)" }}>{s.signal_type}</strong>{" "}
                  {s.message}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
