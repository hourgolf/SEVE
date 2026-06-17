"use client";

// OPS · PRE-FLIGHT — the morning "is it safe to run?" panel, and intraday the
// dead-man display for the Phase-B split-executor desk:
//   STREAM  the Railway worker's heartbeat (only beats while LIVE) — fresh /
//           lagging / STALE (cron exit-only failover) / off
//   CRON    the minute worker's last run (it writes a fund equity snapshot
//           every cycle during RTH)
//   EXEC    armed-channel split between the two executors
//   RISK    Σ RISK-$/trade + Σ daily stops across armed, unmuted channels —
//           the morning's total exposure-at-stake at a glance
import type { OpsStatus } from "@/hooks/useOpsStatus";
import type { StrategistState } from "@/lib/desk/types";

const fmtAge = (s: number | null): string =>
  s == null ? "—" : s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;

// ET market-hours check (rough RTH gate for the liveness colors — off-hours a
// quiet worker is normal, not an alarm).
function inRth(): boolean {
  const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const d = et.getDay(), m = et.getHours() * 60 + et.getMinutes();
  return d >= 1 && d <= 5 && m >= 570 && m < 960;
}

type Tone = "ok" | "warn" | "bad" | "dim";

function Row({ label, tone, value, hint }: { label: string; tone: Tone; value: string; hint?: string }) {
  return (
    <div className="pf-row" title={hint}>
      <span className="pf-label"><span className={`pf-dot pf-${tone}`} />{label}</span>
      <span className={`pf-val pf-val-${tone}`}>{value}</span>
    </div>
  );
}

export interface TapeVitals {
  rowCount: number;
  lastIngestTs: string | null;
  snapCount: number;
  expirations: number;
}

export function OpsPreflight({ strategists, tape, ops }: { strategists: StrategistState[]; tape?: TapeVitals; ops: OpsStatus }) {
  const rth = inRth();

  // STREAM light
  let sTone: Tone = "dim", sVal = "—";
  if (ops.loaded) {
    if (ops.streamArmed === 0 && ops.hbAgeSec == null) { sTone = "dim"; sVal = "off · no stream channels"; }
    else if (ops.hbAgeSec == null) { sTone = rth ? "bad" : "dim"; sVal = "no heartbeat"; }
    else if (ops.hbAgeSec < 60) { sTone = "ok"; sVal = `live · ${fmtAge(ops.hbAgeSec)} ago`; }
    else if (ops.hbAgeSec < 300) { sTone = "warn"; sVal = `lagging · ${fmtAge(ops.hbAgeSec)}`; }
    else { sTone = rth && ops.streamArmed > 0 ? "bad" : "dim"; sVal = rth && ops.streamArmed > 0 ? `STALE ${fmtAge(ops.hbAgeSec)} — cron failover` : `idle · ${fmtAge(ops.hbAgeSec)}`; }
  }

  // CRON light
  let cTone: Tone = "dim", cVal = "—";
  if (ops.loaded) {
    if (ops.cronAgeSec == null) { cTone = rth ? "bad" : "dim"; cVal = "no runs found"; }
    else if (ops.cronAgeSec < 150) { cTone = "ok"; cVal = `running · ${fmtAge(ops.cronAgeSec)} ago`; }
    else if (rth) { cTone = "bad"; cVal = `missed cycles · ${fmtAge(ops.cronAgeSec)}`; }
    else { cTone = "dim"; cVal = `idle · ${fmtAge(ops.cronAgeSec)}`; }
  }

  // Risk-at-stake over armed + unmuted channels
  const active = strategists.filter((s) => s.status === "armed" && !s.config.muted);
  const riskSum = active.reduce((a, s) => a + (s.config.capital_pct || 0), 0);
  const stopSum = active.reduce((a, s) => a + (s.config.daily_stop_usd || 0), 0);

  // TAPE light (absorbed Tape Health — one panel = the whole morning ritual):
  // ingest freshness is the live signal; rows/contracts/expirations ride the hint+value.
  let tTone: Tone = "dim", tVal = "—";
  if (tape) {
    const age = tape.lastIngestTs ? Math.max(0, Math.round((Date.now() - Date.parse(tape.lastIngestTs)) / 1000)) : null;
    if (age == null) { tTone = rth ? "bad" : "dim"; tVal = "no ingest"; }
    else if (age < 180) { tTone = "ok"; tVal = `ingest ${fmtAge(age)} ago · ${tape.snapCount || "—"} contracts · ${tape.expirations || "—"} exp`; }
    else if (rth) { tTone = "bad"; tVal = `ingest STALLED · ${fmtAge(age)}`; }
    else { tTone = "dim"; tVal = `idle · ${fmtAge(age)} · ${tape.snapCount || "—"} contracts`; }
  }

  return (
    <div className="panel ops-pf">
      <div className="phead">
        <span className="t">Ops · Pre-flight</span>
        <span className="x">{rth ? "RTH" : "closed"}</span>
      </div>
      <div className="pf-body">
        <Row label="STREAM" tone={sTone} value={sVal} hint={ops.hbNote ? `worker: ${ops.hbNote}` : "Railway executor heartbeat (beats only while live)"} />
        <Row label="CRON" tone={cTone} value={cVal} hint="minute worker — last fund equity snapshot" />
        <Row
          label="EXEC"
          tone={ops.streamArmed > 0 ? "ok" : "dim"}
          value={`${ops.cronArmed} cron · ${ops.streamArmed} stream`}
          hint="armed channels by executor (strategists.executor)"
        />
        <Row
          label="RISK"
          tone={active.length ? "ok" : "dim"}
          value={`${active.length} armed · $${Math.round(riskSum).toLocaleString()}/trade · stops $${Math.round(stopSum).toLocaleString()}`}
          hint="Σ RISK-$ per trade + Σ daily stops over armed, unmuted channels"
        />
        {tape && (
          <Row
            label="TAPE"
            tone={tTone}
            value={tVal}
            hint={`market-ingest vitals — ${tape.rowCount.toLocaleString()} rows in option_quotes (7d window)`}
          />
        )}
      </div>
    </div>
  );
}
