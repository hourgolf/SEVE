// Deterministic, Mac-independent Sentinel packet publisher.
//
// The default mode is SELECT-only and writes local content-addressed evidence.
// `--publish` appends one idempotent events receipt; it never deletes a prior
// Sentinel row, changes strategy configuration, or touches an order route.

import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DAY1_CONFIG_HASH, DAY1_RELEASE_ID } from "@/lib/channels/day1Release";
import { etDayRangeUtc } from "@/lib/research/afterCloseResearch";
import { nextTradingDay } from "@/engine/market-calendar";
import { findDay1ReleaseReceipt } from "@/lib/ops/releaseReceipt";
import {
  DETERMINISTIC_SENTINEL_PUBLISHER_VERSION,
  deriveSentinelOperatorPacket,
  operatorPacketToJudge,
  type SentinelOperatorPacketInput,
} from "@/lib/sentinel/operatorPacket";
import { auditSentinelManagerBook } from "@/lib/sentinel/managerBookAudit";
import type { DarkCandidateFreeze } from "@/lib/research/darkCandidateFreeze";
import type { DarkEvidenceCompleteness } from "@/lib/research/darkEvidenceCompleteness";
import type { DarkExactReplayResult } from "@/lib/research/darkExactReplay";
import type { MarketEvent } from "@/lib/types";
import { createServerSupabaseClient } from "./serverSupabase";

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
const PUBLISH = process.argv.includes("--publish");
if (!/^\d{4}-\d{2}-\d{2}$/.test(SESSION)) throw new Error("--session must be YYYY-MM-DD");

const sha256 = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");
const numeric = (value: unknown): number | null => {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const dollars = (value: number): string => `${value >= 0 ? "+" : "-"}$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;

interface PositionRow {
  id: string;
  status: string;
  opened_at: string;
  closed_at: string | null;
  realized_pnl: number | string | null;
  close_reason: string | null;
  runner_of: string | null;
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
interface DarkExactReport {
  inputs: { freezeCanonicalSha256: string };
  completeness: DarkEvidenceCompleteness;
  replay: DarkExactReplayResult;
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
  const [releaseRead, positionsRead, managersRead] = await Promise.all([
    sb.from("events").select("id,level,strategist_id,message,meta,created_at")
      .ilike("message", "%day1-release ACTIVE%").order("created_at", { ascending: false }).limit(1),
    sb.from("positions").select("id,status,opened_at,closed_at,realized_pnl,close_reason,runner_of")
      .gte("opened_at", range.start).lt("opened_at", range.end).order("opened_at").limit(100),
    sb.from("manager_shadow_runs").select("id,position_id,manager_id,status,evidence_state,censor_code,entry_at")
      .gte("entry_at", range.start).lt("entry_at", range.end).order("entry_at").limit(1_000),
  ]);
  for (const [label, read] of [["release", releaseRead], ["positions", positionsRead], ["managers", managersRead]] as const) {
    if (read.error) throw new Error(`${label} read failed: ${read.error.message}`);
  }

  const release = findDay1ReleaseReceipt((releaseRead.data ?? []) as unknown as MarketEvent[]);
  const positions = (positionsRead.data ?? []) as PositionRow[];
  const managers = (managersRead.data ?? []) as ManagerRow[];
  const closed = positions.filter((row) => row.status === "closed" || row.closed_at != null);
  const open = positions.length - closed.length;
  const pnlValues = closed.map((row) => numeric(row.realized_pnl));
  const realizedPnl = pnlValues.some((value) => value == null)
    ? null
    : Math.round(pnlValues.reduce<number>((sum, value) => sum + (value ?? 0), 0) * 100) / 100;
  const manualCloses = closed.filter((row) => /manual|operator/i.test(row.close_reason ?? "")).length;
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
  const releaseOk = release?.releaseId === DAY1_RELEASE_ID && release.configHash === DAY1_CONFIG_HASH;
  const managersOk = managerAudit.complete;
  const managerDetail = managersOk
    ? `all ${managerAudit.requiredArms} required arms are terminal across ${managerAudit.rootPositions} root live path(s); ${managerAudit.runnerPositions} runner child row(s) excluded from the manager denominator`
    : `manager completeness failed: ${managerAudit.missingRequiredArms} required missing · ${managerAudit.duplicateRequiredArms} duplicate · ${managerAudit.unexpectedPositionArms} non-root · ${active} active · ${censored} censored`;

  const input: SentinelOperatorPacketInput = {
    session: SESSION,
    forDate,
    generatedAt,
    release: {
      state: releaseOk ? "ok" : release ? "conflict" : "missing",
      source: "events:day1-release-startup-receipt",
      asOf: release?.createdAt ?? null,
      detail: releaseOk ? "sealed release identity matches the active startup receipt" : "active release identity is absent or conflicts with the sealed code contract",
      releaseId: release?.releaseId ?? null,
      configurationSha256: release?.configHash ?? null,
    },
    liveBook: {
      state: open === 0 && pnlValues.every((value) => value != null) ? "ok" : open > 0 ? "partial" : "missing",
      source: "positions:session-opened-cohort",
      asOf: closed.map((row) => row.closed_at).filter((value): value is string => Boolean(value)).sort().at(-1) ?? generatedAt,
      detail: open === 0 ? "session-opened position cohort is closed" : `${open} session position(s) remain open`,
      opened: positions.length,
      closed: closed.length,
      open,
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
    interpretiveProvider: "none",
  };

  const output = { schemaVersion: 1, packet, compatibility: { judge, digest }, publication: { publisherRunId, authorized: PUBLISH } };
  const outputText = `${JSON.stringify(output, null, 2)}\n`;
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, outputText);
  const receipt = {
    version: packet.version,
    session: SESSION,
    forDate,
    packetSha256: sha256(outputText),
    freezeSha256: freeze.canonicalSha256,
    externalWrite: PUBLISH,
    configurationChangeAuthorized: false,
    orderActionAuthorized: false,
  };
  writeFileSync(join(dirname(OUT), `${SESSION}.receipt.json`), `${JSON.stringify(receipt, null, 2)}\n`);

  if (PUBLISH) {
    const message = `sentinel: ${SESSION}`;
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
