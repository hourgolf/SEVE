// ============================================================================
//  ratchet-shadow — the A4 twins' virtual THIRD ARM (2026-07-08; v2 same day).
//
//  THE QUESTION: A4 tests prem-stop vs u-stop on identical bare-ORB entries, but
//  the operator's real fear is "letting +80% winners ride to −50%". The obvious
//  fix (hard TP) was already REFUTED on this spec (+75% cap → freed-slot re-entry
//  churn, −EV). The surviving exit idea from the pattern-fanout graveyard is the
//  ARM-HIGH RATCHET: let winners run, but once armed, never give most of it back.
//
//  WHAT IT DOES: for every CLOSED trade of the A4 twins (orb-ustop/orb-ustop-ctl,
//  since 07-01) AND their predecessor spec (orb-trend-rider, the bare ORB the
//  twins cloned — June trades, epoch-labeled), walk the trade's REAL option-quote
//  mid path from its actual entry fill and replay a ratchet exit. Quotes come
//  from the DB (7d retention) or, for pruned days, the verbatim quotes archive
//  (data/quotes-archive/<date>.json.gz — v2). Banked per position id into
//  data/ratchet-shadow.json (idempotent) → the A4 read gets a THREE-WAY verdict.
//
//  POLICY (FIXED 2026-07-08 BEFORE any results were computed — registry
//  instrumentation-log entry vi; do NOT tune post-hoc):
//   · pre-arm: policy −50% premium stop (a complete policy needs a disaster floor)
//   · arm when mid reaches entry × 1.50 (+50%)
//   · once armed: floor = entry + (peak − entry) × 2/3, ratcheting up with each
//     new peak; exit at the floor (keep ≥ two-thirds of the peak gain)
//   · never exited → flatten on the session's last quote
//   · exits check BEFORE the peak updates (a fresh high can't fire its own floor)
//
//  HONESTY NOTES (printed + banked): mid-basis fills at the level; entry = the
//  trade's REAL fill. PER-TRADE counterfactual only — a live ratchet frees the
//  one-at-a-time slot differently (the +75%-cap lesson); totals are per-arm-
//  stream, not a portfolio claim. Predecessor actuals were lived under a
//  DIFFERENT exit policy (cap/trail era) — epochs don't pool as one baseline.
//  Log-only, never a gate (A7-style).
//
//    npm run ratchet-shadow            # replay all twin + predecessor trades
//  Runs nightly in the capture close pass. day-report publishes a summary into
//  the forensics payload (§03 Shadow & Override panel) via ratchetShadowSummary —
//  ledger-first on the Mac; DB-recompute fallback in the worker image (no ledger
//  file, no archive → same-week twins only, labeled source:"live").
// ============================================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
const SINCE = "2026-06-01T04:00:00Z";
const EPOCH_BY_SLUG: Record<string, string> = {
  "orb-ustop": "a4", "orb-ustop-ctl": "a4",
  "orb-trend-rider": "pre", // the bare-ORB spec the twins cloned (benched 06-25; cap/trail-era actuals)
};
// FIXED policy params — see header. Do not tune after seeing results.
const ARM_PCT = 50;
const KEEP_FRAC = 2 / 3;
const PRE_ARM_STOP_PCT = 50;
const PARAMS = `arm${ARM_PCT}/keep${Math.round(KEEP_FRAC * 100)}/pre${PRE_ARM_STOP_PCT}`;

export interface RatchetRow {
  posId: string; slug: string; epoch: string; occ: string; openedAt: string;
  entry: number; qty: number;
  actualReason: string; actualPnlCt: number;
  ratchetReason: string; ratchetExit: number | null; ratchetPnlCt: number | null;
  peakPct: number; armed: boolean; nQuotes: number; src: "db" | "archive" | "none";
  params: string; basis: "mid-level";
}

function loadLedger(): Map<string, RatchetRow> {
  if (!existsSync(LEDGER)) return new Map();
  try {
    // v1 rows (2026-07-08 morning) predate the epoch/src fields — normalize on load
    return new Map((JSON.parse(readFileSync(LEDGER, "utf8")) as RatchetRow[])
      .map((r) => [r.posId, { ...r, epoch: r.epoch ?? EPOCH_BY_SLUG[r.slug] ?? "a4", src: r.src ?? "db" }]));
  } catch { return new Map(); }
}

