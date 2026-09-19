"use client";

import { readHistoricalAttribution } from '@/lib/reporting/readHistoricalAttribution';
import { historicalTradeForRows, selectHistorical, historicalCoverageText, closeSession } from '@/supabase/functions/_shared/historicalAttribution';
import { summarizeLogicalTradeCohort } from '@/lib/positions/logicalTradeCohort';
import { readWindowedPositions, readWindowedExecutionRoutes } from '@/lib/perform/windowedEvidenceRead';
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { deriveStudioEvidence, type StudioEvidenceSnapshot } from "@/lib/studio/deriveStudioEvidence";
import { startVisibilityPoll } from "@/lib/pollControl";
import { evidenceEnvelope, type EvidenceEnvelope } from "@/lib/evidence/evidenceEnvelope";
import {
  attributePositionsByImmutableExecutionAccount,
} from "@/lib/ops/brokerReconciliation";

export interface StudioEvidence extends StudioEvidenceSnapshot {
  loading: boolean;
  error: boolean;
  asOf: string | null;
  basis: "gross desk attribution";
  evidence: EvidenceEnvelope;
}

const EMPTY: StudioEvidence = {
  bySlug: {}, sessionDates: [], totalTrades: 0,
  loading: false, error: false, asOf: null, basis: "gross desk attribution",
  evidence: evidenceEnvelope({ layer: "historical_executed", unit: "logical_trade", fromSession: null, throughSession: null,
    configurationEpochId: null, managerVersion: null, scope: { kind: "account", accountIds: [], channelSlugs: [] },
    completeness: "unavailable", reconciliation: "blocked", source: "positions + immutable execution route", receiptHash: null,
    limitations: ["No selected account cohort is available."], asOf: null }),
};

/** Page-seam read for STUDIO only. Leaves consume the snapshot and never subscribe. */
export function useStudioEvidence(
  acctId: string | null,
  enabled: boolean,
  configuredPaperAccountIds: readonly string[] = [],
): StudioEvidence {
  const [state, setState] = useState<StudioEvidence>(EMPTY);
  const configuredKey = [...configuredPaperAccountIds].sort().join(",");

  useEffect(() => {
    if (!enabled || !acctId) { setState(EMPTY); return; }
    let alive = true;
    // Never carry one account's evidence across an account-scope change while
    // the next read is in flight.
    setState({ ...EMPTY, loading: true });
    const poll = async () => {
      setState((prior) => ({ ...prior, loading: prior.asOf == null, error: false }));
      try {
        const sb = getSupabase();
        const configuredAccounts = new Set(configuredKey.split(",").filter(Boolean));
        if (!configuredAccounts.size || !configuredAccounts.has(acctId)) {
          throw new Error("selected account is not a configured paper account");
        }
        const since = new Date(Date.now() - 12 * 86_400_000).toISOString();
        const rows = await readWindowedPositions(sb, since, new Date().toISOString());
        const [observations, historical] = await Promise.all([readWindowedExecutionRoutes(sb, rows),readHistoricalAttribution()]);
        const attribution = attributePositionsByImmutableExecutionAccount({
          positions: rows,
          observations,
          configuredPaperAccountIds: configuredAccounts,
          positionLabel: "studio evidence positions",
        });
        const route = new Map([...attribution.byAccount].flatMap(([id,rs])=>rs.map(r=>[r.id,id] as const)));
        const cohort = summarizeLogicalTradeCohort(rows);
        if(cohort.issues.length)throw Error(cohort.issues.join('; '));
        const selection=selectHistorical(historical,{from:closeSession(since),accountId:acctId});
        const logicalRows=cohort.groups.flatMap(t=>{
          if(t.status!=='closed')return [];
          const h=historicalTradeForRows(historical,t.rows);
          const accounts=new Set(t.rows.map(r=>route.get(r.id)??h?.brokerAccountId));
          const close=t.rows.map(r=>r.closed_at??'').sort().at(-1)??'';
          if(accounts.size!==1||!accounts.has(acctId)||close<since)return [];
          const pnl=h?h.reconstructedGross:t.realizedPnl;
          if(pnl==null)return [];
          return [{id:t.rootPositionId,slug:h?.slug??t.rows[0].strategists?.slug??'unknown',qty:t.rows.reduce((s,r)=>s+Math.abs(Number(r.qty)),0),pnl,closedAt:close,runnerOf:null}];
        });
        if (!alive) return;
        const snapshot = deriveStudioEvidence(logicalRows);
        const asOf = new Date().toISOString();
        setState({ ...snapshot, loading: false, error: false, asOf, basis: "gross desk attribution",
          evidence: evidenceEnvelope({ layer: "historical_executed", unit: "logical_trade",
            fromSession: snapshot.sessionDates[0] ?? null, throughSession: snapshot.sessionDates.at(-1) ?? null,
            configurationEpochId: null, managerVersion: null,
            scope: { kind: "account", accountIds: [acctId], channelSlugs: Object.keys(snapshot.bySlug) },
            completeness: selection.unresolvedTrades || selection.unknownAccountTrades ? "partial" : snapshot.totalTrades ? "complete" : "unavailable", reconciliation: "reconciled",
            source: "positions + immutable execution route", receiptHash: null,
            limitations: ["Historical configurations are pooled in this Studio summary.", historicalCoverageText(selection), ...selection.issues], asOf }) });
      } catch {
        if (alive) setState((prior) => ({ ...prior, loading: false, error: true,
          evidence: evidenceEnvelope({ ...prior.evidence, completeness: prior.asOf ? "stale" : "unavailable" }) }));
      }
    };
    poll();
    const stop = startVisibilityPoll(poll, 300_000);
    return () => { alive = false; stop(); };
  }, [acctId, configuredKey, enabled]);

  return state;
}
