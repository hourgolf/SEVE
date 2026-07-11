"use client";

// IncidentBanner (P5 slice 3) — the deterministic incident banner for desktop PERFORM. Pure presentation:
// consumes the seam-derived `Incident` (no hooks, no subscriptions). Severity behavior:
//   normal   → hidden (the always-on SystemHealthStrip carries the healthy/closed state)
//   checking → neutral compact line (no health claim)
//   warning  → compact one line
//   high     → expanded (facts + active codes)
//   critical → expanded + pre-empts chart space (CSS: .perform[data-incident=critical] shrinks the chart)
// Never offers executor-switch / remediation. Sentinel/LLM is NOT an input here.

import { useState } from "react";
import type { Incident } from "@/lib/incident/deriveIncident";

export function IncidentBanner({ incident }: { incident: Incident }) {
  const { severity, title, facts, activeCodes, stopSuppressed } = incident;
  const expandable = severity === "high" || severity === "critical";
  const [open, setOpen] = useState(true);
  if (severity === "normal") return null;

  const showDetails = expandable && open;
  const extraCodes = activeCodes.filter((c) => c !== incident.primaryCode);

  return (
    <div className={`inc-banner inc-${severity}`} role={expandable ? "alert" : "status"} aria-live={severity === "critical" ? "assertive" : "polite"}>
      <div className="inc-row">
        <span className="inc-dot" aria-hidden />
        <span className="inc-title">{title}</span>
        <span className="inc-grow" />
        {facts.length > 0 && (
          <button type="button" className="inc-toggle" onClick={() => setOpen((o) => !o)}>
            {open ? "hide" : "details"}
          </button>
        )}
      </div>
      {(showDetails || severity === "warning" || severity === "checking") && facts.length > 0 && (
        <ul className="inc-facts">{facts.map((f, i) => <li key={i}>{f}</li>)}</ul>
      )}
      {showDetails && (extraCodes.length > 0 || stopSuppressed.length > 0) && (
        <div className="inc-codes">
          {extraCodes.length > 0 && <span>also: {extraCodes.join(" · ")}</span>}
          {stopSuppressed.length > 0 && <span> · suppressed by STOP: {stopSuppressed.join(", ")}</span>}
        </div>
      )}
    </div>
  );
}
