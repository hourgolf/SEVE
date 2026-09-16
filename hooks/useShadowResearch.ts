"use client";

import { useEffect, useState } from "react";
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

export interface ShadowResearch {
  state: "idle" | "loading" | "ok" | "empty" | "error";
  sessions: ShadowSessionSummary[];
  cumulative: ShadowCumulativeSummary | null;
  currentCumulative: ShadowCumulativeSummary | null;
  dryPowderBySlug: Record<string, ChannelDryPowderCurve>;
  dryPowderBySession: Record<string, Record<string, ChannelDryPowderCurve>>;
  currentExecutedBySlug: Record<string, CurrentExecutedSummary>;
  pairedCurrent: PairedCurrentComparison[];
  currentExecutedState: "ok" | "empty" | "error";
  currentExecutedError: string;
  currentExecutedTruncated: boolean;
  boundedRetunes: BoundedRetuneBook;
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
  currentExecutedState: "empty",
  currentExecutedError: "",
  currentExecutedTruncated: false,
  boundedRetuneError: "",
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
    completeness: "unavailable", reconciliation: "unverified", source: "virtual_trades", receiptHash: null,
    limitations: ["Legacy virtual rows may remain unstamped; stamped rows retain channel, release, portfolio, manager, and publisher provenance."], asOf: null }),
  currentExecutedEvidence: evidenceEnvelope({ layer: "current_executed", unit: "logical_trade", fromSession: null, throughSession: null,
    configurationEpochId: null, managerVersion: null, scope: { kind: "portfolio", accountIds: [], channelSlugs: [] },
    completeness: "unavailable", reconciliation: "blocked", source: "positions lineage + immutable execution route", receiptHash: null,
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

/**
 * Page-owned and caller-gated. Fixed date bounds, UUID keysets and source-count
 * reconciliation prevent silently truncated datasets. Experiment read failures
 * do not invalidate the independent virtual and executed datasets.
 */
export function useShadowResearch(enabled: boolean, configuredPaperAccountIds: readonly string[]): ShadowResearch {
  const [state, setState] = useState<ShadowResearch>(EMPTY);
  const [dateRange, setRange] = useState(() => ({ from: COHORT_START, through: shadowSessionDate(new Date().toISOString()) }));
  const configuredKey = [...configuredPaperAccountIds].sort().join(",");

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let reading = false;
    const poll = async () => {
      if (reading) return;
      reading = true;
      setState((previous) => ({ ...previous, state: previous.asOf ? previous.state : "loading", error: "" }));
      try {
        const bounds = researchDateBounds(dateRange.from, dateRange.through);
        // Freeze the upper bound so new signals do not move this read's cohort.
        const until = bounds.until < new Date().toISOString() ? bounds.until : new Date().toISOString();
        const virtualScope = () => getSupabase().from("virtual_trades");
        const rawRows = await completeResearchRead<Record<string, unknown>>({
          key: "signal_id", alive: () => alive,
          count: async () => {
            const r = await virtualScope().select("signal_id", { count: "exact", head: true }).gte("signal_at", bounds.from).lt("signal_at", until);
            if (r.error) throw r.error;
            return r.count;
          },
          page: async (after, size) => {
            let q = virtualScope().select("signal_id,slug,blocked,exit_reason,pnl_per_contract,signal_at,exit_at,occ,entry_px,mfe_pct,giveback_pct,channel_spec_version_id,release_manifest_id,configuration_epoch_id,native_manager_policy_version,research_publisher_version")
              .gte("signal_at", bounds.from).lt("signal_at", until).order("signal_id").limit(size);
            if (after) q = q.gt("signal_id", after);
            const r = await q;
            if (r.error) throw r.error;
            return (r.data ?? []) as Record<string, unknown>[];
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
        let boundedRetuneError = "";
        let retuneCount: number | null = null;
        let boundedRetunes = buildBoundedRetuneBook({ generatedAt: new Date().toISOString(), throughSession: dateRange.through, opportunities: [] });
        try {
          const retuneStrategistIds = PRIORITY_A_BOUNDED_RETUNES.map((row) => row.strategistId);
          const retuneFrom = bounds.from > `${PRIORITY_A_RETUNE_COHORT_START}T04:00:00.000Z` ? bounds.from : `${PRIORITY_A_RETUNE_COHORT_START}T04:00:00.000Z`;
          const retuneSignals = await completeResearchRead<Record<string, unknown>>({
            key: "id", alive: () => alive,
            count: async () => {
              const r = await getSupabase().from("signals").select("id", { count: "exact", head: true })
                .in("strategist_id", retuneStrategistIds).gte("created_at", retuneFrom).lt("created_at", until);
              if (r.error) throw r.error;
              return r.count;
            },
            page: async (after, size) => {
              let q = getSupabase().from("signals")
                .select("id,strategist_id,created_at,rationale_epoch:rationale->>configuration_epoch_id,experiment:rationale->bounded_retune_experiment")
                .in("strategist_id", retuneStrategistIds).gte("created_at", retuneFrom).lt("created_at", until).order("id").limit(size);
              if (after) q = q.gt("id", after);
              const r = await q;
              if (r.error) throw r.error;
              return (r.data ?? []) as Record<string, unknown>[];
            },
          });
          retuneCount = retuneSignals.length;
          const retuneDefinitionByStrategist = new Map(PRIORITY_A_BOUNDED_RETUNES
            .map((definition) => [definition.strategistId, definition]));
          const retuneOpportunities = retuneSignals.flatMap((signal): AtlasOpportunity[] => {
            const definition = retuneDefinitionByStrategist.get(String(signal.strategist_id));
            if (!definition) return [];
            const virtual = virtualBySignal.get(String(signal.id));
            const entryPrice = virtual?.entryPrice ?? null;
            const result = virtual?.pnlPerContract ?? null;
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
              resultPerContractUsd: result,
              returnPct: result != null && entryPrice != null && entryPrice > 0 ? result / entryPrice : null,
              mfePct: virtual?.mfePct ?? null,
              maePct: null,
              captureRatio: null,
              stopExposurePerContractUsd: null,
              boundedRetuneStamp: parseBoundedRetuneSignalStamp(signal.experiment),
              sourceRefs: [`signals:${signal.id}`, ...(virtual ? [`virtual_trades:${signal.id}`] : [])],
            }];
          });
          boundedRetunes = buildBoundedRetuneBook({
            generatedAt: new Date().toISOString(),
            throughSession: cumulative?.throughSession ?? PRIORITY_A_RETUNE_COHORT_START,
            opportunities: retuneOpportunities,
          });
        } catch (error) { boundedRetuneError = message(error); retuneCount = null; }
        let currentExecutedBySlug: Record<string, CurrentExecutedSummary> = {};
        let pairedCurrent: PairedCurrentComparison[] = [];
        let currentExecutedState: ShadowResearch["currentExecutedState"] = "empty";
        let currentExecutedError = "";
        let currentExecutedTruncated = false;
        try {
          const executedRead = await getSupabase().from("positions")
            .select("id,qty,realized_pnl,opened_at,closed_at,runner_of,channel_spec_version_id,release_manifest_id,configuration_epoch_id,strategists(slug)", { count: "exact" })
            .eq("status", "closed")
            .gte("opened_at", bounds.from > "2026-07-20T04:00:00.000Z" ? bounds.from : "2026-07-20T04:00:00.000Z")
            .lt("opened_at", until)
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
          // Current positions can have many observations each, so the old
          // unpaged query returned 1,000 rows and made the remaining positions
          // look unrouted. Read only immutable account-bearing observations and
          // page every bounded position batch to completion.
          for (let batchStart = 0; batchStart < rawExecutedRows.length; batchStart += ROUTE_BATCH_SIZE) {
            const positionIds = rawExecutedRows
              .slice(batchStart, batchStart + ROUTE_BATCH_SIZE)
              .map((row) => row.id);
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
            configuredPaperAccountIds: new Set(configuredKey.split(",").filter(Boolean)),
            positionLabel: "current executed research positions",
          });
          if (!attribution.ok) throw new Error(attribution.issues.join("; "));
          const executedRows: ExecutedResearchRow[] = [...attribution.byAccount.entries()].flatMap(([accountId, accountRows]) =>
            accountRows.map((row) => ({ ...row, accountId })));
          const current = deriveCurrentExecutedEvidence(executedRows);
          currentExecutedBySlug = current.bySlug;
          pairedCurrent = derivePairedCurrentComparisons(current.opportunities, rows);
          currentExecutedState = current.opportunities.length ? "ok" : "empty";
          currentExecutedTruncated = (executedRead.count ?? executedRows.length) > MAX_EXECUTED_ROWS;
        } catch (error) {
          currentExecutedState = "error";
          currentExecutedError = message(error);
        }
        if (!alive) return;
        const asOf = new Date().toISOString();
        const currentSessions = Object.values(currentExecutedBySlug).flatMap((summary) => [summary.fromSession, summary.throughSession]).filter(Boolean).sort();
        setState({
          state: sessions.length ? "ok" : "empty",
          sessions,
          cumulative,
          currentCumulative,
          dryPowderBySlug,
          dryPowderBySession,
          currentExecutedBySlug,
          pairedCurrent,
          currentExecutedState,
          currentExecutedError,
          currentExecutedTruncated,
          boundedRetunes,
          boundedRetuneError,
          sourceCounts: { virtual: rows.length, retuneSignals: retuneCount },
          dateRange,
          setDateRange: () => {},
          virtualEvidence: evidenceEnvelope({ layer: "historical_virtual", unit: "opportunity",
            fromSession: cumulative?.fromSession ?? null, throughSession: cumulative?.throughSession ?? null,
            configurationEpochId: null, managerVersion: null,
            scope: { kind: "portfolio", accountIds: [], channelSlugs: [...new Set(rows.map((row) => row.slug))] },
            completeness: sessions.length ? "complete" : "unavailable",
            reconciliation: "unverified", source: "virtual_trades · native hypothetical paths", receiptHash: null,
            limitations: [
              ...(rows.some((row) => !row.channelSpecVersionId) ? ["Some legacy virtual rows are unstamped and remain labeled as all-history context."] : []),
              "Source row counts reconciled before and after complete pagination. Quote-path quality is a separate requirement.",
            ], asOf }),
          currentExecutedEvidence: evidenceEnvelope({ layer: "current_executed", unit: "logical_trade",
            fromSession: currentSessions[0] ?? null, throughSession: currentSessions.at(-1) ?? null,
            configurationEpochId: null, managerVersion: null,
            scope: { kind: "portfolio", accountIds: [...new Set(Object.values(currentExecutedBySlug).flatMap((summary) => summary.accountIds))], channelSlugs: Object.keys(currentExecutedBySlug) },
            completeness: currentExecutedState === "error" ? "unavailable" : currentExecutedTruncated ? "partial" : currentExecutedState === "ok" ? "complete" : "unavailable",
            reconciliation: currentExecutedState === "ok" ? "reconciled" : "blocked",
            source: "positions lineage + immutable execution route · latest channel behavior spec", receiptHash: null,
            limitations: ["Current execution cohort begins July 20; earlier virtual history remains separately available.", "Channel behavior specifications are selected independently; receipt-only portfolio epoch changes do not reset unchanged channel evidence.", ...(currentExecutedTruncated ? ["Read reached its bounded row cap."] : [])], asOf }),
          cohortStart: dateRange.from,
          truncated: false,
          error: "",
          asOf,
          basis: "native virtual paths in selected date range",
        });
      } catch (error) {
        if (alive) setState((previous) => ({
          ...previous,
          state: "error",
          error: message(error),
          virtualEvidence: evidenceEnvelope({ ...previous.virtualEvidence,
            completeness: previous.asOf ? "stale" : "unavailable" }),
          currentExecutedEvidence: evidenceEnvelope({ ...previous.currentExecutedEvidence,
            completeness: previous.asOf ? "stale" : "unavailable" }),
        }));
      } finally { reading = false; }
    };
    setState({ ...EMPTY, state: "loading", dateRange });
    void poll();
    const stop = startVisibilityPoll(() => void poll(), 10 * 60_000);
    return () => { alive = false; stop(); };
  }, [configuredKey, enabled, dateRange.from, dateRange.through]);

  return { ...state, dateRange, setDateRange: (from, through) => { researchDateBounds(from, through); setRange({ from, through }); } };
}
