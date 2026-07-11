export interface StudioEvidencePosition {
  slug: string;
  qty: number;
  pnl: number;
  closedAt: string;
}

export type EvidenceConfidence = "none" | "thin" | "early" | "building";

export interface StudioChannelEvidence {
  trades: number;
  sessions: number;
  pnl: number;
  grossPerTrade: number;
  grossPerContract: number;
  winPct: number;
  profitFactor: number | null;
  maxDrawdown: number;
  bestSession: number;
  worstSession: number;
  bestSessionSharePct: number | null;
  confidence: EvidenceConfidence;
}

export interface StudioEvidenceSnapshot {
  bySlug: Record<string, StudioChannelEvidence>;
  sessionDates: string[];
  totalTrades: number;
}

const etDate = (iso: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(iso));
const round1 = (value: number): number => Math.round(value * 10) / 10;

export function deriveStudioEvidence(rows: StudioEvidencePosition[], maxSessions = 5): StudioEvidenceSnapshot {
  const allDates = [...new Set(rows.map((row) => etDate(row.closedAt)))].sort();
  const sessionDates = allDates.slice(-maxSessions);
  const allowed = new Set(sessionDates);
  const scoped = rows.filter((row) => allowed.has(etDate(row.closedAt)));
  const grouped = new Map<string, StudioEvidencePosition[]>();
  for (const row of scoped) {
    const list = grouped.get(row.slug) ?? [];
    list.push(row);
    grouped.set(row.slug, list);
  }

  const bySlug: Record<string, StudioChannelEvidence> = {};
  for (const [slug, trades] of grouped) {
    const dayMap = new Map<string, number>();
    let pnl = 0;
    let wins = 0;
    let winUsd = 0;
    let lossUsd = 0;
    let contracts = 0;
    let equity = 0;
    let high = 0;
    let maxDrawdown = 0;
    for (const trade of trades) {
      pnl += trade.pnl;
      if (trade.pnl > 0) { wins += 1; winUsd += trade.pnl; }
      if (trade.pnl < 0) lossUsd += Math.abs(trade.pnl);
      contracts += Math.max(1, Math.abs(trade.qty));
      equity += trade.pnl;
      high = Math.max(high, equity);
      maxDrawdown = Math.max(maxDrawdown, high - equity);
      const date = etDate(trade.closedAt);
      dayMap.set(date, (dayMap.get(date) ?? 0) + trade.pnl);
    }
    const days = [...dayMap.values()];
    const bestSession = Math.max(...days);
    const sessions = days.length;
    const confidence: EvidenceConfidence = sessions === 0 ? "none" : sessions === 1 ? "thin" : sessions < 5 ? "early" : "building";
    bySlug[slug] = {
      trades: trades.length,
      sessions,
      pnl: round1(pnl),
      grossPerTrade: round1(pnl / trades.length),
      grossPerContract: round1(pnl / contracts),
      winPct: round1((wins / trades.length) * 100),
      profitFactor: lossUsd > 0 ? round1(winUsd / lossUsd) : winUsd > 0 ? null : 0,
      maxDrawdown: round1(maxDrawdown),
      bestSession: round1(bestSession),
      worstSession: round1(Math.min(...days)),
      bestSessionSharePct: winUsd > 0 ? round1((Math.max(0, bestSession) / winUsd) * 100) : null,
      confidence,
    };
  }

  return { bySlug, sessionDates, totalTrades: scoped.length };
}
