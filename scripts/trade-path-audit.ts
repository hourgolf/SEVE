// Read-only Phase 1K-B adapter. It joins durable desk lineage, compact
// intraminute receipts, and verbatim executable option-quote archives into a
// local research artifact. It never writes Supabase/R2 or changes execution.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  channelMode,
  classifyFleetOutcome,
  inferResearchFamily,
  type FleetAnnotationReceipt,
  type FleetPositionReceipt,
} from "../lib/research/fleetEvidenceAudit.js";
import { POSITION_RESEARCH_ANNOTATIONS } from "../lib/research/positionAnnotations.js";
import {
  buildTradePathAudit,
  DEFAULT_TRADE_PATH_THRESHOLDS,
  type ExecutionMark,
  type OptionPathSource,
  type TradePathPosition,
  type TradePathQuote,
} from "../lib/research/tradePathAnalysis.js";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const todayEt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const FROM = arg("from", "2026-07-13");
const THROUGH = arg("through", todayEt);
const ARCHIVE_DIR = arg("archive-dir", "data/quotes-archive");
const VERIFIED_INTRAMINUTE_DIR = arg("verified-intraminute-dir", "data/intraminute-replay");
const DATABENTO_PATH_DIR = arg("databento-path-dir", "data/trade-option-paths/cbbo-1s");
const OUT = arg("out", `data/trade-path-audits/${FROM}_${THROUGH}.json`);
const MAX_GAP_SEC = Number(arg("max-gap-sec", String(DEFAULT_TRADE_PATH_THRESHOLDS.maxInternalGapMs / 1_000)));
for (const [label, value] of [["from", FROM], ["through", THROUGH]] as const) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`invalid --${label} ${value}`);
}
if (FROM > THROUGH) throw new Error(`--from ${FROM} is after --through ${THROUGH}`);
if (!Number.isFinite(MAX_GAP_SEC) || MAX_GAP_SEC <= 0) throw new Error("--max-gap-sec must be positive");

function nextDate(date: string): string {
  const at = new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
}

function dateRange(from: string, through: string): string[] {
  const out: string[] = [];
  for (let date = from; date <= through; date = nextDate(date)) out.push(date);
  return out;
}

