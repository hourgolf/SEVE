"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import type { ChannelDecisionBrief } from "@/lib/research/channelDecisionBrief";
import { useRefreshTick } from "./useRefreshTick";

export interface DecisionAtlasReportsRead {
  throughSession: string | null;
  bySlug: Record<string, ChannelDecisionBrief>;
  state: "idle" | "loading" | "ready" | "unavailable" | "error";
  error: string | null;
}

export function useDecisionAtlasReports(enabled = true): DecisionAtlasReportsRead {
  const [read, setRead] = useState<DecisionAtlasReportsRead>({ throughSession: null, bySlug: {}, state: enabled ? "loading" : "idle", error: null });
  const tick = useRefreshTick();
  useEffect(() => {
    if (!enabled) {
      setRead({ throughSession: null, bySlug: {}, state: "idle", error: null });
      return;
    }
    let alive = true;
    (async () => {
      setRead((prior) => ({ ...prior, state: prior.throughSession ? "ready" : "loading", error: null }));
      const sb = getSupabase();
      const latest = await sb.from("decision_atlas_channel_reports")
        .select("through_session").order("through_session", { ascending: false }).limit(1).maybeSingle();
      if (!alive) return;
      const missingTable = latest.error && (latest.error.code === "42P01" || latest.error.code === "PGRST205"
        || /decision_atlas_channel_reports/.test(latest.error.message ?? ""));
      if (missingTable) {
        setRead({ throughSession: null, bySlug: {}, state: "unavailable", error: null });
        return;
      }
      if (latest.error) throw latest.error;
      const throughSession = latest.data?.through_session ? String(latest.data.through_session) : null;
      if (!throughSession) {
        setRead({ throughSession: null, bySlug: {}, state: "unavailable", error: null });
        return;
      }
      const reports = await sb.from("decision_atlas_channel_reports")
        .select("channel_slug,brief").eq("through_session", throughSession).order("channel_slug").limit(500);
      if (!alive) return;
      if (reports.error) throw reports.error;
      const bySlug = Object.fromEntries((reports.data ?? []).map((row) => [
        String(row.channel_slug), row.brief as ChannelDecisionBrief,
      ]));
      setRead({ throughSession, bySlug, state: "ready", error: null });
    })().catch((error) => {
      if (alive) setRead({ throughSession: null, bySlug: {}, state: "error", error: (error as Error)?.message ?? "Atlas brief read failed" });
    });
    return () => { alive = false; };
  }, [enabled, tick]);
  return read;
}
