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
import type { AtlasOpportunity } from "@/lib/research/decisionAtlas";

const COHORT_START = "2026-07-20";
const COHORT_START_ISO = "2026-07-20T04:00:00.000Z";
const PAGE_SIZE = 1_000;
const MAX_ROWS = 10_000;
const MAX_EXECUTED_ROWS = 2_000;
const ROUTE_BATCH_SIZE = 50;
const ROUTE_PAGE_SIZE = 1_000;
const MAX_ROUTE_ROWS_PER_BATCH = 10_000;

export interface ShadowResearch {
  state: "idle" | "loading" | "ok" | "empty" | "error";
  sessions: ShadowSessionSummary[];
  cumulative: ShadowCumulativeSummary | null;
  dryPowderBySlug: Record<string, ChannelDryPowderCurve>;
  dryPowderBySession: Record<string, Record<string, ChannelDryPowderCurve>>;
  currentExecutedBySlug: Record<string, CurrentExecutedSummary>;
  pairedCurrent: PairedCurrentComparison[];
  currentExecutedState: "ok" | "empty" | "error";
  currentExecutedError: string;
  currentExecutedTruncated: boolean;
  boundedRetunes: BoundedRetuneBook;
  virtualEvidence: EvidenceEnvelope;
  currentExecutedEvidence: EvidenceEnvelope;
  cohortStart: typeof COHORT_START;
  truncated: boolean;
  error: string;
  asOf: string | null;
  basis: "native virtual paths since Day 1";
}
const EMPTY: ShadowResearch = {
  state: "idle",
  sessions: [],
  cumulative: null,
  dryPowderBySlug: {},
  dryPowderBySession: {},
  currentExecutedBySlug: {},
  pairedCurrent: [],
  currentExecutedState: "empty",
  currentExecutedError: "",
  currentExecutedTruncated: false,
  boundedRetunes: buildBoundedRetuneBook({
    generatedAt: "",
    throughSession: "",
    opportunities: [],
  }),
  virtualEvidence: evidenceEnvelope({ layer: "historical_virtual", unit: "opportunity", fromSession: null, throughSession: null,
    configurationEpochId: null, managerVersion: null, scope: { kind: "portfolio", accountIds: [], channelSlugs: [] },
    completeness: "unavailable", reconciliation: "unverified", source: "virtual_trades", receiptHash: null,
    limitations: ["Virtual rows do not yet carry configuration epoch provenance."], asOf: null }),
  currentExecutedEvidence: evidenceEnvelope({ layer: "current_executed", unit: "logical_trade", fromSession: null, throughSession: null,
    configurationEpochId: null, managerVersion: null, scope: { kind: "portfolio", accountIds: [], channelSlugs: [] },
    completeness: "unavailable", reconciliation: "blocked", source: "positions lineage + immutable execution route", receiptHash: null,
    limitations: ["No attributed current execution cohort is available."], asOf: null }),
  cohortStart: COHORT_START,
  truncated: false,
  error: "",
  asOf: null,
  basis: "native virtual paths since Day 1",
};

const message = (error: unknown): string =>
  error && typeof error === "object" && "message" in error
    ? String((error as { message?: unknown }).message ?? "read rejected")
    : String(error ?? "read rejected");

/**
 * Page-owned and caller-gated. Reads start at the prospective Day 1 cohort, use
 * stable bounded pagination, and surface truncation instead of silently
 * presenting a partial cumulative result as complete. The workstation keeps
 * this bounded ledger warm so selected-channel diagnostics never depend on the
 * operator visiting Research first.
 */
