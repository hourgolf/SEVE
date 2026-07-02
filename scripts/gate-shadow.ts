// ============================================================================
//  gate-shadow — reconstruct the would-have outcome of GATE-BLOCKED entries
//  (phase-4 A2, 2026-07-01). Closes the cost-gate calibration loop: the desk
//  logs cost_gate / stale_chain blocks but never their counterfactual outcome,
//  and option_quotes prune at 7d — so K=6.0's calibration was unanswerable.
//
//  For each blocked entry signal in the still-live quote window: enter at the
//  logged decision ask, replay the CHANNEL's OWN premium exits (per-channel
//  take_profit_pct / premium_stop_pct, policy default 50) over option_quotes
//  mids, flatten at the last quote of the session. Bank the result durably in
//  data/gate-shadow.json (upsert by signal id — re-run safe) + an events row
//  (service role only, best-effort).
//
//  READ-ONLY vs the trade path. Mid-basis (labeled): would-have P&L uses quote
//  mids, an UPPER BOUND on what a real crossed fill would have realized.
//  Diagnostic only — no profitability claim; feeds the pre-registered check in
//  docs/pre-registered-tests-2026-07.md (≥30 blocks before any K conclusion).
//
//    npm run gate-shadow            # last 6 days (inside the 7d prune window)
//    npm run gate-shadow -- --days 3
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const HAS_SERVICE = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const daysArg = process.argv.indexOf("--days");
const DAYS = daysArg > 0 ? Math.max(1, Number(process.argv[daysArg + 1]) || 6) : 6;
const LEDGER = "data/gate-shadow.json";
const POLICY_STOP = 50; // worker policy.PREMIUM_STOP_PCT — the shadow's fallback stop

interface ShadowRow {
  signalId: string; slug: string; occ: string; createdAt: string; blocked: string;
  entryAsk: number; exitReason: string; exitPx: number | null; pnlPerContract: number | null;
  stopPct: number; tpPct: number; nQuotes: number; basis: "mid-upper-bound";
}

function loadLedger(): Map<string, ShadowRow> {
  if (!existsSync(LEDGER)) return new Map();
  try {
    const rows = JSON.parse(readFileSync(LEDGER, "utf8")) as ShadowRow[];
    return new Map(rows.map((r) => [r.signalId, r]));
  } catch { return new Map(); }
}

async function main() {
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
  const { data: sigs, error } = await sb
    .from("signals")
    .select("id,strategist_id,created_at,blocked_reason,rationale,strategists(slug),direction")
    .in("blocked_reason", ["cost_gate", "stale_chain"])
    .gte("created_at", since)
    .order("created_at", { ascending: true });
  if (error) { console.error(`gate-shadow: signals read failed — ${error.message}`); process.exit(1); }

  const { data: cfgRows } = await sb
    .from("strategists")
    .select("id,slug,strategist_config(premium_stop_pct,take_profit_pct)");
  const cfgById = new Map(
    ((cfgRows ?? []) as any[]).map((r) => {
      const c = Array.isArray(r.strategist_config) ? r.strategist_config[0] : r.strategist_config;
      return [r.id, { stop: c?.premium_stop_pct == null ? POLICY_STOP : Number(c.premium_stop_pct), tp: Number(c?.take_profit_pct ?? 0) }];
    }),
  );

  const ledger = loadLedger();
  let fresh = 0;
  for (const s of (sigs ?? []) as any[]) {
    if (ledger.has(String(s.id))) continue;
    const occ = String(s.rationale?.occ ?? "");
    const ask = Number(s.rationale?.ask ?? 0);
    const slug = String(s.strategists?.slug ?? "?");
    const cfg = cfgById.get(s.strategist_id) ?? { stop: POLICY_STOP, tp: 0 };
    const stopPct = cfg.stop > 0 ? cfg.stop : POLICY_STOP; // stop 0 = u-stop channel; shadow uses the catastrophic reference
    const base: ShadowRow = {
      signalId: String(s.id), slug, occ, createdAt: String(s.created_at), blocked: String(s.blocked_reason),
      entryAsk: ask, exitReason: "no_quotes", exitPx: null, pnlPerContract: null,
      stopPct, tpPct: cfg.tp, nQuotes: 0, basis: "mid-upper-bound",
    };
    if (occ && ask > 0) {
      // quotes from the block to the end of that UTC day (RTH ⇒ same UTC date)
      const dayEnd = `${String(s.created_at).slice(0, 10)}T23:59:59Z`;
      const { data: quotes } = await sb
        .from("option_quotes").select("mid,captured_at")
        .eq("occ_symbol", occ).gte("captured_at", s.created_at).lte("captured_at", dayEnd)
        .order("captured_at", { ascending: true }).limit(5000);
      const qs = ((quotes ?? []) as any[]).map((q) => Number(q.mid)).filter((m) => m > 0);
      base.nQuotes = qs.length;
      if (qs.length) {
        const stopLv = ask * (1 - stopPct / 100);
        const tpLv = cfg.tp > 0 ? ask * (1 + cfg.tp / 100) : null;
        let exitPx = qs[qs.length - 1]; let reason = "would_flatten";
        for (const m of qs) {
          if (tpLv != null && m >= tpLv) { exitPx = tpLv; reason = "would_target"; break; }
          if (m <= stopLv) { exitPx = stopLv; reason = "would_stop"; break; }
        }
        base.exitPx = Math.round(exitPx * 100) / 100;
        base.exitReason = reason;
        base.pnlPerContract = Math.round((exitPx - ask) * 100 * 100) / 100;
      }
    }
    ledger.set(base.signalId, base);
    fresh++;
    if (HAS_SERVICE && base.pnlPerContract != null) {
      try {
        await sb.from("events").insert({
          level: "INFO",
          message: `gate-shadow: ${slug} ${occ} blocked(${base.blocked}) → ${base.exitReason} $${base.pnlPerContract.toFixed(0)}/ct (mid-basis)`,
          meta: { kind: "gate-shadow", ...base },
        });
      } catch { /* best-effort */ }
    }
  }

  mkdirSync("data", { recursive: true });
  const rows = [...ledger.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  writeFileSync(LEDGER, JSON.stringify(rows, null, 1));

  const scored = rows.filter((r) => r.pnlPerContract != null);
  const sum = scored.reduce((a, r) => a + (r.pnlPerContract ?? 0), 0);
  console.log(`\n  GATE-SHADOW · ${fresh} new / ${rows.length} total blocked entries banked → ${LEDGER}`);
  console.log(`  scored ${scored.length} (mid-basis UPPER BOUND) · Σ would-have $${Math.round(sum)} · avg $${scored.length ? Math.round(sum / scored.length) : 0}/ct`);
  const bySlug = new Map<string, { n: number; pnl: number }>();
  for (const r of scored) { const g = bySlug.get(r.slug) ?? { n: 0, pnl: 0 }; g.n++; g.pnl += r.pnlPerContract ?? 0; bySlug.set(r.slug, g); }
  for (const [slug, g] of [...bySlug.entries()].sort((a, b) => b[1].n - a[1].n))
    console.log(`    ${slug.padEnd(28)} n ${String(g.n).padStart(3)} · Σ $${Math.round(g.pnl)}`);
  console.log(`  ⚠ diagnostic only — no K change before the pre-registered ≥30-block check (docs/pre-registered-tests-2026-07.md).\n`);
}
main().catch((e) => { console.error(`gate-shadow fatal — ${(e as Error).message}`); process.exit(1); });
