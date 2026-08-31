// SELECT-only Decision Atlas runner. It reads durable research evidence and a
// freshly generated canonical profitability artifact, then writes local files.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { atlasEvidenceWindow, readAtlasEvidenceRows, type AtlasReadCoverage } from "../lib/research/decisionAtlasRead";
import { loadStoredReceiptBoundControlPlane } from "../lib/channels/channelControlPlanePersistence";
import type { ProfitabilityLedger } from "../lib/profitability/profitabilityLedger";
import { etDateOf } from "../lib/profitability/profitabilityLedger";
import { buildDecisionAtlas } from "../lib/research/decisionAtlas";
import {
  buildBoundedRetuneBook,
  renderBoundedRetuneBookMarkdown,
} from "../lib/research/boundedRetuneExperiments";
import {
  adaptDecisionAtlasSnapshot,
  type AtlasEquitySnapshotRow,
  type AtlasExecutionRow,
  type AtlasPositionContextRow,
  type AtlasWorkerRunRow,
  type AtlasSignalRow,
  type AtlasStrategistRow,
  type AtlasVirtualTradeRow,
  type AtlasVbCandidateReceiptRow,
  type AtlasVbExactManagerPathReceiptRow,
  type AtlasVbExactPathReceiptRow,
  type DecisionAtlasSourceSnapshot,
} from "../lib/research/decisionAtlasAdapter";
import type { ChannelManagerRunRow } from "../lib/research/channelManagerEvidence";
import {
  renderDecisionAtlasMarkdown,
  renderDecisionAtlasProposalPacket,
} from "../lib/research/decisionAtlasReport";
import { createServerSupabaseClient } from "./serverSupabase";
import { etSessionCloseUtc } from "../lib/research/afterCloseResearch";

const arg = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
};

const envFile = arg("env-file") ?? process.env.SEVE_ENV_FILE ?? null;
if (envFile) {
  const path = resolve(envFile);
  if (!existsSync(path)) throw new Error(`environment file not found: ${path}`);
  process.loadEnvFile(path);
} else if (existsSync(resolve(".env.local"))) process.loadEnvFile(resolve(".env.local"));

const outputDir = resolve(arg("out-dir") ?? "data/decision-atlas/latest");
const ledgerFile = resolve(arg("ledger-file") ?? "data/profitability-ledger/ledger.json");
const snapshotFile = arg("snapshot-file");
const virtualCatchupFile = arg("virtual-catchup-file");
const virtualCatchupManifestFile = arg("virtual-catchup-manifest");
const cohortFrom = arg("cohort-from") ?? "2026-07-01T04:00:00.000Z";
const throughSession = arg("through") ?? etDateOf(new Date().toISOString());
const evidenceWindow = atlasEvidenceWindow(cohortFrom, throughSession);

interface ProfitabilityArtifact { ledger: ProfitabilityLedger }

interface LocalVirtualCatchupRow {
  signalId: string;
  slug: string;
  occ: string;
  createdAt: string;
  blocked: string;
  entryAsk: number;
  exitReason: string;
  exitPx: number | null;
  exitAt: string | null;
  pnlPerContract: number | null;
  mfePct: number | null;
  giveback: number | null;
}

interface VirtualCatchupManifest {
  mode: string;
  missingSignalIds: string[];
  exactWriteRequired: boolean;
  productionWrites: number;
}

