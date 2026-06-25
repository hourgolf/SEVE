// theta-attribution-probe — answer the operator's "do the ride theories account for theta?".
// For every closed trade in the archived window, decompose the MID-to-MID premium P&L into:
//   • DIRECTIONAL  = ∫ delta·dUnderlying, PATH-INTEGRATED over the hold using the option's
//     EVOLVING delta (quotes-archive {mid,delta} per minute) × the underlying move per minute
//     (bars-archive). Using the evolving delta absorbs gamma into the directional term.
//   • RESIDUAL (≈THETA) = actual mid change − directional. On 0DTE this is dominated by decay.
//
// TWO honest views (delta is null in the archive for many quotes → can't decompose those):
//   A. DECOMPOSED — only trades whose path has delta on ≥50% of steps (real delta vs theta split).
//   B. CHOP THETA TAX — trades where |underlying move| < 0.5·ATR. Directional ≈ 0 BY CONSTRUCTION
//      (no move to be directional on), so actual mid P&L IS the decay — needs NO delta, so it's the
//      cleanest, highest-coverage theta signal. This is the direct answer to "what do the rides pay".
//
// Window = the durable quotes-archive (≈2026-06-05→). Mid-based (ex entry/exit spread). REAL fills.
//   npx tsx --env-file=.env.local engine/theta-attribution-probe.ts

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const sb: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } });

const ET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const etDate = (iso: string) => ET.format(new Date(iso));
const floorMin = (ms: number) => ms - (ms % 60_000);
const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
const f1 = (v: number) => (Number.isNaN(v) ? "—" : (v >= 0 ? "+" : "") + v.toFixed(1));
const p = (s: unknown, w: number) => String(s).padStart(w);
const FROM = "2026-06-05";

async function pageAll<T>(make: (from: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await make(from).range(from, from + 999);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    out.push(...batch); if (batch.length < 1000) break;
  }
  return out;
}

const arcCache = new Map<string, Map<string, Array<{ ts: number; mid: number; delta: number | null }>> | null>();
function archiveFor(dateET: string) {
  if (arcCache.has(dateET)) return arcCache.get(dateET)!;
  const path = `data/quotes-archive/${dateET}.json.gz`;
  if (!existsSync(path)) { arcCache.set(dateET, null); return null; }
  const rows = JSON.parse(gunzipSync(readFileSync(path)).toString()) as any[];
  const m = new Map<string, Array<{ ts: number; mid: number; delta: number | null }>>();
  for (const q of rows) {
    const occ = q.occ_symbol; if (!occ) continue;
    (m.get(occ) ?? m.set(occ, []).get(occ)!).push({ ts: Date.parse(q.captured_at), mid: Number(q.mid), delta: q.delta != null ? Number(q.delta) : null });
  }
  arcCache.set(dateET, m); return m;
}

const barsCache = new Map<string, { keys: number[]; map: Map<number, number> } | null>();
function barsFor(sym: string, dateET: string) {
  const key = `${sym}|${dateET}`;
  if (barsCache.has(key)) return barsCache.get(key)!;
  const path = `data/bars-archive/${sym}/${dateET}.json`;
  if (!existsSync(path)) { barsCache.set(key, null); return null; }
  const rows = JSON.parse(readFileSync(path, "utf8")) as Array<{ ts: string; close: number }>;
  const map = new Map<number, number>();
  for (const b of rows) map.set(floorMin(Date.parse(b.ts)), Number(b.close));
  const res = { keys: [...map.keys()].sort((a, b) => a - b), map };
  barsCache.set(key, res); return res;
}
function uAt(bars: { keys: number[]; map: Map<number, number> }, ts: number): number | null {
  const m = floorMin(ts);
  if (bars.map.has(m)) return bars.map.get(m)!;
  let lo = 0, hi = bars.keys.length - 1, ans = -1;
  while (lo <= hi) { const k = (lo + hi) >> 1; if (bars.keys[k] <= ts) { ans = k; lo = k + 1; } else hi = k - 1; }
  return ans >= 0 ? bars.map.get(bars.keys[ans])! : (bars.keys.length ? bars.map.get(bars.keys[0])! : null);
}

