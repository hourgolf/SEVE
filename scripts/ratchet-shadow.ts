// ============================================================================
//  ratchet-shadow — the A4 twins' virtual THIRD ARM (2026-07-08).
//
//  THE QUESTION: A4 tests prem-stop vs u-stop on identical bare-ORB entries, but
//  the operator's real fear is "letting +80% winners ride to −50%". The obvious
//  fix (hard TP) was already REFUTED on this spec (+75% cap → freed-slot re-entry
//  churn, −EV). The surviving exit idea from the pattern-fanout graveyard is the
//  ARM-HIGH RATCHET: let winners run, but once armed, never give most of it back.
//
//  WHAT IT DOES: for every CLOSED A4 twin trade (orb-ustop / orb-ustop-ctl), walk
//  the trade's REAL option_quotes mid path from its actual entry fill and replay a
//  ratchet exit policy. Banked per position id into data/ratchet-shadow.json
//  (idempotent upsert, survives the 7d quote prune) → the A4 read gets a THREE-WAY
//  verdict (prem-stop vs u-stop vs ratchet) on identical trades.
//
//  POLICY (FIXED 2026-07-08 BEFORE any results were computed — registry
//  instrumentation-log entry; do NOT tune post-hoc):
//   · pre-arm: policy −50% premium stop (a complete policy needs a disaster floor)
//   · arm when mid reaches entry × 1.50 (+50%)
//   · once armed: floor = entry + (peak − entry) × 2/3, ratcheting up with each
//     new peak; exit at the floor (keep ≥ two-thirds of the peak gain)
//   · never exited → flatten on the session's last quote (the twins' own EOD)
//   · per-quote ordering mirrors the live sweep: exits check BEFORE the peak
//     updates (a fresh high can't fire its own floor on the same quote)
//
//  HONESTY NOTES (printed + banked): mid-basis fills at the level (gate-shadow
//  convention); entry = the trade's REAL fill. PER-TRADE counterfactual only —
//  a live ratchet arm would free the one-at-a-time slot at different times and
//  spawn different re-entries (the +75%-cap lesson); the slot-path is unknowable
//  post-hoc, so totals are per-arm-stream, not a portfolio claim. Same framing
//  as the override ledger's ride-to-close. Log-only, never a gate (A7-style).
//
//    npm run ratchet-shadow            # replay all A4-window twin trades (since 07-01)
//  Runs nightly in the capture close pass (quotes must be inside the 7d window).
// ============================================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* ignore */ }
}

const LEDGER = "data/ratchet-shadow.json";
const SINCE = "2026-07-01T04:00:00Z"; // A4 armed 2026-07-01
const TWINS = ["orb-ustop", "orb-ustop-ctl"];
// FIXED policy params — see header. Do not tune after seeing results.
const ARM_PCT = 50;
const KEEP_FRAC = 2 / 3;
const PRE_ARM_STOP_PCT = 50;

interface RatchetRow {
  posId: string; slug: string; occ: string; openedAt: string;
  entry: number; qty: number;
  actualReason: string; actualPnlCt: number;      // the real arm's outcome ($/contract)
  ratchetReason: string; ratchetExit: number | null; ratchetPnlCt: number | null;
  peakPct: number; armed: boolean; nQuotes: number;
  params: string; basis: "mid-level";
}

function loadLedger(): Map<string, RatchetRow> {
  if (!existsSync(LEDGER)) return new Map();
  try { return new Map((JSON.parse(readFileSync(LEDGER, "utf8")) as RatchetRow[]).map((r) => [r.posId, r])); }
  catch { return new Map(); }
}

