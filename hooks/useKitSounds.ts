"use client";

// useKitSounds — plays the 909 KIT on LIVE fills (909-redesign slice 1).
// Diffs the polled desk feed (open positions + today's closed trades) and
// voices each NEW row: entry = kick, exit voiced by close_reason/sign
// (lib/desk/kit.voiceForClose). Guards against false alarms:
//   · the first snapshot is hydration, not fills — silent
//   · the first 15s after mount stay silent (feeds hydrate in stages)
//   · a bulk jump (>4 new rows at once) reads as backfill/reconnect — silent
// playKit itself no-ops while the KIT pad is off, so this hook is inert until
// the operator opts in. Alert-only; never touches the trade path.

import { useEffect, useRef } from "react";
import { playKit, voiceForClose } from "@/lib/desk/kit";
import type { Position } from "@/lib/desk/types";

const BULK_LIMIT = 4;
const WARMUP_MS = 15_000;

export function useKitSounds(positions: Position[], recentTrades: Position[]): void {
  const seen = useRef<{ open: Set<string>; closed: Set<string> } | null>(null);
  const mountedAt = useRef<number>(Date.now());

  useEffect(() => {
    const open = new Set(positions.map((p) => p.id));
    const closed = new Set(recentTrades.map((t) => t.id));
    const prev = seen.current;
    seen.current = { open, closed };
    if (!prev) return; // first snapshot = hydration
    if (Date.now() - mountedAt.current < WARMUP_MS) return;

    const newOpens = positions.filter((p) => !prev.open.has(p.id));
    const newCloses = recentTrades.filter((t) => !prev.closed.has(t.id));
    const n = newOpens.length + newCloses.length;
    if (n === 0 || n > BULK_LIMIT) return;

    let delay = 0;
    for (let i = 0; i < newOpens.length; i++) {
      window.setTimeout(() => playKit("kick"), delay);
      delay += 120;
    }
    for (const t of newCloses) {
      const v = voiceForClose(t.close_reason, t.realized_pnl ?? 0);
      window.setTimeout(() => playKit(v), delay);
      delay += 120;
    }
  }, [positions, recentTrades]);
}
