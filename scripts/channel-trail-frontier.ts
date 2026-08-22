// Read-only nightly channel trail frontier. It converts the canonical logical
// trade ledger plus frozen executable-bid paths into local deterministic
// artifacts. Missing local archives may be filled by SELECT-only live-window
// option_quotes reads; the command has no production write path.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { pageAll } from "../engine/pageAll";
import { etDateOf, type LogicalTrade, type ProfitabilityLedger } from "../lib/profitability/profitabilityLedger";
import { etSessionCloseUtc, etWallMinuteUtc } from "../lib/research/afterCloseResearch";
import {
  buildChannelTrailFrontier,
  replayTrailOpportunity,
  type ChannelTrailFrontierBook,
  type TrailOpportunity,
  type TrailQuote,
} from "../lib/research/channelTrailFrontier";
import {
  buildRunnerHandoffFrontier,
  type RunnerHandoffFrontierBook,
  type RunnerHandoffProfile,
} from "../lib/research/runnerHandoffFrontier";
import { tomorrowManagerExperimentBySlug } from "../lib/channels/decisionAtlasTomorrowManagerExperiments";
import { ORB_MANAGER_AUTOPSY } from "../lib/research/fiveStepChannelProgram";
import type { DecisionAtlas } from "../lib/research/decisionAtlas";
import type { DecisionAtlasSourceSnapshot } from "../lib/research/decisionAtlasAdapter";
import type { QuoteArchiveReceiptRow } from "../worker/src/quoteArchiveReceiptStore";
import { createServerSupabaseClient } from "./serverSupabase";

const arg = (name: string, fallback?: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback ?? null;
};
const ledgerFile = resolve(arg("ledger-file", "data/decision-atlas/latest/profitability/ledger.json")!);
const atlasFile = resolve(arg("atlas-file", "data/decision-atlas/latest/atlas/atlas.json")!);
const snapshotFile = resolve(arg("snapshot-file", resolve(dirname(atlasFile), "snapshot.json"))!);
const quotesDir = resolve(arg("quotes-dir", "data/quotes-archive")!);
const outputDir = resolve(arg("out-dir", "data/decision-atlas/latest/trails")!);
const fromSession = arg("from");
const minimumAnalysisQuantity = Math.max(1, Math.floor(Number(arg("minimum-analysis-quantity", "1")) || 1));
const envFile = arg("env-file") ?? process.env.SEVE_ENV_FILE ?? null;
if (envFile && existsSync(resolve(envFile))) process.loadEnvFile(resolve(envFile));
else if (existsSync(resolve(".env.local"))) process.loadEnvFile(resolve(".env.local"));

interface LedgerArtifact { ledger: ProfitabilityLedger }
interface ArchiveQuoteRow { occ_symbol: string; bid: number | string | null; captured_at: string }
interface RemoteQuoteRow { occ_symbol: string; bid: number | string | null; captured_at: string }
interface TrailSeed {
  logicalOpportunityId: string;
  channel: string;
  session: string;
  configurationEra: string;
  evidenceLayer: TrailOpportunity["evidenceLayer"];
  entryAt: string;
  entryPrice: number;
  quantity: number;
  nativeReturnPct: number;
  nativeExitAt: string | null;
  occSymbol: string;
}

const numeric = (value: unknown): number | null => {
  const parsed = value == null || value === "" ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : null;
const text = (value: unknown): string | null => typeof value === "string" && value.length ? value : null;

const r2Configured = (): boolean => Boolean(
  process.env.R2_ACCOUNT_ID
  && process.env.R2_ACCESS_KEY_ID
  && process.env.R2_SECRET_ACCESS_KEY
  && process.env.R2_BUCKET,
);

const r2 = r2Configured() ? new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
}) : null;

const stable = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
};
const sha256 = (value: unknown): string => `sha256:${createHash("sha256").update(typeof value === "string" ? value : stable(value)).digest("hex")}`;
const safeName = (value: string): string => value.replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-");

