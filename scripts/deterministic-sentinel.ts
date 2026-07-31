// Deterministic, Mac-independent Sentinel packet publisher.
//
// The default mode is SELECT-only and writes local content-addressed evidence.
// `--publish` appends one idempotent events receipt; it never deletes a prior
// Sentinel row, changes strategy configuration, or touches an order route.

import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { etDayRangeUtc } from "@/lib/research/afterCloseResearch";
import { nextTradingDay } from "@/engine/market-calendar";
import {
  DETERMINISTIC_SENTINEL_PUBLISHER_VERSION,
  deriveSentinelOperatorPacket,
  operatorPacketToJudge,
  type SentinelOperatorPacketInput,
} from "@/lib/sentinel/operatorPacket";
import { auditSentinelManagerBook } from "@/lib/sentinel/managerBookAudit";
import { summarizeLogicalTradeCohort } from "@/lib/positions/logicalTradeCohort";
import { auditSentinelRelease } from "@/lib/sentinel/releaseAudit";
import type { WorkerObservation } from "@/lib/ops/preopenReadinessEngine";
import type { DarkCandidateFreeze } from "@/lib/research/darkCandidateFreeze";
import type { DarkEvidenceCompleteness } from "@/lib/research/darkEvidenceCompleteness";
import type { DarkExactReplayResult } from "@/lib/research/darkExactReplay";
import type { MarketEvent } from "@/lib/types";
import { observeRc54ReleaseReceipt } from "./ops/rc54ReadinessAdapter";
import { loadActiveRc54OperationalAuthority } from "./ops/activeOperationalContract";
import { createServerSupabaseClient } from "./serverSupabase";
import {
  buildVersionedChannelDecisionPacket,
  readVersionedChannelDecisionPacket,
  type ExactCurrentChannelCohort,
} from "@/lib/channels/channelDecisionPacket";
import {
  CHANNEL_DECISION_PACKET_VERSION,
} from "@/lib/channels/channelDecisionEvidence";
import { contentHash } from "@/lib/channels/channelControlPlane";

const WORKER_FRESH_MS = 150_000;
const arg = (name: string, fallback = ""): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const todayEt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const SESSION = arg("session", todayEt);
const FREEZE = arg("freeze", `data/dark-candidate-freezes/${SESSION}/freeze.json`);
const EXACT_REPORT = arg("exact-report");
const OUT = arg("out", `data/sentinel-packets/${SESSION}.json`);
const SUPERSEDES_EVENT_ID = arg("supersedes-event");
const PUBLISH = process.argv.includes("--publish");
if (!/^\d{4}-\d{2}-\d{2}$/.test(SESSION)) throw new Error("--session must be YYYY-MM-DD");
if (SUPERSEDES_EVENT_ID && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(SUPERSEDES_EVENT_ID)) {
  throw new Error("--supersedes-event must be a UUID");
}