// pure ratchet walk over a mid path
function replay(entry: number, quotes: { m: number; t: string }[]) {
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
  return { exit, reason, armed };
}

// archive day cache (one parse per date; ~30k rows/day)
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

async function loadQuotes(sb: SupabaseClient, occ: string, openedAt: string, allowArchive: boolean): Promise<{ quotes: { m: number; t: string }[]; src: "db" | "archive" | "none" }> {
  const date = String(openedAt).slice(0, 10);
  const dayEnd = `${date}T23:59:59Z`;
  const quotes: { m: number; t: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: q, error } = await sb.from("option_quotes").select("mid,captured_at")
      .eq("occ_symbol", occ).gte("captured_at", openedAt).lte("captured_at", dayEnd)
      .order("captured_at", { ascending: true }).order("id", { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`quotes read: ${error.message}`);
    for (const r of (q ?? []) as any[]) if (Number(r.mid) > 0) quotes.push({ m: Number(r.mid), t: String(r.captured_at) });
    if ((q ?? []).length < 1000) break;
  }
  if (quotes.length) return { quotes, src: "db" };
  if (allowArchive) {
    const day = archiveDay(date);
    if (day) {
      const qs = day.filter((r) => r.occ === occ && r.t >= openedAt && r.t <= dayEnd)
        .sort((a, b) => a.t.localeCompare(b.t)).map((r) => ({ m: r.m, t: r.t }));
      if (qs.length) return { quotes: qs, src: "archive" };
    }
  }
  return { quotes: [], src: "none" };
}

async function buildRows(sb: SupabaseClient, opts: { allowArchive: boolean; prior: Map<string, RatchetRow> }): Promise<{ rows: RatchetRow[]; fresh: number }> {
  const slugs = Object.keys(EPOCH_BY_SLUG);
  const { data: strat, error: se } = await sb.from("strategists").select("id,slug").in("slug", slugs);
  if (se) throw new Error(`strategists read: ${se.message}`);
  const slugById = new Map((strat ?? []).map((s: any) => [s.id, s.slug]));
  const { data: pos, error: pe } = await sb.from("positions")
    .select("id,strategist_id,occ_symbol,qty,avg_entry_price,realized_pnl,close_reason,opened_at,peak_mark")
    .in("strategist_id", [...slugById.keys()]).eq("status", "closed").gte("opened_at", SINCE)
    .order("opened_at", { ascending: true });
  if (pe) throw new Error(`positions read: ${pe.message}`);

  const ledger = new Map(opts.prior);
  let fresh = 0;
  for (const p of (pos ?? []) as any[]) {
    const prior = ledger.get(p.id);
    if (prior && prior.ratchetPnlCt != null) continue; // scored rows are final; retry unscored
    const slug = slugById.get(p.strategist_id)!;
    const entry = Number(p.avg_entry_price);
    const { quotes, src } = await loadQuotes(sb, p.occ_symbol, p.opened_at, opts.allowArchive);
    const row: RatchetRow = {
      posId: p.id, slug, epoch: EPOCH_BY_SLUG[slug], occ: p.occ_symbol, openedAt: p.opened_at,
      entry, qty: Number(p.qty),
      actualReason: String(p.close_reason ?? "?"), actualPnlCt: Math.round((Number(p.realized_pnl) / Number(p.qty)) * 100) / 100,
      ratchetReason: "no_quotes", ratchetExit: null, ratchetPnlCt: null,
      peakPct: Math.round(100 * (Number(p.peak_mark) / entry - 1)), armed: false, nQuotes: quotes.length, src,
      params: PARAMS, basis: "mid-level",
    };
    if (quotes.length) {
      const r = replay(entry, quotes);
      row.armed = r.armed;
      row.ratchetExit = Math.round(r.exit * 100) / 100;
      row.ratchetReason = r.reason;
      row.ratchetPnlCt = Math.round((r.exit - entry) * 100 * 100) / 100;
    }
    ledger.set(p.id, row);
    fresh++;
  }
  return { rows: [...ledger.values()].sort((a, b) => a.openedAt.localeCompare(b.openedAt)), fresh };
}

