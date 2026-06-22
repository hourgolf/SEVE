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
// today (cross) · capture half, gate also loosens (coupled) · capture half, gate stays STRICT (decoupled).
// The decoupled config is the A1 test: does keeping the gate at cross-cost give the fill benefit on the
// edge channels WITHOUT loosening the gate to admit junk on the dead books?
const CONFIGS = [
  { name: "today(cross)", flags: ["--fill-cross", "1.0"] },
  { name: "½ coupled", flags: ["--fill-cross", "0.5"] },
  { name: "½ gate-strict", flags: ["--fill-cross", "0.5", "--gate-fill-cross", "1.0"] },
];

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
  console.log("today=cross · ½ coupled=capture half + gate loosens · ½ gate-strict=capture half + gate held at cross. Σ as P&L(trades).\n");
  console.log("channel".padEnd(24) + CONFIGS.map((c) => `${c.name} (n)`.padStart(20)).join("") + "   Δcoupled  Δstrict");
  console.log("─".repeat(24 + 20 * CONFIGS.length + 20));
  const usd = (v: number) => (v < 0 ? "-$" : "+$") + Math.abs(Math.round(v)).toLocaleString();
  const pct = (a: number, b: number) => (a === 0 ? "n/a" : ((b - a) / Math.abs(a) >= 0 ? "+" : "") + (100 * (b - a) / Math.abs(a)).toFixed(0) + "%");

  for (const ch of channels) {
    const runs = CONFIGS.map((c) => backtest([...base, ...ch.route, ...c.flags]));
    const r0 = runs[0];
    if (!r0) { console.log(ch.name.padEnd(24) + "  FAILED"); continue; }
    console.log(
      ch.name.padEnd(24) +
      runs.map((r) => (r ? `${usd(r.pnl)}(${r.trades})` : "—").padStart(20)).join("") +
      `   ${pct(r0.pnl, runs[1]?.pnl ?? r0.pnl).padStart(7)} ${pct(r0.pnl, runs[2]?.pnl ?? r0.pnl).padStart(7)}`);
  }
  console.log("\nΔcoupled / Δstrict = % change in Σ P&L from today (cross) under each capture mode.");
  console.log("COUPLED lets the cheaper cost loosen the 3× gate → admits more trades (n grows); on a dead book that");
  console.log("admits more −EV trades (backfire). GATE-STRICT keeps the gate at cross-cost: pure fill benefit on the");
  console.log("SAME trade set. If gate-strict lifts V3/ALT AND no longer hurts the dead books → spread-capture is");
  console.log("a SAFE GLOBAL win (deploy via entryCostGate.gateCostModel). If dead books still bleed → V3/ALT-only.");
}
main().catch((e) => { console.error(e); process.exit(1); });