const sha256 = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");
const dollars = (value: number): string => `${value >= 0 ? "+" : "-"}$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;

interface PositionRow {
  id: string;
  status: "open" | "closed";
  opened_at: string;
  closed_at: string | null;
  realized_pnl: number | string | null;
  close_reason: string | null;
  runner_of: string | null;
  channel_spec_version_id?: string | null;
  configuration_epoch_id?: string | null;
}
interface ManagerRow {
  id: string;
  position_id: string;
  manager_id: string;
  status: string;
  evidence_state: string | null;
  censor_code: string | null;
  entry_at: string;
}
interface EventRow { id: string; level: string; strategist_id: string | null; message: string; meta: unknown; created_at: string }
interface WorkerRow {
  version: string | null;
  started_at: string | null;
  last_heartbeat_at: string | null;
  last_phase: string | null;
  last_error: string | null;
}
interface DarkExactReport {
  inputs: { freezeCanonicalSha256: string };
  completeness: DarkEvidenceCompleteness;
  replay: DarkExactReplayResult;
}

function dateEt(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function exactCurrentCohorts(input: {
  rows: PositionRow[];
  runtime: NonNullable<
    Awaited<ReturnType<typeof loadActiveRc54OperationalAuthority>>["runtime"]
  >;
}): ExactCurrentChannelCohort[] {
  const slugBySpecDatabaseId = new Map(
    input.runtime.roots.flatMap((root) =>
      root.channelSpecVersionDatabaseId
        ? [[root.channelSpecVersionDatabaseId, {
          slug: root.slug,
          versionId: root.configuration.channelSpecVersionId,
        }] as const]
        : []),
  );
  const rowsByLogicalId = new Map<string, PositionRow[]>();
  for (const row of input.rows) {
    const logicalId = row.runner_of ?? row.id;
    rowsByLogicalId.set(
      logicalId,
      [...(rowsByLogicalId.get(logicalId) ?? []), row],
    );
  }
  const grouped = new Map<string, {
    slug: string;
    channelSpecVersionId: string;
    sessions: Set<string>;
    totalUsd: number;
    logicalIds: string[];
  }>();
  for (const [logicalId, rows] of rowsByLogicalId) {
    const root = rows.find((row) => row.id === logicalId) ?? rows[0];
    if (!root
        || rows.some((row) => row.status !== "closed" && !row.closed_at)
        || root.configuration_epoch_id !== input.runtime.configurationEpochId) {
      continue;
    }
    const spec = root.channel_spec_version_id
      ? slugBySpecDatabaseId.get(root.channel_spec_version_id)
      : null;
    if (!spec) continue;
    const realized = rows.reduce((sum, row) => {
      const value = Number(row.realized_pnl);
      return Number.isFinite(value) ? sum + value : sum;
    }, 0);
    const current = grouped.get(spec.slug) ?? {
      slug: spec.slug,
      channelSpecVersionId: spec.versionId,
      sessions: new Set<string>(),
      totalUsd: 0,
      logicalIds: [],
    };
    current.sessions.add(dateEt(root.opened_at));
    current.totalUsd += realized;
    current.logicalIds.push(logicalId);
    grouped.set(spec.slug, current);
  }
  return [...grouped.values()].sort((a, b) =>
    a.slug.localeCompare(b.slug)).map((cohort) => {
    const evidenceRef = contentHash({
      kind: "exact-current-channel-cohort",
      slug: cohort.slug,
      channelSpecVersionId: cohort.channelSpecVersionId,
      configurationEpochId: input.runtime.configurationEpochId,
      logicalIds: [...cohort.logicalIds].sort(),
      sessions: [...cohort.sessions].sort(),
      totalUsd: cohort.totalUsd,
    });
    return {
      slug: cohort.slug,
      channelSpecVersionId: cohort.channelSpecVersionId,
      configurationEpochId: input.runtime.configurationEpochId,
      observations: cohort.logicalIds.length,
      sessions: cohort.sessions.size,
      totalUsd: cohort.totalUsd,
      evidenceRef,
    };
  });
}

function renderDigest(packet: ReturnType<typeof deriveSentinelOperatorPacket>): string {
  return [
    `# SENTINEL OPERATOR PACKET — ${packet.session}`,
    "",
    `Next session: ${packet.forDate}`,
    `Evidence state: ${packet.overallState}`,
    `Release: ${packet.release.releaseId ?? "missing"} · ${packet.release.configurationSha256?.slice(0, 12) ?? "missing"}`,
    `Live book: ${packet.liveBook.closed} closed · ${packet.liveBook.open} open · ${packet.liveBook.realizedPnl == null ? "P&L unavailable" : dollars(packet.liveBook.realizedPnl)}`,
    `Manager book: ${packet.managerBook.terminal}/${packet.managerBook.observed} terminal · ${packet.managerBook.censored} censored`,
    `Dark book: ${packet.darkBook.rawDecisions} frozen · ${packet.darkBook.exactContracts} contracts · ${packet.darkBook.state}`,
    "",
    "## Review queue",
    ...packet.findings.slice(0, 3).map((finding) => `- [${finding.action}] ${finding.title} — ${finding.detail}`),
    "",
    `Next action: ${packet.nextAction}`,
    "No configuration change, promotion, or order action is authorized by this packet.",
  ].join("\n");
}

