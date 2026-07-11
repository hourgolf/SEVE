// ============================================================================
//  stairstep-shadow — R1b's replay instrument (2026-07-10, registry R1b).
//
//  THE QUESTION (operator's design): when a TP fires, sell half and let the freed
//  contracts take the channel's NEXT signal — in a trend that paid the TP, that's a
//  fresh ATM strike higher ("stairstepping a trendline"). Does runner+ladder beat
//  both the all-out LOCK (as lived) and a runner-only policy?
//
//  THREE ARMS on the channel's IDENTICAL as-lived trade sequence, per ET day:
//   (a) LOCK all-out   — actual realized (as lived: TP 100% → flat → next signal full size).
//   (b) R1 runner-only — first TP: sell ½ at the actual TP exit, ½ rides as a runner;
//       the runner OCCUPIES the channel slot → all subsequent same-day entries SKIPPED
//       (the current one-row-per-channel guard, honestly priced).
//   (c) R1b stairstep  — TP: sell ½, ½ rides as a runner, AND subsequent entries execute
//       at the freed fraction (×½ while any runner rides). Each rung that TPs spawns its
//       own runner (the ladder). Non-TP exits realize as lived × the size multiplier.
//
//  RUNNER POLICY (FIXED 2026-07-10 BEFORE any results — do NOT tune post-hoc; the
//  keep-⅔ family, consistent with ratchet-shadow):
//   · runner peak starts at the TP exit level; floor = entry + (peak − entry) × ⅔,
//     ratcheting up with each new peak (give back ≤ ⅓ of the secured gain);
//   · never floored → flatten on the session's last quote (EOD);
//   · walked on the REAL option-quote mid path from the actual TP close time
//     (DB 7d retention; verbatim quotes archive for pruned days).
//
//  HONESTY NOTES (printed + banked): mid-basis runner fills; TP'd tranche priced at the
//  ACTUAL exit; subsequent-rung P&L = as-lived realized × size multiplier (same entries,
//  same exits — the arm deltas are pure policy). v1 first-order sizing: the budget halves
//  while ANY runner rides (not per-runner compounding). Slot-aware BY CONSTRUCTION (the
//  replay owns the channel's whole day). Log-only, never a gate (A7-style). NO ARM from
//  this — R1b reads after R1 configures at A6.
//
//    npm run stairstep-shadow            # replay the candidate channels since era-4
//  Runs nightly in the capture close pass (after ratchet-shadow). Ledger:
//  data/stairstep-shadow.json.
// ============================================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { pageAll } from "../engine/pageAll";

function loadEnv() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* ignore */ }
}

const LEDGER = "data/stairstep-shadow.json";
const SINCE = "2026-06-30T04:00:00Z"; // era-4
// Registry R1b candidate book: the TP'd trend channels. momo excluded until A13 reads.
const CANDIDATES = ["breakout-alt-v3", "breakout-smart-entries", "pb-ride-2", "breakout"];
// FIXED policy params — see header. Do not tune after seeing results.
const FRAC = 0.5;          // runner fraction kept at TP
const KEEP_FRAC = 2 / 3;   // runner ratchet: keep ⅔ of (peak − entry)
const PARAMS = `frac${Math.round(FRAC * 100)}/keep${Math.round(KEEP_FRAC * 100)}`;

interface Trade {
  posId: string; slug: string; occ: string; openedAt: string; closedAt: string | null;
  entry: number; qty: number; realized: number; reason: string;
}
interface DayResult {
  d: string; slug: string; n: number; nTP: number; runnersScored: number; runnersUnscored: number;
  lockUsd: number; runnerUsd: number | null; stairUsd: number | null;
}
export interface StairLedger { params: string; generatedAt: string; days: DayResult[] }