function exactConfigurationEra(trade: LogicalTrade): string {
  return trade.configuration.key || `${trade.configuration.kind}:unknown`;
}

function flattenAtMs(session: string): number {
  return Math.min(Date.parse(etWallMinuteUtc(session, 15 * 60 + 25)), Date.parse(etSessionCloseUtc(session)));
}

function localSessionQuotes(session: string): Map<string, TrailQuote[]> | null {
  const file = resolve(quotesDir, `${session}.json.gz`);
  if (!existsSync(file)) return null;
  const rows = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as ArchiveQuoteRow[];
  const byOcc = new Map<string, TrailQuote[]>();
  for (const row of rows) {
    const bid = Number(row.bid);
    if (!row.occ_symbol || !(bid > 0) || !Number.isFinite(Date.parse(row.captured_at))) continue;
    byOcc.set(row.occ_symbol, [...(byOcc.get(row.occ_symbol) ?? []), { at: row.captured_at, bid }]);
  }
  return byOcc;
}

async function quoteArchiveReceipts(sessions: readonly string[]): Promise<Map<string, QuoteArchiveReceiptRow>> {
  if (!r2 || !process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)) return new Map();
  const sb = createServerSupabaseClient("channel-trail-frontier-r2-receipts");
  const rows: QuoteArchiveReceiptRow[] = [];
  for (let index = 0; index < sessions.length; index += 40) {
    const { data, error } = await sb.from("quote_archive_receipts").select("*")
      .eq("archive_version", "r2-option-quotes-v1")
      .in("session_date_et", [...sessions.slice(index, index + 40)]);
    if (error) throw new Error(`quote archive receipt SELECT failed: ${error.message}`);
    rows.push(...(data ?? []) as QuoteArchiveReceiptRow[]);
  }
  return new Map(rows.map((row) => [row.session_date_et, row]));
}

async function r2SessionQuotes(receipt: QuoteArchiveReceiptRow): Promise<Map<string, TrailQuote[]>> {
  if (!r2) return new Map();
  const [object, manifest] = await Promise.all([
    r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: receipt.object_key })),
    r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: receipt.manifest_key })),
  ]);
  if (!object.Body || !manifest.Body) throw new Error(`R2 quote archive body missing for ${receipt.session_date_et}`);
  const [compressed, manifestBody] = await Promise.all([
    object.Body.transformToByteArray(),
    manifest.Body.transformToByteArray(),
  ]);
  if (compressed.byteLength !== receipt.compressed_bytes
      || createHash("sha256").update(compressed).digest("hex") !== receipt.compressed_sha256
      || createHash("sha256").update(manifestBody).digest("hex") !== receipt.manifest_sha256) {
    throw new Error(`R2 quote archive receipt mismatch for ${receipt.session_date_et}`);
  }
  const raw = gunzipSync(compressed);
  if (createHash("sha256").update(raw).digest("hex") !== receipt.content_sha256) {
    throw new Error(`R2 quote archive content mismatch for ${receipt.session_date_et}`);
  }
  const declared = JSON.parse(Buffer.from(manifestBody).toString("utf8")) as {
    sessionDateEt?: string; objectKey?: string; rowCount?: number; compressedSha256?: string;
  };
  if (declared.sessionDateEt !== receipt.session_date_et || declared.objectKey !== receipt.object_key
      || declared.rowCount !== receipt.row_count || declared.compressedSha256 !== receipt.compressed_sha256) {
    throw new Error(`R2 quote archive manifest mismatch for ${receipt.session_date_et}`);
  }
  const rows = JSON.parse(raw.toString("utf8")) as ArchiveQuoteRow[];
  if (rows.length !== receipt.row_count) throw new Error(`R2 quote archive row-count mismatch for ${receipt.session_date_et}`);
  const byOcc = new Map<string, TrailQuote[]>();
  for (const row of rows) {
    const bid = Number(row.bid);
    if (!row.occ_symbol || !(bid > 0) || !Number.isFinite(Date.parse(row.captured_at))) continue;
    byOcc.set(row.occ_symbol, [...(byOcc.get(row.occ_symbol) ?? []), { at: row.captured_at, bid }]);
  }
  return byOcc;
}

