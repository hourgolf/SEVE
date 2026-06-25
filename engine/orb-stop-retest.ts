// orb-stop-retest — does the underlying-stop finding survive on the ACTUAL live ORB specs (which carry
// trails and/or profit caps the loose orbEntries sweep did not)? Replays each live spec_json faithfully
// (entries + trail + profit cap) under CURRENT {−50% premium stop} vs NEW {no premium stop + 0.30%/0.25%
// underlying stop}. specToStrategyDef + specTrail (mirrors backtest.ts:605-619) + lever-shared harness
// (RISK 500, cost gate 3.0 @0.25, 1-tick fills, 5 OOS windows; QQQ ~2). Specs fetched live.
//   npx tsx --env-file=.env.local engine/orb-stop-retest.ts
import { createClient } from "@supabase/supabase-js";
import { simulateSession } from "./backtest";
import { specToStrategyDef, specPremiumExit } from "./specEvaluate";
import { specTrail, type StrategySpec } from "../lib/desk/strategySpec";
import { prep, cfgOf, FUND, FILL_1T, GATE_LIVE, RATIO, WINDOWS, winOf, type Prepped } from "./lever-shared";
import type { Trade, Bar } from "./types";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
const f1 = (v: number) => (Number.isNaN(v) ? "—" : (v >= 0 ? "+" : "") + v.toFixed(1));
const p = (s: any, w: number) => String(s).padStart(w);
const SLUGS = ["orb-trend-rider", "orb-spy-trail", "orb-qqq-trail", "qqq-thrust-trail"];

function compile(spec: StrategySpec) {
  const def = specToStrategyDef(spec);
  let premiumExit = specPremiumExit(spec);
  const t = specTrail(spec.management);
  let trailExit: any;
  if (t) { trailExit = t; premiumExit = { stopPct: premiumExit.stopPct }; } // trail governs upside → drop the profit cap (backtest.ts:615)
  return { def, trailExit, profitPct: premiumExit.profitPct };
}
type Mode = { name: string; keepStop: boolean; uStop: number };
const MODES: Mode[] = [
  { name: "CURRENT prem50", keepStop: true, uStop: 0 },   // live: spec profit cap (if any) + the −50% catastrophic stop
  { name: "NEW uStop0.30", keepStop: false, uStop: 0.30 }, // premium stop OFF, underlying 0.30%, profit cap kept
  { name: "NEW uStop0.25", keepStop: false, uStop: 0.25 },
];
function run(D: Prepped, c: { def: any; trailExit: any; profitPct?: number }, m: Mode): { date: string; ts: Trade[] }[] {
  const cfg = cfgOf(6);
  const px = m.keepStop ? { profitPct: c.profitPct, stopPct: 50 } : { profitPct: c.profitPct };
  return D.real.map((s) => ({ date: s.dateET, ts: simulateSession(s.bars, cfg, FUND, c.def.build(s.bars as Bar[], c.def.timeframeMin, { pdh: s.pdh, pdl: s.pdl, gap: s.gap }), D.chainFor(s, s.dateET), false, px, FILL_1T, undefined, c.trailExit, undefined, undefined, m.uStop, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE }, undefined, undefined, undefined, undefined, undefined, 0) }));
}
const stat = (z: { date: string; ts: Trade[] }[]) => { const f = z.flatMap((x) => x.ts), n = f.length, tot = f.reduce((a, t) => a + t.pnl, 0); return { n, tot, exp: n ? tot / n : NaN, win: n ? 100 * f.filter((t) => t.pnl > 0).length / n : NaN, stop: n ? 100 * f.filter((t) => /stop/.test(t.exitReason ?? "")).length / n : NaN }; };
const wexp = (z: { date: string; ts: Trade[] }[], w: string) => { const f = z.filter((x) => winOf(x.date) === w).flatMap((x) => x.ts); return f.length ? f.reduce((a, t) => a + t.pnl, 0) / f.length : NaN; };

async function main() {
  const { data: rows } = await sb.from("strategists").select("slug,underlying,spec_json").in("slug", SLUGS);
  const SPY = await prep("SPY", "data/databento-mdte");
  const QQQ = await prep("QQQ", "data/databento-mdte-qqq");
  console.log(`\n  ORB STOP RE-TEST · live specs (entries + trail + profit cap) · CURRENT −50% prem vs NEW underlying-stop`);
  console.log(`  faithful harness (RISK 500, gate 3.0@0.25, 1-tick) · SPY ${SPY.real.length} / QQQ ${QQQ.real.length} sessions\n`);
  for (const slug of SLUGS) {
    const r = (rows ?? []).find((x) => x.slug === slug); if (!r) { console.log(`  (no spec for ${slug})\n`); continue; }
    const c = compile(r.spec_json as StrategySpec);
    const D = r.underlying === "QQQ" ? QQQ : SPY;
    console.log(`━━ ${slug} [${r.underlying}] · ${c.trailExit ? "trail k=" + c.trailExit.atrChandelierK : "NO trail"} · profitCap ${c.profitPct ?? "none"} ━━`);
    console.log(`  ${p("config", 16)}${p("n", 5)}${p("exp/t", 8)}${p("total", 9)}${p("win", 5)}${p("stop%", 6)}   ${WINDOWS.map((w) => p(w.short, 8)).join("")}`);
    const base = stat(run(D, c, MODES[0])).exp;
    for (const m of MODES) {
      const z = run(D, c, m), s = stat(z);
      const wins = WINDOWS.map((w) => p(f1(wexp(z, w.name)), 8)).join("");
      const beats = !m.keepStop && s.exp > base ? " *" : "";
      console.log(`  ${p(m.name, 16)}${p(s.n, 5)}${p(f1(s.exp), 8)}${p(usd(s.tot), 9)}${p(Math.round(s.win), 5)}${p(Math.round(s.stop), 6)}   ${wins}${beats}`);
    }
    console.log("");
  }
  console.log(`  * = NEW underlying-stop beats CURRENT −50% premium (pooled). QQQ = ~2 windows (thin). Modeled options → forward-test.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
