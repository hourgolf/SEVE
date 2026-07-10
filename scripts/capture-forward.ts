// ============================================================================
//  capture-forward — the ONE nightly job that banks every day's forward data so
//  the data flywheel never starves. (2026-06-19.)
//
//  THE PROBLEM IT FIXES: the desk's richest forward signal — option_quotes (the
//  intra-trade premium paths) — PRUNES at 7d and is NOT reconstructable, and the
//  override ledger reconstructs ride-to-close FROM those quotes (so it too must run
//  inside 7d). The "run export-quotes / day-report same-week" rituals were MANUAL —
//  every week nobody ran them, that data was lost forever. This automates them.
//
//  It runs the existing scripts (no logic duplicated), each idempotent + catch-up:
//   · TIER 1 (irreplaceable, MUST succeed): export-quotes + export-bars — verbatim
//     archive of the option NBBO + 1-min tape to data/*-archive (the corpus only grows).
//   · TIER 2 (live-window, best-effort): day-report for the last N ET days (upserts the
//     override + foul-out ledgers from the still-live quotes; publishes the forensics
//     panel) + build-training-store (accumulates the conviction-sizing dataset).
//
//  Children inherit env (this runs via `tsx --env-file=.env.local`), so the spawned
//  `npm run …` scripts get the Supabase anon key without their own --env-file.
//
//  Idempotent: re-running re-exports only un-archived days (the last archived day is
//  always re-done in case it was partial). Safe to run twice a day / on every wake →
//  combined with the launchd schedule + the catch-up window, no day is lost unless the
//  Mac is off for the WHOLE 7d prune window (the GAP CHECK below screams if that nears).
//
//    npm run capture            # the nightly job (also run by launchd)
//    npm run capture -- --days 10   # widen the day-report catch-up window
// ============================================================================

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";

const ET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const etDate = (ms: number) => ET.format(new Date(ms));
const di = process.argv.indexOf("--days");
const CATCHUP_DAYS = di >= 0 && process.argv[di + 1] ? Math.max(1, Number(process.argv[di + 1])) : 6;
const now = Date.now();
const recentDays = Array.from({ length: CATCHUP_DAYS }, (_, i) => etDate(now - i * 86_400_000)); // today → back

const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const dur = (ms: number) => (ms / 1000).toFixed(1) + "s";

interface StepResult { label: string; ok: boolean; ms: number; tier: 1 | 2 }
const results: StepResult[] = [];

function run(label: string, args: string[], tier: 1 | 2): boolean {
  const t0 = Date.now();
  process.stdout.write(`\n▶ ${label} … `);
  // inherit stdio so the child's own progress shows in the launchd log; inherit env (Supabase key loaded by --env-file)
  const r = spawnSync("npm", ["run", ...args], { stdio: "inherit", env: process.env });
  const ok = r.status === 0 && !r.error;
  results.push({ label, ok, ms: Date.now() - t0, tier });
  if (!ok) process.stdout.write(`\n✗ ${label} FAILED (${r.error?.message ?? `exit ${r.status}`})\n`);
  return ok;
}

// ── archive coverage / gap check ──────────────────────────────────────────────
function latestArchived(dir: string, ext: string): string | null {
  if (!existsSync(dir)) return null;
  const days = readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => f.slice(0, 10)).sort();
  return days.length ? days[days.length - 1] : null;
}
// trading-day distance ≈ calendar days minus weekends (rough; good enough to flag a real gap)
function tradingDaysBehind(latest: string | null): number {
  if (!latest) return 999;
  let count = 0;
  for (let ms = now; etDate(ms) > latest; ms -= 86_400_000) { const d = new Date(ms).getUTCDay(); if (d !== 0 && d !== 6) count++; if (count > 30) break; }
  return count;
}

