"use client";

import { useEffect, useMemo, useReducer, type ReactNode } from "react";
import {
  DeskDispatchContext,
  DeskStateContext,
  deskReducer,
  type DeskView,
} from "@/hooks/useDeskState";
import { seedDesk } from "@/lib/desk/seed";
import { loadDeskConfig } from "@/lib/desk/load";

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
