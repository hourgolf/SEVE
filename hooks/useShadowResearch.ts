"use client";

import { readHistoricalAttribution } from '@/lib/reporting/readHistoricalAttribution';
import { type HistoricalTrade } from '@/supabase/functions/_shared/historicalAttribution';
import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { startVisibilityPoll } from "@/lib/pollControl";
import { evidenceEnvelope, type EvidenceEnvelope } from "@/lib/evidence/evidenceEnvelope";
import {
  attributePositionsByImmutableExecutionAccount,
  type ExecutionAccountObservation,
} from "@/lib/ops/brokerReconciliation";
import {
  deriveChannelDryPowderCurves,
  deriveCurrentExecutedEvidence,
  derivePairedCurrentComparisons,
  deriveSessionDryPowderCurves,
  deriveShadowCumulative,
  deriveShadowSessions,
  selectLatestObservedChannelSpecRows,
  shadowSessionDate,
  type ChannelDryPowderCurve,
  type CurrentExecutedSummary,
  type ExecutedResearchRow,
  type PairedCurrentComparison,
  type ShadowCumulativeSummary,
  type ShadowResearchRow,
  type ShadowSessionSummary,
} from "@/lib/research/shadowResearch";
import { buildBoundedRetuneBook, type BoundedRetuneBook } from "@/lib/research/boundedRetuneExperiments";
import {
  parseBoundedRetuneSignalStamp,
  PRIORITY_A_BOUNDED_RETUNES,
  PRIORITY_A_RETUNE_COHORT_START,
} from "@/lib/research/boundedRetuneRegistry";
import { completeResearchRead, researchDateBounds } from "@/lib/research/completeResearchRead";
import type { AtlasOpportunity } from "@/lib/research/decisionAtlas";

const COHORT_START = "2026-06-01";
const MAX_EXECUTED_ROWS = 2_000;
const ROUTE_BATCH_SIZE = 50;
const ROUTE_PAGE_SIZE = 1_000;
const MAX_ROUTE_ROWS_PER_BATCH = 10_000;
const RESEARCH_REOPEN_CACHE_MS = 10 * 60_000;

export interface ShadowResearch {
  state: "idle" | "loading" | "ok" | "empty" | "error";
  sessions: ShadowSessionSummary[];
  cumulative: ShadowCumulativeSummary | null;
  currentCumulative: ShadowCumulativeSummary | null;
  dryPowderBySlug: Record<string, ChannelDryPowderCurve>;
  dryPowderBySession: Record<string, Record<string, ChannelDryPowderCurve>>;
  currentExecutedBySlug: Record<string, CurrentExecutedSummary>;
  pairedCurrent: PairedCurrentComparison[];
  currentExecutedState: "idle" | "loading" | "ok" | "empty" | "error";
  currentExecutedError: string;
  currentExecutedTruncated: boolean;
  boundedRetunes: BoundedRetuneBook;
  boundedRetuneState: "idle" | "loading" | "ok" | "empty" | "error";
  boundedRetuneError: string;
  sourceCounts: { virtual: number; retuneSignals: number | null };
  dateRange: { from: string; through: string };
  setDateRange: (from: string, through: string) => void;
  virtualEvidence: EvidenceEnvelope;
  currentExecutedEvidence: EvidenceEnvelope;
  cohortStart: string;
  truncated: boolean;
  error: string;
  asOf: string | null;
  basis: "native virtual paths in selected date range";
}
const EMPTY: ShadowResearch = {
  state: "idle",
  sessions: [],
  cumulative: null,
  currentCumulative: null,
  dryPowderBySlug: {},
  dryPowderBySession: {},
  currentExecutedBySlug: {},
  pairedCurrent: [],
  currentExecutedState: "idle",
  currentExecutedError: "",
  currentExecutedTruncated: false,
  boundedRetuneError: "",
  boundedRetuneState: "idle",
  sourceCounts: { virtual: 0, retuneSignals: null },
  dateRange: { from: COHORT_START, through: "" },
  setDateRange: () => {},
  boundedRetunes: buildBoundedRetuneBook({
    generatedAt: "",
    throughSession: "",
    opportunities: [],
  }),
  virtualEvidence: evidenceEnvelope({ layer: "historical_virtual", unit: "opportunity", fromSession: null, throughSession: null,
    configurationEpochId: null, managerVersion: null, scope: { kind: "portfolio", accountIds: [], channelSlugs: [] },
    completeness: "unavailable", reconciliation: "unverified", authority: "withheld", source: "virtual_trades", receiptHash: null,
    limitations: ["Legacy virtual rows may remain unstamped; stamped rows retain channel, release, portfolio, manager, and publisher provenance."], asOf: null }),
  currentExecutedEvidence: evidenceEnvelope({ layer: "current_executed", unit: "logical_trade", fromSession: null, throughSession: null,
    configurationEpochId: null, managerVersion: null, scope: { kind: "portfolio", accountIds: [], channelSlugs: [] },
    completeness: "unavailable", reconciliation: "blocked", authority: "withheld", source: "positions lineage + immutable execution route", receiptHash: null,
    limitations: ["No attributed current execution cohort is available."], asOf: null }),
  cohortStart: COHORT_START,
  truncated: false,
  error: "",
  asOf: null,
  basis: "native virtual paths in selected date range",
};

