// ============================================================================
//  weekly-readout — the Friday post-close aggregate (approved 2026-07-02).
//  Closes the "collect vs use" gap: the nightly jobs BANK the data; this prints
//  the week's interrogation of it, on a schedule, so the re-mine cadence no
//  longer depends on anyone remembering. ANALYSIS ONLY — no knobs, no arms.
//
//  Sections:
//   1. WEEK ROLLUP    — per-channel n/win%/P&L + TP-hits/stops + NEAR-MISS count
//                       (registry A6b: peak ≥70% of TP but closed ≤0; tp>0 only)
//   2. VB FLEET WEEK  — virtual bench would-haves vs the banked backtest PRIOR
//                       (engine/vb-fleet-probe.ts exp/t — forward-vs-prior drift
//                        is the finding, in either direction)
//   3. GATE COUNTERS  — progress toward every pre-registered readout
//
//  Output: stdout + data/weekly-readouts/<date>.txt (gitignored) + one events
//  journal row (visible in the §03 log). Runs Fridays from capture-forward;
//  `npm run weekly-readout` any time by hand.
//
//  ⚠ All MFE/near-miss figures are option-MID based (upper bounds); vb numbers
//  are capital-blind would-haves. Diagnostics, never edge claims (registry A8).
// ============================================================================

import { writeFileSync, mkdirSync } from "node:fs";
import { createServerSupabaseClient } from "./serverSupabase";

const HAS_SERVICE = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createServerSupabaseClient("weekly-readout");

const DAYS = 7;
const ERA4_START = "2026-06-30"; // LOCK/RIDE era (A6)
// Backtest PRIOR exp$/t per vb spec — banked 2026-07-01 by engine/vb-fleet-probe.ts
// (308 SPY sessions, real NBBO, tp/−30 LOCK). Re-run the probe to refresh.
const VB_PRIOR: Record<string, number> = {
  "vb-vwap-revert": -21.6, "vb-rsi-revert": -36.3, "vb-level-break": -25.6,
  "vb-or-fail": -17.4, "vb-macd-state": -25.6, "vb-curl-reversal": -23.2,
  "vb-squeeze-break": -27.4, "vb-pm-trend": -25.5, "vb-gap-drift": -31.8, "vb-ribbon-cross": -23.8,
};

const pad = (s: unknown, w: number) => String(s).padStart(w);
const padE = (s: unknown, w: number) => String(s).padEnd(w);
const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));