async function remoteSessionQuotes(session: string, occSymbols: readonly string[]): Promise<Map<string, TrailQuote[]>> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)) return new Map();
  const sb = createServerSupabaseClient("channel-trail-frontier");
  const rows: RemoteQuoteRow[] = [];
  for (let index = 0; index < occSymbols.length; index += 40) {
    const batch = occSymbols.slice(index, index + 40);
    rows.push(...await pageAll<RemoteQuoteRow>((from) => sb.from("option_quotes")
      .select("occ_symbol,bid,captured_at")
      .in("occ_symbol", [...batch])
      .gte("captured_at", etWallMinuteUtc(session, 9 * 60 + 30))
      .lte("captured_at", new Date(flattenAtMs(session)).toISOString())
      .order("captured_at").order("id"), {
      pageSize: 1_000, max: 150_000, attempts: 3, retryDelaysMs: [250, 750], timeoutMs: 20_000,
    }));
  }
  const byOcc = new Map<string, TrailQuote[]>();
  for (const row of rows) {
    const bid = Number(row.bid);
    if (!(bid > 0)) continue;
    byOcc.set(row.occ_symbol, [...(byOcc.get(row.occ_symbol) ?? []), { at: row.captured_at, bid }]);
  }
  return byOcc;
}

function renderMarkdown(book: ChannelTrailFrontierBook): string {
  const lines = [
    `# Channel Trail Frontier — through ${book.throughSession}`,
    "",
    "Read-only paired executable-bid research. Entry, size, route, roster, and production managers remain unchanged.",
    ...(minimumAnalysisQuantity > 1 ? [
      "",
      `Manager-shape lab: staged exits are normalized to at least ${minimumAnalysisQuantity} contracts so one-contract source paths can test bank/runner behavior. Capacity and executable sizing remain separate decisions.`,
    ] : []),
    "",
    "| Channel | Era | Decision | Leading exit | Typical lift | Beat rate | Evidence |",
    "|---|---|---|---|---:|---:|---:|",
  ];
  for (const channel of Object.values(book.channels).sort((left, right) => left.channel.localeCompare(right.channel))) {
    const selected = [
      channel.eras.find((row) => row.configurationEra === channel.selectedConfigurationEra) ?? null,
      channel.virtualEras.find((row) => row.configurationEra === channel.selectedVirtualConfigurationEra) ?? null,
    ];
    for (const era of selected) {
      if (!era) continue;
      const candidate = era.candidates.find((row) => row.candidateId === era.recommendedCandidateId)
        ?? [...era.candidates].sort((left, right) => (right.typicalBenefitPct ?? -Infinity) - (left.typicalBenefitPct ?? -Infinity))[0];
      const pct = (value: number | null): string => value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
      lines.push(`| ${channel.channel} (${era.evidenceLayer.replaceAll("_", " ")}) | ${era.configurationEra} | ${era.recommendation.replaceAll("_", " ")} | ${candidate?.label ?? "—"} | ${pct(candidate?.typicalBenefitPct ?? null)} | ${candidate?.improvementFrequency == null ? "—" : `${Math.round(candidate.improvementFrequency * 100)}%`} | ${candidate?.pairedOpportunities ?? 0} paths / ${candidate?.sessions ?? 0}s |`);
    }
  }
  lines.push("", "Executed and exact-current virtual paths are displayed in separate rows and are never pooled. An exit is proposal-ready only when its paired benefit, chronological validation, leave-session-out validation, and nearby parameter plateau agree. Capacity and displacement still require a separate pass.", "");
  return lines.join("\n");
}

