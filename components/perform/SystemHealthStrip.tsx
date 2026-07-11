"use client";

// SystemHealthStrip (P5 slice 3) — the always-visible deterministic health line for desktop PERFORM.
// Renders in EVERY state so open-position truth is never hidden (constraint). Pure presentation: consumes
// only the seam-derived `Incident`. Deterministic health only — no Sentinel/LLM. Positions are shown as
// "desk shows N open" with the per-executor attribution (stream / cron / unknown), never "reconciled/flat".

import type { Incident, Severity, MarketSession } from "@/lib/incident/deriveIncident";

const TONE: Record<Severity, string> = { critical: "bad", high: "bad", warning: "warn", checking: "dim", normal: "ok" };

function healthLabel(sev: Severity, session: MarketSession): string {
  if (sev === "critical") return "INCIDENT";
  if (sev === "high") return "DEGRADED";
  if (sev === "warning") return "WARNING";
  if (sev === "checking") return "CHECKING";
  return session === "open" || session === "premarket" ? "WORKER OBSERVED" : "MARKET CLOSED";
}

export function SystemHealthStrip({ incident }: { incident: Incident }) {
  const { severity, session, positions, coverageKnown } = incident;
  const p = positions;
  return (
    <div className="sys-health" data-tone={TONE[severity]}>
      <span className={`sys-chip sys-${TONE[severity]}`}>{healthLabel(severity, session)}</span>
      <span className="sys-item sys-pos">
        <span className="sys-k">OPEN</span>
        <span className="sys-v">{p.total}</span>
        {p.total > 0 && (
          <span className="sys-attr">
            {p.streamConfigured}<i>s</i>/{p.cronConfigured}<i>c</i>{p.unknown > 0 ? <>/<b className="sys-unk">{p.unknown}?</b></> : null}
          </span>
        )}
      </span>
      <span className="sys-item sys-sess">
        <span className="sys-k">SESSION</span>
        <span className="sys-v">{session}{coverageKnown ? "" : " · cal?"}</span>
      </span>
    </div>
  );
}