const sha256 = (value: string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const safeName = (value: string): string => value.replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-");

function applyLocalVirtualCatchup(snapshot: DecisionAtlasSourceSnapshot): {
  snapshot: DecisionAtlasSourceSnapshot;
  metadata: null | { rows: number; dataSha256: string; manifestSha256: string; mode: string };
} {
  if (!virtualCatchupFile && !virtualCatchupManifestFile) return { snapshot, metadata: null };
  if (!virtualCatchupFile || !virtualCatchupManifestFile) {
    throw new Error("--virtual-catchup-file and --virtual-catchup-manifest must be provided together");
  }
  const dataPath = resolve(virtualCatchupFile);
  const manifestPath = resolve(virtualCatchupManifestFile);
  if (!existsSync(dataPath) || !existsSync(manifestPath)) throw new Error("virtual catch-up artifact or manifest not found");
  const dataJson = readFileSync(dataPath, "utf8");
  const manifestJson = readFileSync(manifestPath, "utf8");
  const local = JSON.parse(dataJson) as LocalVirtualCatchupRow[];
  const manifest = JSON.parse(manifestJson) as VirtualCatchupManifest;
  if (manifest.mode !== "read-only-select-audit" || manifest.productionWrites !== 0) {
    throw new Error("virtual catch-up manifest is not a zero-write read-only audit");
  }
  const missingIds = [...new Set(manifest.missingSignalIds)].sort();
  if (manifest.exactWriteRequired !== (missingIds.length > 0)) throw new Error("virtual catch-up manifest requirement is inconsistent");
  const remoteIds = new Set(snapshot.virtualTrades.map((row) => row.signal_id));
  const stale = missingIds.filter((id) => remoteIds.has(id));
  if (stale.length) throw new Error(`virtual catch-up manifest is stale; ${stale.length} listed row(s) are now remote`);
  const localById = new Map(local.map((row) => [row.signalId, row]));
  const signalsById = new Map(snapshot.signals.map((row) => [row.id, row]));
  const additions = missingIds.map((id): AtlasVirtualTradeRow => {
    const row = localById.get(id);
    const signal = signalsById.get(id);
    if (!row || !signal) throw new Error(`virtual catch-up lineage missing for ${id}`);
    return {
      signal_id: id,
      strategist_id: signal.strategist_id,
      slug: row.slug,
      occ: row.occ || null,
      signal_at: row.createdAt,
      blocked: row.blocked || null,
      entry_px: row.entryAsk > 0 ? row.entryAsk : null,
      exit_reason: row.exitReason || null,
      exit_px: row.exitPx,
      exit_at: row.exitAt,
      pnl_per_contract: row.pnlPerContract,
      mfe_pct: row.mfePct,
      giveback_pct: row.giveback,
    };
  });
  return {
    snapshot: { ...snapshot, virtualTrades: [...snapshot.virtualTrades, ...additions]
      .sort((left, right) => left.signal_at.localeCompare(right.signal_at) || left.signal_id.localeCompare(right.signal_id)) },
    metadata: { rows: additions.length, dataSha256: sha256(dataJson), manifestSha256: sha256(manifestJson), mode: manifest.mode },
  };
}

async function collect(ledger: ProfitabilityLedger): Promise<{
  snapshot: DecisionAtlasSourceSnapshot;
  timingsMs: Record<string, number>;
  controlPlaneState: string;
  sourceReadCoverage: Record<string, AtlasReadCoverage>;
}> {
  const sb = createServerSupabaseClient("decision-atlas");
  const timingsMs: Record<string, number> = {};
  const sourceReadCoverage: Record<string, AtlasReadCoverage> = {};
  const timed = async <T>(label: string, read: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    const value = await read();
    timingsMs[label] = Date.now() - started;
    return value;
  };
  const read = <T>(label: string, query: (options: { head: boolean; count?: "exact" }) => any, key = "id") =>
    timed(label, async () => {
      const result = await readAtlasEvidenceRows<T>({ label,
        query: (head) => query(head ? { head, count: "exact" } : { head }),
        key: (row) => String((row as Record<string, unknown>)[key] ?? ""),
      });
      sourceReadCoverage[label] = result.coverage;
      return result.rows;
    });
  const optional = async <T>(read: () => Promise<T[]>): Promise<T[]> => {
    try { return await read(); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/42P01|PGRST205|does not exist|schema cache/i.test(message)) return [];
      throw error;
    }
  };
  const [strategists, positions, signals, executionObservations, virtualTrades, managerRuns, equitySnapshots, workerRuns,
    vbCandidateReceipts, vbExactPathReceipts, vbExactManagerPathReceipts, control] = await Promise.all([
    read<AtlasStrategistRow>("strategists", (options) => sb.from("strategists")
      .select("id,slug,underlying", options).order("id")),
    read<AtlasPositionContextRow>("position_context", (options) => sb.from("positions")
      .select("id,runner_of,entry_features,occ_symbol,opened_at", options)
      .gte("opened_at", evidenceWindow.start).lt("opened_at", evidenceWindow.end).order("opened_at").order("id")),
    read<AtlasSignalRow>("signals", (options) => sb.from("signals")
      .select("id,strategist_id,signal_type,underlying_price,direction,rationale,acted_on,blocked_reason,created_at,configuration_epoch_id", options)
      .gte("created_at", evidenceWindow.start).lt("created_at", evidenceWindow.end).order("created_at").order("id")),
    read<AtlasExecutionRow>("execution_observations", (options) => sb.from("execution_observations")
      .select(["id", "trace_id", "event_kind", "event_at", "strategist_id", "account_id", "channel_slug",
        "opportunity_id", "position_id", "action", "reason", "blocked_reason", "underlying", "occ_symbol",
        "option_side", "bid", "ask", "requested_qty", "broker_status", "filled_qty", "fill_price", "payload",
        "configuration_epoch_id", "source_bar_at", "client_order_id", "broker_order_id", "source_boot_id"].join(","), options)
      .gte("event_at", evidenceWindow.start).lt("event_at", evidenceWindow.end).order("event_at").order("id")),
    read<AtlasVirtualTradeRow>("virtual_trades", (options) => sb.from("virtual_trades")
      .select("signal_id,strategist_id,slug,occ,signal_at,blocked,entry_px,exit_reason,exit_px,exit_at,pnl_per_contract,mfe_pct,giveback_pct", options)
      .gte("signal_at", evidenceWindow.start).lt("signal_at", evidenceWindow.end).order("signal_at").order("signal_id"), "signal_id"),
    read<ChannelManagerRunRow>("manager_shadow_runs", (options) => sb.from("manager_shadow_runs")
      .select(["id", "position_id", "channel_slug", "manager_id", "manager_policy_version", "shadow_book_version",
        "configuration_epoch_id", "status", "evidence_state", "entry_at", "entry_price", "original_qty",
        "economic_mode", "peak_return_pct", "terminal_at", "terminal_return_pct", "terminal_pnl", "censored_at",
        "censor_code"].join(","), options)
      .gte("entry_at", evidenceWindow.start).lt("entry_at", evidenceWindow.end).order("entry_at").order("id")),
    timed("equity_snapshots", async () => {
      const result = await sb.from("equity_snapshots")
      .select("id,account_id,net_liquidation,captured_at")
      .not("account_id", "is", null).is("strategist_id", null)
      .lt("captured_at", evidenceWindow.end)
      .order("captured_at", { ascending: false }).order("id", { ascending: false }).limit(500);
      if (result.error) throw result.error;
      return (result.data ?? []) as unknown as Array<AtlasEquitySnapshotRow & { id: string }>;
    }),
    read<AtlasWorkerRunRow>("worker_runs", (options) => sb.from("worker_runs")
      .select("boot_id,instance_id,git_sha,railway_deployment,started_at,last_heartbeat_at,shutdown_started_at,ended_at,termination_kind,last_phase,memory_rss_mb", options)
      .gte("started_at", evidenceWindow.start).lt("started_at", evidenceWindow.end).order("started_at").order("boot_id"), "boot_id"),
    optional(() => read<AtlasVbCandidateReceiptRow>("vb_candidate_receipts", (options) =>
      sb.from("vb_candidate_receipts")
        .select("id,opportunity_id,signal_id,channel_slug,session_date_et,source_bar_at,blocked_reason,channel_version,configuration_epoch_id,manager_paths_expected,manager_paths_published,manager_censors", options)
        .gte("source_bar_at", evidenceWindow.start).lt("source_bar_at", evidenceWindow.end).order("source_bar_at").order("id"))),
    optional(() => read<AtlasVbExactPathReceiptRow>("vb_exact_path_receipts", (options) =>
      sb.from("vb_exact_path_receipts")
        .select("id,candidate_id,opportunity_id,entry_ask", options)
        // T+1 publication belongs to its entry cohort, not the later publication day.
        .gte("entry_quote_at", evidenceWindow.start).lt("entry_quote_at", evidenceWindow.end).order("entry_quote_at").order("id"))),
    optional(() => read<AtlasVbExactManagerPathReceiptRow>("vb_exact_manager_path_receipts", (options) =>
      sb.from("vb_exact_manager_path_receipts")
        .select("id,candidate_id,opportunity_id,channel_slug,manager_id,pnl_per_contract,basis,independent_opportunity", options)
        .gte("source_bar_at", evidenceWindow.start).lt("source_bar_at", evidenceWindow.end).order("source_bar_at").order("id"))),
    timed("active_control_plane", () => loadStoredReceiptBoundControlPlane(sb)),
  ]);
  if (!control.compiled) throw new Error(`active control plane unavailable: ${control.error ?? control.state}`);
  return {
    snapshot: {
      ledger, strategists, positions, signals, executionObservations, virtualTrades, managerRuns, equitySnapshots, workerRuns,
      vbCandidateReceipts, vbExactPathReceipts, vbExactManagerPathReceipts,
      activeChannelSpecs: control.compiled.channelSpecs,
      activeChannelSpecDatabaseIdsByVersionKey: control.databaseIdentity?.channelSpecDatabaseIdsByVersionKey ?? {},
      currentConfigurationEpochId: control.activationReceipt?.configurationEpochId ?? null,
    },
    timingsMs,
    controlPlaneState: control.state,
    sourceReadCoverage,
  };
}