// ---- quote path (DB 7d → verbatim archive fallback), from a trade's CLOSE time ----
const archCache = new Map<string, { occ: string; m: number; t: string }[]>();
function archiveDay(date: string): { occ: string; m: number; t: string }[] | null {
  if (archCache.has(date)) return archCache.get(date)!;
  const f = `data/quotes-archive/${date}.json.gz`;
  if (!existsSync(f)) return null;
  try {
    const rows = (JSON.parse(gunzipSync(readFileSync(f)).toString("utf8")) as any[])
      .map((r) => ({ occ: String(r.occ_symbol), m: Number(r.mid), t: String(r.captured_at) }))
      .filter((r) => r.m > 0);
    archCache.set(date, rows);
    return rows;
  } catch { return null; }
}
async function quotesAfter(sb: SupabaseClient, occ: string, fromIso: string): Promise<{ m: number; t: string }[]> {
  const date = fromIso.slice(0, 10);
  const dayEnd = `${date}T23:59:59Z`;
  const out: { m: number; t: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: q, error } = await sb.from("option_quotes").select("mid,captured_at")
      .eq("occ_symbol", occ).gte("captured_at", fromIso).lte("captured_at", dayEnd)
      .order("captured_at", { ascending: true }).order("id", { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`quotes read: ${error.message}`);
    for (const r of (q ?? []) as any[]) if (Number(r.mid) > 0) out.push({ m: Number(r.mid), t: String(r.captured_at) });
    if ((q ?? []).length < 1000) break;
  }
  if (out.length) return out;
  const day = archiveDay(date);
  if (!day) return [];
  return day.filter((r) => r.occ === occ && r.t >= fromIso && r.t <= dayEnd)
    .sort((a, b) => a.t.localeCompare(b.t)).map((r) => ({ m: r.m, t: r.t }));
}

// runner ratchet walk (FIXED): peak starts at the spawn (TP) level; floor = entry + (peak−entry)·⅔
function walkRunner(entry: number, spawnLevel: number, quotes: { m: number }[]): number {
  let peak = Math.max(spawnLevel, entry);
  let exit = quotes.length ? quotes[quotes.length - 1].m : spawnLevel; // no path → flatten at spawn (conservative)
  for (const q of quotes) {
    const floor = entry + (peak - entry) * KEEP_FRAC;
    if (q.m <= floor) { exit = floor; break; }
    if (q.m > peak) peak = q.m;
  }
  return exit;
}