async function main() {
  console.log(`\n══ capture-forward · ${stamp()} · catch-up ${CATCHUP_DAYS}d ══`);

  // CLOSE PASS (2026-07-07) — TODAY's panel-facing totals FIRST, so the §03 dashboard
  // (forensics payload · benched-vs-live · one-account shadow · give-back · LAB gate rows)
  // lands minutes after the bell, beside the 16:05 ET autopsy — not after the archival
  // work. Safe to front-run Tier 1: both scripts read the LIVE DB (not the archives),
  // they're idempotent, the engine fail-fasts on a partial quote tape (no silent modeled
  // numbers under load), and the tape-first guarantee is preserved — exports still run
  // every cycle below plus the 02:15 catch-up, and option_quotes hold 7d (the GAP CHECK
  // screams long before loss). Scheduled via launchd at 13:03 local (16:03 ET).
  run(`day-report ${recentDays[0]} (close pass)`, ["day-report", "--", "--date", recentDays[0]], 2);
  run("gate-shadow (close pass)", ["gate-shadow"], 2);
  // ratchet-shadow (2026-07-08): the A4 twins' virtual third arm — replays each twin trade's
  // real quote path under the fixed arm-high ratchet, banked before the 7d prune. Log-only.
  run("ratchet-shadow (close pass)", ["ratchet-shadow"], 2);
  // stairstep-shadow (2026-07-10, registry R1b): three-arm replay of the TP'd trend channels —
  // LOCK all-out (as lived) vs runner-only vs the operator's stairstep (TP-half → freed size
  // takes the next rung). Banks before the 7d prune; log-only, reads behind R1 at A6.
  run("stairstep-shadow (close pass)", ["stairstep-shadow"], 2);

  // TIER 1 — the irreplaceable raw tape (idempotent: writes only un-archived days)
  const quotesOk = run("export-quotes", ["export-quotes"], 1);
  const barsOk = run("export-bars", ["export-bars"], 1);

  // CLEAN BOOKS — keep the desk's per-channel P&L tied out to the broker so all analysis runs on truth.
  //  · reconcile-alpaca (READ-ONLY) verifies the books vs the real Alpaca fills across all 3 accounts +
  //    writes the durable broker-truth snapshot. It exits non-zero on real drift (≥$200) or unreachable
  //    accounts → flagged in the summary. It does NOT auto-correct: the worker books row-primary going
  //    forward, so drift means investigate the worker, never silently rewrite the books (run --fix --write
  //    by hand once confirmed). Tier 1 because corrupted books poison every downstream verdict.
  //  · backfill-forensics regenerates data/forensics-dataset.jsonl off the now-clean books (the LLM
  //    analysis substrate) — best-effort.
  const booksOk = run("reconcile-alpaca", ["reconcile-alpaca"], 1);
  run("backfill-forensics", ["backfill-forensics"], 2);
  // SENTINEL (2026-07-09): the nightly opportunity + drift scan — the avg-peak harvest lens across
  // live channels (forensics) + the virtual bench (gate-shadow peak), then the key-gated LLM
  // judgment layer (grounded in docs/sentinel-context.md). Runs AFTER the substrate is fresh
  // (gate-shadow + backfill-forensics above). Log-only, shadow-first: banks data/sentinel/<date>.md
  // for review; paging is the graduation step. Best-effort — never blocks the tape capture.
  run("sentinel", ["sentinel"], 2);

  // TIER 2 — live-window analyses (best-effort; the ledger needs the still-live 7d quotes)
  // Catch-up for the REMAINING days (today already published by the close pass above).
  // Sequencing history: 2026-07-06 pinned day-report after Tier 1 because DB load could
  // silently degrade its sims to Black-Scholes (the −144.96/−487.31 two-state flicker);
  // the engine now retries each quote page 4× and FAIL-FASTS on a partial tape, which is
  // what makes the close pass safe — load yields a loud "sim failed:" note, never a wrong
  // number, and the next run self-heals (idempotent upserts, catch-up window 6d).
  // INCLUDES today (2026-07-09 fix): the fast close-pass day-report above ran BEFORE ratchet-shadow +
  // reconcile, so its §03 ratchet summary was a day stale; re-running today here (post-ratchet-shadow,
  // post-reconcile) republishes the panel with the complete, settled ledger. day-report is idempotent.
  for (const d of recentDays) run(`day-report ${d}`, ["day-report", "--", "--date", d], 2);
  run("build-training-store", ["build-training-store"], 2);
  // WEEKLY READOUT (approved 2026-07-02): Fridays only — the week's aggregate interrogation
  // of the banked data (rollup + near-miss + vb-fleet-vs-prior + gate counters). Analysis
  // only; scheduling it here is the whole point (the re-mine cadence was a memory note).
  // iv-bank (2026-07-05): the dealer-positioning clock — daily OI/IV/GEX surface snapshot
  // (session-gated internally; the IV-rank series only exists if this runs every day).
  run("iv-bank", ["iv-bank"], 2);
  const [ey, em, ed] = etDate(now).split("-").map(Number);
  const isFriday = new Date(Date.UTC(ey, em - 1, ed)).getUTCDay() === 5;
  if (isFriday) {
    run("weekly-readout", ["weekly-readout"], 2);
    // Weekly rituals promoted from memory-dependent to scheduled (2026-07-05): drift
    // detection + the operator-override scorecard. Both read-only.
    run("mfe-drift", ["mfe-drift"], 2);
    run("override-scorecard", ["override-scorecard"], 2);
  }
  // evening digest (2026-07-05): the ten-line ops push — per-bucket day P&L, era-4/A6
  // progress, heartbeat + capture health. Deterministic, informational only.
  run("evening-digest", ["evening-digest"], 2);
  // A6 AUTOPILOT (2026-07-05): counts era-4 sessions; T-1 heads-up push, and AT TRIGGER
  // auto-generates the decision memo (full read + pre-filled SQL per registered decision)
  // + pushes the headline. Decides nothing — the operator's word stays the gate.
  run("a6-watch", ["a6-watch"], 2);
  // OFF-SITE BACKUP — LAST, so tonight's exports/ledgers/iv-bank all ride this push.
  // The quotes tape is the one artifact a dead Mac cannot re-create.
  run("backup-archives", ["backup-archives"], 2);

  // ── summary ──
  console.log(`\n══ summary · ${stamp()} ══`);
  for (const r of results) console.log(`  [T${r.tier}] ${r.ok ? "✓" : "✗"} ${r.label.padEnd(26)} ${dur(r.ms).padStart(7)}`);

  const qLatest = latestArchived("data/quotes-archive", ".json.gz");
  const sLatest = latestArchived("data/bars-archive/SPY", ".json");
  const qBehind = tradingDaysBehind(qLatest);
  console.log(`\n  quotes archive → latest ${qLatest ?? "NONE"} (${qBehind} trading day(s) behind) · bars(SPY) → latest ${sLatest ?? "NONE"}`);

  // GAP CHECK — the whole point. option_quotes prune at 7d, so >~5 trading days behind = at risk of permanent loss.
  let exit = 0;
  if (!quotesOk) { console.log(`\n  ✗ CRITICAL — export-quotes FAILED. The 7d tape is at risk; fix env/network and re-run TODAY.`); exit = 1; }
  else if (qBehind >= 5) { console.log(`\n  ⚠ GAP — quotes archive is ${qBehind} trading days behind (prune is ~7d). Data may already be LOST. Investigate the schedule.`); exit = exit || 2; }
  else if (qBehind >= 3) { console.log(`\n  ⚠ quotes archive is ${qBehind} trading days behind — within the 7d window but watch it; the Mac may be missing runs.`); }
  else { console.log(`\n  ✓ tape captured — corpus current (≤2 trading days behind). The flywheel is fed.`); }

  // CLEAN-BOOKS verdict (the new nightly guarantee) — separate from the tape gap check above.
  if (booksOk) console.log(`\n  ✓ clean books — desk P&L ties out to the broker; forensics dataset regenerated off clean books.`);
  else { console.log(`\n  ⚠ CLEAN BOOKS — reconcile-alpaca flagged drift or unreachable accounts (see above). The books may NOT tie out; investigate the worker's booking before trusting the dataset, then 'npm run reconcile-alpaca -- --fix --write' once confirmed.`); exit = exit || 3; }

  const t1Fail = results.some((r) => r.tier === 1 && !r.ok);
  const t2Fail = results.filter((r) => r.tier === 2 && !r.ok).length;
  if (t2Fail) console.log(`  · ${t2Fail} best-effort step(s) failed (non-fatal — the raw tape is what's irreplaceable).`);
  process.exit(t1Fail ? 1 : exit);
}
main().catch((e) => { console.error(`capture-forward fatal — ${(e as Error).message}`); process.exit(1); });
