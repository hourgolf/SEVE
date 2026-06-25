// NET EXPOSURE — the read-only X-ray over the (now clean) per-channel book. The desk's channels
// massively SHARE contracts (many channels buy the same SPY 0DTE strike → one netted lot), so the
// "13 channels" are really a few correlated bets stacked. This surfaces the TRUE aggregate the desk
// holds — per contract (how many channels stack it), per underlying/direction, total notional —
// WITHOUT capping anything. Each channel still trades at its own discretion; the operator just gets
// to SEE the real correlated concentration and manage it with judgment. Pure function over the open
// rows the UI already has (no new query); the clean books make the aggregate exact.

import type { Position } from "./types";

export interface OccExposure {
  occ: string;
  underlying: string;
  strike: number;
  optType: "call" | "put";
  contracts: number;   // Σ signed qty across all channels = the real netted lot
  channels: string[];  // the strategist slugs stacking this one contract
  mark: number;
  notional: number;    // |contracts| × mark × 100
}
export interface DirExposure {
  underlying: string;
  callContracts: number;
  putContracts: number;
  notional: number;
}
export interface NetExposure {
  byOcc: OccExposure[];          // sorted by |contracts| desc — the stacked lots first
  byUnderlying: DirExposure[];   // directional net per underlying
  totalNotional: number;
  totalContracts: number;
  occCount: number;
  stackedOccCount: number;       // contracts held by ≥2 channels (the netting/correlation)
  maxStack: OccExposure | null;  // the single heaviest concentration
}

// OCC symbol = ROOT + YYMMDD + C/P + strike — parse the underlying root (SPY/QQQ/IWM).
const rootOf = (occ: string): string => /^([A-Z]+)/.exec(occ)?.[1] ?? "?";

export function computeNetExposure(positions: Position[], liveMarks?: Record<string, number>): NetExposure {
  const open = positions.filter((p) => (p.status ?? "open") === "open" && p.qty !== 0);
  const byOccMap = new Map<string, OccExposure>();
  for (const p of open) {
    const mark = liveMarks?.[p.occ_symbol] ?? p.current_mark ?? p.avg_entry_price ?? 0;
    let e = byOccMap.get(p.occ_symbol);
    if (!e) {
      e = { occ: p.occ_symbol, underlying: rootOf(p.occ_symbol), strike: p.strike, optType: p.opt_type, contracts: 0, channels: [], mark, notional: 0 };
      byOccMap.set(p.occ_symbol, e);
    }
    e.contracts += p.qty;
    e.mark = mark; // last writer = the shared live mark (same for every channel on this OCC)
    if (!e.channels.includes(p.strategist_slug)) e.channels.push(p.strategist_slug);
  }
  for (const e of byOccMap.values()) e.notional = Math.abs(e.contracts) * e.mark * 100;

  const byOcc = [...byOccMap.values()].sort((a, b) => Math.abs(b.contracts) - Math.abs(a.contracts));

  const dirMap = new Map<string, DirExposure>();
  for (const e of byOcc) {
    let d = dirMap.get(e.underlying);
    if (!d) { d = { underlying: e.underlying, callContracts: 0, putContracts: 0, notional: 0 }; dirMap.set(e.underlying, d); }
    if (e.optType === "call") d.callContracts += e.contracts; else d.putContracts += e.contracts;
    d.notional += e.notional;
  }

  return {
    byOcc,
    byUnderlying: [...dirMap.values()].sort((a, b) => b.notional - a.notional),
    totalNotional: byOcc.reduce((s, e) => s + e.notional, 0),
    totalContracts: byOcc.reduce((s, e) => s + Math.abs(e.contracts), 0),
    occCount: byOcc.length,
    stackedOccCount: byOcc.filter((e) => e.channels.length >= 2).length,
    maxStack: byOcc[0] ?? null,
  };
}