async function main() {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });

  const { data: strat, error: se } = await sb.from("strategists").select("id,slug").in("slug", CANDIDATES);
  if (se) throw new Error(`strategists read: ${se.message}`);
  const slugById = new Map((strat ?? []).map((s: any) => [s.id, s.slug]));

  // pageAll + id tiebreak (audit [17]): SINCE is the fixed era-4 epoch, so this window grows
  // monotonically. Ordered ascending, an un-paginated read past the 1000-row cap would silently drop
  // the NEWEST sessions — and the ledger is rewritten wholesale each night (no merge), so the
  // truncation is NOT self-healing. opened_at alone is not a total order.
  const pos = await pageAll<any>((off) => sb.from("positions")
    .select("id,strategist_id,occ_symbol,qty,avg_entry_price,realized_pnl,close_reason,opened_at,closed_at")
    .in("strategist_id", [...slugById.keys()]).eq("status", "closed").gte("opened_at", SINCE)
    .order("opened_at", { ascending: true }).order("id", { ascending: true }));

  const trades: Trade[] = (pos as any[]).map((p) => ({
    posId: p.id, slug: slugById.get(p.strategist_id)!, occ: p.occ_symbol,
    openedAt: p.opened_at, closedAt: p.closed_at ?? null,
    entry: Number(p.avg_entry_price), qty: Number(p.qty),
    realized: Number(p.realized_pnl ?? 0), reason: String(p.close_reason ?? "?"),
  }));

  // group per channel per ET day (opened_at date is a good-enough day key — 0/1DTE)
  const byDay = new Map<string, Trade[]>();
  for (const t of trades) { const k = `${t.openedAt.slice(0, 10)}|${t.slug}`; (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(t); }

  const days: DayResult[] = [];
  for (const [k, ts] of [...byDay.entries()].sort()) {
    const [d, slug] = k.split("|");
    ts.sort((a, b) => a.openedAt.localeCompare(b.openedAt));
    const isTP = (t: Trade) => t.reason === "target_premium";
    const lockUsd = ts.reduce((s, t) => s + t.realized, 0);

    // walk both counterfactual arms over the same sequence
    let runnerUsd = 0, stairUsd = 0, runnersScored = 0, runnersUnscored = 0, scoreOk = true;
    let bActiveRunner = false, bDone = false; // (b) runner-only: first TP spawns; rest skipped
    let cRunners = 0;                          // (c) stairstep: count of live runners (mult = ½ while ≥1)
    for (const t of ts) {
      const perCt = t.realized / Math.max(1, t.qty); // as-lived $/contract
      // ---- (b) runner-only ----
      if (!bDone) {
        if (isTP(t) && t.closedAt) {
          const qs = await quotesAfter(sb, t.occ, t.closedAt);
          const tpLevel = t.entry + perCt / 100; // actual exit level implied by realized/ct
          const exit = walkRunner(t.entry, tpLevel, qs);
          if (qs.length) runnersScored++; else runnersUnscored++;
          runnerUsd += 0.5 * t.realized + 0.5 * t.qty * (exit - t.entry) * 100;
          bActiveRunner = true; bDone = true; // runner rides to EOD → slot occupied all day
        } else {
          runnerUsd += t.realized; // full size until the first TP
        }
      } // after bDone: subsequent trades skipped (slot occupied) → contribute 0
      // ---- (c) stairstep ----
      const mult = cRunners > 0 ? FRAC : 1.0;
      if (isTP(t) && t.closedAt) {
        const qs = await quotesAfter(sb, t.occ, t.closedAt);
        const tpLevel = t.entry + perCt / 100;
        const exit = walkRunner(t.entry, tpLevel, qs);
        if (!qs.length) scoreOk = scoreOk && false;
        stairUsd += mult * (0.5 * t.realized + 0.5 * t.qty * (exit - t.entry) * 100);
        cRunners++;
      } else {
        stairUsd += mult * t.realized;
      }
    }
    void bActiveRunner;
    days.push({
      d, slug, n: ts.length, nTP: ts.filter(isTP).length,
      runnersScored, runnersUnscored,
      lockUsd: Math.round(lockUsd),
      runnerUsd: Math.round(runnerUsd),
      stairUsd: Math.round(stairUsd),
    });
  }

  mkdirSync("data", { recursive: true });
  const ledger: StairLedger = { params: PARAMS, generatedAt: new Date().toISOString(), days };
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));

  // ---- report ----
  const sgn = (v: number | null) => v == null ? "      —" : `${v < 0 ? "-" : "+"}$${Math.abs(v).toLocaleString()}`.padStart(8);
  console.log(`\n  STAIRSTEP SHADOW (R1b) — 3 arms on identical as-lived sequences (${PARAMS} · mid runner fills · slot-aware by construction)`);
  console.log(`  ${"day".padEnd(6)}${"channel".padEnd(24)}${"n".padStart(3)}${"TP".padStart(4)}${"(a) LOCK".padStart(10)}${"(b) runner".padStart(11)}${"(c) stair".padStart(10)}`);
  const bySlug = new Map<string, { lock: number; run: number; stair: number; n: number; nTP: number }>();
  for (const r of days) {
    console.log(`  ${r.d.slice(5).padEnd(6)}${r.slug.padEnd(24)}${String(r.n).padStart(3)}${String(r.nTP).padStart(4)}${sgn(r.lockUsd).padStart(10)}${sgn(r.runnerUsd).padStart(11)}${sgn(r.stairUsd).padStart(10)}${r.runnersUnscored ? "  ⚠" + r.runnersUnscored + " unscored" : ""}`);
    const e = bySlug.get(r.slug) ?? { lock: 0, run: 0, stair: 0, n: 0, nTP: 0 };
    e.lock += r.lockUsd; e.run += r.runnerUsd ?? 0; e.stair += r.stairUsd ?? 0; e.n += r.n; e.nTP += r.nTP;
    bySlug.set(r.slug, e);
  }
  console.log(`  ${"─".repeat(72)}`);
  let tLock = 0, tRun = 0, tStair = 0;
  for (const [slug, e] of [...bySlug.entries()].sort()) {
    console.log(`  Σ     ${slug.padEnd(24)}${String(e.n).padStart(3)}${String(e.nTP).padStart(4)}${sgn(Math.round(e.lock)).padStart(10)}${sgn(Math.round(e.run)).padStart(11)}${sgn(Math.round(e.stair)).padStart(10)}`);
    tLock += e.lock; tRun += e.run; tStair += e.stair;
  }
  console.log(`  Σ     ${"POOLED".padEnd(24)}${"".padStart(7)}${sgn(Math.round(tLock)).padStart(10)}${sgn(Math.round(tRun)).padStart(11)}${sgn(Math.round(tStair)).padStart(10)}`);
  const best = tStair >= tLock && tStair >= tRun ? "STAIRSTEP" : tLock >= tRun ? "LOCK all-out" : "runner-only";
  console.log(`\n  verdict (so far): ${best} leads · rungs only fire on target_premium exits (nTP above = ladder fuel)`);
  console.log(`  ⚠ log-only (registry R1b): v1 first-order sizing (budget ×${FRAC} while any runner rides); runner fills mid-basis;`);
  console.log(`     evidence accrues nightly — the read chains behind R1 at the A6 gate. NO ARM from this.\n`);
}
main().catch((e) => { console.error(`stairstep-shadow: ${(e as Error).message}`); process.exit(1); });
