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
import { getPositionById, reconstructRideToClose, writeShadowEvent, type PositionRow } from "./store.js";
import { info } from "./log.js";
import { shadowLifecycleAction } from "./shadowManageModel.js";

const COST: CostModel = { spreadSource: "option_bars", modeledSpreadPct: 0.03, modeledSpreadFloorUsd: 0.03, slippageTicksPerSide: 0.25, commissionPerContract: 0.04, crossSpread: true };
const sgn = (n: number) => `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(0)}`;

interface Tracked {
  slug: string;
  occ: string;
  sym: string;
  st: ManagedState;
  managedPnl: number;
  managedClosed: boolean;
  lastReason?: string;
  truncated: boolean;
  // Captured once the real row closes. The counterfactual can then keep walking
  // market quotes until its OWN policy closes instead of being cut off at the
  // actual exit. Undefined means the actual outcome is not confirmed yet.
  actualPnl?: number;
}
// Keyed by desk-row id. ⚠ Persists across CYCLES only, not restarts (audit 2026-07-10): a
// Railway redeploy mid-hold re-opens the sim blind to banked partials / the armed BE-trail
// floor, so the finalize would compare a truncated managed side against a DB-true actual.
// Such sims are flagged `truncated` at open and their finalize is banked as MGMT-TRUNCATED —
// excluded from the clean managed-vs-actual evidence (day-report filters on "MGMT ").
const tracked = new Map<string, Tracked>();

// RIDE channels (managementFor null — pb-ride, base grind/power) have no scale/BE/trail to
// shadow, but the operator OVERRIDES them (manual close). We track each while open so an
// early override can be scored against ride-to-close at the flatten — the live, cloud-durable
// twin of the day-report's override scorecard ("did the human beat the ride").
interface RideTrack { slug: string; occ: string; sym: string; entry: number; qty: number; openedAt: string; }
const rideTracked = new Map<string, RideTrack>();

const FLATTEN_MTC = 35; // pullback flattenMtc → 15:25 ET (parity with the day-report ride-to-close)
// 15:25 ET (+30s, to catch the flatten-cycle fill) on the trade's ET date → UTC ISO. DST-correct
// via a noon probe (offset = how far UTC leads ET: 240 EDT / 300 EST). Mirrors day-report.
function flattenIsoFor(openedAt: string): string {
  const etDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(openedAt));
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date(Date.parse(`${etDate}T12:00:00Z`)));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "12") % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const offsetMin = 12 * 60 - (h * 60 + m);
  return new Date(Date.parse(`${etDate}T15:25:00Z`) + offsetMin * 60_000 + 30_000).toISOString();
}

export interface MgmtUpdateCtx {
  rows: PositionRow[];               // open desk rows this cycle (this symbol)
  slugById: Map<string, string>;     // strategist_id → slug
  sym: string;                       // the symbol being processed (scopes finalize — the maps are global)
  chain: ChainStore;
  sessionBars: Bar[];
  atr: number;                       // ATR at the latest bar
  etMin: number;                     // ET minute of the latest bar
  minutesToClose: number;
}