function renderDossier(channel: string, atlas: ReturnType<typeof buildDecisionAtlas>): string {
  const dossier = atlas.channels[channel];
  const lines = [
    `# ${channel} — ${dossier.disposition.replaceAll("_", " ")}`,
    "",
    dossier.summary,
    "",
    ...dossier.firstGlance.map((metric) => `- ${metric.label}: **${metric.value}** — ${metric.detail}`),
    "",
    `Decision group: **${dossier.lifecycle.decisionGroup.replaceAll("_", " ")}**.`,
    "",
    `Basis: ${dossier.decisionCohort.scoredSessions} scored sessions · ${dossier.decisionCohort.scoredOpportunities} scored logical outcomes · ${dossier.decisionCohort.opportunities} observed signals · ${dossier.decisionCohort.portfolioConfigurationEras.length} portfolio receipt(s). ${dossier.decisionCohort.fact}`,
    "",
    `Channel era: \`${dossier.decisionCohort.configurationEra}\`.`,
    "",
    "This dossier is read-only research and cannot change production behavior.",
    "",
  ];
  return lines.join("\n");
}

async function main(): Promise<void> {
  if (!existsSync(ledgerFile)) throw new Error(`canonical profitability artifact not found: ${ledgerFile}`);
  const artifact = JSON.parse(readFileSync(ledgerFile, "utf8")) as ProfitabilityArtifact;
  // Freeze the default evidence clock at the selected session close. Wall-clock
  // generation time belongs in the receipt, not in decision-bearing payloads:
  // repeated runs through the same session must keep the same semantic hashes.
  const generatedAt = arg("generated-at") ?? etSessionCloseUtc(throughSession);
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("generated-at must be an ISO timestamp");
  let snapshot: DecisionAtlasSourceSnapshot;
  let timingsMs: Record<string, number>;
  let posture: "select_only_local_artifacts" | "local_snapshot_replay";
  let controlPlaneState: string;
  let sourceReadCoverage: Record<string, AtlasReadCoverage> | null = null;
  if (snapshotFile) {
    const path = resolve(snapshotFile);
    const started = Date.now();
    snapshot = JSON.parse(readFileSync(path, "utf8")) as DecisionAtlasSourceSnapshot;
    timingsMs = { localSnapshotReplay: Date.now() - started };
    posture = "local_snapshot_replay";
    controlPlaneState = "snapshot";
  } else {
    const collected = await collect(artifact.ledger);
    snapshot = collected.snapshot;
    timingsMs = collected.timingsMs;
    posture = "select_only_local_artifacts";
    controlPlaneState = collected.controlPlaneState;
    sourceReadCoverage = collected.sourceReadCoverage;
  }
  const catchup = applyLocalVirtualCatchup(snapshot);
  snapshot = catchup.snapshot;
  const normalized = adaptDecisionAtlasSnapshot({ snapshot, generatedAt, throughSession });
  const atlas = buildDecisionAtlas(normalized);
  const boundedRetunes = buildBoundedRetuneBook({
    generatedAt,
    throughSession,
    opportunities: normalized.opportunities,
  });
  const snapshotJson = `${JSON.stringify(snapshot, null, 2)}\n`;
  const atlasJson = `${JSON.stringify(atlas, null, 2)}\n`;
  const boundedRetunesJson = `${JSON.stringify(boundedRetunes, null, 2)}\n`;
  const boundedRetunesReport = renderBoundedRetuneBookMarkdown(boundedRetunes);
  const report = renderDecisionAtlasMarkdown(atlas);
  const proposals = renderDecisionAtlasProposalPacket(atlas);
  const receipt = {
    schemaVersion: 3,
    generatedAt,
    throughSession,
    posture,
    controlPlaneState,
    ledgerFile,
    cohortFrom,
    evidenceWindow,
    sourceReadCoverage,
    equitySelection: "latest 500 account snapshots before the evidence-window end; not a historical equity series",
    timingsMs,
    localVirtualCatchup: catchup.metadata,
    sourceRows: {
      logicalTrades: snapshot.ledger.logicalTrades.length,
      positionContext: snapshot.positions?.length ?? 0,
      signals: snapshot.signals.length,
      executionObservations: snapshot.executionObservations.length,
      virtualTrades: snapshot.virtualTrades.length,
      managerRuns: snapshot.managerRuns.length,
      equitySnapshots: snapshot.equitySnapshots.length,
      workerRuns: snapshot.workerRuns?.length ?? 0,
      vbCandidateReceipts: snapshot.vbCandidateReceipts?.length ?? 0,
      vbExactPathReceipts: snapshot.vbExactPathReceipts?.length ?? 0,
      vbExactManagerPathReceipts: snapshot.vbExactManagerPathReceipts?.length ?? 0,
      activeChannelSpecs: snapshot.activeChannelSpecs.length,
      activeChannelSpecDatabaseIds: Object.keys(snapshot.activeChannelSpecDatabaseIdsByVersionKey ?? {}).length,
    },
    logicalOpportunities: atlas.evidence.logicalOpportunities,
    channels: Object.keys(atlas.channels).length,
    hashes: {
      snapshot: sha256(snapshotJson),
      atlas: sha256(atlasJson),
      report: sha256(report),
      proposals: sha256(proposals),
      boundedRetunes: sha256(boundedRetunesJson),
      boundedRetunesReport: sha256(boundedRetunesReport),
    },
    sourceTables: ["strategists", "positions", "signals", "execution_observations", "virtual_trades",
      "manager_shadow_runs", "equity_snapshots", "worker_runs", "release_manifests", "release_manifest_channels",
      "channel_spec_versions", "activation_receipts", "vb_candidate_receipts", "vb_exact_path_receipts",
      "vb_exact_manager_path_receipts"],
    productionWrites: 0,
    allowedMethods: ["SELECT", "GET"],
    orderAuthority: false,
    configurationAuthority: false,
    scheduleActivationAuthorized: false,
  };
  mkdirSync(resolve(outputDir, "channels"), { recursive: true });
  writeFileSync(resolve(outputDir, "snapshot.json"), snapshotJson);
  writeFileSync(resolve(outputDir, "atlas.json"), atlasJson);
  writeFileSync(resolve(outputDir, "atlas.md"), report);
  writeFileSync(resolve(outputDir, "proposals.md"), proposals);
  writeFileSync(resolve(outputDir, "bounded-retunes.json"), boundedRetunesJson);
  writeFileSync(resolve(outputDir, "bounded-retunes.md"), boundedRetunesReport);
  writeFileSync(resolve(outputDir, "collision-redundancy.json"), `${JSON.stringify(atlas.collisionGraph, null, 2)}\n`);
  for (const channel of Object.keys(atlas.channels).sort()) {
    writeFileSync(resolve(outputDir, "channels", `${safeName(channel)}.json`), `${JSON.stringify(atlas.channels[channel], null, 2)}\n`);
    writeFileSync(resolve(outputDir, "channels", `${safeName(channel)}.md`), renderDossier(channel, atlas));
  }
  writeFileSync(resolve(outputDir, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`decision-atlas: PASS · ${Object.keys(atlas.channels).length} channels · ${atlas.evidence.logicalOpportunities} logical opportunities`);
  console.log(`  output: ${outputDir}`);
  console.log(`  atlas: ${receipt.hashes.atlas}`);
  console.log("  production writes: 0 · authority: none");
}

main().catch((error) => {
  console.error(`decision-atlas: FAIL · ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