async function main() {
  const now = Date.now();
  const sinceIso = new Date(now - DAYS * 86_400_000).toISOString();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(now));
  const L: string[] = [];
  const out = (s: string) => { L.push(s); console.log(s); };

  out(`\nWEEKLY READOUT — ${today} (last ${DAYS}d) · analysis only, no knobs · MFE/near-miss = mid-basis upper bounds`);

  // ── 1. week rollup + near-miss (A6b) ──
  const { data: cfgRows } = await sb.from("strategists").select("id,slug,strategist_config(take_profit_pct)");
  const tpBySlug = new Map<string, number>(
    ((cfgRows ?? []) as any[]).map((r) => {
      const c = Array.isArray(r.strategist_config) ? r.strategist_config[0] : r.strategist_config;
      return [r.slug, Number(c?.take_profit_pct ?? 0)];
    }),
  );
  const { data: pos } = await sb
    .from("positions")
    .select("realized_pnl,avg_entry_price,peak_mark,close_reason,closed_at,strategists(slug)")
    .eq("status", "closed").gte("closed_at", sinceIso).limit(2000);
  type Agg = { n: number; w: number; pnl: number; tpHits: number; stops: number; nearMiss: number };
  const week = new Map<string, Agg>();
  const era4Days = new Set<string>();
  for (const p of (pos ?? []) as any[]) {
    const slug = String(p.strategists?.slug ?? "?");
    const a = week.get(slug) ?? { n: 0, w: 0, pnl: 0, tpHits: 0, stops: 0, nearMiss: 0 };
    const r = Number(p.realized_pnl ?? 0), e = Number(p.avg_entry_price ?? 0), pk = p.peak_mark != null ? Number(p.peak_mark) : null;
    a.n++; a.pnl += r; if (r > 0) a.w++;
    if (String(p.close_reason ?? "").startsWith("target")) a.tpHits++;
    if (/stop/.test(String(p.close_reason ?? ""))) a.stops++;
    const tp = tpBySlug.get(slug) ?? 0;
    if (tp > 0 && pk != null && e > 0 && r <= 0 && pk >= e * (1 + (0.7 * tp) / 100)) a.nearMiss++;
    week.set(slug, a);
    if (String(p.closed_at ?? "") >= ERA4_START) era4Days.add(String(p.closed_at).slice(0, 10));
  }
  out(`\n1 · WEEK ROLLUP (${(pos ?? []).length} closed trades)`);
  out(`  ${padE("channel", 28)}${pad("n", 4)}${pad("win%", 6)}${pad("P&L", 9)}${pad("TP", 4)}${pad("stop", 5)}${pad("nearMiss", 9)}`);
  for (const [slug, a] of [...week.entries()].sort((x, y) => y[1].pnl - x[1].pnl))
    out(`  ${padE(slug, 28)}${pad(a.n, 4)}${pad(Math.round((100 * a.w) / a.n), 6)}${pad(usd(a.pnl), 9)}${pad(a.tpHits, 4)}${pad(a.stops, 5)}${pad(a.nearMiss || "·", 9)}`);
  out(`  near-miss (A6b): peak ≥70% of TP but closed ≤0 — read at the A6 gate, not before; ratchet probe reopens at ≥15% @ N≥40.`);

  // ── 2. vb fleet week vs prior ──
  const { data: vt } = await sb
    .from("virtual_trades")
    .select("slug,blocked,pnl_per_contract,signal_at")
    .gte("signal_at", sinceIso).limit(5000);
  const fleet = new Map<string, { n: number; w: number; pnl: number }>();
  let gateN = 0, gateScored = 0;
  for (const v of (vt ?? []) as any[]) {
    if (v.blocked !== "not_armed") { gateN++; if (v.pnl_per_contract != null) gateScored++; continue; }
    if (v.pnl_per_contract == null) continue;
    const a = fleet.get(v.slug) ?? { n: 0, w: 0, pnl: 0 };
    a.n++; a.pnl += Number(v.pnl_per_contract); if (Number(v.pnl_per_contract) > 0) a.w++;
    fleet.set(v.slug, a);
  }
  out(`\n2 · VIRTUAL BENCH — week would-have vs banked PRIOR (capital-blind, mid-basis; hypotheses only)`);
  out(`  ${padE("spec", 24)}${pad("n", 4)}${pad("win%", 6)}${pad("avg/ct", 9)}${pad("prior/t", 9)}   drift`);
  for (const [slug, a] of [...fleet.entries()].sort((x, y) => y[1].n - x[1].n)) {
    const avg = a.pnl / a.n;
    const prior = VB_PRIOR[slug];
    const drift = prior != null ? (avg >= prior + 15 ? "above" : avg <= prior - 15 ? "below" : "≈prior") : "—";
    out(`  ${padE(slug, 24)}${pad(a.n, 4)}${pad(Math.round((100 * a.w) / a.n), 6)}${pad(usd(avg), 9)}${pad(prior != null ? usd(prior) : "—", 9)}   ${drift}`);
  }
  out(`  drift is the finding (either direction); the MINING pass stays gated to ≥2 months / regime change (A8).`);

  // ── 3. gate counters ──
  const { count: orbN } = await sb.from("positions").select("id", { count: "exact", head: true })
    .eq("status", "closed").in("strategist_id",
      ((cfgRows ?? []) as any[]).filter((r) => r.slug === "orb-ustop" || r.slug === "orb-ustop-ctl").map((r) => r.id));
  const { count: gateTotal } = await sb.from("virtual_trades").select("signal_id", { count: "exact", head: true })
    .neq("blocked", "not_armed").not("pnl_per_contract", "is", null);
  const { data: gam } = await sb.from("events").select("created_at").like("message", "stream-shadow: gamma-open%").limit(2000);
  const gamSessions = new Set(((gam ?? []) as any[]).map((e) => String(e.created_at).slice(0, 10))).size;
  const { data: e4 } = await sb.from("positions").select("closed_at").eq("status", "closed").gte("closed_at", ERA4_START).limit(2000);
  const e4Sessions = new Set(((e4 ?? []) as any[]).map((p) => String(p.closed_at).slice(0, 10))).size;
  out(`\n3 · GATE COUNTERS (pre-registered readouts — docs/pre-registered-tests-2026-07.md)`);
  out(`  ORB u-stop A/B        ${orbN ?? 0}/80 paired trades (40/leg)`);
  out(`  gate-shadow K check   ${gateTotal ?? 0}/30 scored blocks (this week: ${gateScored}/${gateN})`);
  out(`  A5 implied-move       ${gamSessions}/20 sessions`);
  out(`  A6 era-4 (LOCK/RIDE)  ${e4Sessions}/15 sessions`);
  out(`\n  paper trading · diagnostics only · nothing here arms or re-sizes anything\n`);

  mkdirSync("data/weekly-readouts", { recursive: true });
  writeFileSync(`data/weekly-readouts/${today}.txt`, L.join("\n") + "\n");
  if (HAS_SERVICE) {
    try {
      await sb.from("events").insert({
        level: "INFO",
        message: `weekly-readout ${today}: ${(pos ?? []).length}t week · gates orbAB ${orbN ?? 0}/80 · gateK ${gateTotal ?? 0}/30 · A5 ${gamSessions}/20 · era4 ${e4Sessions}/15`,
        meta: { kind: "weekly-readout", date: today },
      });
    } catch { /* best-effort */ }
  }
}
main().catch((e) => { console.error(`weekly-readout fatal — ${(e as Error).message}`); process.exit(1); });
