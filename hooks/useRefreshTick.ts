"use client";

import { useEffect, useState } from "react";

// Shared freshness tick for the §03 once-a-run artifact panels (daily/weekly autopsy,
// Shadow & Override, LAB bench). They used to fetch ONCE on mount — a long-lived tab
// showed load-time data forever, which read as "the panels don't update at day's end"
// (the artifacts actually land ~16:05–16:25 ET; the tab just never re-asked). The tick
// bumps on visibility-regain (min 60s apart) and on a slow poll while visible — tiny
// reads on a 10-min cadence, consistent with the per-concern poll cadences +
// visibility-pause doctrine from the egress fix. Consumers add the tick to their
// fetch-effect deps; loading state stays settled so refreshes are silent (no flash).
export function useRefreshTick(intervalMs = 10 * 60_000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let last = Date.now();
    const bump = () => { last = Date.now(); setTick((t) => t + 1); };
    const onVis = () => { if (document.visibilityState === "visible" && Date.now() - last > 60_000) bump(); };
    const id = setInterval(() => { if (document.visibilityState === "visible") bump(); }, intervalMs);
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [intervalMs]);
  return tick;
}
