// ============================================================================
//  pyramid-graduation-replay — the pre-arm GATE for the cap12 pyramid (TASK 2 / #2).
//
//  Both the engine backtest and the live worker call the SHARED decidePyramidAdd gate, so
//  the GATE never drifts. The only un-shared inputs are (1) addFill — engine uses the
//  cost-adjusted buy fill, the worker uses the RAW ask (~1 tick lower) → the +30% / below-
//  last-lot boundary can disagree; (2) sizeQty — engine via riskGovernor, worker via
//  floor(RISK/(0.5·ask·100)). At the live config those qty formulas are algebraically equal
//  (both floor(10/ask) off the same q.ask), so this asserts it empirically + quantifies the
//  addFill boundary disagreements BEFORE arming pyramid_adds>0 + max_contracts=12 on V3/ALT.
//
//  Runs V3/ALT faithful (real NBBO, RISK 500, gate 3, cap12) with a default-off engine hook
//  that recomputes the WORKER's decision on identical state at every add-eval, and reports
//  add/no-add agreement + lot-by-lot qty parity. Arm only if parity is ~clean.
//
//    npm run pyramid-graduation-replay
// ============================================================================
import { simulateSession, setPyramidParityHook, type PyramidParityInfo } from "./backtest";
import { decidePyramidAdd } from "./pyramid";
import { loadFaithfulRoster, sessionsFor, cfgOf, FUND, FILL_1T, ENTRY_GATE, RISK, type Channel } from "./roster-faithful";
import type { Trade } from "./types";

const PYR = { maxAdds: 3, minProfitPct: 30, maxStack: 12 }; // the cap12 arm
const SLUGS = new Set(["breakout-alt-v3", "breakout-smart-entries"]);

// worker-side inputs (decide.ts): raw-ask addFill + floor(RISK/(0.5·ask·100)) capped to stack room
function workerDecision(p: PyramidParityInfo) {
  const room = p.maxStack != null ? p.maxStack - p.posQty : Infinity;
  const wQty = Math.max(0, Math.min(Math.floor(RISK / (0.5 * p.ask * 100)), room));
  return decidePyramidAdd({
    cfg: p.cfg, pos: { optType: p.optType, qty: p.posQty, entryPrice: p.posEntry }, lots: p.lots,
    heldAtPriorBar: p.heldAtPriorBar, exiting: p.exiting, continuationDir: p.dir,
    addFill: p.ask, sizeQty: wQty,
  });
}

async function main() {
  const { channels, corpusOf } = await loadFaithfulRoster();
  const targets = channels.filter((c) => SLUGS.has(c.slug));
  console.log(`\nPYRAMID GRADUATION REPLAY · cap12 (maxAdds 3 / +30% / maxStack 12) · V3+ALT faithful (real NBBO, RISK ${RISK}, gate 3)`);
  console.log("engine addFill = cost-adjusted fill · worker addFill = raw ask · qty: engine riskGovernor vs worker floor(RISK/(0.5·ask·100))\n");

  let gEvals = 0, gAgreeAdd = 0, gAgreeNo = 0, gEngineOnly = 0, gWorkerOnly = 0, gQtyMismatch = 0;
  for (const ch of targets) {
    let evals = 0, agreeAdd = 0, agreeNo = 0, engineOnly = 0, workerOnly = 0, qtyMismatch = 0;
    const ex: string[] = [];
    setPyramidParityHook((p) => {
      evals++;
      const w = workerDecision(p);
      const e = p.engineDec.add, wa = w.add;
      if (e && wa) { if (p.engineDec.qty === w.qty) agreeAdd++; else { qtyMismatch++; if (ex.length < 4) ex.push(`  QTY engine ${p.engineDec.qty} vs worker ${w.qty} @ ask ${p.ask.toFixed(2)}`); } }
      else if (!e && !wa) agreeNo++;
      else if (e && !wa) { engineOnly++; if (ex.length < 4) ex.push(`  ENGINE-ONLY add (worker:${(w as { reason?: string }).reason}) · ask ${p.ask.toFixed(2)} engFill ${p.engineFill.toFixed(2)} appr~${(((p.ask - p.lots[0].entryFill) / p.lots[0].entryFill) * 100).toFixed(1)}%`); }
      else { workerOnly++; if (ex.length < 4) ex.push(`  WORKER-ONLY add · ask ${p.ask.toFixed(2)} engFill ${p.engineFill.toFixed(2)}`); }
    });
    const { real, chainFor } = sessionsFor(ch, corpusOf(ch.symbol));
    for (const s of real) {
      simulateSession(s.bars, cfgOf(12), FUND, ch.mk(s) as Parameters<typeof simulateSession>[3], chainFor(s), false, ch.premiumExit,
        FILL_1T, undefined, undefined, undefined, undefined, 0, ENTRY_GATE, undefined, PYR) as Trade[];
    }
    setPyramidParityHook(null);
    const adds = agreeAdd + qtyMismatch + engineOnly + workerOnly;
    const agreePct = evals ? (100 * (agreeAdd + agreeNo) / evals).toFixed(1) : "—";
    console.log(`${ch.name}  [${real.length} sessions]`);
    console.log(`  add-eval bars ${evals} · engine-adds ${agreeAdd + qtyMismatch + engineOnly} · worker-adds ${agreeAdd + qtyMismatch + workerOnly}`);
    console.log(`  AGREE ${agreeAdd} add + ${agreeNo} no-add = ${agreePct}% · DISAGREE: engine-only ${engineOnly}, worker-only ${workerOnly}, qty-mismatch ${qtyMismatch}  (of ${adds} add-decisions)`);
    if (ex.length) console.log(ex.join("\n"));
    console.log("");
    gEvals += evals; gAgreeAdd += agreeAdd; gAgreeNo += agreeNo; gEngineOnly += engineOnly; gWorkerOnly += workerOnly; gQtyMismatch += qtyMismatch;
  }
  const gAdds = gAgreeAdd + gQtyMismatch + gEngineOnly + gWorkerOnly;
  console.log(`TOTAL · ${gEvals} add-eval bars · AGREE ${(100 * (gAgreeAdd + gAgreeNo) / gEvals).toFixed(1)}%`);
  console.log(`  qty-parity on co-fired adds: ${gAgreeAdd}/${gAgreeAdd + gQtyMismatch} exact (${gQtyMismatch} mismatches)`);
  console.log(`  boundary disagreements: engine-only ${gEngineOnly}, worker-only ${gWorkerOnly} (of ${gAdds} total add-decisions = the ~1-tick addFill caveat)`);
  console.log(gQtyMismatch === 0 && gWorkerOnly === 0
    ? "\n✓ CLEAN: qty parity exact, worker never adds where engine doesn't (worker only ever MORE conservative via raw-ask). Safe to arm cap12."
    : "\n⚠ review the disagreements above before arming.");
}
main().catch((e) => { console.error(e); process.exit(1); });
