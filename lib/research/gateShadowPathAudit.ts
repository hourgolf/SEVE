// Independent audit of the legacy minute-mid shadow contract. This is NOT a
// native manager replay or an executable-fill simulation.
export interface GateShadowAuditQuote {
  id: string;
  occ_symbol: string;
  ask: number | string | null;
  mid: number | string | null;
  captured_at: string;
}

export function auditGateShadowPath(input: {
  occ: string; signalAt: string; decisionAsk: number;
  targetPct: number; stopPct: number; sessionClose: string;
  quotes: readonly GateShadowAuditQuote[];
}) {
  const from = Date.parse(input.signalAt), end = Date.parse(input.sessionClose);
  const ordered = input.quotes.filter((q) => q.occ_symbol === input.occ
    && Date.parse(q.captured_at) >= from && Date.parse(q.captured_at) < end)
    .sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at) || a.id.localeCompare(b.id));
  const first = ordered.find((q) => Date.parse(q.captured_at) <= from + 180_000);
  const entryPx = input.decisionAsk > 0 ? input.decisionAsk : Number(first?.ask ?? first?.mid ?? 0);
  const path = ordered.filter((q) => Number(q.mid) > 0);
  if (!(entryPx > 0) || !path.length) throw new Error("quote audit lacks an entry or positive-mid path");
  const target = input.targetPct > 0 ? entryPx * (1 + input.targetPct / 100) : Infinity;
  const stop = entryPx * (1 - input.stopPct / 100);
  let peak = -Infinity;
  let exitPrice = Number(path.at(-1)!.mid), exitAt = path.at(-1)!.captured_at;
  let exitReason = "would_flatten";
  for (const q of path) {
    const mid = Number(q.mid);
    peak = Math.max(peak, mid);
    if (mid >= target) { exitPrice = target; exitAt = q.captured_at; exitReason = "would_target"; break; }
    if (mid <= stop) { exitPrice = stop; exitAt = q.captured_at; exitReason = "would_stop"; break; }
  }
  const mfePct = Math.round((peak / entryPx - 1) * 1_000) / 10;
  const realizedPct = (exitPrice / entryPx - 1) * 100;
  return { entryPx, exitReason, exitPx: Math.round(exitPrice * 100) / 100,
    exitAt: new Date(exitAt).toISOString(), pnlPerContract: Math.round((exitPrice - entryPx) * 10_000) / 100,
    nQuotes: path.length, mfePct,
    givebackPct: mfePct > 0.01 ? Math.round((mfePct - realizedPct) / mfePct * 100) : null };
}
