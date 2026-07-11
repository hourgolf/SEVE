// ============================================================================
//  Per-channel scorecard — "what's working and what's not".
//  Reads the desk's live telemetry (strategists ⋈ positions ⋈ signals) via the
//  anon key (read-only) and rolls it up per channel: realized P&L + win rate +
//  expectancy from closed positions, and acted/blocked breakdown from signals
//  (what the risk layer is vetoing). Pair this with `npm run backtest --strat X`
//  to compare the MODELED edge against what the channel is actually doing live.
//
//    npm run report                 # all-time
//    npm run report -- --days 5     # last 5 days
//
//  NOTE: numbers reflect whatever is in the DB — during/after an incident (e.g.
//  the 0DTE-cutoff 422 stretch + pending reconciliation) they will be noisy.
// ============================================================================

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { pageAll } from "./pageAll";

function loadEnv() {
  try {
    const txt = readFileSync(".env.local", "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {
    /* fall through */
  }
}
function argNum(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : def;
}
const usd = (v: number) => (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(2);
const pct = (v: number) => (v * 100).toFixed(1) + "%";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY (.env.local)");
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const days = argNum("days", 0); // 0 = all-time
  const sinceIso = days > 0 ? new Date(Date.now() - days * 86_400_000).toISOString() : null;
  const span = days > 0 ? `last ${days} day(s)` : "all-time";

  // Closed positions + signals PAGINATE (audit 2026-07-10): .limit(20000/50000) silently
  // capped at PostgREST's ~1000 max-rows, so the all-time scorecard was an arbitrary
  // ~1000-row slice masquerading as per-channel P&L/win-rate. pageAll + a total order
  // (.order(col) + id tiebreak) fetches everything or fails loud.
  const [stratRes, openRes, closed, signals] = await Promise.all([
    sb.from("strategists").select("id,slug,name,status,sort_order").order("sort_order", { ascending: true }),
    sb.from("positions").select("strategist_id,unrealized_pnl").eq("status", "open").limit(2000),
    pageAll<any>(() =>
      (sinceIso
        ? sb.from("positions").select("strategist_id,realized_pnl,closed_at").eq("status", "closed").gte("closed_at", sinceIso)
        : sb.from("positions").select("strategist_id,realized_pnl,closed_at").eq("status", "closed")
      ).order("closed_at", { ascending: true }).order("id")),
    pageAll<any>(() =>
      (sinceIso
        ? sb.from("signals").select("strategist_id,signal_type,acted_on,blocked_reason,created_at").gte("created_at", sinceIso)
        : sb.from("signals").select("strategist_id,signal_type,acted_on,blocked_reason,created_at")
      ).order("created_at", { ascending: false }).order("id")),
  ]);

  if (stratRes.error) throw new Error("strategists read: " + stratRes.error.message);
  const strategists = (stratRes.data ?? []) as any[];
  const open = (openRes.data ?? []) as any[];

  const groupBy = <T>(rows: T[], keyFn: (r: T) => string) => {
    const m = new Map<string, T[]>();
    for (const r of rows) { const k = keyFn(r); (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
    return m;
  };
  const closedByCh = groupBy(closed, (r) => String(r.strategist_id));
  const openByCh = groupBy(open, (r) => String(r.strategist_id));
  const sigByCh = groupBy(signals, (r) => String(r.strategist_id));

  console.log(`\n══════════════════════════════════════════════════════════`);
  console.log(`  SEVE channel scorecard · ${span}`);
  console.log(`══════════════════════════════════════════════════════════`);

  let fundRealized = 0, fundTrades = 0;
  for (const s of strategists) {
    const cl = (closedByCh.get(String(s.id)) ?? []).map((r) => Number(r.realized_pnl ?? 0));
    const wins = cl.filter((p) => p > 0);
    const losses = cl.filter((p) => p <= 0);
    const total = cl.reduce((a, p) => a + p, 0);
    const expectancy = cl.length ? total / cl.length : 0;
    const avgWin = wins.length ? wins.reduce((a, p) => a + p, 0) / wins.length : 0;
    const avgLoss = losses.length ? losses.reduce((a, p) => a + p, 0) / losses.length : 0;
    const openRows = openByCh.get(String(s.id)) ?? [];
    const openUnreal = openRows.reduce((a, r) => a + Number(r.unrealized_pnl ?? 0), 0);

    const sig = sigByCh.get(String(s.id)) ?? [];
    const acted = sig.filter((r) => r.acted_on).length;
    const blocked: Record<string, number> = {};
    for (const r of sig) if (!r.acted_on && r.blocked_reason) blocked[r.blocked_reason] = (blocked[r.blocked_reason] ?? 0) + 1;
    const topBlocked = Object.entries(blocked).sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([k, n]) => `${k} ${n}`).join(" · ") || "—";

    fundRealized += total; fundTrades += cl.length;

    console.log(`\n● ${s.name}  (${s.slug}) · ${s.status ?? "armed"}`);
    console.log(`  Closed trades   ${cl.length}   win ${cl.length ? pct(wins.length / cl.length) : "—"}   exp/trade ${usd(expectancy)}`);
    console.log(`  Realized P&L    ${usd(total)}   (avg win ${usd(avgWin)} / avg loss ${usd(avgLoss)})`);
    console.log(`  Open            ${openRows.length}   unreal ${usd(openUnreal)}`);
    console.log(`  Signals         ${sig.length}   acted ${sig.length ? pct(acted / sig.length) : "—"}`);
    console.log(`  Top vetoes      ${topBlocked}`);
  }

  console.log(`\n──────────────────────────────────────────────────────────`);
  console.log(`  DESK · ${fundTrades} closed trades · realized ${usd(fundRealized)}`);
  console.log(`══════════════════════════════════════════════════════════\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
