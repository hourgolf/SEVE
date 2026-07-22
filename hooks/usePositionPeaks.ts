"use client";

// Peak option mark for each open position. The durable peak is already stamped
// onto positions.peak_mark by the worker, while liveMarks supplies the fast
// between-ingest mark. Ratchet both in memory so the operator never sees a peak
// move backwards during the lifetime of an open position.
//
// This intentionally performs ZERO remote reads. The former implementation
// queried option_quotes once per open contract every 15 seconds, ordering the
// full since-entry history by mid. That duplicated worker evidence and created
// avoidable Postgres I/O exactly when the desk was busiest.

import { useRef } from "react";
import type { Position } from "@/lib/desk/types";

export function derivePositionPeaks(
  positions: Position[],
  liveMarks: Record<string, number> = {},
  seen: Record<string, number> = {},
): Record<string, number> {
  const open = positions.filter((position) => position.status === "open");
  const occs = new Set(open.map((position) => position.occ_symbol));
  for (const occ of Object.keys(seen)) if (!occs.has(occ)) delete seen[occ];

  const peaks: Record<string, number> = {};
  for (const position of open) {
    const occ = position.occ_symbol;
    const durable = Number(position.peak_mark ?? 0);
    const live = Number(liveMarks[occ] ?? 0);
    const peak = Math.max(seen[occ] ?? 0, durable, live);
    if (Number.isFinite(peak) && peak > 0) {
      seen[occ] = peak;
      peaks[occ] = peak;
    }
  }
  return peaks;
}

export function usePositionPeaks(
  positions: Position[],
  liveMarks: Record<string, number> = {},
): Record<string, number> {
  const seenRef = useRef<Record<string, number>>({});
  return derivePositionPeaks(positions, liveMarks, seenRef.current);
}
