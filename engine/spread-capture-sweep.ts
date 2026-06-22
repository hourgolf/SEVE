// ============================================================================
//  spread-capture-sweep — the FAITHFUL #4 "lower the cost" probe. Unlike fill-probe
//  (ungated, builtins only), this runs the ARMED EDGE channels (V3/ALT specs) +
//  key builtins under the LIVE config (real SPY bars + real Databento NBBO, RISK
//  $500, daily-stop $500, cost-gate 3.0, −50% premium stop) and sweeps the per-side
//  spread-cross fraction. The gate matters: recapturing spread lowers round-trip
//  cost → the 3× gate passes MORE trades, so the lift compounds.
//
//    npm run spread-capture-sweep
//
//  Reads V3/ALT spec_json live from the DB (so it's the real armed config). Shells
//  the validated backtest CLI per (channel × frac) — correct --risk/--cost-gate/
//  --fill-cross wiring, no reimplementation. Reports Σ P&L, exp$/t, and the LIFT
//  from crossing (f1.0, today) to half-capture (f0.5) per channel.
// ============================================================================
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const TSX = join(process.cwd(), "node_modules", ".bin", "tsx");
const FROM = "2024-05-01", TO = "2026-06-09";
const FRACS = [1.0, 0.5, 0.25]; // cross(today) · half-capture · 3/4-capture

// armed spec channels (pull live spec_json) + key builtins for contrast
const SPEC_SLUGS = ["breakout-alt-v3", "breakout-smart-entries"];
const BUILTINS = ["grind-v3", "breakout", "power"];

interface Run { pnl: number; trades: number; exp: number }
const usdNum = (sign: string, n: string) => (sign === "-" ? -1 : 1) * Number(n.replace(/,/g, ""));
function parse(out: string): Run | null {
  const pnl = out.match(/Total P&L\s+(-?)\$([\d,]+\.?\d*)/); // handles "-$X" (minus before $)
  const tr = out.match(/Trades\s+(\d+)\s+\(([\d.]+)\/day\)/);
  const exp = out.match(/Expectancy\/trade\s+(-?)\$([\d,]+\.?\d*)/);
  if (!pnl || !tr) return null;
  return { pnl: usdNum(pnl[1], pnl[2]), trades: Number(tr[1]), exp: exp ? usdNum(exp[1], exp[2]) : 0 };
}
function backtest(args: string[]): Run | null {
  try {
    const out = execFileSync(TSX, ["engine/backtest.ts", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 25 });
    return parse(out);
  } catch { return null; }
}

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await sb.from("strategists").select("slug,spec_json").in("slug", SPEC_SLUGS);
  if (error) throw new Error(error.message);
  const specPath = new Map<string, string>();
  for (const r of (data ?? []) as Array<{ slug: string; spec_json: unknown }>) {
    if (!r.spec_json) { console.error(`⚠ no spec_json for ${r.slug}`); continue; }
    const p = join(tmpdir(), `sweep-${r.slug}.json`);
    writeFileSync(p, JSON.stringify(r.spec_json));
    specPath.set(r.slug, p);
  }
  const channels: Array<{ name: string; route: string[] }> = [];
  for (const s of SPEC_SLUGS) if (specPath.has(s)) channels.push({ name: s, route: ["--spec", specPath.get(s)!] });
  for (const b of BUILTINS) channels.push({ name: b, route: ["--strat", b] });

  const base = ["--source", "real", "--options", "databento", "--underlying", "SPY", "--from", FROM, "--to", TO, "--risk", "500", "--daily-stop", "500", "--cost-gate", "3", "--prem-stop", "50"];
  console.log(`\nSPREAD-CAPTURE SWEEP · faithful (real SPY bars + Databento NBBO · RISK 500 · gate 3 · −50% stop) · ${FROM}→${TO}`);
  console.log("frac 1.00 = cross full spread (today) · 0.50 = recapture half · 0.25 = recapture 3/4. Σ shown as P&L(trades).\n");
  console.log("channel".padEnd(24) + FRACS.map((f) => `Σ@f${f.toFixed(2)} (n)`.padStart(17)).join("") + "  Σ-lift @½   @¾");
  console.log("─".repeat(24 + 17 * FRACS.length + 22));
  const usd = (v: number) => (v < 0 ? "-$" : "+$") + Math.abs(Math.round(v)).toLocaleString();
  const pct = (a: number, b: number) => (a === 0 ? "  n/a" : ((b - a) / Math.abs(a) >= 0 ? "+" : "") + (100 * (b - a) / Math.abs(a)).toFixed(0) + "%");

  for (const ch of channels) {
    const runs = FRACS.map((fr) => backtest([...base, ...ch.route, "--fill-cross", String(fr)]));
    const r0 = runs[0];
    if (!r0) { console.log(ch.name.padEnd(24) + "  FAILED"); continue; }
    console.log(
      ch.name.padEnd(24) +
      runs.map((r) => (r ? `${usd(r.pnl)}(${r.trades})` : "—").padStart(17)).join("") +
      `  ${pct(r0.pnl, runs[1]?.pnl ?? r0.pnl).padStart(7)} ${pct(r0.pnl, runs[2]?.pnl ?? r0.pnl).padStart(6)}`);
  }
  console.log("\nΣ-lift @½ / @¾ = % change in total P&L from recapturing half / three-quarters of the spread.");
  console.log("The gate is ON: lower frac → lower round-trip cost → MORE trades pass the 3× gate (n grows), so the");
  console.log("lift is both cheaper fills AND more admitted +EV trades. On a REAL edge (V3/ALT) that compounds; on a");
  console.log("directionally-dead book (grind/power, −EV gross) it only reduces the loss.");
}
main().catch((e) => { console.error(e); process.exit(1); });
