"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";

export interface ExecutableShadowSummary {
  slug: string;
  posture: "OBSERVING";
  evidenceLayer: "EXECUTABLE SHADOW";
  sessions: number;
  opportunities: number;
  scored: number;
  censored: number;
  blocked: number;
  primaryManager: string;
  arms: Array<{ manager: string; wrapper: string; sessions: number; scored: number; averagePerContractUsd: number | null }>;
  nextGate: string;
  registeredAt: string;
}
export function useExecutableShadowSummary(slug: string | null, enabled = true) {
  const { session, operator } = useAuth();
  const [summary, setSummary] = useState<ExecutableShadowSummary | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  useEffect(() => {
    if (!slug || !enabled || !session || !operator) { setSummary(null); setState("idle"); return; }
    let alive = true;
    setState("loading");
    fetch(`/api/executable-shadow-summary?slug=${encodeURIComponent(slug)}`, {
      headers: { authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    }).then(async (response) => {
      const body = await response.json().catch(() => ({})) as { ok?: boolean; summary?: ExecutableShadowSummary | null };
      if (!response.ok || !body.ok) throw new Error("executable-shadow summary unavailable");
      if (alive) { setSummary(body.summary ?? null); setState("ok"); }
    }).catch(() => { if (alive) { setSummary(null); setState("error"); } });
    return () => { alive = false; };
  }, [enabled, operator, session, slug]);
  return { summary, state };
}