function runnerHandoffProfiles(snapshot: DecisionAtlasSourceSnapshot): RunnerHandoffProfile[] {
  const profiles: RunnerHandoffProfile[] = snapshot.activeChannelSpecs.flatMap((spec) => {
    const bankPct = numeric(spec.takeProfit.targetPct);
    const runnerFraction = numeric(spec.takeProfit.fraction);
    const armPct = numeric(spec.ratchetParameters.engageReturnPct);
    const retainPct = numeric(spec.ratchetParameters.retainGainPct);
    const stopPct = numeric(spec.stopLoss.catastrophePct);
    if (spec.takeProfit.kind !== "bank" || !(bankPct != null && bankPct > 0)
      || !(runnerFraction != null && runnerFraction > 0 && runnerFraction < 1)
      || spec.ratchetParameters.kind !== "a13" || !(armPct != null && armPct >= bankPct)
      || !(retainPct != null && retainPct > 0 && retainPct < 100) || !(stopPct != null && stopPct > 0)) return [];
    return [{
      channel: spec.slug,
      profileId: spec.managerProfileId,
      profileSource: "active_spec" as const,
      channelSpecDatabaseId: snapshot.activeChannelSpecDatabaseIdsByVersionKey?.[spec.id] ?? null,
      bankPct,
      runnerFraction,
      armPct,
      retainPeakGain: retainPct / 100,
      catastropheStopPct: stopPct,
      fixedRunnerTargetPct: armPct,
    }];
  });
  // ORB's approved all-out experiment deliberately displaced its former
  // B30/A13 manager. Preserve that exact prior manager as an explicitly
  // historical research control; it is never described as live.
  const orb = tomorrowManagerExperimentBySlug("orb-ustop-ctl");
  const activeOrb = snapshot.activeChannelSpecs.find((row) => row.slug === "orb-ustop-ctl");
  if (orb?.takeProfit.kind === "bank" && (orb.takeProfit.fraction ?? 0) > 0
    && orb.takeProfit.targetPct && orb.ratchetParameters.kind === "a13"
    && activeOrb?.managerProfileId !== orb.managerProfileId) {
    profiles.push({
      channel: orb.slug,
      profileId: orb.managerProfileId,
      profileSource: "historical_reference",
      channelSpecDatabaseId: ORB_MANAGER_AUTOPSY.priorSpecDatabaseId,
      bankPct: orb.takeProfit.targetPct,
      runnerFraction: orb.takeProfit.fraction,
      armPct: orb.ratchetParameters.engageReturnPct ?? 50,
      retainPeakGain: (orb.ratchetParameters.retainGainPct ?? 67) / 100,
      catastropheStopPct: orb.stopLossCatastrophePct ?? activeOrb?.stopLoss.catastrophePct ?? 30,
      fixedRunnerTargetPct: orb.ratchetParameters.engageReturnPct ?? 50,
    });
  }
  return profiles;
}

