"use client";

// /incident-preview — a deterministic FIXTURE harness for the P5-slice-3 incident banner + health strip.
// Renders every severity (normal / checking / warning / high / critical) from hand-built Incident objects
// — NO production data, NO hooks, NO mutation. For independent visual/DOM review of the severity states.
// Not linked from the app; navigate directly.

import "@/app/shell.css";
import "@/app/perform.css";
import "@/app/incident.css";
import { IncidentBanner } from "@/components/perform/IncidentBanner";
import { SystemHealthStrip } from "@/components/perform/SystemHealthStrip";
import type { Incident } from "@/lib/incident/deriveIncident";

const pos = (total: number, s = 0, c = 0, u = 0) => ({ total, streamConfigured: s, cronConfigured: c, unknown: u });

const FIXTURES: { label: string; incident: Incident }[] = [
  { label: "NORMAL (banner hidden; health strip shows)", incident: { severity: "normal", primaryCode: "N1", title: "HEALTHY", facts: [], activeCodes: ["N1"], stopSuppressed: [], session: "open", coverageKnown: true, positions: pos(3, 3) } },
  { label: "CHECKING (loading — no health claim)", incident: { severity: "checking", primaryCode: "L", title: "CHECKING…", facts: ["reading worker + ops telemetry"], activeCodes: ["L"], stopSuppressed: [], session: "open", coverageKnown: true, positions: pos(0) } },
  { label: "WARNING (compact)", incident: { severity: "warning", primaryCode: "W4", title: "STREAM BEAT LAGGING", facts: ["stream beat 1m, market hours; process observed"], activeCodes: ["W4"], stopSuppressed: [], session: "open", coverageKnown: true, positions: pos(2, 2) } },
  { label: "HIGH (expanded)", incident: { severity: "high", primaryCode: "H1", title: "WORKER UNSTABLE — 4 ABRUPT TERMINATIONS / 16H", facts: ["process last observed 20s ago", "boots incl. redeploys: 30"], activeCodes: ["H1", "W-obs"], stopSuppressed: [], session: "open", coverageKnown: true, positions: pos(1, 0, 0, 1) } },
  { label: "CRITICAL (pre-empts chart space)", incident: { severity: "critical", primaryCode: "C4-stream", title: "STREAM HEARTBEAT STALE", facts: ["no stream beat 3m + process last observed 5m ago, market hours", "3 stream-configured open positions — manager not observed", "broker state unconfirmed"], activeCodes: ["C4-stream", "C2", "H1"], stopSuppressed: [], session: "open", coverageKnown: true, positions: pos(3, 3) } },
];

export default function IncidentPreview() {
  return (
    <div className="console-root" data-theme="blackout" style={{ minHeight: "100vh", padding: 24 }}>
      <div className="shell-root" data-mode="perform" data-skin="blackout" data-density="normal">
        <h1 style={{ fontFamily: "var(--sh-mono)", fontSize: 15, color: "var(--lcd-ink)", marginBottom: 4 }}>Incident preview — deterministic fixtures</h1>
        <p style={{ fontFamily: "var(--sh-mono)", fontSize: 11, color: "var(--dk-mut)", marginBottom: 20 }}>slice-3 banner + system-health strip · not production data</p>
        {FIXTURES.map(({ label, incident }) => (
          <section key={incident.primaryCode} data-fixture={incident.severity} style={{ marginBottom: 22 }}>
            <div style={{ fontFamily: "var(--sh-mono)", fontSize: 11, color: "var(--dk-mut)", marginBottom: 6, letterSpacing: "0.04em" }}>{label}</div>
            <div className="perform" data-incident={incident.severity} style={{ border: "1px dashed var(--sep-line)", borderRadius: 12, padding: 12, minHeight: "auto", height: "auto", display: "block" }}>
              <IncidentBanner incident={incident} />
              <aside className="pf-rail" style={{ maxWidth: 380 }}>
                <SystemHealthStrip incident={incident} />
              </aside>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
