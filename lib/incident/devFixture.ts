// devFixture — deterministic Incident fixtures for DEV verification ONLY (P5 slice 3A). Used by the
// production-gated /incident-preview route and the NODE_ENV-gated `?incident=<sev>` real-surface override.
// Never rendered in production (both call sites are compile-time gated). Not a policy source.

import type { Incident, PositionsByExecutor, MarketSession } from "./deriveIncident";

const pos = (total: number, s = 0, c = 0, u = 0): PositionsByExecutor => ({ total, streamConfigured: s, cronConfigured: c, unknown: u });

export function devIncidentFixture(sev: string, positions?: PositionsByExecutor, session: MarketSession = "open"): Incident {
  const p = positions ?? pos(3, 3);
  const base = (over: Partial<Incident>): Incident => ({
    severity: "normal", primaryCode: "N1", title: "HEALTHY", facts: [], activeCodes: ["N1"],
    stopSuppressed: [], session, coverageKnown: true, positions: p, ...over,
  });
  switch (sev) {
    case "checking": return base({ severity: "checking", primaryCode: "L", title: "CHECKING…", facts: ["reading worker + ops telemetry"], activeCodes: ["L"], positions: pos(0) });
    case "warning": return base({ severity: "warning", primaryCode: "W4", title: "STREAM BEAT LAGGING", facts: ["stream beat 1m, market hours; process observed"], activeCodes: ["W4"], positions: pos(2, 2) });
    case "high": return base({ severity: "high", primaryCode: "H1", title: "WORKER UNSTABLE — 4 ABRUPT TERMINATIONS / 16H", facts: ["process last observed 20s ago", "boots incl. redeploys: 30"], activeCodes: ["H1", "W-obs"], positions: pos(1, 0, 0, 1) });
    case "critical": return base({ severity: "critical", primaryCode: "C4-stream", title: "STREAM HEARTBEAT STALE", facts: ["no stream beat 3m + process last observed 5m ago, market hours", "3 stream-configured open positions — manager not observed", "broker state unconfirmed"], activeCodes: ["C4-stream", "C2", "H1"], positions: pos(3, 3) });
    default: return base({});
  }
}

export const DEV_SEVERITIES = ["normal", "checking", "warning", "high", "critical"] as const;