function renderRunnerHandoffMarkdown(book: RunnerHandoffFrontierBook): string {
  const pct = (value: number | null): string => value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
  const money = (value: number | null): string => value == null ? "—" : `${value < 0 ? "-" : "+"}$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;
  const lines = [
    `# Runner Handoff Frontier — through ${book.throughSession}`,
    "",
    "Read-only paired executable-bid research. Every row keeps entry, contract, quantity, session, and configuration era fixed.",
    "",
    "| Channel | Profile | Evidence relation | Layer | Candidate | Typical result | Typical lift | Total modeled P&L | Negative runner | Rebound after exit | Paths |",
    "|---|---|---|---|---|---:|---:|---:|---:|---:|---:|",
  ];
  const representative = new Map<string, RunnerHandoffFrontierBook["eras"][number]>();
  for (const era of book.eras) {
    const key = [era.channel, era.profile.profileId, era.profile.profileSource, era.evidenceLayer].join("\u0000");
    const prior = representative.get(key);
    const exact = era.profile.channelSpecDatabaseId != null
      && (era.configurationEra === `channel-spec:${era.profile.channelSpecDatabaseId}`
        || era.configurationEra.startsWith(`epoch:${era.profile.channelSpecDatabaseId}:`));
    const priorExact = prior?.profile.channelSpecDatabaseId != null
      && (prior.configurationEra === `channel-spec:${prior.profile.channelSpecDatabaseId}`
        || prior.configurationEra.startsWith(`epoch:${prior.profile.channelSpecDatabaseId}:`));
    const bankPaths = era.candidates.find((row) => row.candidateId === "CURRENT_HANDOFF")?.bankHitOpportunities ?? 0;
    const priorBankPaths = prior?.candidates.find((row) => row.candidateId === "CURRENT_HANDOFF")?.bankHitOpportunities ?? 0;
    if (!prior || Number(exact) > Number(priorExact)
      || (exact === priorExact && (bankPaths > priorBankPaths
        || (bankPaths === priorBankPaths && era.sessions > prior.sessions)))) representative.set(key, era);
  }
  for (const era of [...book.channelSpecRollups, ...representative.values()]
    .sort((left, right) => left.channel.localeCompare(right.channel)
      || left.evidenceLayer.localeCompare(right.evidenceLayer))) {
    const selected = era.candidates.find((row) => row.candidateId === era.leadingCandidateId)
      ?? era.candidates.find((row) => row.candidateId === "CURRENT_HANDOFF")!;
    const exactProfileSpec = era.profile.channelSpecDatabaseId != null
      && (era.configurationEra === `channel-spec:${era.profile.channelSpecDatabaseId}`
        || era.configurationEra === `channel-spec-rollup:${era.profile.channelSpecDatabaseId}`
        || era.configurationEra.startsWith(`epoch:${era.profile.channelSpecDatabaseId}:`));
    const relation = era.profile.profileSource === "historical_reference"
      ? "historical manager control" : exactProfileSpec ? "exact channel spec" : "structural history";
    lines.push(`| ${era.channel} | ${era.profile.profileId} | ${relation} | ${era.evidenceLayer} | ${selected.label} | ${pct(selected.typicalBankHitResultPct)} | ${pct(selected.typicalBankHitBenefitVsCurrentPct)} | ${money(selected.bankHitTotalPnlUsd)} | ${selected.negativeRunnerFrequency == null ? "—" : `${Math.round(selected.negativeRunnerFrequency * 100)}%`} | ${selected.reboundAfterExitFrequency == null ? "—" : `${Math.round(selected.reboundAfterExitFrequency * 100)}%`} | ${selected.bankHitOpportunities}/${selected.bankHitSessions}s |`);
  }
  lines.push("", "The table is intentionally concise: it shows an exact channel-spec rollup when available, otherwise the most informative separated era for each profile and evidence layer. Full era-by-era comparisons remain in frontier.json.", "", "A challenger is an investigation lead, not an activation recommendation. Threshold fills exclude spread, slippage, and queue position; historical-reference profiles are never presented as current production behavior.", "");
  return lines.join("\n");
}

