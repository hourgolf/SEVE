// orb-stop-retest — does the underlying-stop finding survive on the ACTUAL armed ORB channels, which
// carry an ATR-chandelier TRAIL the loose orbEntries test did not? Replays each live spec_json
// (entries + trail) under CURRENT {−50% premium stop} vs NEW {no premium stop + 0.30%/0.25% underlying
// stop}. Faithful: specToStrategyDef + specTrail (mirrors backtest.ts:605-619) + lever-shared harness
// (RISK 500, cost gate 3.0 @0.25, 1-tick fills, 5 OOS windows; QQQ ~2 windows). Specs fetched live.
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

function compile(spec: StrategySpec) {
  const def = specToStrategyDef(spec);
  let premiumExit = specPremiumExit(spec);
  const t = specTrail(spec.management);
  let trailExit: any;
  if (t) { trailExit = t; premiumExit = { stopPct: premiumExit.stopPct }; }
  return { def, trailExit };
}
type Mode = { name: string; stopPct?: number; uStop: number };
const MODES: Mode[] = [
  { name: "CURRENT prem50", stopPct: 50, uStop: 0 },   // the live worker catastrophic −50% (+ the spec stop)
  { name: "NEW uStop0.30", uStop: 0.30 },              // premium stop OFF, underlying 0.30%
  { name: "NEW uStop0.25", uStop: 0.25 },
];
function run(D: Prepped, def: any, trailExit: any, m: Mode): { date: string; ts: Trade[] }[] {
  const cfg = cfgOf(6), px = m.stopPct != null ? { stopPct: m.stopPct } : {};
  return D.real.map((s) => ({ date: s.dateET, ts: simulateSession(s.bars, cfg, FUND, def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl, gap: s.gap }), D.chainFor(s, s.dateET), false, px, FILL_1T, undefined, trailExit, undefined, undefined, m.uStop, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE }, undefined, undefined, undefined, undefined, undefined, 0) }));
}
const stat = (z: { date: string; ts: Trade[] }[]) => { const f = z.flatMap((x) => x.ts), n = f.length, tot = f.reduce((a, t) => a + t.pnl, 0); return { n, tot, exp: n ? tot / n : NaN, win: n ? 100 * f.filter((t) => t.pnl > 0).length / n : NaN, stop: n ? 100 * f.filter((t) => /stop/.test(t.exitReason ?? "")).length / n : NaN }; };
const wexp = (z: { date: string; ts: Trade[] }[], w: string) => { const f = z.filter((x) => winOf(x.date) === w).flatMap((x) => x.ts); return f.length ? f.reduce((a, t) => a + t.pnl, 0) / f.length : NaN; };

async function main() {
  const { data: rows } = await sb.from("strategists").select("slug,underlying,spec_json").in("slug", ["orb-spy-trail", "orb-qqq-trail", "qqq-thrust-trail"]);
  const SPY = await prep("SPY", "data/databento-mdte");
  const QQQ = await prep("QQQ", "data/databento-mdte-qqq");
  console.log(`\n  ORB STOP RE-TEST · live armed specs (entries + chandelier trail) · CURRENT −50% prem vs NEW underlying-stop`);
  console.log(`  faithful harness (RISK 500, gate 3.0@0.25, 1-tick) · SPY ${SPY.real.length} / QQQ ${QQQ.real.length} sessions\n`);
  for (const slug of ["orb-spy-trail", "orb-qqq-trail", "qqq-thrust-trail"]) {
    const r = (rows ?? []).find((x) => x.slug === slug); if (!r) { console.log(`  (no spec for ${slug})`); continue; }
    const { def, trailExit } = compile(r.spec_json as StrategySpec);
    const D = r.underlying === "QQQ" ? QQQ : SPY;
    console.log(`━━ ${slug} [${r.underlying}] · trail k=${trailExit?.atrChandelierK ?? "—"} ━━`);
    console.log(`  ${p("config", 16)}${p("n", 5)}${p("exp/t", 8)}${p("total", 9)}${p("win", 5)}${p("stop%", 6)}   ${WINDOWS.map((w) => p(w.short, 8)).join("")}`);
    const base = stat(run(D, def, trailExit, MODES[0])).exp;
    for (const m of MODES) {
      const z = run(D, def, trailExit, m), s = stat(z);
      const wins = WINDOWS.map((w) => p(f1(wexp(z, w.name)), 8)).join("");
      const beats = m.stopPct == null && s.exp > base ? " *" : "";
      console.log(`  ${p(m.name, 16)}${p(s.n, 5)}${p(f1(s.exp), 8)}${p(usd(s.tot), 9)}${p(Math.round(s.win), 5)}${p(Math.round(s.stop), 6)}   ${wins}${beats}`);
    }
    console.log("");
  }
  console.log(`  * = NEW underlying-stop beats CURRENT −50% premium (pooled). QQQ = ~2 windows (thin) → directional only. Modeled options → forward-test.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