async function main() {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });

  const { data: strat, error: se } = await sb.from("strategists").select("id,slug").in("slug", TWINS);
  if (se || (strat ?? []).length !== 2) { console.error(`ratchet-shadow: twins lookup failed (${se?.message ?? (strat ?? []).length + "/2"})`); process.exit(1); }
  const slugById = new Map((strat ?? []).map((s: any) => [s.id, s.slug]));

  const { data: pos, error: pe } = await sb.from("positions")
    .select("id,strategist_id,occ_symbol,qty,avg_entry_price,realized_pnl,close_reason,opened_at,closed_at,peak_mark")
    .in("strategist_id", [...slugById.keys()]).eq("status", "closed").gte("opened_at", SINCE)
    .order("opened_at", { ascending: true });
  if (pe) { console.error(`ratchet-shadow: positions read failed — ${pe.message}`); process.exit(1); }

  const ledger = loadLedger();
  let fresh = 0, unscored = 0;

  for (const p of (pos ?? []) as any[]) {
    if (ledger.has(p.id)) continue;
    const entry = Number(p.avg_entry_price);
    const dayEnd = `${String(p.opened_at).slice(0, 10)}T23:59:59Z`;
    // full quote paging (the silent-truncation lesson): a session path is ~390 rows,
    // but page defensively anyway
    const quotes: { m: number; t: string }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data: q, error: qe } = await sb.from("option_quotes").select("mid,captured_at")
        .eq("occ_symbol", p.occ_symbol).gte("captured_at", p.opened_at).lte("captured_at", dayEnd)
        .order("captured_at", { ascending: true }).order("id", { ascending: true }).range(from, from + 999);
      if (qe) { console.error(`ratchet-shadow: quotes read failed — ${qe.message}`); process.exit(1); }
      for (const r of (q ?? []) as any[]) if (Number(r.mid) > 0) quotes.push({ m: Number(r.mid), t: String(r.captured_at) });
      if ((q ?? []).length < 1000) break;
    }
    const row: RatchetRow = {
      posId: p.id, slug: slugById.get(p.strategist_id)!, occ: p.occ_symbol, openedAt: p.opened_at,
      entry, qty: Number(p.qty),
      actualReason: String(p.close_reason ?? "?"), actualPnlCt: Math.round((Number(p.realized_pnl) / Number(p.qty)) * 100) / 100,
      ratchetReason: "no_quotes", ratchetExit: null, ratchetPnlCt: null,
      peakPct: Math.round(100 * (Number(p.peak_mark) / entry - 1)), armed: false, nQuotes: quotes.length,
      params: `arm${ARM_PCT}/keep${Math.round(KEEP_FRAC * 100)}/pre${PRE_ARM_STOP_PCT}`, basis: "mid-level",
    };
    if (quotes.length) {
      const armLv = entry * (1 + ARM_PCT / 100);
      const preStopLv = entry * (1 - PRE_ARM_STOP_PCT / 100);
      let peak = entry, armed = false, exit = quotes[quotes.length - 1].m, reason = "would_flatten";
      for (const q of quotes) {
        if (armed) {
          const floor = entry + (peak - entry) * KEEP_FRAC;
          if (q.m <= floor) { exit = floor; reason = "ratchet_floor"; break; }
        } else if (q.m <= preStopLv) { exit = preStopLv; reason = "pre_arm_stop"; break; }
        if (q.m > peak) { peak = q.m; if (!armed && q.m >= armLv) armed = true; }
      }
      row.armed = armed;
      row.ratchetExit = Math.round(exit * 100) / 100;
      row.ratchetReason = reason;
      row.ratchetPnlCt = Math.round((exit - entry) * 100 * 100) / 100;
    } else unscored++;
    ledger.set(p.id, row);
    fresh++;
  }

  mkdirSync("data", { recursive: true });
  const rows = [...ledger.values()].sort((a, b) => a.openedAt.localeCompare(b.openedAt));
  writeFileSync(LEDGER, JSON.stringify(rows, null, 1));

  // ── three-way read ──
  const sgn = (v: number) => `${v < 0 ? "-" : "+"}$${Math.abs(Math.round(v))}`;
  console.log(`\n  RATCHET SHADOW — the A4 twins' virtual third arm (${rows[0]?.params ?? ""} · mid-level fills · per-trade, slot-path caveat applies)`);
  console.log(`  ${String("date").padEnd(6)}${"arm".padEnd(14)}${"occ".padEnd(10)}${"peak".padStart(6)}${"actual".padStart(9)}  ${"".padEnd(16)}${"ratchet".padStart(9)}  ${"Δ/ct".padStart(8)}`);
  for (const r of rows) {
    if (r.ratchetPnlCt == null) { console.log(`  ${r.openedAt.slice(5, 10)} ${r.slug.padEnd(14)}${r.occ.slice(9).padEnd(10)}  — quotes pruned (${r.actualReason})`); continue; }
    const d = r.ratchetPnlCt - r.actualPnlCt;
    console.log(`  ${r.openedAt.slice(5, 10)} ${r.slug.padEnd(14)}${r.occ.slice(9).padEnd(10)}${(r.peakPct + "%").padStart(6)}${sgn(r.actualPnlCt).padStart(9)}  ${("(" + r.actualReason + ")").padEnd(16)}${sgn(r.ratchetPnlCt).padStart(9)}  ${sgn(d).padStart(8)} ${r.ratchetReason === "ratchet_floor" ? "⚑" : r.ratchetReason === "pre_arm_stop" ? "×" : "→bell"}`);
  }
  for (const slug of TWINS) {
    const rs = rows.filter((r) => r.slug === slug && r.ratchetPnlCt != null);
    if (!rs.length) continue;
    const act = rs.reduce((a, r) => a + r.actualPnlCt * r.qty, 0);
    const rat = rs.reduce((a, r) => a + (r.ratchetPnlCt ?? 0) * r.qty, 0);
    console.log(`\n  Σ ${slug} (${rs.length}t, position-sized): actual ${sgn(act)} vs ratchet ${sgn(rat)} → Δ ${sgn(rat - act)} · armed on ${rs.filter((r) => r.armed).length}/${rs.length}`);
  }
  console.log(`\n  banked ${fresh} new / ${rows.length} total → ${LEDGER}${unscored ? ` · ⚠ ${unscored} unscored (quotes pruned — run nightly)` : ""}`);
  console.log(`  ⚠ log-only instrumentation (registry): params fixed pre-results; never a gate; the A4 read arbitrates.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