async function main(): Promise<void> {
  for (const file of [atlasFile, snapshotFile]) if (!existsSync(file)) throw new Error(`required frozen artifact not found: ${file}`);
  const atlasText = readFileSync(atlasFile, "utf8");
  const snapshotText = readFileSync(snapshotFile, "utf8");
  const atlas = JSON.parse(atlasText) as DecisionAtlas;
  const snapshot = JSON.parse(snapshotText) as DecisionAtlasSourceSnapshot;
  const ledgerSourceText = existsSync(ledgerFile)
    ? readFileSync(ledgerFile, "utf8")
    : JSON.stringify(snapshot.ledger);
  const ledger = existsSync(ledgerFile)
    ? (JSON.parse(ledgerSourceText) as LedgerArtifact).ledger
    : snapshot.ledger;
  if (!ledger?.logicalTrades?.length) {
    throw new Error(`canonical profitability ledger missing from ${ledgerFile} and frozen snapshot`);
  }
  const trades = ledger.logicalTrades.filter((trade) => trade.status === "closed" && trade.closedAt
    && trade.quantity > 0 && trade.entryDebitUsd != null && trade.entryDebitUsd > 0
    && trade.realizedReturnPct != null && trade.occSymbol && trade.openedAt
    && trade.openedAt <= `${atlas.throughSession}T23:59:59.999Z`);
  const seeds: TrailSeed[] = [];
  for (const trade of trades) {
    const session = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(trade.openedAt));
    seeds.push({
      logicalOpportunityId: trade.id,
      channel: trade.channelSlug,
      session,
      configurationEra: exactConfigurationEra(trade),
      evidenceLayer: "executed",
      entryAt: trade.openedAt,
      entryPrice: (trade.entryDebitUsd as number) / (trade.quantity * 100),
      quantity: trade.quantity,
      nativeReturnPct: trade.realizedReturnPct as number,
      nativeExitAt: trade.closedAt,
      occSymbol: trade.occSymbol,
    });
  }
  const signalById = new Map(snapshot.signals.map((row) => [row.id, row]));
  const activeSpecBySlug = new Map(snapshot.activeChannelSpecs.map((row) => [row.slug, row]));
  const currentVirtualConfigurationEras: Record<string, string> = {};
  const latestVirtualAtByChannel = new Map<string, string>();
  let virtualMissingSignal = 0;
  let virtualMissingConfigurationStamp = 0;
  for (const virtual of snapshot.virtualTrades) {
    const signal = signalById.get(virtual.signal_id);
    const entryPrice = numeric(virtual.entry_px);
    const pnl = numeric(virtual.pnl_per_contract);
    if (!signal) { virtualMissingSignal += 1; continue; }
    if (!virtual.occ || !(entryPrice != null && entryPrice > 0) || pnl == null || !virtual.exit_at
      || etDateOf(virtual.signal_at) > atlas.throughSession) continue;
    const rationale = object(signal.rationale);
    const observedPolicyEpoch = text(rationale?.observed_policy_configuration_epoch_id)
      ?? text(rationale?.configuration_epoch_id) ?? signal.configuration_epoch_id;
    if (!observedPolicyEpoch) { virtualMissingConfigurationStamp += 1; continue; }
    const activeSpec = activeSpecBySlug.get(virtual.slug);
    const activeDatabaseId = activeSpec
      ? snapshot.activeChannelSpecDatabaseIdsByVersionKey?.[activeSpec.id] ?? null : null;
    const configurationEra = activeDatabaseId && signal.configuration_epoch_id === snapshot.currentConfigurationEpochId
      ? `channel-spec:${activeDatabaseId}` : `prospective-policy:${observedPolicyEpoch}`;
    const quantity = activeSpec?.quantity ?? Math.max(1, Math.floor(numeric(rationale?.qty) ?? 1));
    seeds.push({
      logicalOpportunityId: `signal:${virtual.signal_id}`,
      channel: virtual.slug,
      session: etDateOf(virtual.signal_at),
      configurationEra,
      evidenceLayer: "virtual",
      entryAt: virtual.signal_at,
      entryPrice,
      quantity,
      nativeReturnPct: pnl / entryPrice,
      nativeExitAt: virtual.exit_at,
      occSymbol: virtual.occ,
    });
    const latestAt = latestVirtualAtByChannel.get(virtual.slug);
    if (!latestAt || virtual.signal_at > latestAt) {
      latestVirtualAtByChannel.set(virtual.slug, virtual.signal_at);
      currentVirtualConfigurationEras[virtual.slug] = configurationEra;
    }
  }
  const bySession = new Map<string, TrailSeed[]>();
  for (const seed of seeds) {
    if (fromSession && seed.session < fromSession) continue;
    bySession.set(seed.session, [...(bySession.get(seed.session) ?? []), seed]);
  }
  const receipts = await quoteArchiveReceipts([...bySession.keys()]);
  const opportunities: TrailOpportunity[] = [];
  let archiveSessions = 0;
  let r2Sessions = 0;
  let remoteSessions = 0;
  let missingSessions = 0;
  const missingSessionDates: string[] = [];
  for (const [session, sessionSeeds] of [...bySession].sort(([left], [right]) => left.localeCompare(right))) {
    let quoteBook = localSessionQuotes(session);
    let source: TrailOpportunity["source"] = "frozen_option_archive";
    if (quoteBook) archiveSessions += 1;
    else if (receipts.has(session)) {
      quoteBook = await r2SessionQuotes(receipts.get(session)!);
      source = "r2_quote_archive";
      r2Sessions += 1;
    }
    else {
      quoteBook = await remoteSessionQuotes(session, [...new Set(sessionSeeds.map((seed) => seed.occSymbol))]);
      source = "live_option_quotes";
      if (quoteBook.size) remoteSessions += 1;
      else {
        missingSessions += 1;
        missingSessionDates.push(session);
      }
    }
    const cutoff = flattenAtMs(session);
    for (const seed of sessionSeeds) {
      const quotes = (quoteBook.get(seed.occSymbol) ?? []).filter((quote) => {
        const at = Date.parse(quote.at);
        return at >= Date.parse(seed.entryAt) && at <= cutoff;
      });
      opportunities.push({
        logicalOpportunityId: seed.logicalOpportunityId,
        channel: seed.channel,
        session: seed.session,
        configurationEra: seed.configurationEra,
        evidenceLayer: seed.evidenceLayer,
        entryAt: seed.entryAt,
        entryPrice: seed.entryPrice,
        quantity: seed.quantity,
        nativeReturnPct: seed.nativeReturnPct,
        nativeExitAt: seed.nativeExitAt,
        quotes,
        source,
      });
    }
  }
  const currentConfigurationEras = Object.fromEntries(Object.values(atlas.channels)
    .map((dossier) => [dossier.channel, dossier.decisionCohort.configurationEra]));
  const analysisOpportunities = minimumAnalysisQuantity > 1
    ? opportunities.map((row) => ({ ...row, quantity: Math.max(row.quantity, minimumAnalysisQuantity) }))
    : opportunities;
  const book = buildChannelTrailFrontier({
    generatedAt: atlas.generatedAt,
    throughSession: atlas.throughSession,
    opportunities: analysisOpportunities,
    currentConfigurationEras,
    currentVirtualConfigurationEras,
  });
  const handoffBook = buildRunnerHandoffFrontier({
    generatedAt: atlas.generatedAt,
    throughSession: atlas.throughSession,
    opportunities: analysisOpportunities,
    profiles: runnerHandoffProfiles(snapshot),
  });
  const json = `${JSON.stringify(book, null, 2)}\n`;
  const markdown = `${renderMarkdown(book)}\n`;
  const handoffJson = `${JSON.stringify(handoffBook, null, 2)}\n`;
  const handoffMarkdown = `${renderRunnerHandoffMarkdown(handoffBook)}\n`;
  const replayPolicies = book.candidates.filter((policy) => policy.origin === "preset");
  const pathRows = analysisOpportunities.flatMap((opportunity) => replayPolicies.map((policy) => {
    const result = replayTrailOpportunity(opportunity, policy);
    return {
      channel: opportunity.channel,
      evidenceLayer: opportunity.evidenceLayer,
      configurationEra: opportunity.configurationEra,
      entryAt: opportunity.entryAt,
      entryPrice: opportunity.entryPrice,
      quantity: opportunity.quantity,
      source: opportunity.source,
      ...result,
      modeledPnlUsd: result.candidateReturnPct == null ? null
        : Math.round(result.candidateReturnPct * opportunity.entryPrice * opportunity.quantity * 100) / 100,
    };
  }));
  const pathJson = `${JSON.stringify({ schemaVersion: 1, frontierVersion: book.frontierVersion,
    generatedAt: book.generatedAt, throughSession: book.throughSession,
    candidateIds: replayPolicies.map((policy) => policy.id), paths: pathRows,
    productionWrites: 0, orderAuthority: false }, null, 2)}\n`;
  const receipt = {
    schemaVersion: 1,
    generatedAt: book.generatedAt,
    throughSession: book.throughSession,
    fromSession,
    frontierVersion: book.frontierVersion,
    channels: Object.keys(book.channels).length,
    logicalOpportunities: book.sourceOpportunities,
    executedLogicalOpportunities: book.executedSourceOpportunities,
    virtualLogicalOpportunities: book.virtualSourceOpportunities,
    virtualCensors: { missingSignal: virtualMissingSignal, missingConfigurationStamp: virtualMissingConfigurationStamp },
    pathSources: { localArchiveSessions: archiveSessions, verifiedR2Sessions: r2Sessions, remoteSelectSessions: remoteSessions,
      missingSessions, missingSessionDates },
    analysisQuantityFloor: minimumAnalysisQuantity,
    inputs: { ledgerSha256: sha256(ledgerSourceText), atlasSha256: sha256(atlasText), snapshotSha256: sha256(snapshotText) },
    runnerHandoff: { profiles: handoffBook.profiles.length, eras: handoffBook.eras.length,
      channelSpecRollups: handoffBook.channelSpecRollups.length },
    outputs: { frontierSha256: sha256(json), markdownSha256: sha256(markdown),
      pathResultsSha256: sha256(pathJson),
      runnerHandoffSha256: sha256(handoffJson), runnerHandoffMarkdownSha256: sha256(handoffMarkdown) },
    productionReads: [
      ...(receipts.size ? ["quote_archive_receipts:SELECT", "r2_quote_archive:GET"] : []),
      ...(remoteSessions ? ["option_quotes:SELECT"] : []),
    ],
    productionWrites: 0,
    allowedMethods: ["SELECT", "GET"],
    orderAuthority: false,
    configurationAuthority: false,
  };
  mkdirSync(resolve(outputDir, "channels"), { recursive: true });
  mkdirSync(resolve(outputDir, "runner-handoffs", "channels"), { recursive: true });
  writeFileSync(resolve(outputDir, "frontier.json"), json);
  writeFileSync(resolve(outputDir, "frontier.md"), markdown);
  writeFileSync(resolve(outputDir, "path-results.json"), pathJson);
  writeFileSync(resolve(outputDir, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  writeFileSync(resolve(outputDir, "runner-handoffs", "frontier.json"), handoffJson);
  writeFileSync(resolve(outputDir, "runner-handoffs", "frontier.md"), handoffMarkdown);
  for (const channel of Object.values(book.channels)) {
    writeFileSync(resolve(outputDir, "channels", `${safeName(channel.channel)}.json`), `${JSON.stringify(channel, null, 2)}\n`);
  }
  for (const channel of [...new Set(handoffBook.eras.map((era) => era.channel))]) {
    const payload = { ...handoffBook,
      eras: handoffBook.eras.filter((era) => era.channel === channel),
      channelSpecRollups: handoffBook.channelSpecRollups.filter((era) => era.channel === channel) };
    writeFileSync(resolve(outputDir, "runner-handoffs", "channels", `${safeName(channel)}.json`), `${JSON.stringify(payload, null, 2)}\n`);
  }
  console.log(`channel-trail-frontier: PASS · ${receipt.channels} channels · ${receipt.logicalOpportunities} logical opportunities`);
  console.log(`  local archive ${archiveSessions}s · verified R2 ${r2Sessions}s · remote SELECT ${remoteSessions}s · missing ${missingSessions}s`);
  console.log(`  runner handoffs ${handoffBook.profiles.length} profiles · ${handoffBook.eras.length} separate eras`);
  console.log("  production writes: 0 · authority: none");
}

main().catch((error) => {
  console.error(`channel-trail-frontier: FAIL · ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
