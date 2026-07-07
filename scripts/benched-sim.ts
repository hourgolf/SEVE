// ============================================================================
//  benched-sim — "would the cut channels have earned their bench today?"
//
//  The honest head-to-head the cull rests on, run on a SINGLE live day. Benched
//  (status='draft') channels are evaluated by the worker but their entries are
//  BLOCKED (not_armed) — no position, no P&L. This replays each one's REAL strategy
//  + REAL exit stack (the trail/target/stop the live worker runs — NOT a ride-to-
//  close proxy) over today's tape + today's REAL option NBBO (option_quotes, the
//  same-week source that dodges the Databento T+1 embargo), with the channel's REAL
//  RISK/cost-gate/u-stop config. Then compares the would-be P&L to the live roster's
//  actual P&L for the day.
//
//  Faithfulness: it drives engine/backtest.ts (--options quotes + the --risk/--ustop/
//  --cost-gate/--prem-stop faithful-config flags) with worker-parity slug resolution —
//  exact-first-then-base builtins passed to --strat by their RESOLVED name (decide.ts
//  buildEvaluator precedence) vs compiled spec_json for everything else. Known
//  minor gaps vs live: the cutoff→1DTE roll (backtest sims 0DTE) and power's +100%
//  giveback trail (not modeled) — both noted; neither changes the verdict's sign.
//
//    npm run benched-sim                  (today ET)
//    npm run benched-sim -- --date 2026-06-15
//  Read-only. option_quotes prune at 7d → run SAME-WEEK (older dates skip with a note).
// ============================================================================

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function loadEnv() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) return; // day-report runs with --env-file already
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* ignore */ }
}

// Mirror the worker's slug resolution (engine/registry.ts + decide.ts buildEvaluator, ~L159):
// EXACT slug first, else the base slug — the same strip chain decide.ts runs (-N / -manual /
// -qqq|spy / -itm); a registry built-in runs as CODE, everything else uses spec_json. The sim
// must pass the RESOLVED name to the engine: backtest.ts strips only -qqq/-spy and used to
// fall through to FADE for any slug its ternary didn't know — that's the pre-06-30 forensics
// mirage where the three -manual twins replayed with identical trades+P&L (all three were
// running fade). Fixed 2026-07-06, alongside a fail-fast on unknown --strat in backtest.ts.
const BUILTINS = new Set(["breakout", "power", "power-final30", "grind", "grind-v2", "grind-v3", "pb-ride", "fade"]);
// Registry CODE the engine CLI can't run — backtest.ts has no pullback branch (the pb probes
// import buildPullback directly). Flag it honestly; never let it reach the engine's ternary.
const NO_ENGINE_STRAT = new Set(["pb-ride"]);
const baseSlug = (s: string) => s.replace(/-\d+$/, "").replace(/-manual$/i, "").replace(/-(qqq|spy)$/i, "").replace(/-itm$/i, "");
export const resolveBuiltin = (slug: string): string | null =>
  BUILTINS.has(slug) ? slug : BUILTINS.has(baseSlug(slug)) ? baseSlug(slug) : null;
// Channels whose entries land inside the 0DTE cutoff (OPEN_0DTE_CUTOFF_MIN=31) → the live worker
// rolls them to the NEXT-session expiry (decide.ts:289). The sim fills the 0DTE chain only, so a
// 1DTE-only channel's P&L is NOT comparable (premium ~2-3× / different theta). Flag, don't sim.
const FINAL_WINDOW = new Set(["power-final30", "power-final35", "power-mom30", "power-mom35"]);

// TSX_BIN lets the worker's shadow-publish (cwd /app, deps under /app/worker) pass an absolute path.
const TSX = process.env.TSX_BIN || join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");

export interface BenchedResult { slug: string; name: string; underlying: string; useSpec: boolean; ran: boolean; trades: number; pnl: number; note?: string; }
export interface LiveResult { slug: string; name: string; pnl: number; trades: number; }
export interface BenchedVsLive { date: string; sameWeek: boolean; benched: BenchedResult[]; live: LiveResult[]; benchedTotal: number; liveTotal: number; skipped: { name: string; reason: string }[]; }