export interface RatchetSummary {
  params: string; source: "ledger" | "live";
  n: number; scored: number; armed: number;
  actualUsd: number; ratchetUsd: number; deltaUsd: number;
  epochs: { key: string; n: number; actualUsd: number; ratchetUsd: number }[];
  byDay: { d: string; n: number; actual: number; ratchet: number }[];
}

function summarize(rows: RatchetRow[], source: "ledger" | "live"): RatchetSummary {
  const scored = rows.filter((r) => r.ratchetPnlCt != null);
  const usd = (f: (r: RatchetRow) => number) => Math.round(scored.reduce((a, r) => a + f(r) * r.qty, 0));
  const byDayMap = new Map<string, { n: number; actual: number; ratchet: number }>();
  for (const r of scored) {
    const d = r.openedAt.slice(0, 10);
    const e = byDayMap.get(d) ?? { n: 0, actual: 0, ratchet: 0 };
    e.n++; e.actual += r.actualPnlCt * r.qty; e.ratchet += (r.ratchetPnlCt ?? 0) * r.qty;
    byDayMap.set(d, e);
  }
  const epochs = ["a4", "pre"].map((key) => {
    const es = scored.filter((r) => r.epoch === key);
    return { key, n: es.length, actualUsd: Math.round(es.reduce((a, r) => a + r.actualPnlCt * r.qty, 0)), ratchetUsd: Math.round(es.reduce((a, r) => a + (r.ratchetPnlCt ?? 0) * r.qty, 0)) };
  }).filter((e) => e.n > 0);
  return {
    params: PARAMS, source, n: rows.length, scored: scored.length,
    armed: scored.filter((r) => r.armed).length,
    actualUsd: usd((r) => r.actualPnlCt), ratchetUsd: usd((r) => r.ratchetPnlCt ?? 0),
    deltaUsd: usd((r) => (r.ratchetPnlCt ?? 0) - r.actualPnlCt),
    epochs,
    byDay: [...byDayMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([d, e]) => ({ d, n: e.n, actual: Math.round(e.actual), ratchet: Math.round(e.ratchet) })),
  };
}

// day-report hook: Mac → the banked ledger; worker image (no ledger/archive) → live
// DB-only recompute of the same-week twins, labeled so the panel can say which it is.
export async function ratchetShadowSummary(sb: SupabaseClient): Promise<RatchetSummary | null> {
  try {
    if (existsSync(LEDGER)) return summarize([...loadLedger().values()], "ledger");
    const { rows } = await buildRows(sb, { allowArchive: false, prior: new Map() });
    return rows.length ? summarize(rows, "live") : null;
  } catch { return null; }
}

// ── SLOT-AWARE replay (the arbiter) ────────────────────────────────────────────
// The per-trade replay above is capital-blind on the SLOT: it can't see that a
// ratchet's early exit FREES the one-at-a-time slot → re-entry → the −EV churn that
// killed the +75% profit cap on this exact spec. This mode closes that gap: it drives
// the RE-ENTRY-AWARE engine (engine/backtest.ts, real option_quotes fills) on the
// twins' OWN spec entries, swapping ONLY the exit across three regimes. The churn shows
// up as the trade-count blow-up; the P&L delta is the honest verdict. --options quotes
// reads the DB only (7d retention) → coverage is the still-live window; older A4 days
// prune out (reported). This is the number the arm/no-arm call rests on.
const TSX = process.env.TSX_BIN || join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
interface RegimeRun { name: string; flags: string[]; trades: number; pnl: number; reasons: string }

