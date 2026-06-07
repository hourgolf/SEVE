// scripts/mc-roster.ts — bootstrap Monte Carlo across the LIVE channel roster.
//
//   npm run mc-roster
//   npm run mc-roster -- --from 2026-03-01 --to 2026-06-05 --n 10000 --block 5 --stop 500
//
// Queries the armed + unmuted strategists, routes each to the backtest (built-in
// --strat vs compiled --spec, mirroring the worker's base-slug precedence), detects
// real-vs-modeled fills per ticker (Databento cache present?), runs engine/montecarlo.ts
// --json per channel over a FIXED ET-date window (reproducible — not Date.now()-anchored),
// and prints a ranked SPY/QQQ comparison table.
//
// Research-only: reads the live roster, runs backtests; touches no live worker/DB/UI.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createClient } from "@supabase/supabase-js";

function loadEnv() {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const arg = (n: string, d: string): string => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const FROM = arg("from", "2026-03-01"), TO = arg("to", "2026-06-05");
const N = arg("n", "10000"), BLOCK = arg("block", "5"), STOP = arg("stop", "500"), HORIZON = arg("horizon", "");

// backtest makeEval built-ins (mirror engine/backtest.ts) — a channel whose base slug
// (minus a -spy/-qqq ticker suffix) is one of these runs as CODE, not a compiled spec
// (matching the worker's base-slug precedence). Everything else uses its spec_json.
const BUILTINS = new Set(["breakout", "power", "power-final35", "power-final30", "power-mom60", "power-mom35", "power-mom30", "grind", "grind-v2", "grind-v3", "fade", "fade-v2", "cross", "straddle"]);
const baseSlug = (s: string) => s.replace(/-(qqq|spy)$/i, "");

const TSX = join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
const daysBack = Math.ceil((Date.now() - Date.parse(FROM + "T00:00:00Z")) / 86_400_000) + 5; // bound the fetch (result is pinned by --from/--to)

interface StratRow { slug: string; name: string; underlying: string | null; status: string; spec_json: unknown; sort_order: number | null; strategist_config: { muted: boolean | null } | { muted: boolean | null }[] | null }
interface McSummary { realizedTotal: number; realizedMaxDD: number; trades: number; tradedDays: number; winDayPct: number; sharpe: number; p5: number; p25: number; p50: number; p75: number; p95: number; mean: number; pNeg: number; medMaxDD: number; p95MaxDD: number; pBreach: number | null }
type ResultRow = { slug: string; name: string; u: string; fill: string; useSpec: boolean } & (McSummary & { failed?: false } | { failed: true });

const m = (v: number) => (v < 0 ? "-$" : "+$") + Math.abs(Math.round(v)).toLocaleString();
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padL = (s: string | number, n: number) => String(s).padStart(n);

function table(rows: ResultRow[], title: string) {
  console.log("\n" + title);
  console.log(pad("channel", 22) + padL("trades", 8) + padL("realized", 11) + padL("p5", 10) + padL("p50", 10) + padL("p95", 10) + padL("P(<0)", 7) + padL("medDD", 9) + padL("shrp", 7));
  for (const r of rows) {
    if ("failed" in r && r.failed) { console.log(pad(r.name, 22) + padL("FAILED", 8)); continue; }
    const s = r as ResultRow & McSummary;
    console.log(
      pad(r.name, 22) + padL(`${s.tradedDays}d/${s.trades}t`, 8) + padL(m(s.realizedTotal), 11) +
      padL(m(s.p5), 10) + padL(m(s.p50), 10) + padL(m(s.p95), 10) +
      padL(Math.round(s.pNeg * 100) + "%", 7) + padL(m(-s.medMaxDD), 9) + padL(String(s.sharpe), 7));
  }
}

async function main() {
  const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL, SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!SB_URL || !SB_ANON) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY in .env.local");
  const sb = createClient(SB_URL, SB_ANON, { auth: { persistSession: false } });

  const { data, error } = await sb.from("strategists").select("slug,name,underlying,status,spec_json,sort_order,strategist_config(muted)");
  if (error) throw new Error(error.message);
  const roster = ((data ?? []) as unknown as StratRow[])
    .filter((s) => { const c = Array.isArray(s.strategist_config) ? s.strategist_config[0] : s.strategist_config; return s.status === "armed" && !(c && c.muted); })
    .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999));

  console.error(`mc-roster: ${roster.length} armed+unmuted channels · window ${FROM} → ${TO} · block ${BLOCK} · ${N} paths · stop $${STOP}\n`);

  const out: ResultRow[] = [];
  for (const s of roster) {
    const u = (s.underlying ?? "SPY").toUpperCase();
    const useSpec = !BUILTINS.has(baseSlug(s.slug)) && s.spec_json != null;
    const cacheDir = "data/databento" + (u === "SPY" ? "" : "-" + u.toLowerCase());
    const hasCache = existsSync(cacheDir) && readdirSync(cacheDir).some((f) => f.endsWith(".json"));
    const fill = hasCache ? "databento" : "synthetic";
    const args = ["engine/montecarlo.ts", "--strat", s.slug, "--underlying", u, "--from", FROM, "--to", TO, "--days", String(daysBack), "--options", fill, "--stop", STOP, "--n", N, "--block", BLOCK, "--json"];
    if (HORIZON) args.push("--horizon", HORIZON);
    if (useSpec) { const p = join(tmpdir(), `seve-spec-${s.slug.replace(/[^a-z0-9-]/gi, "_")}.json`); writeFileSync(p, JSON.stringify(s.spec_json)); args.push("--spec", p); }
    process.stderr.write(`▶ ${s.slug} (${u}, ${fill}${useSpec ? ", spec" : ""})...\n`);
    try {
      const o = execFileSync(TSX, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 24 });
      const line = o.trim().split("\n").filter(Boolean).pop() ?? "{}";
      out.push({ slug: s.slug, name: s.name, u, fill, useSpec, ...(JSON.parse(line) as McSummary) });
    } catch (e) {
      process.stderr.write(`  ✗ ${s.slug}: ${(e as Error).message}\n`);
      out.push({ slug: s.slug, name: s.name, u, fill, useSpec, failed: true });
    }
  }

  const modeled = out.filter((r) => r.fill === "synthetic" && !("failed" in r && r.failed)).map((r) => r.name);
  const byP50 = (a: ResultRow, b: ResultRow) => ((("p50" in b ? b.p50 : -1e9)) - (("p50" in a ? a.p50 : -1e9)));
  const spy = out.filter((r) => r.u === "SPY").sort(byP50);
  const qqq = out.filter((r) => r.u !== "SPY").sort(byP50);
  if (spy.length) table(spy, `═══ SPY channels · ${FROM} → ${TO} · block B=${BLOCK} · ${N} paths · stop $${STOP} ═══`);
  if (qqq.length) table(qqq, "═══ QQQ channels ═══");
  if (modeled.length) console.log(`\n⚠ MODELED (no Databento cache) — directional only: ${modeled.join(", ")}`);
  console.log("\nJSON:\n" + JSON.stringify(out.filter((r) => !("failed" in r && r.failed))));
}

main().catch((e) => { console.error(e); process.exit(1); });