// Run one benched channel through the engine on the day's real NBBO with its real config.
function simChannel(s: { slug: string; name: string; underlying: string; spec_json: unknown; risk: number; maxC: number; dailyStop: number; ustop: number }, date: string): BenchedResult {
  const u = (s.underlying || "SPY").toUpperCase();
  const builtin = resolveBuiltin(s.slug);
  const useSpec = builtin == null && s.spec_json != null;
  // Fail HONEST, not silent: an unresolvable slug with no spec has nothing to replay, and a
  // pb-ride-family draft would need engine code that doesn't exist — both used to fall through
  // to the engine's fade default and bank a mirage P&L.
  if (builtin == null && s.spec_json == null)
    return { slug: s.slug, name: s.name, underlying: u, useSpec: false, ran: false, trades: 0, pnl: 0, note: "no builtin match + no spec_json — nothing to sim" };
  if (builtin != null && NO_ENGINE_STRAT.has(builtin))
    return { slug: s.slug, name: s.name, underlying: u, useSpec: false, ran: false, trades: 0, pnl: 0, note: `${builtin} is worker-only code — engine has no --strat for it` };
  const emit = join(tmpdir(), `seve-benched-${s.slug.replace(/[^a-z0-9-]/gi, "_")}.json`);
  const specPath = join(tmpdir(), `seve-benched-spec-${s.slug.replace(/[^a-z0-9-]/gi, "_")}.json`);
  const daysBack = Math.ceil((Date.now() - Date.parse(date + "T00:00:00Z")) / 86_400_000) + 5;
  const args = ["engine/backtest.ts", "--strat", builtin ?? s.slug, "--underlying", u, "--source", "real", "--options", "quotes",
    "--from", date, "--to", date, "--days", String(daysBack),
    "--risk", String(s.risk), "--max-contracts", String(s.maxC), "--daily-stop", String(s.dailyStop),
    "--cost-gate", "3.0", "--prem-stop", "50", "--ustop", String(s.ustop), "--emit-trades", emit];
  if (useSpec) { writeFileSync(specPath, JSON.stringify(s.spec_json)); args.push("--spec", specPath); }
  try {
    try { if (existsSync(emit)) rmSync(emit); } catch { /* ignore */ } // never read a stale prior emit
    execFileSync(TSX, args, { encoding: "utf8", stdio: ["ignore", "ignore", "ignore"], maxBuffer: 1 << 24, timeout: 60_000, killSignal: "SIGKILL" });
    if (!existsSync(emit)) return { slug: s.slug, name: s.name, underlying: u, useSpec, ran: false, trades: 0, pnl: 0, note: "no session data (no fills emitted)" };
    const out = JSON.parse(readFileSync(emit, "utf8")) as { perDay: { date: string; pnl: number; trades: number }[] };
    const d = out.perDay.find((p) => p.date === date) ?? { pnl: 0, trades: 0 };
    // A resolved clone (e.g. breakout-2 → breakout) notes which code actually ran — the
    // banked payload is the audit trail the -manual mirage hid in.
    return { slug: s.slug, name: s.name, underlying: u, useSpec, ran: true, trades: d.trades, pnl: Math.round(d.pnl), ...(builtin && builtin !== s.slug ? { note: `ran builtin "${builtin}"` } : {}) };
  } catch (e) {
    return { slug: s.slug, name: s.name, underlying: u, useSpec, ran: false, trades: 0, pnl: 0, note: `sim failed: ${(e as Error).message.split("\n")[0]}` };
  } finally {
    for (const p of [emit, specPath]) { try { if (existsSync(p)) rmSync(p); } catch { /* ignore */ } }
  }
}

