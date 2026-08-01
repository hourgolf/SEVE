"use client";

import type { SurfaceProps } from "@/components/surfaceTypes";
import { findSealedReleaseReceipt } from "@/lib/ops/releaseReceipt";
import { OpsReadinessPanel } from "@/components/ops/OpsReadinessPanel";
import { SeveWorkspaceHeader } from "@/components/ui/Seve909";

const age = (seconds: number | null): string => seconds == null ? "—" : seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h`;
const localTime = (value: string | null | undefined): string => value ? new Date(value).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) + " PT" : "—";

function StateLamp({ state, label, detail }: { state: string; label: string; detail: string }) {
  const tone = state === "ok" || state === "observed" || state === "paper" || state === "authenticated" ? "green" : state === "error" || state === "live" ? "red" : "yellow";
  return <div className={`opsw-lamp ${tone}`}><i /><span><small>{label}</small><b>{state.toUpperCase()}</b><em>{detail}</em></span></div>;
}

export function OpsWorkspace({ surface }: { surface: SurfaceProps }) {
  const { data, ops, workerRuns, incident, feed, write, accounts, acctId } = surface;
  const release = findSealedReleaseReceipt(data.releaseEvents);
  const account = accounts.find((row) => row.id === acctId);
  const reconciliation = surface.opsReadiness.evidence.find((item) => item.id === "reconciliation");
  const processAge = workerRuns.currentHeartbeatAtMs == null ? null : Math.max(0, Math.round((Date.now() - workerRuns.currentHeartbeatAtMs) / 1000));

  return <section className="opsw" id="perform-ops" tabIndex={-1} aria-label="Operations evidence workspace">
    <SeveWorkspaceHeader
      title="OPERATIONS"
      subtitle="read-only control-plane evidence · paper desk"
      boundary="EVIDENCE ONLY"
    />
    <div className="opsw-grid">
      <section className="opsw-card opsw-readiness"><header><span>00</span><b>CAPTURE + OBSERVER READINESS</b><em>configured ≠ observed</em></header><OpsReadinessPanel model={surface.opsReadiness} /></section>
      <section className="opsw-card"><header><span>01</span><b>PROCESS + EXECUTORS</b><em>liveness clocks remain distinct</em></header><div className="opsw-lamps">
        <StateLamp label="24/7 PROCESS" state={workerRuns.query.state === "ok" ? (workerRuns.hasOpenRun ? "observed" : "missing") : workerRuns.query.state} detail={`${age(processAge)} · ${workerRuns.rowsIn16h} runs / 16h · ${workerRuns.abrupt16h} abrupt`} />
        <StateLamp label="STREAM BEAT" state={ops.heartbeat.state} detail={`${age(ops.hbAgeSec)} · RTH clock`} />
        <StateLamp label="CRON SNAPSHOT" state={ops.cron.state} detail={`${age(ops.cronAgeSec)} · latest desk-total snapshot`} />
        <StateLamp label="DB ASSIGNMENTS" state={ops.assignment.state} detail={`${ops.streamArmed} stream / ${ops.cronArmed} cron armed rows · runtime release may overlay`} />
      </div></section>

      <section className="opsw-card"><header><span>02</span><b>MARKET READS</b><em>last successful app poll</em></header><div className="opsw-lamps">
        {(["option_chain", "bars", "events"] as const).map((key) => { const read = data.readHealth[key]; return <StateLamp key={key} label={key.replaceAll("_", " ")} state={read.lastError ? "error" : read.lastSuccessAt ? "ok" : "checking"} detail={read.lastError || `ok ${localTime(read.lastSuccessAt)}`} />; })}
        <StateLamp label="LATEST OPTION SNAPSHOT" state={data.lastIngestTs ? "observed" : "missing"} detail={`${localTime(data.lastIngestTs)} · ${data.snapshot.length} contracts · ${data.expirations} expirations`} />
      </div></section>

      <section className="opsw-card"><header><span>03</span><b>ACTIVE RELEASE</b><em>startup receipt ≠ current liveness</em></header>
        {release ? <div className="opsw-release"><i /><span><small>LAST OBSERVED STARTUP RECEIPT</small><b>{release.releaseId}</b><em>{release.configHash}</em><small>{localTime(release.createdAt)}</small></span></div> : <div className="opsw-empty">no sealed startup receipt returned by the dedicated receipt read</div>}
        <p className="opsw-note">The process heartbeat above establishes current observation. This receipt only identifies the release/config seen at startup.</p>
      </section>

      <section className="opsw-card"><header><span>04</span><b>OPERATOR + BOOK</b><em>claims kept deliberately narrow</em></header><div className="opsw-lamps">
        <StateLamp label="ACCOUNT MODE" state={account?.mode ?? "checking"} detail={account?.name ?? "selected account unavailable"} />
        <StateLamp label="OPERATOR" state={write.canWrite ? "authenticated" : "read only"} detail={write.canWrite ? "manual-close and protected controls available" : "sign in for protected actions"} />
        <StateLamp label="DESK POSITIONS" state={feed.positions.length === 0 ? "observed" : "warning"} detail={`desk shows ${feed.positions.length} open · ${incident.positions.streamConfigured}s/${incident.positions.cronConfigured}c/${incident.positions.unknown}?`} />
        <StateLamp label="BROKER RECONCILIATION" state={reconciliation?.tone === "green" ? "observed" : reconciliation?.tone === "red" ? "error" : reconciliation?.tone === "yellow" ? "warning" : "checking"} detail={reconciliation ? `${reconciliation.state} · ${reconciliation.detail}` : "checking current paper accounts"} />
      </div></section>
    </div>
  </section>;
}