const message = (error: unknown): string =>
  error && typeof error === "object" && "message" in error
    ? String((error as { message?: unknown }).message ?? "read rejected")
    : String(error ?? "read rejected");

async function readRetuneSignals(input: {
  from: string;
  until: string;
  alive: () => boolean;
}): Promise<Record<string, unknown>[]> {
  const retuneStrategistIds = PRIORITY_A_BOUNDED_RETUNES.map((row) => row.strategistId);
  const retuneFrom = input.from > `${PRIORITY_A_RETUNE_COHORT_START}T04:00:00.000Z`
    ? input.from
    : `${PRIORITY_A_RETUNE_COHORT_START}T04:00:00.000Z`;
  return completeResearchRead<Record<string, unknown>>({
    key: "id",
    alive: input.alive,
    count: async () => {
      const result = await getSupabase().from("signals").select("id", { count: "exact", head: true })
        .in("strategist_id", retuneStrategistIds).gte("created_at", retuneFrom).lt("created_at", input.until);
      if (result.error) throw result.error;
      return result.count;
    },
    page: async (after, size) => {
      let query = getSupabase().from("signals")
        .select("id,strategist_id,created_at,rationale_epoch:rationale->>configuration_epoch_id,experiment:rationale->bounded_retune_experiment")
        .in("strategist_id", retuneStrategistIds).gte("created_at", retuneFrom).lt("created_at", input.until).order("id").limit(size);
      if (after) query = query.gt("id", after);
      const result = await query;
      if (result.error) throw result.error;
      return (result.data ?? []) as Record<string, unknown>[];
    },
  });
}