function etWallToUtcMs(dateEt: string, hour: number, minute: number): number {
  const noon = new Date(`${dateEt}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(noon);
  const localHour = Number(parts.find((part) => part.type === "hour")?.value ?? "12") % 24;
  const localMinute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return Date.parse(`${dateEt}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`)
    + (12 * 60 - localHour * 60 - localMinute) * 60_000;
}

const START_ISO = new Date(etWallToUtcMs(FROM, 0, 0)).toISOString();
const END_ISO = new Date(etWallToUtcMs(nextDate(THROUGH), 0, 0)).toISOString();
const ET_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const numeric = (value: unknown): number | null => {
  if (value == null) return null;
  const parsed = Number(value);
  return finite(parsed) ? parsed : null;
};

async function page<T>(read: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, label: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await read(from, from + 999);
    if (error) throw new Error(`${label} read failed: ${error.message}`);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < 1_000) return rows;
  }
}

interface PositionDbRow {
  id: string;
  strategist_id: string;
  occ_symbol: string;
  underlying: string;
  qty: number | string | null;
  avg_entry_price: number | string | null;
  opened_at: string;
  closed_at: string | null;
  realized_pnl: number | string | null;
  close_reason: string | null;
  runner_of: string | null;
  strategists: { slug?: string; name?: string } | Array<{ slug?: string; name?: string }> | null;
}
interface OutcomeDbRow { position_id: string; opportunity_id: string | null; event_kind: string; }
interface ExecutionDbRow {
  position_id: string | null;
  opportunity_id: string | null;
  event_kind: string;
  action: string;
  event_at: string;
  source_bar_at: string | null;
  fill_price: number | string | null;
  bid: number | string | null;
  ask: number | string | null;
  quote_age_ms: number | string | null;
}
interface IntraminuteReceiptDbRow {
  symbol: string;
  session_date_et: string;
  schema_version: number;
  row_count: number;
  gap_count: number;
  provider_min_at: string;
  provider_max_at: string;
}
interface QuoteDbRow {
  occ_symbol: string;
  captured_at: string;
  bid: number | string | null;
  ask: number | string | null;
  underlying_price: number | string | null;
}
interface ExactPathManifest {
  schemaVersion: number;
  dataset: string;
  schema: string;
  dateEt: string;
  rows: number;
  sha256: string;
  objectFile: string;
}
interface ExactPathRow {
  occSymbol: string;
  atMs: number;
  bid: number;
  ask: number;
  source: "databento_cbbo_1s";
}

const joinedStrategist = (value: PositionDbRow["strategists"]): { slug: string; name: string } => {
  const row = Array.isArray(value) ? value[0] : value;
  const slug = row?.slug ?? "?";
  return { slug, name: row?.name ?? slug };
};

function toMark(row: ExecutionDbRow | null): ExecutionMark | null {
  if (!row) return null;
  const atMs = Date.parse(row.event_at);
  if (!Number.isFinite(atMs)) return null;
  return {
    atMs,
    bid: numeric(row.bid),
    ask: numeric(row.ask),
    fillPrice: numeric(row.fill_price),
    quoteAgeMs: numeric(row.quote_age_ms),
  };
}

function choose(rows: readonly ExecutionDbRow[], eventKind: string, actions: readonly string[], last = false): ExecutionDbRow | null {
  const candidates = rows.filter((row) => row.event_kind === eventKind && actions.includes(row.action))
    .sort((a, b) => Date.parse(a.event_at) - Date.parse(b.event_at));
  return (last ? candidates.at(-1) : candidates[0]) ?? null;
}

async function readLedger(sb: SupabaseClient): Promise<{
  positions: PositionDbRow[];
  outcomes: OutcomeDbRow[];
  executions: ExecutionDbRow[];
  intraminuteReceipts: IntraminuteReceiptDbRow[];
}> {
  const [positions, outcomes, executions, intraminuteReceipts] = await Promise.all([
    page<PositionDbRow>((from, to) => sb.from("positions")
      .select("id,strategist_id,occ_symbol,underlying,qty,avg_entry_price,opened_at,closed_at,realized_pnl,close_reason,runner_of,strategists(slug,name)")
      .gte("opened_at", START_ISO).lt("opened_at", END_ISO).order("opened_at").order("id").range(from, to), "positions"),
    page<OutcomeDbRow>((from, to) => sb.from("position_outcome_events")
      .select("position_id,opportunity_id,event_kind")
      .gte("event_at", START_ISO).lt("event_at", END_ISO).order("event_at").order("id").range(from, to), "position outcomes"),
    page<ExecutionDbRow>((from, to) => sb.from("execution_observations")
      .select("position_id,opportunity_id,event_kind,action,event_at,source_bar_at,fill_price,bid,ask,quote_age_ms")
      .gte("event_at", START_ISO).lt("event_at", END_ISO).order("event_at").order("id").range(from, to), "execution observations"),
    page<IntraminuteReceiptDbRow>((from, to) => sb.from("intraminute_capture_receipts")
      .select("symbol,session_date_et,schema_version,row_count,gap_count,provider_min_at,provider_max_at")
      .gte("session_date_et", FROM).lte("session_date_et", THROUGH).order("provider_min_at").range(from, to), "intraminute receipts"),
  ]);
  return { positions, outcomes, executions, intraminuteReceipts };
}

function archiveQuotes(dates: readonly string[], occs: ReadonlySet<string>): {
  quotesByOcc: Map<string, TradePathQuote[]>;
  archivedDates: string[];
  missingDates: string[];
  archiveRowsScanned: number;
} {
  const quotesByOcc = new Map<string, TradePathQuote[]>();
  const archivedDates: string[] = [];
  const missingDates: string[] = [];
  let archiveRowsScanned = 0;
  for (const date of dates) {
    const file = join(ARCHIVE_DIR, `${date}.json.gz`);
    if (!existsSync(file)) { missingDates.push(date); continue; }
    const rows = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as QuoteDbRow[];
    archiveRowsScanned += rows.length;
    archivedDates.push(date);
    for (const row of rows) {
      if (!occs.has(row.occ_symbol)) continue;
      const atMs = Date.parse(row.captured_at);
      if (!Number.isFinite(atMs)) continue;
      const group = quotesByOcc.get(row.occ_symbol) ?? [];
      group.push({
        atMs,
        bid: numeric(row.bid),
        ask: numeric(row.ask),
        underlyingPrice: numeric(row.underlying_price),
        source: "local_archive",
      });
      quotesByOcc.set(row.occ_symbol, group);
    }
  }
  return { quotesByOcc, archivedDates, missingDates, archiveRowsScanned };
}

async function liveFallbackQuotes(sb: SupabaseClient, dates: readonly string[], occs: readonly string[]): Promise<Map<string, TradePathQuote[]>> {
  const quotesByOcc = new Map<string, TradePathQuote[]>();
  for (const date of dates) {
    const startIso = new Date(etWallToUtcMs(date, 0, 0)).toISOString();
    const endIso = new Date(etWallToUtcMs(nextDate(date), 0, 0)).toISOString();
    for (let index = 0; index < occs.length; index += 40) {
      const chunk = occs.slice(index, index + 40);
      const rows = await page<QuoteDbRow>((from, to) => sb.from("option_quotes")
        .select("occ_symbol,captured_at,bid,ask,underlying_price").in("occ_symbol", chunk)
        .gte("captured_at", startIso).lt("captured_at", endIso).order("captured_at").order("id").range(from, to), `option quotes ${date}`);
      for (const row of rows) {
        const group = quotesByOcc.get(row.occ_symbol) ?? [];
        group.push({
          atMs: Date.parse(row.captured_at),
          bid: numeric(row.bid),
          ask: numeric(row.ask),
          underlyingPrice: numeric(row.underlying_price),
          source: "supabase_live",
        });
        quotesByOcc.set(row.occ_symbol, group);
      }
    }
  }
  return quotesByOcc;
}

function exactDatabentoQuotes(dates: readonly string[], occs: ReadonlySet<string>): {
  quotesByOcc: Map<string, TradePathQuote[]>;
  manifests: Array<{ dateEt: string; rows: number; sha256: string; objectFile: string }>;
} {
  const quotesByOcc = new Map<string, TradePathQuote[]>();
  const manifests: Array<{ dateEt: string; rows: number; sha256: string; objectFile: string }> = [];
  for (const date of dates) {
    const manifestPath = join(DATABENTO_PATH_DIR, `${date}.manifest.json`);
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ExactPathManifest;
    if (manifest.schemaVersion !== 1 || manifest.dataset !== "OPRA.PILLAR" || manifest.schema !== "cbbo-1s" || manifest.dateEt !== date)
      throw new Error(`unsupported exact-path manifest ${manifestPath}`);
    const objectPath = join(DATABENTO_PATH_DIR, manifest.objectFile);
    const compressed = readFileSync(objectPath);
    const sha256 = createHash("sha256").update(compressed).digest("hex");
    if (sha256 !== manifest.sha256) throw new Error(`exact-path checksum mismatch ${objectPath}`);
    const rows = JSON.parse(gunzipSync(compressed).toString("utf8")) as ExactPathRow[];
    if (rows.length !== manifest.rows) throw new Error(`exact-path row-count mismatch ${objectPath}`);
    for (const row of rows) {
      if (!occs.has(row.occSymbol) || !Number.isFinite(row.atMs)) continue;
      const group = quotesByOcc.get(row.occSymbol) ?? [];
      group.push({ atMs: row.atMs, bid: row.bid, ask: row.ask, source: "databento_cbbo_1s" });
      quotesByOcc.set(row.occSymbol, group);
    }
    manifests.push({ dateEt: date, rows: manifest.rows, sha256, objectFile: manifest.objectFile });
  }
  return { quotesByOcc, manifests };
}

function verifiedIntraminutePositions(dates: readonly string[]): { positionIds: Set<string>; fixtures: Array<{ date: string; entries: number; verifiedRows: number }> } {
  const positionIds = new Set<string>();
  const fixtures: Array<{ date: string; entries: number; verifiedRows: number }> = [];
  for (const date of dates) {
    const file = join(VERIFIED_INTRAMINUTE_DIR, date, "entry-source-minutes.json");
    if (!existsSync(file)) continue;
    const fixture = JSON.parse(readFileSync(file, "utf8")) as {
      coverage?: { sourceMinutesRequested?: number; sourceMinutesRecovered?: number; verifiedRows?: number };
      entries?: Array<{ positionId?: string }>;
    };
    const requested = Number(fixture.coverage?.sourceMinutesRequested ?? 0);
    const recovered = Number(fixture.coverage?.sourceMinutesRecovered ?? -1);
    const verifiedRows = Number(fixture.coverage?.verifiedRows ?? 0);
    if (requested <= 0 || recovered !== requested || verifiedRows <= 0) continue;
    const ids = (fixture.entries ?? []).flatMap((entry) => entry.positionId ? [entry.positionId] : []);
    for (const id of ids) positionIds.add(id);
    fixtures.push({ date, entries: ids.length, verifiedRows });
  }
  return { positionIds, fixtures };
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase backend credentials missing");
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const ledger = await readLedger(sb);
  const dates = dateRange(FROM, THROUGH);
  const verifiedIntraminute = verifiedIntraminutePositions(dates);
  const positionById = new Map(ledger.positions.map((position) => [position.id, position]));
  const opportunityByPosition = new Map<string, string>();
  for (const outcome of ledger.outcomes) if (outcome.opportunity_id && !opportunityByPosition.has(outcome.position_id)) {
    opportunityByPosition.set(outcome.position_id, outcome.opportunity_id);
  }
  const executionsByPosition = new Map<string, ExecutionDbRow[]>();
  const executionsByOpportunity = new Map<string, ExecutionDbRow[]>();
  for (const row of ledger.executions) {
    if (row.position_id) executionsByPosition.set(row.position_id, [...(executionsByPosition.get(row.position_id) ?? []), row]);
    if (row.opportunity_id) executionsByOpportunity.set(row.opportunity_id, [...(executionsByOpportunity.get(row.opportunity_id) ?? []), row]);
  }
  const annotations = new Map<string, FleetAnnotationReceipt>(POSITION_RESEARCH_ANNOTATIONS.map((annotation) => [annotation.positionId, annotation]));

  const positions: TradePathPosition[] = ledger.positions.map((row) => {
    const strategist = joinedStrategist(row.strategists);
    const rootId = row.runner_of ?? row.id;
    const opportunityId = opportunityByPosition.get(rootId) ?? opportunityByPosition.get(row.id) ?? null;
    const entryRows = opportunityId ? executionsByOpportunity.get(opportunityId) ?? [] : executionsByPosition.get(rootId) ?? [];
    const exitRows = executionsByPosition.get(row.id) ?? [];
    const entryDecisionRow = choose(entryRows, "decision", ["enter", "add"]);
    const entryFillRow = choose(entryRows, "broker_result", ["enter", "add"]);
    const exitDecisionRow = choose(exitRows, "decision", ["exit", "reconcile"], true);
    const exitFillRow = choose(exitRows, "broker_result", ["exit", "reconcile"], true);
    const sourceBarAtMs = entryDecisionRow?.source_bar_at ? Date.parse(entryDecisionRow.source_bar_at) : null;
    const matchingReceipts = sourceBarAtMs == null || !Number.isFinite(sourceBarAtMs) ? [] : ledger.intraminuteReceipts.filter((receipt) =>
      receipt.symbol.toUpperCase() === row.underlying.toUpperCase()
      && Date.parse(receipt.provider_max_at) >= sourceBarAtMs
      && Date.parse(receipt.provider_min_at) <= sourceBarAtMs + 60_000);
    const fleetPosition: FleetPositionReceipt = {
      id: row.id,
      opportunityId,
      strategistId: row.strategist_id,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      quantity: numeric(row.qty),
      realizedPnl: numeric(row.realized_pnl),
      closeReason: row.close_reason,
      runnerOf: row.runner_of,
    };
    return {
      id: row.id,
      strategistId: row.strategist_id,
      channel: strategist.slug,
      familyId: inferResearchFamily(strategist.slug, row.underlying),
      underlying: row.underlying.toUpperCase(),
      occSymbol: row.occ_symbol,
      quantity: numeric(row.qty),
      entryPrice: numeric(row.avg_entry_price),
      openedAtMs: Date.parse(row.opened_at),
      sourceBarAtMs: Number.isFinite(sourceBarAtMs) ? sourceBarAtMs : null,
      closedAtMs: row.closed_at ? Date.parse(row.closed_at) : null,
      realizedPnl: numeric(row.realized_pnl),
      closeReason: row.close_reason,
      outcomeClass: classifyFleetOutcome(fleetPosition, channelMode(strategist.slug), annotations),
      runnerOf: row.runner_of,
      entryDecision: toMark(entryDecisionRow),
      entryFill: toMark(entryFillRow),
      exitDecision: toMark(exitDecisionRow),
      exitFill: toMark(exitFillRow),
      intraminute: {
        sourceBarAtMs: Number.isFinite(sourceBarAtMs) ? sourceBarAtMs : null,
        receiptCount: matchingReceipts.length,
        schemaVersions: [...new Set(matchingReceipts.map((receipt) => receipt.schema_version))].sort((a, b) => a - b),
        gapCount: matchingReceipts.reduce((sum, receipt) => sum + Number(receipt.gap_count ?? 0), 0),
        checksumVerified: matchingReceipts.length > 0 && verifiedIntraminute.positionIds.has(row.id),
      },
    };
  });

  const occs = [...new Set(positions.map((position) => position.occSymbol))];
  const archive = archiveQuotes(dates, new Set(occs));
  const fallback = archive.missingDates.length
    ? await liveFallbackQuotes(sb, archive.missingDates, occs)
    : new Map<string, TradePathQuote[]>();
  const quotesByOcc = new Map(archive.quotesByOcc);
  for (const [occ, rows] of fallback) quotesByOcc.set(occ, [...(quotesByOcc.get(occ) ?? []), ...rows]);
  const exact = exactDatabentoQuotes(dates, new Set(occs));
  // Exact one-second paths replace snapshot archives contract-by-contract. Two
  // sources at the same timestamp must not silently compete for the high/low.
  for (const [occ, rows] of exact.quotesByOcc) quotesByOcc.set(occ, rows);

  const thresholds = {
    ...DEFAULT_TRADE_PATH_THRESHOLDS,
    maxStartLagMs: MAX_GAP_SEC * 1_000,
    maxEndLeadMs: MAX_GAP_SEC * 1_000,
    maxInternalGapMs: MAX_GAP_SEC * 1_000,
  };
  const audit = buildTradePathAudit({ positions, quotesByOcc, thresholds });
  const sourceTypes = [...new Set([...quotesByOcc.values()].flatMap((rows) => rows.map((quote) => quote.source)))] as OptionPathSource[];
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    window: { fromDateEt: FROM, throughDateEt: THROUGH, startIso: START_ISO, endExclusiveIso: END_ISO },
    sources: {
      durableLedger: "supabase_select_only",
      optionPath: sourceTypes.sort(),
      archiveDir: ARCHIVE_DIR,
      archivedDates: archive.archivedDates,
      missingArchiveDates: archive.missingDates,
      archiveRowsScanned: archive.archiveRowsScanned,
      relevantOptionQuoteRows: [...quotesByOcc.values()].reduce((sum, rows) => sum + rows.length, 0),
      intraminuteReceiptRows: ledger.intraminuteReceipts.length,
      verifiedIntraminuteDir: VERIFIED_INTRAMINUTE_DIR,
      verifiedIntraminuteFixtures: verifiedIntraminute.fixtures,
      rawR2DownloadedAndVerifiedThisRun: false,
      databentoPathDir: DATABENTO_PATH_DIR,
      exactDatabentoManifests: exact.manifests,
    },
    audit,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);

  const summary = audit.summary;
  console.log(`trade-path-audit: ${FROM} → ${THROUGH}`);
  console.log(`  ${summary.trades} trades · ${summary.completePaths} complete option paths · ${summary.nativeExitComparable} native exit-comparable · ${summary.multiContractComparable} scale-capable`);
  console.log(`  native denominator: ${summary.nativeExitComparable}/${summary.nativeClosedWithPnl} comparable / $${summary.nativeComparablePnl} · ${summary.nativeCensored} censored / $${summary.nativeCensoredPnl}`);
  console.log(`  censor: missing ${summary.missingPaths} · left ${summary.leftCensored} · right ${summary.rightCensored} · internal-gap ${summary.internalGapCensored}`);
  console.log(`  intraminute source-minute receipts ${summary.intraminuteReceiptCovered}/${summary.trades} · positions backed by checksum-verified raw fixtures ${summary.checksumVerifiedIntraminute}`);
  for (const family of audit.families) {
    console.log(`    ${family.familyId}: ${family.trades}t · complete ${family.completePaths} · native ${family.nativeExitComparable}/${family.nativeClosedWithPnl} $${family.nativeComparablePnl} (censored ${family.nativeCensored}/$${family.nativeCensoredPnl}) · MFE p50 ${family.observedMfePctMedian ?? "—"}% · MAE p50 ${family.observedMaePctMedian ?? "—"}% · capture p50 ${family.realizedCaptureRatioMedian ?? "—"} · entry-slip n${family.freshEntrySlippage} p50 ${family.entryFillVsAskPctMedian ?? "—"}% · exit-slip n${family.freshExitSlippage} p50 ${family.exitFillVsBidPctMedian ?? "—"}%`);
  }
  console.log("  promotion: NEVER AUTOMATIC — path evidence is diagnostic, not a roster verdict");
  console.log(`  wrote ${OUT}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
