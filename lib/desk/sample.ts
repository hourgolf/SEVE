// ============================================================================
//  Sample desk feed — realistic, ticking positions / P&L / signals so the
//  console feels alive with no backend. Every value is flagged isSample.
//  SEAM: when the bots trade, replace these generators with reads of the real
//  positions / fills / signals / equity_snapshots tables (same shapes).
// ============================================================================

import type {
  ChannelPnl,
  DeskState,
  PmColor,
  Position,
  Signal,
  Step,
  StrategistState,
} from "@/lib/desk/types";
import type { EventLevel } from "@/lib/types";

const SPOT = 756;

// OCC symbol, e.g. SPY260529C00756000
function occ(expiration: string, type: "call" | "put", strike: number): string {
  const [y, m, d] = expiration.split("-");
  const k = String(Math.round(strike * 1000)).padStart(8, "0");
  return `SPY${y.slice(2)}${m}${d}${type === "call" ? "C" : "P"}${k}`;
}

let idCounter = 1;
const nextId = () => `s${idCounter++}`;

// A small open book per strategist, sized loosely by their capital lean.
export function seedPositions(strategists: StrategistState[]): Position[] {
  const today = "2026-05-29";
  const out: Position[] = [];
  for (const s of strategists) {
    const legs = Math.max(1, Math.round(s.config.capital_pct / 12));
    for (let i = 0; i < legs; i++) {
      const type: "call" | "put" = (i + s.slug.length) % 2 === 0 ? "call" : "put";
      const strike = SPOT + (type === "call" ? 1 : -1) * (i + 1);
      const qty = (type === "call" ? 1 : -1) * Math.max(1, Math.round(s.config.max_contracts / 2));
      const entry = 0.8 + i * 0.35;
      const mark = entry + (Math.random() - 0.45) * 0.4;
      out.push({
        id: nextId(),
        strategist_slug: s.slug,
        occ_symbol: occ(today, type, strike),
        expiration: today,
        strike,
        opt_type: type,
        qty,
        avg_entry_price: Number(entry.toFixed(2)),
        current_mark: Number(Math.max(0.01, mark).toFixed(2)),
        unrealized_pnl: 0, // filled by recompute below
      });
    }
  }
  return out.map(recomputePnl);
}

function recomputePnl(p: Position): Position {
  // option multiplier 100; qty signed
  const unrealized = (p.current_mark - p.avg_entry_price) * p.qty * 100;
  return { ...p, unrealized_pnl: Math.round(unrealized) };
}

// Random-walk the marks each tick; volatility scales with the strategist's
// aggression so turning TUNE up visibly widens that channel's P&L swings.
export function tickPositions(prev: Position[], desk: DeskState): Position[] {
  return prev.map((p) => {
    const s = desk.strategists.find((x) => x.slug === p.strategist_slug);
    const aggr = s ? s.config.aggression : 50;
    const vol = 0.01 + (aggr / 100) * 0.08; // 1%–9% per tick
    const drift = (Math.random() - 0.5) * 2 * vol;
    const mark = Math.max(0.01, p.current_mark * (1 + drift));
    return recomputePnl({ ...p, current_mark: Number(mark.toFixed(2)) });
  });
}

export function channelPnl(positions: Position[]): Record<string, ChannelPnl> {
  const out: Record<string, ChannelPnl> = {};
  for (const p of positions) {
    const c = (out[p.strategist_slug] ??= { dayPnl: 0, openCount: 0, exposure: 0 });
    c.dayPnl += p.unrealized_pnl;
    c.openCount += 1;
    c.exposure += Math.abs(p.qty) * p.current_mark * 100;
  }
  for (const k of Object.keys(out)) out[k].dayPnl = Math.round(out[k].dayPnl);
  return out;
}

export function fundPnl(
  positions: Position[],
  totalCapital: number
): { nav: number; dayPnl: number } {
  const dayPnl = positions.reduce((a, p) => a + p.unrealized_pnl, 0);
  return { nav: Math.round(totalCapital + dayPnl), dayPnl: Math.round(dayPnl) };
}

export function seedEquityCurve(base: number, points = 60): { ts: string; equity: number }[] {
  const out: { ts: string; equity: number }[] = [];
  let eq = base;
  for (let i = 0; i < points; i++) {
    eq += (Math.random() - 0.48) * (base * 0.002);
    out.push({ ts: `${i}`, equity: Math.round(eq) });
  }
  return out;
}

const SIGNAL_TEMPLATES: { slug: string; level: EventLevel; type: string; msg: string }[] = [
  { slug: "fade", level: "INFO", type: "MR-FADE", msg: "stretch 1.6 ATR over VWAP — arming put fade" },
  { slug: "breakout", level: "EXEC", type: "ORB-L", msg: "BTO 2 SPY 757C @ 0.74 — range break long" },
  { slug: "power", level: "RISK", type: "GAMMA-LEAN", msg: "idle until 15:00 ET — gamma window closed" },
  { slug: "grind", level: "OK", type: "SCALP", msg: "STC 4 SPY 756C @ 0.91 — +0.07 scalp" },
  { slug: "fade", level: "WARN", type: "MR-FADE", msg: "momentum still firm — holding fire" },
  { slug: "breakout", level: "INFO", type: "ORB-S", msg: "watching low-of-range for short trigger" },
];

export function tickSignals(prev: Signal[], desk: DeskState, nowIso: string): Signal[] {
  // ~35% chance per tick to push a new signal from an active strategist.
  if (Math.random() > 0.35) return prev;
  const candidates = SIGNAL_TEMPLATES.filter((t) => {
    const s = desk.strategists.find((x) => x.slug === t.slug);
    return s && !s.config.muted;
  });
  if (!candidates.length) return prev;
  const t = candidates[Math.floor(Math.random() * candidates.length)];
  const sig: Signal = {
    id: nextId(),
    strategist_slug: t.slug,
    level: t.level,
    signal_type: t.type,
    message: t.msg,
    created_at: nowIso,
  };
  return [sig, ...prev].slice(0, 16);
}

const COLOR_OF: Record<string, PmColor> = {
  fade: "green",
  breakout: "blue",
  power: "amber",
  grind: "cyan",
};

// 16-step tape: each recent signal lights a step in its strategist's color,
// newest at the right. Pulses the most recent.
export function buildSteps(signals: Signal[]): Step[] {
  const steps: Step[] = Array.from({ length: 16 }, () => ({ lit: false }));
  signals.slice(0, 16).forEach((sig, i) => {
    const idx = 15 - i;
    steps[idx] = {
      lit: true,
      color: COLOR_OF[sig.strategist_slug],
      pulse: i === 0,
    };
  });
  return steps;
}