export function useShadowResearch(enabled: boolean, configuredPaperAccountIds: readonly string[]): ShadowResearch {
  const [state, setState] = useState<ShadowResearch>(EMPTY);
  const configuredKey = [...configuredPaperAccountIds].sort().join(",");

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const poll = async () => {
      setState((previous) => ({ ...previous, state: previous.asOf ? previous.state : "loading", error: "" }));
      try {
        const rawRows: Record<string, unknown>[] = [];
        let total = 0;
        for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
          const result = await getSupabase().from("virtual_trades")
            .select("signal_id,slug,blocked,exit_reason,pnl_per_contract,signal_at,exit_at,occ,entry_px,mfe_pct,giveback_pct", { count: "exact" })
            .gte("signal_at", COHORT_START_ISO)
            .order("signal_at", { ascending: true })
            .order("signal_id", { ascending: true })
            .range(offset, Math.min(offset + PAGE_SIZE - 1, MAX_ROWS - 1));
          if (result.error) throw result.error;
          const page = (result.data ?? []) as Record<string, unknown>[];
          rawRows.push(...page);
          total = result.count ?? rawRows.length;
          if (page.length < PAGE_SIZE || rawRows.length >= total) break;
        }
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
        } satisfies ShadowResearchRow));
        const sessions = deriveShadowSessions(rows);
        const cumulative = deriveShadowCumulative(rows);
        const dryPowderBySlug = deriveChannelDryPowderCurves(rows);
        const dryPowderBySession = deriveSessionDryPowderCurves(rows);
        const virtualBySignal = new Map(rows.map((row) => [row.signalId ?? "", row]));
        const retuneSignals: Array<{
          id: string;
          strategist_id: string;
          created_at: string;
          rationale: Record<string, unknown> | null;
        }> = [];
        const retuneStrategistIds = PRIORITY_A_BOUNDED_RETUNES.map((row) => row.strategistId);
        for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
          const signalRead = await getSupabase().from("signals")
            .select("id,strategist_id,created_at,rationale")
            .in("strategist_id", retuneStrategistIds)
            .gte("created_at", `${PRIORITY_A_RETUNE_COHORT_START}T04:00:00.000Z`)
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1);
          if (signalRead.error) throw signalRead.error;
          const page = (signalRead.data ?? []) as typeof retuneSignals;
          retuneSignals.push(...page);
          if (page.length < PAGE_SIZE) break;
          if (offset + PAGE_SIZE >= MAX_ROWS) throw new Error("bounded-retune signal read reached its safety cap");
        }
        const retuneDefinitionByStrategist = new Map(PRIORITY_A_BOUNDED_RETUNES
          .map((definition) => [definition.strategistId, definition]));
        const retuneOpportunities = retuneSignals.flatMap((signal): AtlasOpportunity[] => {
          const definition = retuneDefinitionByStrategist.get(signal.strategist_id);
          if (!definition) return [];
          const virtual = virtualBySignal.get(signal.id);
          const entryPrice = virtual?.entryPrice ?? null;
          const result = virtual?.pnlPerContract ?? null;
          const rationale = signal.rationale && typeof signal.rationale === "object" ? signal.rationale : {};
          const configurationEpochId = typeof rationale.configuration_epoch_id === "string"
            ? rationale.configuration_epoch_id : null;
          return [{
            logicalOpportunityId: `signal:${signal.id}`,
            id: `prospective_virtual:${signal.id}`,
            channel: definition.channel,
            session: shadowSessionDate(signal.created_at),
            signalAt: signal.created_at,
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
            boundedRetuneStamp: parseBoundedRetuneSignalStamp(rationale.bounded_retune_experiment),
            sourceRefs: [`signals:${signal.id}`, ...(virtual ? [`virtual_trades:${signal.id}`] : [])],
          }];
        });
        const boundedRetunes = buildBoundedRetuneBook({
          generatedAt: new Date().toISOString(),
          throughSession: cumulative?.throughSession ?? PRIORITY_A_RETUNE_COHORT_START,
          opportunities: retuneOpportunities,
        });
        let currentExecutedBySlug: Record<string, CurrentExecutedSummary> = {};
        let pairedCurrent: PairedCurrentComparison[] = [];
        let currentExecutedState: ShadowResearch["currentExecutedState"] = "empty";
        let currentExecutedError = "";
        let currentExecutedTruncated = false;
        try {
          const executedRead = await getSupabase().from("positions")
            .select("id,qty,realized_pnl,opened_at,closed_at,runner_of,configuration_epoch_id,strategists(slug)", { count: "exact" })
            .eq("status", "closed")
            .gte("opened_at", COHORT_START_ISO)
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
          dryPowderBySlug,
          dryPowderBySession,
          currentExecutedBySlug,
          pairedCurrent,
          currentExecutedState,
          currentExecutedError,
          currentExecutedTruncated,
          boundedRetunes,
          virtualEvidence: evidenceEnvelope({ layer: "historical_virtual", unit: "opportunity",
            fromSession: cumulative?.fromSession ?? null, throughSession: cumulative?.throughSession ?? null,
            configurationEpochId: null, managerVersion: null,
            scope: { kind: "portfolio", accountIds: [], channelSlugs: [...new Set(rows.map((row) => row.slug))] },
            completeness: total > MAX_ROWS ? "partial" : sessions.length ? "complete" : "unavailable",
            reconciliation: "unverified", source: "virtual_trades", receiptHash: null,
            limitations: ["Virtual rows do not yet carry configuration epoch provenance.", ...(total > MAX_ROWS ? ["Read reached its bounded row cap."] : [])], asOf }),
          currentExecutedEvidence: evidenceEnvelope({ layer: "current_executed", unit: "logical_trade",
            fromSession: currentSessions[0] ?? null, throughSession: currentSessions.at(-1) ?? null,
            configurationEpochId: null, managerVersion: null,
            scope: { kind: "portfolio", accountIds: [...new Set(Object.values(currentExecutedBySlug).flatMap((summary) => summary.accountIds))], channelSlugs: Object.keys(currentExecutedBySlug) },
            completeness: currentExecutedState === "error" ? "unavailable" : currentExecutedTruncated ? "partial" : currentExecutedState === "ok" ? "complete" : "unavailable",
            reconciliation: currentExecutedState === "ok" ? "reconciled" : "blocked",
            source: "positions lineage + immutable execution route · latest channel configuration epoch", receiptHash: null,
            limitations: ["Configuration epochs are selected independently per channel.", ...(currentExecutedTruncated ? ["Read reached its bounded row cap."] : [])], asOf }),
          cohortStart: COHORT_START,
          truncated: total > MAX_ROWS,
          error: "",
          asOf,
          basis: "native virtual paths since Day 1",
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
      }
    };
    void poll();
    const stop = startVisibilityPoll(() => void poll(), 10 * 60_000);
    return () => { alive = false; stop(); };
  }, [configuredKey, enabled]);

  return state;
}