export async function updateShadowManagement(ctx: MgmtUpdateCtx): Promise<void> {
  const { rows, slugById, sym, chain, sessionBars, atr, etMin, minutesToClose } = ctx;
  if (!sessionBars.length) return;
  const underlying = sessionBars[sessionBars.length - 1].close;
  const openIds = new Set(rows.map((r) => r.id));

  // ---- open / step a managed sim for each managed open position ----
  for (const r of rows) {
    const slug = slugById.get(r.strategist_id) ?? "";
    const m = managementFor(slug);
    if (!m) {
      // RIDE / unmanaged channel — no scale/BE/trail to shadow, but track it so an early
      // manual close (override) can be scored against ride-to-close at the flatten.
      if (r.opened_at) rideTracked.set(r.id, { slug, occ: r.occ_symbol, sym, entry: r.avg_entry_price, qty: r.qty, openedAt: r.opened_at });
      continue;
    }
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
      // TRUNCATED detection: first sight normally lands on the NEXT bar-close after the fill
      // (≤ ~90s). A sim opening > 3 min after opened_at missed part of the hold (restart /
      // mid-hold config change) — its managed side is not comparable to the full actual.
      const truncated = Number.isFinite(entryMs) && Date.now() - entryMs > 3 * 60_000;
      t = { slug, occ: r.occ_symbol, sym, st, managedPnl: 0, managedClosed: false, truncated };
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

  // ---- continue counterfactuals after the actual position closes ----
  // The prior implementation finalized as soon as the desk row disappeared. If the
  // simulated manager still held contracts, only already-banked partials were counted
  // (often $0) and compared with the completed actual trade. Actual and simulated exits
  // are independent clocks: capture the real outcome, then keep stepping the simulation
  // on live quotes until its own manager is flat.
  for (const [id, t] of tracked.entries()) {
    if (t.sym !== sym || openIds.has(id) || t.managedClosed) continue;

    if (t.actualPnl === undefined) {
      const actual = await getPositionById(id);
      // A missing row/read or an input snapshot race is not proof of a close. Wait for
      // a positively observed closed row before advancing the post-actual simulation.
      if (!actual || actual.status === "open") continue;
      t.actualPnl = Number(actual.realized_pnl ?? 0);
    }

    const q = chain.byOcc(t.occ);
    const action = shadowLifecycleAction({ actualOpen: false, managedClosed: t.managedClosed, hasExecutableQuote: !!q && q.mid > 0 });
    if (action !== "step" || !q) continue;

    const quote = { strike: t.st.strike, optType: t.st.optType, bid: q.bid, ask: q.ask, mid: q.mid };
    const res = stepManaged(t.st, quote, underlying, atr, etMin, minutesToClose, COST);
    for (const pe of res.partials) {
      t.managedPnl += pe.pnl;
      t.lastReason = pe.reason;
      info(`mgmt-shadow ${t.slug} ${t.occ}: post-actual would ${pe.reason} ×${pe.qty} @ ${pe.exitPremium.toFixed(2)} (${sgn(pe.pnl)})`);
    }
    if (res.closed) info(`mgmt-shadow ${t.slug} ${t.occ}: management would be FLAT after actual exit — total ${sgn(t.managedPnl)} (${t.lastReason})`);
    t.managedClosed = t.managedClosed || res.closed;
  }

  // ---- finalize only when BOTH clocks have completed ----
  // Scoped to THIS symbol's pass (the maps are module-global; without the sym guard a
  // SPY position would be mis-finalized while still open during the QQQ pass).
  for (const [id, t] of [...tracked.entries()]) {
    if (t.sym !== sym) continue;
    const action = shadowLifecycleAction({ actualOpen: openIds.has(id), managedClosed: t.managedClosed, hasExecutableQuote: false });
    if (action !== "finalize") continue;
    if (t.actualPnl === undefined) {
      const actual = await getPositionById(id);
      if (!actual || actual.status === "open") continue;
      t.actualPnl = Number(actual.realized_pnl ?? 0);
    }
    const actualPnl = t.actualPnl;
    const delta = t.managedPnl - actualPnl;
    // MGMT-TRUNCATED (no space after MGMT) deliberately fails day-report's `includes("MGMT ")`
    // filter — a restart-truncated sim is banked for inspection, never as clean evidence.
    const kind = t.truncated ? "MGMT-TRUNCATED" : "MGMT";
    info(`mgmt-shadow ${t.slug} ${t.occ} DONE — managed ${sgn(t.managedPnl)} vs actual ${sgn(actualPnl)} (Δ ${sgn(delta)})${t.truncated ? " [TRUNCATED — sim opened mid-hold; not clean evidence]" : ""}`);
    void writeShadowEvent(`${kind} ${t.slug} ${t.occ} — managed ${sgn(t.managedPnl)} vs actual ${sgn(actualPnl)} (Δ ${sgn(delta)})`, { managed: Math.round(t.managedPnl), actual: Math.round(actualPnl), delta: Math.round(delta), slug: t.slug, truncated: t.truncated });
    tracked.delete(id);
  }

  // ---- ride-to-close finalize: an OVERRIDDEN ride position, scored at the flatten ----
  // A ride channel the operator closed EARLY: wait until past the 15:25 flatten (so the
  // full ride path is in option_quotes), then reconstruct ride-to-close and log the
  // override-vs-ride delta. Only manual overrides fire (a native exit ≈ ride → Δ~0, dull).
  for (const [id, rt] of [...rideTracked.entries()]) {
    if (rt.sym !== sym) continue;                  // scope to this symbol's pass
    if (openIds.has(id)) continue;                 // still open — keep riding
    if (minutesToClose > FLATTEN_MTC) continue;    // closed early; defer until the ride path completes
    rideTracked.delete(id);
    const actual = await getPositionById(id);
    if (!actual) continue;
    const isOverride = actual.close_reason === "manual" || !!actual.close_reason?.startsWith("manual:");
    if (!isOverride) continue;                     // rode to its own native exit — nothing to compare
    const r = await reconstructRideToClose(rt.occ, rt.entry, rt.qty, rt.openedAt, flattenIsoFor(rt.openedAt));
    if (!r || !r.rideOk) continue;                 // OCC drifted off the tracked chain — incomplete path
    const actualPnl = Number(actual.realized_pnl ?? 0);
    const delta = actualPnl - r.ride;              // >0 ⇒ the override BEAT ride-to-close
    const openMs = Date.parse(rt.openedAt);
    // exit-timing (run #4): operator's hold vs the ride's would-be hold — feeds the auto-arbiter once N grows
    const actualHoldMin = actual.closed_at ? Math.round((Date.parse(actual.closed_at) - openMs) / 60000) : null;
    const rideHoldMin = r.rideExitMs != null ? Math.round((r.rideExitMs - openMs) / 60000) : null;
    info(`ride-shadow ${rt.slug} ${rt.occ} OVERRIDE — ride ${sgn(r.ride)} vs actual ${sgn(actualPnl)} (Δ ${sgn(delta)})`);
    void writeShadowEvent(`RIDE ${rt.slug} ${rt.occ} — ride ${sgn(r.ride)} vs actual ${sgn(actualPnl)} (Δ ${sgn(delta)})`, { slug: rt.slug, occ: rt.occ, ride: Math.round(r.ride), actual: Math.round(actualPnl), delta: Math.round(actualPnl) - Math.round(r.ride), stopHit: r.rideStop, actualHoldMin, rideHoldMin, override: true });
  }
}
