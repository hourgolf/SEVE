"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { deriveStudioEvidence, type StudioEvidenceSnapshot } from "@/lib/studio/deriveStudioEvidence";
import { startVisibilityPoll } from "@/lib/pollControl";
import {
  attributePositionsByImmutableExecutionAccount,
  type ExecutionAccountObservation,
} from "@/lib/ops/brokerReconciliation";

export interface StudioEvidence extends StudioEvidenceSnapshot {
  loading: boolean;
  error: boolean;
  asOf: string | null;
  basis: "gross desk attribution";
}

const EMPTY: StudioEvidence = {
  bySlug: {}, sessionDates: [], totalTrades: 0,
  loading: false, error: false, asOf: null, basis: "gross desk attribution",
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
        const rows: Array<{ id: string; qty: number; realized_pnl: number; closed_at: string; strategists: { slug?: string } | null }> = [];
        for (let from = 0; from < 10_000; from += 1000) {
          const res = await sb.from("positions")
            .select("id,qty,realized_pnl,closed_at,strategists!inner(slug)")
            .eq("status", "closed")
            .gte("closed_at", since)
            .order("closed_at", { ascending: true })
            .range(from, from + 999);
          if (res.error) throw res.error;
          const page = (res.data ?? []) as unknown as typeof rows;
          rows.push(...page);
          if (page.length < 1000) break;
        }
        const observations: ExecutionAccountObservation[] = [];
        for (let from = 0; from < rows.length; from += 200) {
          const routeRead = await sb.from("execution_observations")
            .select("id,position_id,account_id,event_at")
            .in("position_id", rows.slice(from, from + 200).map((row) => row.id));
          if (routeRead.error) throw routeRead.error;
          observations.push(...((routeRead.data ?? []) as ExecutionAccountObservation[]));
        }
        const attribution = attributePositionsByImmutableExecutionAccount({
          positions: rows,
          observations,
          configuredPaperAccountIds: configuredAccounts,
          positionLabel: "studio evidence positions",
        });
        if (!attribution.ok) throw new Error(attribution.issues.join("; "));
        const accountRows = (attribution.byAccount.get(acctId) ?? []) as typeof rows;
        if (!alive) return;
        const snapshot = deriveStudioEvidence(accountRows.map((row) => ({
          slug: row.strategists?.slug ?? "unknown",
          qty: Number(row.qty),
          pnl: Number(row.realized_pnl ?? 0),
          closedAt: row.closed_at,
        })));
        setState({ ...snapshot, loading: false, error: false, asOf: new Date().toISOString(), basis: "gross desk attribution" });
      } catch {
        if (alive) setState((prior) => ({ ...prior, loading: false, error: true }));
      }
    };
    poll();
    const stop = startVisibilityPoll(poll, 300_000);
    return () => { alive = false; stop(); };
  }, [acctId, configuredKey, enabled]);

  return state;
}