async function readCurrentExecutedEvidence(input: {
  from: string;
  until: string;
  configuredKey: string;
}) {
  const executedRead = await getSupabase().from("positions")
    .select("id,qty,realized_pnl,opened_at,closed_at,runner_of,channel_spec_version_id,release_manifest_id,configuration_epoch_id,strategists(slug)", { count: "exact" })
    .eq("status", "closed")
    .gte("opened_at", input.from > "2026-07-20T04:00:00.000Z" ? input.from : "2026-07-20T04:00:00.000Z")
    .lt("opened_at", input.until)
    .order("opened_at", { ascending: true })
    .limit(MAX_EXECUTED_ROWS);
  if (executedRead.error) throw executedRead.error;
  const rawExecutedRows = ((executedRead.data ?? []) as Record<string, unknown>[]).flatMap((row) => {
    const relation = Array.isArray(row.strategists) ? row.strategists[0] : row.strategists;
    const slug = relation && typeof relation === "object" && "slug" in relation
      ? String((relation as { slug?: unknown }).slug ?? "")
      : "";
    if (!slug || !row.id || !row.opened_at || row.realized_pnl == null) return [];
    return [{
      id: String(row.id),
      slug,
      quantity: Number(row.qty ?? 0),
      realizedPnl: Number(row.realized_pnl),
      openedAt: String(row.opened_at),
      closedAt: row.closed_at == null ? null : String(row.closed_at),
      runnerOf: row.runner_of == null ? null : String(row.runner_of),
      configurationEpochId: row.configuration_epoch_id == null ? null : String(row.configuration_epoch_id),
      channelSpecVersionId: row.channel_spec_version_id == null ? null : String(row.channel_spec_version_id),
      releaseManifestId: row.release_manifest_id == null ? null : String(row.release_manifest_id),
    }];
  });
  const observations: ExecutionAccountObservation[] = [];
  // A single `.in(...)` read silently stops at PostgREST's row ceiling.
  // Page every bounded position batch and retain only immutable routes.
  for (let batchStart = 0; batchStart < rawExecutedRows.length; batchStart += ROUTE_BATCH_SIZE) {
    const positionIds = rawExecutedRows.slice(batchStart, batchStart + ROUTE_BATCH_SIZE).map((row) => row.id);
    for (let offset = 0; offset < MAX_ROUTE_ROWS_PER_BATCH; offset += ROUTE_PAGE_SIZE) {
      const routeRead = await getSupabase().from("execution_observations")
        .select("id,position_id,account_id,event_at")
        .in("position_id", positionIds)
        .not("account_id", "is", null)
        .order("event_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + ROUTE_PAGE_SIZE - 1);
      if (routeRead.error) throw routeRead.error;
      const page = (routeRead.data ?? []) as ExecutionAccountObservation[];
      observations.push(...page);
      if (page.length < ROUTE_PAGE_SIZE) break;
      if (offset + ROUTE_PAGE_SIZE >= MAX_ROUTE_ROWS_PER_BATCH) {
        throw new Error(`immutable route read exceeded ${MAX_ROUTE_ROWS_PER_BATCH} rows for ${positionIds.length} positions`);
      }
    }
  }
  const attribution = attributePositionsByImmutableExecutionAccount({
    positions: rawExecutedRows,
    observations,
    configuredPaperAccountIds: new Set(input.configuredKey.split(",").filter(Boolean)),
    positionLabel: "current executed research positions",
  });
  if (!attribution.ok) throw new Error(attribution.issues.join("; "));
  const historical = await readHistoricalAttribution();
  const byId = new Map<string, HistoricalTrade>(historical.records.flatMap((trade) =>
    trade.positionIds.map((id) => [id, trade] as const)));
  const missingChannels = new Set(historical.brokerOnly.map((trade) => trade.slug));
  let historicalExecutedWithheld = 0;
  const executedRows: ExecutedResearchRow[] = [...attribution.byAccount.entries()].flatMap(([accountId, accountRows]) =>
    accountRows.map((row) => ({ ...row, accountId }))).filter((row) => {
      const trade = byId.get(row.id);
      const eligible = !missingChannels.has(row.slug)
        && (!trade || trade.state === "broker_reconstructed"
          && Math.abs(Math.round((trade.reconstructedGross! - trade.ledgerGross) * 100)) === 0);
      if (!eligible) historicalExecutedWithheld += 1;
      return eligible;
    });
  const current = deriveCurrentExecutedEvidence(executedRows);
  return {
    current,
    historicalExecutedWithheld,
    historicalMissingChannels: [...missingChannels].sort(),
    truncated: (executedRead.count ?? executedRows.length) > MAX_EXECUTED_ROWS,
  };
}

/**
 * Page-owned and caller-gated. Fixed date bounds, UUID keysets and source-count
 * reconciliation prevent silently truncated datasets. Experiment read failures
 * do not invalidate the independent virtual and executed datasets.
 */
export function useShadowResearch(enabled: boolean, configuredPaperAccountIds: readonly string[]): ShadowResearch {
  const [state, setState] = useState<ShadowResearch>(EMPTY);
  const stateRef = useRef<ShadowResearch>(state);
  const [dateRange, setRange] = useState(() => ({ from: COHORT_START, through: shadowSessionDate(new Date().toISOString()) }));
  const configuredKey = [...configuredPaperAccountIds].sort().join(",");
  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let reading = false;
    const cached = stateRef.current;
    const reusable = (cached.state === "ok" || cached.state === "empty")
      && cached.asOf != null
      && cached.boundedRetuneState !== "loading"
      && cached.currentExecutedState !== "loading"
      && cached.dateRange.from === dateRange.from
      && cached.dateRange.through === dateRange.through
      && Date.now() - Date.parse(cached.asOf) < RESEARCH_REOPEN_CACHE_MS;
    const poll = async () => {
      if (reading) return;
      reading = true;
      setState((previous) => ({ ...previous, state: previous.asOf ? previous.state : "loading", error: "" }));
      try {
        const bounds = researchDateBounds(dateRange.from, dateRange.through);
        // Freeze the upper bound so new signals do not move this read's cohort.
        const until = bounds.until < new Date().toISOString() ? bounds.until : new Date().toISOString();

        // These datasets are independent. Start them together, then publish the
        // complete virtual ledger as soon as it reconciles instead of making the
        // primary Atlas wait for slower supplemental comparisons.
        const retuneRead = readRetuneSignals({ from: bounds.from, until, alive: () => alive })
          .then((rows) => ({ rows, error: "" }), (error) => ({ rows: null, error: message(error) }));
        const executedRead = readCurrentExecutedEvidence({ from: bounds.from, until, configuredKey })
          .then((value) => ({ value, error: "" }), (error) => ({ value: null, error: message(error) }));

        const virtualScope = () => getSupabase().from("virtual_trades");
        const rawRows = await completeResearchRead<Record<string, unknown>>({
          key: "signal_id", alive: () => alive,
          count: async () => {
            const result = await virtualScope().select("signal_id", { count: "exact", head: true }).gte("signal_at", bounds.from).lt("signal_at", until);
            if (result.error) throw result.error;
            return result.count;
          },
          page: async (after, size) => {
            let query = virtualScope().select("signal_id,slug,blocked,exit_reason,pnl_per_contract,signal_at,exit_at,occ,entry_px,mfe_pct,giveback_pct,channel_spec_version_id,release_manifest_id,configuration_epoch_id,native_manager_policy_version,research_publisher_version")
              .gte("signal_at", bounds.from).lt("signal_at", until).order("signal_id").limit(size);
            if (after) query = query.gt("signal_id", after);
            const result = await query;
            if (result.error) throw result.error;
            return (result.data ?? []) as Record<string, unknown>[];
          },
        });
        const rows = rawRows.map((row) => ({
          signalId: String(row.signal_id ?? ""),
          slug: String(row.slug ?? ""),
          blocked: String(row.blocked ?? "unknown"),
          exitReason: String(row.exit_reason ?? "unknown"),
          pnlPerContract: row.pnl_per_contract == null ? null : Number(row.pnl_per_contract),
          signalAt: String(row.signal_at ?? ""),
          exitAt: row.exit_at == null ? null : String(row.exit_at),
          occ: row.occ == null ? null : String(row.occ),
          entryPrice: row.entry_px == null ? null : Number(row.entry_px),
          mfePct: row.mfe_pct == null ? null : Number(row.mfe_pct),
          givebackPct: row.giveback_pct == null ? null : Number(row.giveback_pct),
          channelSpecVersionId: row.channel_spec_version_id == null ? null : String(row.channel_spec_version_id),
          releaseManifestId: row.release_manifest_id == null ? null : String(row.release_manifest_id),
          configurationEpochId: row.configuration_epoch_id == null ? null : String(row.configuration_epoch_id),
          nativeManagerPolicyVersion: row.native_manager_policy_version == null ? null : String(row.native_manager_policy_version),
          researchPublisherVersion: row.research_publisher_version == null ? null : String(row.research_publisher_version),
        } satisfies ShadowResearchRow));
        const sessions = deriveShadowSessions(rows);
        const cumulative = deriveShadowCumulative(rows);
        const currentCumulative = deriveShadowCumulative(selectLatestObservedChannelSpecRows(rows));
        const dryPowderBySlug = deriveChannelDryPowderCurves(rows);
        const dryPowderBySession = deriveSessionDryPowderCurves(rows);
        const virtualBySignal = new Map(rows.map((row) => [row.signalId ?? "", row]));
        if (!alive) return;
        const asOf = new Date().toISOString();
        setState({
          state: sessions.length ? "ok" : "empty",
          sessions,
          cumulative,
          currentCumulative,
          dryPowderBySlug,
          dryPowderBySession,
          currentExecutedBySlug: {},
          pairedCurrent: [],
          currentExecutedState: "loading",
          currentExecutedError: "",
          currentExecutedTruncated: false,
          boundedRetunes: buildBoundedRetuneBook({ generatedAt: asOf, throughSession: dateRange.through, opportunities: [] }),
          boundedRetuneState: "loading",
          boundedRetuneError: "",
          sourceCounts: { virtual: rows.length, retuneSignals: null },
          dateRange,
          setDateRange: () => {},
          virtualEvidence: evidenceEnvelope({ layer: "historical_virtual", unit: "opportunity",
            fromSession: cumulative?.fromSession ?? null, throughSession: cumulative?.throughSession ?? null,
            configurationEpochId: null, managerVersion: null,
            scope: { kind: "portfolio", accountIds: [], channelSlugs: [...new Set(rows.map((row) => row.slug))] },
            completeness: sessions.length ? "complete" : "unavailable",
            reconciliation: "unverified", authority: sessions.length ? "research_only" : "withheld", source: "virtual_trades · native hypothetical paths", receiptHash: null,
            limitations: [
              ...(rows.some((row) => !row.channelSpecVersionId) ? ["Some legacy virtual rows are unstamped and remain labeled as all-history context."] : []),
              "Source row counts reconciled before and after complete pagination. Quote-path quality is a separate requirement.",
            ], asOf }),
          currentExecutedEvidence: evidenceEnvelope({ ...EMPTY.currentExecutedEvidence, fromSession: dateRange.from,
            throughSession: dateRange.through, limitations: ["Current executed comparison is loading independently of the complete virtual ledger."], asOf: null }),
          cohortStart: dateRange.from,
          truncated: false,
          error: "",
          asOf,
          basis: "native virtual paths in selected date range",
        });

        const retuneCompletion = retuneRead.then((result) => {
          if (!alive) return;
          if (!result.rows) {
            setState((previous) => previous.dateRange.from !== dateRange.from || previous.dateRange.through !== dateRange.through
              ? previous : { ...previous, boundedRetuneState: "error", boundedRetuneError: result.error,
                sourceCounts: { ...previous.sourceCounts, retuneSignals: null } });
            return;
          }
          const definitionByStrategist = new Map(PRIORITY_A_BOUNDED_RETUNES
            .map((definition) => [definition.strategistId, definition]));
          const opportunities = result.rows.flatMap((signal): AtlasOpportunity[] => {
            const definition = definitionByStrategist.get(String(signal.strategist_id));
            if (!definition) return [];
            const virtual = virtualBySignal.get(String(signal.id));
            const entryPrice = virtual?.entryPrice ?? null;
            const outcome = virtual?.pnlPerContract ?? null;
            const configurationEpochId = typeof signal.rationale_epoch === "string" ? signal.rationale_epoch : null;
            return [{
              logicalOpportunityId: `signal:${signal.id}`,
              id: `prospective_virtual:${signal.id}`,
              channel: definition.channel,
              session: shadowSessionDate(String(signal.created_at)),
              signalAt: String(signal.created_at),
              exitAt: virtual?.exitAt ?? null,
              configurationEra: configurationEpochId,
              portfolioConfigurationEra: configurationEpochId,
              managerVersion: null,
              evidenceLayer: "prospective_virtual",
              accountId: null,
              underlying: "UNKNOWN",
              occSymbol: virtual?.occ ?? null,
              direction: null,
              contractSelected: virtual?.occ ? true : null,
              quoteEligible: null,
              admissionAllowed: null,
              filled: false,
              blockedReason: virtual?.blocked ?? null,
              quantity: null,
              entryPrice,
              resultPerContractUsd: outcome,
              returnPct: outcome != null && entryPrice != null && entryPrice > 0 ? outcome / entryPrice : null,
              mfePct: virtual?.mfePct ?? null,
              maePct: null,
              captureRatio: null,
              stopExposurePerContractUsd: null,
              boundedRetuneStamp: parseBoundedRetuneSignalStamp(signal.experiment),
              sourceRefs: [`signals:${signal.id}`, ...(virtual ? [`virtual_trades:${signal.id}`] : [])],
            }];
          });
          const boundedRetunes = buildBoundedRetuneBook({
            generatedAt: new Date().toISOString(),
            throughSession: cumulative?.throughSession ?? PRIORITY_A_RETUNE_COHORT_START,
            opportunities,
          });
          setState((previous) => previous.dateRange.from !== dateRange.from || previous.dateRange.through !== dateRange.through
            ? previous : { ...previous, boundedRetunes, boundedRetuneState: result.rows.length ? "ok" : "empty",
              boundedRetuneError: "", sourceCounts: { ...previous.sourceCounts, retuneSignals: result.rows.length } });
        }).catch((error) => {
          if (alive) setState((previous) => previous.dateRange.from !== dateRange.from || previous.dateRange.through !== dateRange.through
            ? previous : { ...previous, boundedRetuneState: "error", boundedRetuneError: message(error),
              sourceCounts: { ...previous.sourceCounts, retuneSignals: null } });
        });

        const executedCompletion = executedRead.then((result) => {
          if (!alive) return;
          if (!result.value) {
            setState((previous) => previous.dateRange.from !== dateRange.from || previous.dateRange.through !== dateRange.through
              ? previous : { ...previous, currentExecutedState: "error", currentExecutedError: result.error,
                currentExecutedEvidence: evidenceEnvelope({ ...previous.currentExecutedEvidence,
                  completeness: "unavailable", reconciliation: "blocked", authority: "withheld",
                  limitations: ["Executed evidence could not be reconciled; the virtual ledger remains independently complete."], asOf: new Date().toISOString() }) });
            return;
          }
          const { current, historicalExecutedWithheld, historicalMissingChannels, truncated } = result.value;
          const currentExecutedState: ShadowResearch["currentExecutedState"] = current.opportunities.length ? "ok" : "empty";
          const currentSessions = Object.values(current.bySlug)
            .flatMap((summary) => [summary.fromSession, summary.throughSession]).filter(Boolean).sort();
          const supplementalAsOf = new Date().toISOString();
          setState((previous) => previous.dateRange.from !== dateRange.from || previous.dateRange.through !== dateRange.through
            ? previous : {
              ...previous,
              currentExecutedBySlug: current.bySlug,
              pairedCurrent: derivePairedCurrentComparisons(current.opportunities, rows),
              currentExecutedState,
              currentExecutedError: "",
              currentExecutedTruncated: truncated,
              currentExecutedEvidence: evidenceEnvelope({ layer: "current_executed", unit: "logical_trade",
                fromSession: currentSessions[0] ?? null, throughSession: currentSessions.at(-1) ?? null,
                configurationEpochId: null, managerVersion: null,
                scope: { kind: "portfolio", accountIds: [...new Set(Object.values(current.bySlug).flatMap((summary) => summary.accountIds))], channelSlugs: Object.keys(current.bySlug) },
                completeness: truncated || historicalExecutedWithheld || historicalMissingChannels.length ? "partial" : currentExecutedState === "ok" ? "complete" : "unavailable",
                reconciliation: currentExecutedState === "ok" ? "reconciled" : "blocked",
                authority: currentExecutedState === "ok" && !truncated && !historicalExecutedWithheld && !historicalMissingChannels.length ? "decision_ready" : "withheld",
                source: "positions lineage + immutable execution route · latest channel behavior spec", receiptHash: null,
                limitations: ["Current execution cohort begins July 20; earlier virtual history remains separately available.", "Channel behavior specifications are selected independently; receipt-only portfolio epoch changes do not reset unchanged channel evidence.", ...(truncated ? ["Read reached its bounded row cap."] : []), ...(historicalExecutedWithheld ? [`${historicalExecutedWithheld} position rows withheld from current behavior comparisons because their broker result or inventory does not match the recorded ledger.`] : []), ...(historicalMissingChannels.length ? [`Broker-only historical fills prevent complete executed comparisons for ${historicalMissingChannels.join(", ")}. See Review for their audited economic subtotals.`] : [])], asOf: supplementalAsOf }),
            });
        }).catch((error) => {
          if (alive) setState((previous) => previous.dateRange.from !== dateRange.from || previous.dateRange.through !== dateRange.through
            ? previous : { ...previous, currentExecutedState: "error", currentExecutedError: message(error),
              currentExecutedEvidence: evidenceEnvelope({ ...previous.currentExecutedEvidence,
                completeness: "unavailable", reconciliation: "blocked", authority: "withheld",
                limitations: ["Executed evidence derivation failed; the virtual ledger remains independently complete."], asOf: new Date().toISOString() }) });
        });
        await Promise.all([retuneCompletion, executedCompletion]);
      } catch (error) {
        if (alive) setState((previous) => ({
          ...previous,
          state: "error",
          error: message(error),
          virtualEvidence: evidenceEnvelope({ ...previous.virtualEvidence,
            completeness: previous.asOf ? "stale" : "unavailable", authority: previous.asOf ? "research_only" : "withheld" }),
          currentExecutedEvidence: evidenceEnvelope({ ...previous.currentExecutedEvidence,
            completeness: previous.asOf ? "stale" : "unavailable", authority: "withheld" }),
        }));
      } finally { reading = false; }
    };
    if (!reusable) {
      setState((previous) => previous.asOf
        && previous.dateRange.from === dateRange.from
        && previous.dateRange.through === dateRange.through
        ? previous
        : { ...EMPTY, state: "loading", dateRange });
      void poll();
    }
    const stop = startVisibilityPoll(() => void poll(), 10 * 60_000);
    return () => { alive = false; stop(); };
  }, [configuredKey, enabled, dateRange.from, dateRange.through]);

  return { ...state, dateRange, setDateRange: (from, through) => { researchDateBounds(from, through); setRange({ from, through }); } };
}