async function slotAware(sb: SupabaseClient, from: string, to: string): Promise<{ from: string; to: string; runs: RegimeRun[] } | null> {
  const { data, error } = await sb.from("strategists").select("spec_json,strategist_config(capital_pct,max_contracts,daily_stop_usd)").eq("slug", "orb-ustop").single();
  if (error || !(data as any)?.spec_json) { console.error(`slot-aware: orb-ustop spec unavailable (${error?.message ?? "no spec"})`); return null; }
  const cfg = Array.isArray((data as any).strategist_config) ? (data as any).strategist_config[0] : (data as any).strategist_config;
  const risk = String(Number(cfg?.capital_pct ?? 500)), maxC = String(Number(cfg?.max_contracts ?? 6)), dstop = String(Number(cfg?.daily_stop_usd ?? 500));
  const specPath = join(tmpdir(), "ratchet-slot-spec.json");
  writeFileSync(specPath, JSON.stringify((data as any).spec_json)); // entries + EOD timeET only; stops layered via CLI
  const daysBack = Math.ceil((Date.now() - Date.parse(from + "T00:00:00Z")) / 86_400_000) + 3;
  // three regimes, IDENTICAL entries (the spec) — only the exit differs, so entries cancel and the
  // delta is pure exit-policy + its slot/churn consequence. Ratchet params = the fixed per-trade set
  // (arm +50, keep ⅔ = giveback 33), pre-arm −50% floor.
  // + entry-capped ratchets (the operator's "quota then sit out" lever, --max-entries): tests
  // whether a re-entry guard rescues the ratchet. First read (07-01→08): it does NOT — capping is
  // flat-to-worse (the giveback EXIT trails ride-to-bell at equal trade count; the churn wasn't the
  // drag). Kept visible so the answer updates as the sample grows across ride- vs give-back-day mixes.
  const regimes: { name: string; flags: string[] }[] = [
    { name: "u-stop 0.30", flags: ["--ustop", "0.30", "--prem-stop", "0"] },
    { name: "prem-stop 50", flags: ["--prem-stop", "50"] },
    { name: "ratchet uncapped", flags: ["--prem-stop", "50", "--giveback", "33", "--arm-pct", "50"] },
    { name: "ratchet cap-1/day", flags: ["--prem-stop", "50", "--giveback", "33", "--arm-pct", "50", "--max-entries", "1"] },
    { name: "ratchet cap-2/day", flags: ["--prem-stop", "50", "--giveback", "33", "--arm-pct", "50", "--max-entries", "2"] },
  ];
  const runs: RegimeRun[] = [];
  for (const rg of regimes) {
    const emit = join(tmpdir(), `ratchet-slot-${rg.name.replace(/[^a-z0-9]/gi, "_")}.json`);
    try { if (existsSync(emit)) rmSync(emit); } catch { /* */ }
    const args = ["engine/backtest.ts", "--spec", specPath, "--strat", "breakout", "--underlying", "SPY",
      "--source", "real", "--options", "quotes", "--from", from, "--to", to, "--days", String(daysBack),
      "--risk", risk, "--max-contracts", maxC, "--daily-stop", dstop, "--cost-gate", "3.0", ...rg.flags, "--emit-trades", emit];
    let stdout = "";
    try { stdout = execFileSync(TSX, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 24, timeout: 180_000, killSignal: "SIGKILL" }); }
    catch (e) { const err = e as Error & { stdout?: string; stderr?: string }; console.error(`slot-aware ${rg.name} failed: ${(err.stderr ?? err.stdout ?? err.message).split("\n").find((l) => l.trim()) ?? ""}`); return null; }
    const reasons = (stdout.match(/Exit reasons\s+(\{[^}]*\})/)?.[1] ?? "").replace(/"/g, "");
    let trades = 0, pnl = 0;
    if (existsSync(emit)) { const o = JSON.parse(readFileSync(emit, "utf8")) as { perDay: { pnl: number; trades: number }[] }; trades = o.perDay.reduce((a, d) => a + d.trades, 0); pnl = Math.round(o.perDay.reduce((a, d) => a + d.pnl, 0)); }
    try { rmSync(emit); } catch { /* */ }
    runs.push({ name: rg.name, flags: rg.flags, trades, pnl, reasons });
  }
  try { rmSync(specPath); } catch { /* */ }
  return { from, to, runs };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
