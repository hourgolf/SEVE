// ============================================================================
//  pyramid — the shared "should I add a lot to this winner?" predicate. PURE.
//
//  THE SINGLE SOURCE OF TRUTH for the pyramiding add-gate, called by BOTH the backtest
//  (engine/backtest.ts simulateSession) AND, later, the live-worker shadow detector — so the
//  two can NEVER drift (the [[add-channel-vocab-parity]] / "inlined twin that drifts" lesson;
//  the adversarial recon flagged a hand-mirrored gate as the real driftwood risk). The caller
//  computes the fill (addFill) and the lot size (sizeQty) — engine via riskGovernor, the worker
//  via its own decide formula — and passes them in; this function owns the GATE + the
//  weighted-avg math. ⚠ sizeQty is the ONE thing NOT shared (each caller sizes its own way), so
//  any live graduation MUST assert lot-by-lot qty parity, not just count/direction.
// ============================================================================

import type { OptType } from "./types";

export interface PyramidCfg { maxAdds: number; minProfitPct: number; }
export interface PyramidPos { optType: OptType; qty: number; entryPrice: number; }
export interface PyramidLot { qty: number; entryFill: number; }

export interface PyramidInputs {
  cfg: PyramidCfg;
  pos: PyramidPos;                  // current weighted-avg row
  lots: PyramidLot[];               // the open stack (lots[0] = base); length-1 = adds so far
  heldAtPriorBar: boolean;          // !wasFlat — never the entry bar
  exiting: boolean;                 // an exit intent fired this bar
  continuationDir: OptType | null;  // evaluate(f,null) → enter.direction (the trigger), else null
  addFill: number;                  // cost-adjusted BUY fill of the SAME contract
  sizeQty: number;                  // caller-sized add lot (engine: riskGovernor; worker: decide formula)
}
export type PyramidReason =
  | "no_base" | "not_held" | "exiting" | "max_adds" | "no_continuation"
  | "wrong_dir" | "below_last_lot" | "not_appreciated" | "zero_qty";
export type PyramidDecision =
  | { add: true; qty: number; newQty: number; newEntryPrice: number; appreciatedPct: number }
  | { add: false; reason: PyramidReason };

// The add-gate, in the EXACT order of engine/backtest.ts's original inline block (so the engine
// call is byte-identical). Returns the weighted-avg update on add. NEVER averages down — the add
// fill must exceed the last lot (the schema's only hard scale-in rule, forbidIfBelowEntryPremium).
export function decidePyramidAdd(i: PyramidInputs): PyramidDecision {
  const { cfg, pos, lots } = i;
  if (lots.length === 0) return { add: false, reason: "no_base" };          // base lot must exist
  if (!i.heldAtPriorBar) return { add: false, reason: "not_held" };          // never the entry bar
  if (i.exiting) return { add: false, reason: "exiting" };
  if (lots.length > cfg.maxAdds) return { add: false, reason: "max_adds" };  // lots incl. base → maxAdds adds = length maxAdds+1
  if (i.continuationDir == null) return { add: false, reason: "no_continuation" };
  if (i.continuationDir !== pos.optType) return { add: false, reason: "wrong_dir" };
  const last = lots[lots.length - 1].entryFill;
  if (!(i.addFill > last)) return { add: false, reason: "below_last_lot" };  // never average down
  const base = lots[0].entryFill;
  const appreciatedPct = base > 0 ? ((i.addFill - base) / base) * 100 : 0;
  if (appreciatedPct < cfg.minProfitPct) return { add: false, reason: "not_appreciated" };
  if (!(i.sizeQty > 0)) return { add: false, reason: "zero_qty" };
  const newQty = pos.qty + i.sizeQty;
  const newEntryPrice = (pos.entryPrice * pos.qty + i.addFill * i.sizeQty) / newQty; // weighted avg
  return { add: true, qty: i.sizeQty, newQty, newEntryPrice, appreciatedPct };
}
