import type { Incident } from "@/lib/incident/deriveIncident";

/**
 * Deterministic incident evidence only. Severity is derived once at the page
 * seam; this panel never fetches, subscribes, or reinterprets the policy.
 */
export function IncidentDetail({ incident }: { incident: Incident }) {
  if (incident.severity !== "critical" && incident.severity !== "high") return null;
  const p = incident.positions;
  return (
    <section className={`pf-screen pfi-detail pfi-${incident.severity}`} aria-label="incident detail">
      <div className="pf-head">
        <span className="t">INCIDENT DETAIL</span>
        <span className="grow" />
        <span className="x">deterministic · {incident.primaryCode}</span>
      </div>
      <div className="pfi-body">
        <strong>{incident.title}</strong>
        <ul>{incident.facts.map((fact, index) => <li key={index}>{fact}</li>)}</ul>
        <div className="pfi-grid">
          <span><i>active</i><b>{incident.activeCodes.join(" · ")}</b></span>
          <span><i>desk positions</i><b>{p.total} · {p.streamConfigured}s/{p.cronConfigured}c/{p.unknown}?</b></span>
          <span><i>session</i><b>{incident.session}{incident.coverageKnown ? "" : " · calendar?"}</b></span>
          {incident.stopSuppressed.length > 0 && <span><i>STOP suppressed</i><b>{incident.stopSuppressed.join(" · ")}</b></span>}
        </div>
      </div>
    </section>
  );
}
