// lastweek-sim-probe — faithful, re-entry-aware replay of the LAST WEEK under OLD vs NEW config.
// Uses the option_quotes source (real NBBO, the 7d live tape the databento backtest can't reach),
// bar-by-bar (so re-entries, stop-outs, and take-profits all fire in true time order). For each
// channel it runs the SAME entries twice, only changing the exits:
//   OLD = ride-ish (profit +100% / stop −50%)   NEW = the calibrated lock+stop per channel.
// Compiled channels (V3/ALT/MOMO) get full TP+stop control via an edited spec; builtin PB gets the
// stop change via --prem-stop (its +20% target is the builtin's, unchanged — the PB change IS the stop).
//   npx tsx --env-file=.env.local engine/lastweek-sim-probe.ts
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createClient } from "@supabase/supabase-js";

const FROM = "2026-06-23", TO = "2026-06-30";
const TSX = join(process.cwd(), "node_modules", ".bin", "tsx");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });

type Exits = { profitPct?: number; stopPct: number };
interface Chan { name: string; slug: string; compiled: boolean; old: Exits; new: Exits }
const CHANS: Chan[] = [
  { name: "V3",      slug: "breakout-alt-v3",        compiled: true,  old: { profitPct: 100, stopPct: 50 }, new: { profitPct: 22, stopPct: 30 } },
  { name: "ALT",     slug: "breakout-smart-entries", compiled: true,  old: { profitPct: 100, stopPct: 50 }, new: { profitPct: 22, stopPct: 30 } },
  { name: "MOMO",    slug: "momo-shape",             compiled: true,  old: { stopPct: 50 },                 new: { stopPct: 50 } }, // ride, unchanged (sanity)
  { name: "PB-0DTE", slug: "pb-ride-2",              compiled: false, old: { stopPct: 50 },                 new: { stopPct: 30 } },
  { name: "PB-1DTE", slug: "pb-ride",                compiled: false, old: { stopPct: 50 },                 new: { stopPct: 30 } },
];

function runOne(c: Chan, spec: any, cfg: { risk: number; maxC: number; dailyStop: number; ustop: number; underlying: string }, exits: Exits): { pnl: number; trades: number; ok: boolean; note?: string } {
  const tag = `${c.slug}-${exits.profitPct ?? "ride"}-${exits.stopPct}`.replace(/[^a-z0-9-]/gi, "_");
  const emit = join(tmpdir(), `seve-lw-${tag}.json`);
  const specPath = join(tmpdir(), `seve-lw-spec-${tag}.json`);
  const args = ["engine/backtest.ts", "--strat", c.slug, "--underlying", cfg.underlying, "--source", "real", "--options", "quotes",
    "--from", FROM, "--to", TO, "--days", "12", "--risk", String(cfg.risk), "--max-contracts", String(cfg.maxC),
    "--daily-stop", String(cfg.dailyStop), "--cost-gate", "3.0", "--ustop", String(cfg.ustop), "--emit-trades", emit];
  if (c.compiled && spec) {
    const exitsArr: any[] = [];
    if (exits.profitPct != null) exitsArr.push({ profitPct: exits.profitPct });
    exitsArr.push({ stopPct: exits.stopPct }, { timeET: "15:25" });
    writeFileSync(specPath, JSON.stringify({ ...spec, exits: exitsArr }));
    args.push("--spec", specPath);
  } else {
    args.push("--prem-stop", String(exits.stopPct)); // builtin: stop via flag, TP is the builtin's own
  }
  try {
    if (existsSync(emit)) rmSync(emit);
    execFileSync(TSX, args, { encoding: "utf8", stdio: ["ignore", "ignore", "ignore"], maxBuffer: 1 << 24, timeout: 120_000, killSignal: "SIGKILL" });
    if (!existsSync(emit)) return { pnl: 0, trades: 0, ok: false, note: "no fills" };
    const out = JSON.parse(readFileSync(emit, "utf8")) as { perDay: { date: string; pnl: number; trades: number }[] };
    const pnl = out.perDay.reduce((a, d) => a + d.pnl, 0), trades = out.perDay.reduce((a, d) => a + d.trades, 0);
    return { pnl: Math.round(pnl), trades, ok: true };
  } catch (e) {
    return { pnl: 0, trades: 0, ok: false, note: (e as Error).message.split("\n")[0] };
  } finally {
    for (const p of [emit, specPath]) { try { if (existsSync(p)) rmSync(p); } catch { /* */ } }
  }
}

const sgn = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(v).toLocaleString();
const p = (s: any, w: number) => String(s).padStart(w);

async function main() {
  const { data } = await sb.from("strategists")
    .select("slug,underlying,spec_json,strategist_config(capital_pct,max_contracts,daily_stop_usd,underlying_stop_pct)")
    .in("slug", CHANS.map((c) => c.slug));
  const bySlug = new Map((data ?? []).map((r: any) => [r.slug, r]));
  console.log(`\n  LAST-WEEK SIM · ${FROM}…${TO} · real option_quotes NBBO · re-entry-aware (stops/TPs/re-entries fire bar-by-bar)`);
  console.log(`  OLD = ride-ish (+100%/−50%) · NEW = calibrated lock+stop · compiled=full control, PB=stop-only (builtin TP)\n`);
  console.log(`  ${p("channel", 9)}${p("OLD $", 11)}${p("OLDt", 6)}${p("NEW $", 11)}${p("NEWt", 6)}${p("Δ", 11)}`);
  let oT = 0, nT = 0;
  for (const c of CHANS) {
    const r = bySlug.get(c.slug); if (!r) { console.log(`  ${p(c.name, 9)}  (not found)`); continue; }
    const cfg = { risk: Number(r.strategist_config?.capital_pct ?? 2000), maxC: Number(r.strategist_config?.max_contracts ?? 6),
      dailyStop: Number(r.strategist_config?.daily_stop_usd ?? 2000), ustop: Number(r.strategist_config?.underlying_stop_pct ?? 0), underlying: (r.underlying ?? "SPY").toUpperCase() };
    const o = runOne(c, r.spec_json, cfg, c.old);
    const n = runOne(c, r.spec_json, cfg, c.new);
    if (o.ok) oT += o.pnl; if (n.ok) nT += n.pnl;
    const d = (n.ok && o.ok) ? n.pnl - o.pnl : NaN;
    console.log(`  ${p(c.name, 9)}${p(o.ok ? sgn(o.pnl) : o.note ?? "—", 11)}${p(o.trades, 6)}${p(n.ok ? sgn(n.pnl) : n.note ?? "—", 11)}${p(n.trades, 6)}${p(Number.isNaN(d) ? "—" : sgn(d), 11)}`);
  }
  console.log(`  ${p("TOTAL", 9)}${p(sgn(oT), 11)}${p("", 6)}${p(sgn(nT), 11)}${p("", 6)}${p(sgn(nT - oT), 11)}`);
  console.log(`\n  Δ = NEW − OLD (the config effect, same engine entries so entries cancel). ⚠ option_quotes modeled exits;`);
  console.log(`  PB shows the STOP change only (its +20% TP is the builtin's, unchanged); MOMO old=new (ride, sanity check = ~0).\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
