"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import type { ChannelDecisionBrief } from "@/lib/research/channelDecisionBrief";
import {
  decisionAtlasFreshness,
  type DecisionAtlasFreshness,
  etSessionDate,
} from "@/lib/research/decisionAtlasFreshness";
import { useRefreshTick } from "./useRefreshTick";
import { browserPublicationHash, verifyAtlasPublication, type AtlasPublicationVerification } from "@/lib/research/atlasPublication";

export interface DecisionAtlasReportsRead {
  throughSession: string | null;
  evidenceThroughSession: string | null;
  freshness: DecisionAtlasFreshness;
  bySlug: Record<string, ChannelDecisionBrief>;
  state: "idle" | "loading" | "ready" | "unavailable" | "error";
  error: string | null;
  publication?: AtlasPublicationVerification;
}

export function useDecisionAtlasReports(enabled = true): DecisionAtlasReportsRead {
  const [read, setRead] = useState<DecisionAtlasReportsRead>({ throughSession: null, evidenceThroughSession: null, freshness: "unknown", bySlug: {}, state: enabled ? "loading" : "idle", error: null });
  const tick = useRefreshTick();
  useEffect(() => {
    if (!enabled) {
      setRead({ throughSession: null, evidenceThroughSession: null, freshness: "unknown", bySlug: {}, state: "idle", error: null });
      return;
    }
    let alive = true;
    (async () => {
      setRead((prior) => ({ ...prior, state: prior.throughSession ? "ready" : "loading", error: null }));
      const sb = getSupabase();
      const [latest, latestEvidence] = await Promise.all([
        sb.from("decision_atlas_channel_reports")
          .select("through_session").order("through_session", { ascending: false }).limit(1).maybeSingle(),
        sb.from("virtual_trades")
          .select("signal_at").order("signal_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (!alive) return;
      const missingTable = latest.error && (latest.error.code === "42P01" || latest.error.code === "PGRST205"
        || /decision_atlas_channel_reports/.test(latest.error.message ?? ""));
      if (missingTable) {
        setRead({ throughSession: null, evidenceThroughSession: null, freshness: "unknown", bySlug: {}, state: "unavailable", error: null });
        return;
      }
      if (latest.error) throw latest.error;
      const evidenceThroughSession = latestEvidence.error
        ? null
        : etSessionDate(latestEvidence.data?.signal_at ? String(latestEvidence.data.signal_at) : null);
      const throughSession = latest.data?.through_session ? String(latest.data.through_session) : null;
      if (!throughSession) {
        setRead({ throughSession: null, evidenceThroughSession, freshness: "unknown", bySlug: {}, state: "unavailable", error: null });
        return;
      }
      const reports = await sb.from("decision_atlas_channel_reports")
        .select("channel_slug,brief,brief_sha256", { count: "exact" }).eq("through_session", throughSession).order("channel_slug").limit(500);
      if (!alive) return;
      if (reports.error) throw reports.error;
      if (reports.count == null || reports.count !== (reports.data ?? []).length) throw new Error("Atlas publication read is incomplete");
      const publication = await verifyAtlasPublication(reports.data ?? [], throughSession, browserPublicationHash);
      if (!alive) return;
      const bySlug = Object.fromEntries((reports.data ?? []).map((row) => [
        String(row.channel_slug), row.brief as ChannelDecisionBrief,
      ]));
      setRead({ throughSession, evidenceThroughSession, freshness: decisionAtlasFreshness(throughSession, evidenceThroughSession), bySlug, state: "ready", error: null, publication });
    })().catch((error) => {
      if (alive) setRead({ throughSession: null, evidenceThroughSession: null, freshness: "unknown", bySlug: {}, state: "error", error: (error as Error)?.message ?? "Atlas brief read failed" });
    });
    return () => { alive = false; };
  }, [enabled, tick]);
  return read;
}