async function cli() {
  if (process.argv.includes("--slot")) {
    loadEnv();
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const to = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
    const r = await slotAware(sb, "2026-07-01", to);
    if (!r) process.exit(1);
    const sgn = (v: number) => `${v < 0 ? "-" : "+"}$${Math.abs(v).toLocaleString()}`;
    console.log(`\n  RATCHET SHADOW — SLOT-AWARE (re-entry-aware engine · twin spec entries · real option_quotes · ${r.from}→${r.to})`);
    console.log(`  the arbiter: same entries, exit swapped — the ratchet's freed-slot re-entry churn is MODELED here (the per-trade replay can't see it)\n`);
    console.log(`  ${"regime".padEnd(18)}${"trades".padStart(8)}${"P&L".padStart(11)}   exits`);
    for (const run of r.runs) console.log(`  ${run.name.padEnd(18)}${String(run.trades).padStart(8)}${sgn(run.pnl).padStart(11)}   ${run.reasons}`);
    const ratchets = r.runs.filter((x) => x.name.startsWith("ratchet"));
    const live = r.runs.filter((x) => !x.name.startsWith("ratchet"));
    const bestLive = live.reduce((a, x) => (x.pnl > a.pnl ? x : a), live[0]);
    const bestRat = ratchets.reduce((a, x) => (x.pnl > a.pnl ? x : a), ratchets[0]);
    console.log(`\n  best ratchet variant: ${bestRat.name} ${sgn(bestRat.pnl)} (${bestRat.trades}t) vs best live ${bestLive.name} ${sgn(bestLive.pnl)} (${bestLive.trades}t)`);
    console.log(`  verdict: ${bestRat.pnl >= bestLive.pnl ? "a ratchet variant WINS slot-aware" : `every ratchet variant LOSES (best trails by ${sgn(bestRat.pnl - bestLive.pnl)}) — capping entries does NOT rescue it; the giveback EXIT trails ride-to-bell on this window's mix`}`);
    console.log(`  ⚠ log-only; ${r.from} at the 7d option_quotes edge (coverage = still-live window); ratchet-vs-ride is a day-mix bet → one era = noise, the A4 read (N≥40) arbitrates.\n`);
    return;
  }
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { rows, fresh } = await buildRows(sb, { allowArchive: true, prior: loadLedger() });
  mkdirSync("data", { recursive: true });
  writeFileSync(LEDGER, JSON.stringify(rows, null, 1));

  const sgn = (v: number) => `${v < 0 ? "-" : "+"}$${Math.abs(Math.round(v))}`;
  console.log(`\n  RATCHET SHADOW — virtual third arm (${PARAMS} · mid-level · per-trade, slot-path caveat)`);
  for (const r of rows) {
    if (r.ratchetPnlCt == null) { console.log(`  ${r.openedAt.slice(5, 10)} ${r.slug.padEnd(16)}${r.occ.slice(9).padEnd(10)}  — no quotes (${r.src}) (${r.actualReason})`); continue; }
    const d = r.ratchetPnlCt - r.actualPnlCt;
    console.log(`  ${r.openedAt.slice(5, 10)} ${r.slug.padEnd(16)}${r.occ.slice(9).padEnd(10)}${(r.peakPct + "%").padStart(6)}${sgn(r.actualPnlCt).padStart(9)}  ${("(" + r.actualReason + ")").padEnd(18)}${sgn(r.ratchetPnlCt).padStart(9)}  ${sgn(d).padStart(8)} ${r.ratchetReason === "ratchet_floor" ? "⚑" : r.ratchetReason === "pre_arm_stop" ? "×" : "→bell"}${r.src === "archive" ? " ᵃ" : ""}`);
  }
  const s = summarize(rows, "ledger");
  for (const e of s.epochs) {
    console.log(`\n  Σ ${e.key === "a4" ? "A4 twins" : "predecessor (orb-trend-rider, cap/trail-era actuals)"} (${e.n}t): actual ${sgn(e.actualUsd)} vs ratchet ${sgn(e.ratchetUsd)} → Δ ${sgn(e.ratchetUsd - e.actualUsd)}`);
  }
  console.log(`  Σ pooled (${s.scored}/${s.n} scored, position-sized): actual ${sgn(s.actualUsd)} vs ratchet ${sgn(s.ratchetUsd)} → Δ ${sgn(s.deltaUsd)} · armed ${s.armed}/${s.scored}`);
  console.log(`\n  banked ${fresh} new/retried / ${rows.length} total → ${LEDGER}`);
  console.log(`  ⚠ log-only instrumentation (registry vi): params fixed pre-results; epochs don't pool as one baseline; the A4 read arbitrates.\n`);
}
if (process.argv[1]?.endsWith("ratchet-shadow.ts")) cli().catch((e) => { console.error(e); process.exit(1); });