type Pos = {
  occ_symbol: string; underlying: string | null; opt_type: string; qty: number;
  avg_entry_price: number; opened_at: string; closed_at: string | null;
  entry_features: any; strategists?: { slug?: string; name?: string } | null;
};
type Agg = {
  name: string; pathN: number;
  decN: number; decHoldMin: number; actual: number; delta: number; theta: number; prem: number; ctHours: number; // decomposed-only
  chopN: number; chopTax: number; chopHoldMin: number; // chop trades (delta-free theta signal)
};

async function main() {
  const positions = await pageAll<Pos>((from) => sb.from("positions")
    .select("occ_symbol,underlying,opt_type,qty,avg_entry_price,opened_at,closed_at,entry_features,strategists(slug,name)")
    .eq("status", "closed").gte("opened_at", `${FROM}T00:00:00Z`).order("opened_at", { ascending: true }));

  const byCh = new Map<string, Agg>();
  let total = 0, pathOk = 0, decOk = 0;

  for (const pos of positions) {
    if (!pos.closed_at) continue; total++;
    const slug = pos.strategists?.slug ?? "?";
    const a = byCh.get(slug) ?? { name: pos.strategists?.name ?? slug, pathN: 0, decN: 0, decHoldMin: 0, actual: 0, delta: 0, theta: 0, prem: 0, ctHours: 0, chopN: 0, chopTax: 0, chopHoldMin: 0 };
    byCh.set(slug, a);

    const openMs = Date.parse(pos.opened_at), closeMs = Date.parse(pos.closed_at);
    const day = etDate(pos.opened_at);
    const path0 = archiveFor(day)?.get(pos.occ_symbol);
    if (!path0) continue;
    const path = path0.filter((q) => q.ts >= openMs && q.ts <= closeMs && isFinite(q.mid)).sort((x, y) => x.ts - y.ts);
    if (path.length < 2) continue;
    const bars = barsFor((pos.underlying ?? "SPY").toUpperCase(), day); if (!bars) continue;
    a.pathN++; pathOk++;

    const mult = 100 * Math.abs(pos.qty);
    const holdMin = (closeMs - openMs) / 60_000;
    if (holdMin > 390) continue; // exclude multi-session strands + 1DTE overnight holds (not clean intraday 0DTE theta)
    const actual = path[path.length - 1].mid - path[0].mid; // per-contract mid→mid
    const u0 = uAt(bars, path[0].ts), uN = uAt(bars, path[path.length - 1].ts);
    const totalDU = (u0 != null && uN != null) ? uN - u0 : 0;
    const atr = typeof pos.entry_features?.atr === "number" ? pos.entry_features.atr : null;
    const moveAtr = atr && atr > 0 ? Math.abs(totalDU) / atr : null;

    // B. chop theta tax — |move|<0.5ATR ⇒ directional≈0 ⇒ actual IS decay (no delta needed).
    // Require hold ≥ 20m so theta has time to bite (sub-20m losses are spread/vega, not decay).
    if (moveAtr != null && moveAtr < 0.5 && holdMin >= 20) { a.chopN++; a.chopTax += actual * mult; a.chopHoldMin += holdMin; }

    // A. decomposed — needs delta on ≥50% of steps
    const sign = pos.opt_type === "put" ? -1 : 1;
    let deltaPnl = 0, lastDelta: number | null = null, deltaSteps = 0;
    for (let i = 0; i < path.length - 1; i++) {
      if (path[i].delta != null) { lastDelta = Math.abs(path[i].delta!); }
      if (lastDelta == null) continue;
      const a0 = uAt(bars, path[i].ts), a1 = uAt(bars, path[i + 1].ts);
      if (a0 == null || a1 == null) continue;
      deltaPnl += sign * lastDelta * (a1 - a0); deltaSteps++;
    }
    if (deltaSteps / (path.length - 1) >= 0.5) {
      decOk++; a.decN++; a.decHoldMin += holdMin;
      a.actual += actual * mult; a.delta += deltaPnl * mult; a.theta += (actual - deltaPnl) * mult;
      a.prem += pos.avg_entry_price * mult; a.ctHours += (holdMin / 60) * Math.abs(pos.qty);
    }
  }

  console.log(`\n  THETA ATTRIBUTION · ${FROM}→ · ${total} closed trades · ${pathOk} with mid+underlying paths · ${decOk} also delta-decomposable (≥50% steps)\n`);

  // ── B. the headline: chop theta tax (delta-free, high coverage) ──
  console.log(`  ── (B) CHOP THETA TAX · non-mover trades (|underlying move| < 0.5·ATR) · actual mid-P&L ≈ pure decay, no delta needed ──`);
  console.log(`  ${p("channel", 22)}${p("chopN", 6)}${p("avgHold", 8)}${p("Σdecay", 9)}${p("$/trade", 9)}`);
  for (const a of [...byCh.values()].filter((x) => x.chopN >= 2).sort((x, y) => x.chopTax - y.chopTax))
    console.log(`  ${p(a.name.slice(0, 21), 22)}${p(a.chopN, 6)}${p(Math.round(a.chopHoldMin / a.chopN) + "m", 8)}${p(usd(a.chopTax), 9)}${p(usd(a.chopTax / a.chopN), 9)}`);

  // ── A. full decomposition (delta-covered trades only) ──
  console.log(`\n  ── (A) FULL DECOMPOSITION · delta-covered trades only · ACTUAL = DIRECTIONAL(∫delta·dU) + THETA(residual) ──`);
  console.log(`  ${p("channel", 22)}${p("n", 4)}${p("avgHold", 8)}${p("Σactual", 9)}${p("directional", 12)}${p("Σtheta", 9)}${p("θ%prem", 8)}${p("$/ct/hr", 9)}`);
  const dec = [...byCh.values()].filter((x) => x.decN >= 3).sort((x, y) => x.theta - y.theta);
  for (const a of dec) {
    const thetaPct = a.prem ? (a.theta / a.prem) * 100 : NaN;
    console.log(`  ${p(a.name.slice(0, 21), 22)}${p(a.decN, 4)}${p(Math.round(a.decHoldMin / a.decN) + "m", 8)}${p(usd(a.actual), 9)}${p(usd(a.delta), 12)}${p(usd(a.theta), 9)}${p(f1(thetaPct) + "%", 8)}${p(usd(a.ctHours ? a.theta / a.ctHours : 0), 9)}`);
  }

  const T = dec.reduce((s, a) => ({ actual: s.actual + a.actual, delta: s.delta + a.delta, theta: s.theta + a.theta }), { actual: 0, delta: 0, theta: 0 });
  const chopAll = [...byCh.values()].reduce((s, a) => ({ n: s.n + a.chopN, tax: s.tax + a.chopTax }), { n: 0, tax: 0 });
  console.log(`\n  ── totals ──`);
  console.log(`  (A) decomposed: ACTUAL ${usd(T.actual)} = DIRECTIONAL ${usd(T.delta)} + THETA ${usd(T.theta)}  (theta = ${T.actual ? Math.round((T.theta / (Math.abs(T.delta) + Math.abs(T.theta))) * 100) : 0}% of gross moves)`);
  console.log(`  (B) chop decay tax: ${usd(chopAll.tax)} across ${chopAll.n} non-mover trades = ${usd(chopAll.n ? chopAll.tax / chopAll.n : 0)}/trade`);
  console.log(`\n  READ: long-hold channels with big −Σdecay ARE paying the theta you flagged. The fix is structural — ITM (less`);
  console.log(`  extrinsic to bleed) or a time/stall exit on non-movers. ⚠ residual carries vega + 2nd-order gamma; mid-based; ~14-day window.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