async function main(): Promise<void> {
  const generatedAt = new Date().toISOString();
  const forDate = nextTradingDay(SESSION);
  const range = etDayRangeUtc(SESSION);
  const freeze = JSON.parse(readFileSync(FREEZE, "utf8")) as DarkCandidateFreeze;
  if (freeze.sessionDateEt !== SESSION) throw new Error(`freeze session ${freeze.sessionDateEt} conflicts with ${SESSION}`);
  const exactBytes = EXACT_REPORT ? readFileSync(EXACT_REPORT) : null;
  const exact = exactBytes ? JSON.parse(exactBytes.toString("utf8")) as DarkExactReport : null;
  if (exact && (exact.inputs.freezeCanonicalSha256 !== freeze.canonicalSha256
      || exact.completeness.sessionDateEt !== SESSION || exact.replay.sessionDateEt !== SESSION)) {
    throw new Error("exact replay identity conflicts with the frozen Sentinel session");
  }

  const sb = createServerSupabaseClient("deterministic-sentinel");
  const [
    releaseRead,
    workerRead,
    positionsRead,
    managersRead,
    operationalAuthority,
  ] = await Promise.all([
    sb.from("events").select("id,level,strategist_id,message,meta,created_at")
      .ilike("message", "%release ACTIVE%").order("created_at", { ascending: false }).limit(50),
    sb.from("worker_runs").select("version,started_at,last_heartbeat_at,last_phase,last_error")
      .is("ended_at", null).order("started_at", { ascending: false }).limit(20),
    sb.from("positions").select("id,status,opened_at,closed_at,realized_pnl,close_reason,runner_of")
      .gte("opened_at", range.start).lt("opened_at", range.end).order("opened_at").limit(100),
    sb.from("manager_shadow_runs").select("id,position_id,manager_id,status,evidence_state,censor_code,entry_at")
      .gte("entry_at", range.start).lt("entry_at", range.end).order("entry_at").limit(1_000),
    loadActiveRc54OperationalAuthority(
      sb as unknown as Parameters<typeof loadActiveRc54OperationalAuthority>[0],
    ),
  ]);
  for (const [label, read] of [["release", releaseRead], ["workers", workerRead], ["positions", positionsRead], ["managers", managersRead]] as const) {
    if (read.error) throw new Error(`${label} read failed: ${read.error.message}`);
  }

  const releaseContract = operationalAuthority.contract;
  const release = observeRc54ReleaseReceipt(
    (releaseRead.data ?? []) as unknown as MarketEvent[],
    releaseContract,
  );
  const workers = ((workerRead.data ?? []) as WorkerRow[]).map((row): WorkerObservation => ({
    runtimeVersion: row.version,
    startedAt: row.started_at,
    heartbeatAt: row.last_heartbeat_at,
    lastPhase: row.last_phase,
    lastError: row.last_error,
  }));
  const releaseAudit = auditSentinelRelease({
    contract: releaseContract,
    receipt: release,
    workers,
    nowMs: Date.parse(generatedAt),
    workerFreshMs: WORKER_FRESH_MS,
  });
  const positions = (positionsRead.data ?? []) as PositionRow[];
  const managers = (managersRead.data ?? []) as ManagerRow[];
  const closed = positions.filter((row) => row.status === "closed" || row.closed_at != null);
  const logicalBook = summarizeLogicalTradeCohort(positions);
  if (logicalBook.issues.length) {
    throw new Error(`logical live-book attribution failed: ${logicalBook.issues.join("; ")}`);
  }
  const open = logicalBook.open;
  const realizedPnl = logicalBook.realizedPnl;
  const manualCloses = logicalBook.manualCloses;
  const managerAudit = auditSentinelManagerBook(
    positions.map((row) => ({ id: row.id, runnerOf: row.runner_of })),
    managers.map((row) => ({
      positionId: row.position_id,
      managerId: row.manager_id,
      status: row.status,
      censorCode: row.censor_code,
    })),
  );
  const { terminal, censored, active } = managerAudit;
  const managersOk = managerAudit.complete;
  const managerDetail = managersOk
    ? `all ${managerAudit.requiredArms} required arms are terminal across ${managerAudit.rootPositions} root live path(s); ${managerAudit.runnerPositions} runner child row(s) excluded from the manager denominator`
    : `manager completeness failed: ${managerAudit.missingRequiredArms} required missing · ${managerAudit.duplicateRequiredArms} duplicate · ${managerAudit.unexpectedPositionArms} non-root · ${active} active · ${censored} censored`;

  const input: SentinelOperatorPacketInput = {
    session: SESSION,
    forDate,
    generatedAt,
    release: {
      state: releaseAudit.state,
      source: `events:sealed-startup-receipt+worker_runs:${releaseContract.adapterId}`,
      asOf: releaseAudit.asOf,
      detail: releaseAudit.detail,
      releaseId: releaseAudit.releaseId,
      configurationSha256: releaseAudit.configurationSha256,
    },
    liveBook: {
      state: open === 0 && realizedPnl != null ? "ok" : open > 0 ? "partial" : "missing",
      source: "positions:session-opened-logical-cohort",
      asOf: closed.map((row) => row.closed_at).filter((value): value is string => Boolean(value)).sort().at(-1) ?? generatedAt,
      detail: open === 0
        ? `${logicalBook.closed} logical trade(s) closed across ${logicalBook.positionRows} immutable position row(s)`
        : `${open} session logical trade(s) remain open across ${logicalBook.positionRows} position row(s)`,
      opened: logicalBook.opened,
      closed: logicalBook.closed,
      open,
      positionRows: logicalBook.positionRows,
      realizedPnl,
      manualCloses,
    },
    managerBook: {
      state: managersOk ? "ok" : managers.length ? "partial" : managerAudit.rootPositions ? "missing" : "ok",
      source: "manager_shadow_runs:session-entry-cohort",
      asOf: managers.map((row) => row.entry_at).sort().at(-1) ?? generatedAt,
      detail: managerDetail,
      observed: managers.length,
      terminal,
      censored,
      active,
    },
    darkBook: {
      state: exact
        ? exact.completeness.state === "complete" ? "ok"
          : exact.completeness.state === "exact_pending" ? "not_due"
            : exact.completeness.state === "censored" ? "error" : "partial"
        : "not_due",
      source: exact ? "dark-candidate-t1-v1:exact-cbbo-manager-replay" : "dark-candidate-freeze-v1:signals-plus-execution-observations",
      asOf: exact ? generatedAt : range.end,
      detail: exact
        ? `${exact.completeness.state}; ${exact.replay.source.independentManagerPaths} independent manager paths after sequential overlap censoring`
        : "source decisions are frozen; exact Databento CBBO replay remains gated until T+1",
      rawDecisions: freeze.summary.validRawDecisions,
      sourceCensors: freeze.summary.censoredSignals,
      exactContracts: freeze.summary.exactContracts,
      exactEligible: exact?.completeness.counts.exactEligible ?? null,
      exactCensored: exact?.completeness.counts.exactCensored ?? null,
      exactMissing: exact?.completeness.counts.exactMissing ?? null,
      independentManagerPaths: exact?.replay.source.independentManagerPaths ?? null,
      overlappingManagerClocksCensored: exact?.replay.source.overlappingManagerClocksCensored ?? null,
      freezeSha256: freeze.canonicalSha256,
      exactReportSha256: exactBytes ? sha256(exactBytes) : null,
    },
    publisherProof: {
      state: "not_due",
      source: "remote-morning-publisher-v1",
      asOf: null,
      detail: `hosted start/Sentinel/finish proof is due before ${forDate} open`,
    },
  };
  const packet = deriveSentinelOperatorPacket(input);
  let channelDecisionPacket = null;
  if (operationalAuthority.runtime) {
    const specDatabaseIds = operationalAuthority.runtime.roots
      .map((root) => root.channelSpecVersionDatabaseId)
      .filter((value): value is string => Boolean(value));
    const [cohortRead, priorPacketRead, strategistsRead] = await Promise.all([
      specDatabaseIds.length
        ? sb.from("positions")
          .select(
            "id,status,opened_at,closed_at,realized_pnl,close_reason,runner_of,channel_spec_version_id,configuration_epoch_id",
          )
          .eq(
            "configuration_epoch_id",
            operationalAuthority.runtime.configurationEpochId,
          )
          .in("channel_spec_version_id", specDatabaseIds)
          .order("opened_at")
          .limit(10_000)
        : Promise.resolve({ data: [], error: null }),
      sb.from("events")
        .select("meta,created_at")
        .like("message", "sentinel:%")
        .order("created_at", { ascending: false })
        .limit(50),
      sb.from("strategists")
        .select("slug")
        .order("slug")
        .limit(1_000),
    ]);
    if (cohortRead.error) {
      throw new Error(
        `current configuration cohort read failed: ${cohortRead.error.message}`,
      );
    }
    if (priorPacketRead.error) {
      throw new Error(
        `prior channel packet read failed: ${priorPacketRead.error.message}`,
      );
    }
    if (strategistsRead.error) {
      throw new Error(
        `channel inventory read failed: ${strategistsRead.error.message}`,
      );
    }
    const predecessor = (priorPacketRead.data ?? []).map((row) =>
      readVersionedChannelDecisionPacket(row.meta?.channelDecisionPacket))
      .find((value) => value != null) ?? null;
    channelDecisionPacket = buildVersionedChannelDecisionPacket({
      sessionDateEt: SESSION,
      generatedAt,
      releaseId: operationalAuthority.runtime.releaseId,
      manifestContentHash: operationalAuthority.runtime.manifestContentHash,
      configurationEpochId:
        operationalAuthority.runtime.configurationEpochId,
      predecessorContentHash: predecessor?.contentHash ?? null,
      slugs: (strategistsRead.data ?? []).map((row) => String(row.slug)),
      exactCurrentCohorts: exactCurrentCohorts({
        rows: (cohortRead.data ?? []) as PositionRow[],
        runtime: operationalAuthority.runtime,
      }),
      reviewBasisVersion: CHANNEL_DECISION_PACKET_VERSION,
      sourceEvidenceRefs: [
        `sentinel-operator-packet:${SESSION}:${packet.version}`,
        `dark-freeze:sha256:${freeze.canonicalSha256}`,
      ],
    });
  }
  const judge = operatorPacketToJudge(packet);
  const digest = renderDigest(packet);
  const publisherRunId = `${DETERMINISTIC_SENTINEL_PUBLISHER_VERSION}:${SESSION}:${forDate}`;
  const meta = {
    kind: "sentinel",
    schemaVersion: 4,
    publisherVersion: DETERMINISTIC_SENTINEL_PUBLISHER_VERSION,
    publisherRunId,
    publisherEvidenceState: packet.overallState === "ok" ? "complete" : "partial",
    publisherEvidenceDetail: `deterministic packet ${packet.overallState}; next action ${packet.nextAction}`,
    supersedesEventId: SUPERSEDES_EVENT_ID || null,
    supersessionReason: SUPERSEDES_EVENT_ID
      ? "release parser correction: replace stale release identity with the latest sealed startup receipt"
      : null,
    session: SESSION,
    date: SESSION,
    forDate,
    publishedAt: generatedAt,
    digest,
    brief: null,
    scan: {
      benchDays: 0, promote: [], fixable: [], leaks: [],
      drift: packet.findings.map((finding) => `${finding.code}: ${finding.title}`),
      scalps: [], craters: [], patterns: [],
    },
    judge,
    lens: null,
    operatorPacket: packet,
    channelDecisionPacket,
    interpretiveProvider: "none",
  };

  const output = {
    schemaVersion: 1,
    packet,
    channelDecisionPacket,
    compatibility: { judge, digest },
    publication: {
      publisherRunId,
      authorized: PUBLISH,
      supersedesEventId: SUPERSEDES_EVENT_ID || null,
    },
  };
  const outputText = `${JSON.stringify(output, null, 2)}\n`;
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, outputText);
  const receipt = {
    version: packet.version,
    session: SESSION,
    forDate,
    packetSha256: sha256(outputText),
    channelDecisionPacketContentHash:
      channelDecisionPacket?.contentHash ?? null,
    freezeSha256: freeze.canonicalSha256,
    externalWrite: PUBLISH,
    supersedesEventId: SUPERSEDES_EVENT_ID || null,
    configurationChangeAuthorized: false,
    orderActionAuthorized: false,
  };
  writeFileSync(join(dirname(OUT), `${SESSION}.receipt.json`), `${JSON.stringify(receipt, null, 2)}\n`);

  if (PUBLISH) {
    const message = `sentinel: ${SESSION}`;
    if (SUPERSEDES_EVENT_ID) {
      const superseded = await sb.from("events").select("id,message,meta,created_at")
        .eq("id", SUPERSEDES_EVENT_ID).maybeSingle();
      if (superseded.error) throw new Error(`superseded receipt read failed: ${superseded.error.message}`);
      if (!superseded.data
          || superseded.data.message !== message
          || superseded.data.meta?.session !== SESSION
          || superseded.data.meta?.publisherRunId === publisherRunId) {
        throw new Error("superseded receipt does not match this Sentinel session and prior publisher identity");
      }
    }
    const prior = await sb.from("events").select("message,created_at,meta")
      .eq("message", message).order("created_at", { ascending: false }).limit(25);
    if (prior.error) throw new Error(`publication identity read failed: ${prior.error.message}`);
    const exists = (prior.data ?? []).some((row) => row.meta?.publisherRunId === publisherRunId);
    if (!exists) {
      const inserted = await sb.from("events").insert({ level: "INFO", message, meta });
      if (inserted.error) throw new Error(`deterministic Sentinel publish failed: ${inserted.error.message}`);
    }
    console.log(`deterministic-sentinel: ${exists ? "already published" : "published"} ${publisherRunId}`);
  }

  console.log(`deterministic-sentinel: ${SESSION} -> ${forDate} · ${packet.overallState} · ${packet.nextAction}`);
  console.log(`  live ${closed.length}/${positions.length} closed · managers ${terminal}/${managers.length} terminal · dark ${freeze.summary.validRawDecisions} frozen`);
  console.log(`  wrote ${OUT} · llm NONE · config/order authority NONE`);
}

main().catch((error) => {
  console.error(`deterministic-sentinel failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
