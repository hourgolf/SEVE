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
  const { severity, title, facts, activeCodes, stopSuppressed, primaryCode } = incident;
  // Only HIGH is collapsible. CRITICAL is ALWAYS expanded (it must not inherit a previously-collapsed
  // HIGH `open` state). WARNING/CHECKING show their fact(s) inline with no (nonfunctional) toggle button.
  const collapsible = severity === "high";
  const [highOpen, setHighOpen] = useState(true);
  if (severity === "normal") return null;

  const expanded = severity === "critical" ? true : collapsible ? highOpen : true;
  const extraCodes = activeCodes.filter((c) => c !== primaryCode);
  const critHigh = severity === "critical" || severity === "high";

  return (
    <div className={`inc-banner inc-${severity}`} role={critHigh ? "alert" : "status"} aria-live={severity === "critical" ? "assertive" : "polite"}>
      <div className="inc-row">
        <span className="inc-dot" aria-hidden />
        <span className="inc-title">{title}</span>
        <span className="inc-grow" />
        {collapsible && facts.length > 0 && (
          <button type="button" className="inc-toggle" onClick={() => setHighOpen((o) => !o)}>
            {highOpen ? "hide" : "details"}
          </button>
        )}
      </div>
      {expanded && facts.length > 0 && (
        <ul className="inc-facts">{facts.map((f, i) => <li key={i}>{f}</li>)}</ul>
      )}
      {expanded && (extraCodes.length > 0 || stopSuppressed.length > 0) && (
        <div className="inc-codes">
          {extraCodes.length > 0 && <span>also: {extraCodes.join(" · ")}</span>}
          {stopSuppressed.length > 0 && <span> · suppressed by STOP: {stopSuppressed.join(", ")}</span>}
        </div>
      )}
    </div>
  );
}
