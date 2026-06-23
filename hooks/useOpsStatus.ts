"use client";

// Pre-flight ops status — the "is the machine healthy?" read the operator
// otherwise assembles by hand each morning:
//   · STREAM executor liveness  (worker_heartbeat 'stream' — Phase B dead-man)
//   · CRON liveness             (latest fund-level equity snapshot age — the
//                                cron writes one per run during RTH)
//   · executor split            (how many armed channels each engine owns)
// 15s anon-read poll; all three sources have anon SELECT policies.

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";

export interface OpsStatus {
  loaded: boolean;
  /** seconds since the stream worker's last heartbeat; null = no beat ever */
  hbAgeSec: number | null;
  hbNote: string | null;
  /** seconds since the cron's last fund equity snapshot; null = none found */
  cronAgeSec: number | null;
  /** ARMED channels by executor */
  streamArmed: number;
  cronArmed: number;
}

const INITIAL: OpsStatus = { loaded: false, hbAgeSec: null, hbNote: null, cronAgeSec: null, streamArmed: 0, cronArmed: 0 };

export function useOpsStatus(): OpsStatus {
  const [s, setS] = useState<OpsStatus>(INITIAL);

  useEffect(() => {
    const sb = getSupabase();
    let alive = true;

    async function poll() {
      try {
        const [hb, snap, strat] = await Promise.all([
          sb.from("worker_heartbeat").select("beat_at,note").eq("id", "stream").maybeSingle(),
          sb.from("equity_snapshots").select("captured_at").is("strategist_id", null).is("account_id", null) // desk-TOTAL only (cockpit P3)
            .order("captured_at", { ascending: false }).limit(1).maybeSingle(),
          sb.from("strategists").select("executor,status"),
        ]);
        if (!alive) return;
        const beatAt = (hb.data as { beat_at?: string } | null)?.beat_at;
        const snapAt = (snap.data as { captured_at?: string } | null)?.captured_at;
        let streamArmed = 0, cronArmed = 0;
        for (const r of (strat.data ?? []) as Array<{ executor?: string; status?: string }>) {
          if ((r.status ?? "armed") !== "armed") continue;
          if (r.executor === "stream") streamArmed++; else cronArmed++;
        }
        setS({
          loaded: true,
          hbAgeSec: beatAt ? Math.max(0, Math.round((Date.now() - Date.parse(beatAt)) / 1000)) : null,
          hbNote: (hb.data as { note?: string } | null)?.note ?? null,
          cronAgeSec: snapAt ? Math.max(0, Math.round((Date.now() - Date.parse(snapAt)) / 1000)) : null,
          streamArmed,
          cronArmed,
        });
      } catch { /* keep the last reading */ }
    }

    poll();
    const id = setInterval(poll, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return s;
}
