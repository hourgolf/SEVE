"use client";

import { useEffect, useMemo, useReducer, type ReactNode } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  DeskDispatchContext,
  DeskStateContext,
  deskReducer,
  type DeskView,
} from "@/hooks/useDeskState";
import { seedDesk } from "@/lib/desk/seed";
import { loadDeskConfig } from "@/lib/desk/load";
import { getSupabase } from "@/lib/supabaseClient";

// Splits state and dispatch into two contexts: dispatch identity is stable, so
// components that only dispatch never re-render on state changes. Combined with
// React.memo'd ChannelStrips, knob drags stay smooth.
export function DeskProvider({ children }: { children: ReactNode }) {
  const [desk, dispatch] = useReducer(deskReducer, undefined, seedDesk);

  // One-time hydrate from real DB config; silent fallback to the seed if the
  // read fails (e.g. RLS not applied yet). Not polled, so local knob turns
  // aren't clobbered before the writes phase.
  useEffect(() => {
    let cancelled = false;
    loadDeskConfig().then((state) => {
      if (!cancelled && state) dispatch({ type: "HYDRATE", state });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // CROSS-DEVICE SYNC: the desk config (mute/solo/kill/status/knobs) is GLOBAL in the
  // DB, but each client hydrated once on mount — so a mute on the phone didn't show on
  // desktop until a reload. Subscribe to realtime changes on the config tables and
  // re-hydrate (debounced) so every signed-in surface reflects the same state live.
  // Idempotent: re-reads DB truth, so applying your own echo is a no-op. (Requires the
  // 3 config tables in the realtime publication — see 06_realtime.sql.)
  useEffect(() => {
    let cancelled = false;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const rehydrate = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        loadDeskConfig().then((state) => {
          if (!cancelled && state) dispatch({ type: "HYDRATE", state });
        });
      }, 300);
    };
    let channel: RealtimeChannel | null = null;
    try {
      const sb = getSupabase();
      channel = sb
        .channel("desk-config")
        .on("postgres_changes", { event: "*", schema: "public", table: "strategist_config" }, rehydrate)
        .on("postgres_changes", { event: "*", schema: "public", table: "strategists" }, rehydrate)
        .on("postgres_changes", { event: "*", schema: "public", table: "fund_state" }, rehydrate)
        .subscribe();
    } catch {
      /* env missing — no live cross-device sync (writes still persist; a reload picks them up) */
    }
    return () => {
      cancelled = true;
      if (debounce) clearTimeout(debounce);
      if (channel) {
        try {
          getSupabase().removeChannel(channel);
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  const view = useMemo<DeskView>(() => {
    const anySolo = desk.strategists.some((s) => s.config.soloed);
    const isActive = (slug: string) => {
      const s = desk.strategists.find((x) => x.slug === slug);
      if (!s) return false;
      return (
        !s.config.muted &&
        (!anySolo || s.config.soloed) &&
        !desk.fund.is_halted &&
        desk.fund.running
      );
    };
    return { desk, anySolo, isActive };
  }, [desk]);

  return (
    <DeskStateContext.Provider value={view}>
      <DeskDispatchContext.Provider value={dispatch}>
        {children}
      </DeskDispatchContext.Provider>
    </DeskStateContext.Provider>
  );
}