export async function benchedVsLive(date: string): Promise<BenchedVsLive> {
  loadEnv();
  const sb: SupabaseClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const todayET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const ageDays = Math.round((Date.parse(todayET) - Date.parse(date)) / 86_400_000);
  const sameWeek = ageDays >= 0 && ageDays <= 6; // option_quotes 7d retention

  // live actual P&L (armed roster) for the day
  const { data: posRaw } = await sb.from("positions")
    .select("realized_pnl,strategists(slug,name,status)")
    .eq("status", "closed").gte("closed_at", `${date}T13:00:00Z`).lte("closed_at", `${date}T22:00:00Z`);
  const live = new Map<string, LiveResult>();
  for (const p of (posRaw ?? []) as any[]) {
    if (p.strategists?.status !== "armed") continue;
    const slug = p.strategists.slug, name = p.strategists.name ?? slug;
    const r = live.get(slug) ?? { slug, name, pnl: 0, trades: 0 };
    r.pnl += Number(p.realized_pnl ?? 0); r.trades += 1; live.set(slug, r);
  }
  const liveArr = [...live.values()].map((r) => ({ ...r, pnl: Math.round(r.pnl) })).sort((a, b) => b.pnl - a.pnl);
  const liveTotal = liveArr.reduce((a, r) => a + r.pnl, 0);

  const benched: BenchedResult[] = [];
  const skipped: { name: string; reason: string }[] = [];
  if (!sameWeek) return { date, sameWeek, benched, live: liveArr, benchedTotal: 0, liveTotal, skipped };

  // benched roster + config
  const { data: draftRaw } = await sb.from("strategists")
    .select("id,slug,name,underlying,spec_json,strategist_config(capital_pct,max_contracts,daily_stop_usd,underlying_stop_pct,entry_dte)")
    .eq("status", "draft")
    // vb-* EXCLUDED (2026-07-06): the virtual-bench fleet has its OWN replay pipeline
    // (gate-shadow → virtual_trades → the §03 LAB panel) anchored to the LIVE signal
    // stream + config TP/stop. Simulating them here too double-reported every vb channel
    // under DIFFERENT physics (engine-derived entries, spec exits, NBBO-crossing fills) —
    // e.g. 07-06 vb-macd-state read +$825 here vs −$48 in LAB. One channel, one simulator:
    // this sweep owns the CULLED drafts; the LAB pipeline owns the fleet.
    .not("slug", "like", "vb-%");
  const drafts = ((draftRaw ?? []) as any[]).map((s) => {
    const c = Array.isArray(s.strategist_config) ? s.strategist_config[0] : s.strategist_config;
    return { id: s.id, slug: s.slug, name: s.name ?? s.slug, underlying: s.underlying ?? "SPY", spec_json: s.spec_json,
      risk: Number(c?.capital_pct ?? 350), maxC: Number(c?.max_contracts ?? 6), dailyStop: Number(c?.daily_stop_usd ?? 350), ustop: Number(c?.underlying_stop_pct ?? 0), entryDte: Number(c?.entry_dte ?? 0) };
  });

  // only sim drafts that produced an ENTRY intent today (signal logged) — a channel that
  // never signaled would-be-trade nothing; skip it (faster + honest). disabled channels excluded.
  const { data: sigRaw } = await sb.from("signals").select("strategist_id")
    .gte("created_at", `${date}T13:00:00Z`).lte("created_at", `${date}T22:00:00Z`);
  const signaled = new Set(((sigRaw ?? []) as any[]).map((r) => r.strategist_id));
  for (const d of drafts) {
    if (!signaled.has(d.id)) { skipped.push({ name: d.name, reason: "no entry signal today" }); continue; }
    // 1DTE-live channels (entry_dte=1, or a final-window strategy whose entries roll past the
    // 0DTE cutoff) can't be faithfully sim'd on the 0DTE chain → flag, don't fold into the Σ.
    if (d.entryDte >= 1 || FINAL_WINDOW.has(baseSlug(d.slug))) {
      benched.push({ slug: d.slug, name: d.name, underlying: (d.underlying || "SPY").toUpperCase(), useSpec: false, ran: false, trades: 0, pnl: 0, note: "1DTE live — sim is 0DTE, NOT comparable" });
      continue;
    }
    benched.push(simChannel(d, date));
  }
  benched.sort((a, b) => b.pnl - a.pnl);
  const benchedTotal = benched.reduce((a, r) => a + (r.ran ? r.pnl : 0), 0);
  return { date, sameWeek, benched, live: liveArr, benchedTotal, liveTotal, skipped };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const sgn = (v: number) => (v >= 0 ? "+" : "") + Math.round(v);
async function cli() {
  const di = process.argv.indexOf("--date");
  const date = di >= 0 && process.argv[di + 1] ? process.argv[di + 1] : new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const r = await benchedVsLive(date);
  console.log(`\nBENCHED would-be vs LIVE actual — ${date} (ET)\n`);
  if (!r.sameWeek) { console.log(`  ⚠ ${date} is outside the 7-day option_quotes window — can't reconstruct fills. Run same-week.\n`); return; }
  console.log(`live actual (armed roster): ${sgn(r.liveTotal)} over ${r.live.length} channels`);
  for (const l of r.live) console.log(`  ${l.name.padEnd(24)} ${String(l.trades).padStart(2)}t  ${sgn(l.pnl).padStart(7)}`);
  console.log(`\nbenched would-be (real strategy + exits on real NBBO, real RISK/cost-gate/u-stop):`);
  if (!r.benched.length) console.log(`  (no benched channel signaled today)`);
  for (const b of r.benched) console.log(`  ${b.name.padEnd(24)} ${b.ran ? `${String(b.trades).padStart(2)}t  ${sgn(b.pnl).padStart(7)}  [${b.useSpec ? "spec" : "builtin"}/${b.underlying}]` : `— ${b.note}`}`);
  for (const s of r.skipped) console.log(`  ${s.name.padEnd(24)} —  (${s.reason})`);
  if (r.benched.some((b) => b.ran)) console.log(`\n  Σ benched would-be ${sgn(r.benchedTotal)} vs Σ live actual ${sgn(r.liveTotal)}  → arming the (comparable) bench today would have ${r.benchedTotal >= 0 ? "ADDED" : "COST"} $${Math.abs(r.benchedTotal).toLocaleString()}`);
  else console.log(`\n  (no comparable benched sim ran — nothing to total)`);
  console.log(`  ⚠ one day = noise; the cull rests on the 5-window evidence. Model gaps: 0DTE chain (final-window/entry_dte=1 channels flagged not-comparable; other channels' last-31-min entries are 0DTE-modeled), power +100% giveback not modeled.\n`);
}
if (process.argv[1]?.endsWith("benched-sim.ts")) cli().catch((e) => { console.error(e); process.exit(1); });
