// ============================================================================
//  Shadow management "what-if" — runs each channel's per-channel `management`
//  block (engine/management.ts → engine/manage.ts) as a PARALLEL simulation over
//  every live position it applies to, on the REAL-TIME OPRA quote, one step per
//  bar-close. It places NO orders and books nothing real — when the actual
//  position closes (cron/manual), it logs managed-vs-actual + writes a `MGMT …`
//  shadow event, so we accumulate multi-session evidence for whether the
//  scale-out/breakeven/trail beats the channels' real exits.
//
//  Unmanaged channels (power, grind base — see MANAGEMENT_BY_SLUG) are skipped:
//  managing them caps the tail / bleeds scalp cost (backtest + the 06-03 A/B).
// ============================================================================

import { computeFeatures } from "../../engine/engine";
import { fillWithCost, type CostModel } from "../../engine/cost";
import { openManaged, stepManaged, type ManagedState } from "../../engine/manage";
import { managementFor } from "../../engine/management";
import type { Bar, OptType } from "../../engine/types";
import type { ChainStore } from "./state.js";
import { getPositionById, writeShadowEvent, type PositionRow } from "./store.js";
import { info } from "./log.js";

const COST: CostModel = { spreadSource: "option_bars", modeledSpreadPct: 0.03, modeledSpreadFloorUsd: 0.03, slippageTicksPerSide: 0.25, commissionPerContract: 0.04, crossSpread: true };
const sgn = (n: number) => `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(0)}`;

interface Tracked { slug: string; occ: string; st: ManagedState; managedPnl: number; managedClosed: boolean; lastReason?: string; }
const tracked = new Map<string, Tracked>(); // keyed by desk-row id (persists across cycles)

export interface MgmtUpdateCtx {
  rows: PositionRow[];               // open desk rows this cycle
  slugById: Map<string, string>;     // strategist_id → slug
  chain: ChainStore;
  sessionBars: Bar[];
  atr: number;                       // ATR at the latest bar
  etMin: number;                     // ET minute of the latest bar
  minutesToClose: number;
}

export async function updateShadowManagement(ctx: MgmtUpdateCtx): Promise<void> {
  const { rows, slugById, chain, sessionBars, atr, etMin, minutesToClose } = ctx;
  if (!sessionBars.length) return;
  const underlying = sessionBars[sessionBars.length - 1].close;
  const openIds = new Set(rows.map((r) => r.id));

  // ---- open / step a managed sim for each managed open position ----
  for (const r of rows) {
    const slug = slugById.get(r.strategist_id) ?? "";
    const m = managementFor(slug);
    if (!m) continue; // unmanaged channel — intentionally not tracked
    const q = chain.byOcc(r.occ_symbol);
    if (!q || q.mid <= 0) continue;
    const quote = { strike: r.strike, optType: r.opt_type as OptType, bid: q.bid, ask: q.ask, mid: q.mid };

    let t = tracked.get(r.id);
    if (!t) {
      const entryMs = r.opened_at ? Date.parse(r.opened_at) : sessionBars[0].ts;
      let ei = sessionBars.findIndex((b) => b.ts >= entryMs);
      if (ei < 0) ei = 0;
      const entryAtr = computeFeatures(sessionBars, ei).atr || atr;
      const entryEdge = fillWithCost("buy", quote, COST).edgeUsd;
      const st = openManaged(m, r.opt_type as OptType, r.strike, r.qty, r.avg_entry_price, sessionBars[ei]?.close ?? r.strike, ei, entryAtr, entryEdge);
      t = { slug, occ: r.occ_symbol, st, managedPnl: 0, managedClosed: false };
      tracked.set(r.id, t);
    }
    if (t.managedClosed) continue;

    const res = stepManaged(t.st, quote, underlying, atr, etMin, minutesToClose, COST);
    for (const pe of res.partials) {
      t.managedPnl += pe.pnl;
      t.lastReason = pe.reason;
      info(`mgmt-shadow ${t.slug} ${t.occ}: would ${pe.reason} ×${pe.qty} @ ${pe.exitPremium.toFixed(2)} (${sgn(pe.pnl)})`);
    }
    if (res.closed) info(`mgmt-shadow ${t.slug} ${t.occ}: management would be FLAT — total ${sgn(t.managedPnl)} (${t.lastReason})`);
    t.managedClosed = t.managedClosed || res.closed;
  }

  // ---- finalize: a tracked position that's no longer open → actual vs managed ----
  for (const [id, t] of [...tracked.entries()]) {
    if (openIds.has(id)) continue;
    const actual = await getPositionById(id);
    const actualPnl = Number(actual?.realized_pnl ?? 0);
    const delta = t.managedPnl - actualPnl;
    info(`mgmt-shadow ${t.slug} ${t.occ} DONE — managed ${sgn(t.managedPnl)} vs actual ${sgn(actualPnl)} (Δ ${sgn(delta)})`);
    void writeShadowEvent(`MGMT ${t.slug} ${t.occ} — managed ${sgn(t.managedPnl)} vs actual ${sgn(actualPnl)} (Δ ${sgn(delta)})`, { managed: Math.round(t.managedPnl), actual: Math.round(actualPnl), delta: Math.round(delta), slug: t.slug });
    tracked.delete(id);
  }
}
