// a6-read — the ERA-4 LOCK/RIDE evaluation (registry A6 + A6b + A9), mechanized.
//
// The read itself is pre-registered in docs/pre-registered-tests-2026-07.md; this script
// exists so the evaluation is LOCKED IN CODE before outcomes are visible — run it any time
// to see trigger progress, but VERDICTS only bind per the registry rules:
//   · trigger: 15 era-4 sessions (amended 2026-07-03; was N≥150-or-15-sessions)
//   · per-channel verdicts only at that channel's own N≥40 (short channels → deferred read)
//   · A6:  LOCK channel win% 95% CI (Wilson) vs the pre-registered 58% bar — CI UPPER < 58%
//          at N≥40 → flag RIDE-or-bench; above bar with green→red ≈ 0 → LOCK stands.
//          (58% was fixed for the +22/−30 pair; each channel's OWN breakeven bar is printed
//          for context, but changing the binding bar is a pre-window registry edit, not a
//          read-time judgment call.)
//   · A6b: near-miss rate = peak ≥ entry·(1 + 0.7·tp/100) AND realized ≤ 0, per channel.
//          ≥15% at N≥40 → reopen the arm-high-ratchet probe. ORB A/B excluded by design.
//   · A9:  breakout(base) era-4 split by |entry_features.gap| ≥/< 0.25. Flat expectancy < 0
//          at n≥15 AND gap expectancy ≥ 0 → gate validated (action chosen at the read).
//
//   npm run a6-read            # progress + (at trigger) verdicts
//
// Era boundaries (calibration-change log): grind-v3-2's TP changed 12→5 on 2026-07-02 —
// its era-4 sample starts there; do not pool across the boundary.

import { createClient } from "@supabase/supabase-js";

const ERA4_START = "2026-06-30";
const SESSIONS_TRIGGER = 15;
const VERDICT_N = 40;
const BAR = 0.58; // pre-registered (A6); per-channel own-bar printed for context only
const ERA_OVERRIDES: Record<string, string> = {
  "grind-v3-2": "2026-07-02", // TP 12→5 calibration (log entry B) — new era
};

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v)).toLocaleString();
const pct = (v: number) => (v * 100).toFixed(0) + "%";

// Wilson 95% CI for a binomial proportion.
function wilson(wins: number, n: number): { lo: number; hi: number } {
  if (n === 0) return { lo: 0, hi: 1 };
  const z = 1.96, p = wins / n, z2 = z * z;
  const den = 1 + z2 / n;
  const mid = (p + z2 / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  return { lo: Math.max(0, mid - half), hi: Math.min(1, mid + half) };
}

interface Row {
  strategist_id: string; realized_pnl: number; avg_entry_price: number; peak_mark: number | null;
  close_reason: string | null; opened_at: string; entry_features: { gap?: number | string } | null;
}

async function main() {
  const { data: strats } = await sb.from("strategists").select("id,slug,name,status,strategist_config(take_profit_pct,premium_stop_pct)");
  const bySlug = new Map<string, { id: string; slug: string; status: string; tp: number; stop: number }>();
  for (const s of (strats ?? []) as any[]) {
    const cfg = Array.isArray(s.strategist_config) ? s.strategist_config[0] : s.strategist_config;
    if (!cfg) continue;
    bySlug.set(s.slug, {
      id: s.id, slug: s.slug, status: s.status,
      tp: Number(cfg.take_profit_pct ?? 0),
      stop: cfg.premium_stop_pct == null ? 50 : Number(cfg.premium_stop_pct), // null → policy default 50
    });
  }
  const idToSlug = new Map([...bySlug.values()].map((s) => [s.id, s.slug]));

  // Era-4 closed trades, paginated past the PostgREST cap.
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("positions")
      .select("strategist_id,realized_pnl,avg_entry_price,peak_mark,close_reason,opened_at,entry_features")
      .eq("status", "closed").gte("opened_at", ERA4_START)
      .order("opened_at", { ascending: true }).range(from, from + 999);
    if (error) { console.error(`positions read failed: ${error.message}`); process.exit(1); }
    rows.push(...((data ?? []) as any[]));
    if (!data || data.length < 1000) break;
  }

  const sessions = new Set(rows.map((r) => r.opened_at.slice(0, 10)));
  const triggered = sessions.size >= SESSIONS_TRIGGER;

  console.log(`\n  A6 ERA-4 READ · era-4 = opened ≥ ${ERA4_START} · ${rows.length} closed trades · sessions ${sessions.size}/${SESSIONS_TRIGGER}${triggered ? "  ⇒ TRIGGERED" : "  (not yet triggered — progress view)"}`);
  console.log(`  rules: docs/pre-registered-tests-2026-07.md (A6 · A6b · A9) — verdicts bind only at trigger + own N≥${VERDICT_N}\n`);

  // Group era-4 trades per slug (honoring per-slug era overrides).
  const perSlug = new Map<string, Row[]>();
  for (const r of rows) {
    const slug = idToSlug.get(r.strategist_id);
    if (!slug) continue;
    const eraStart = ERA_OVERRIDES[slug] ?? ERA4_START;
    if (r.opened_at.slice(0, 10) < eraStart) continue;
    (perSlug.get(slug) ?? perSlug.set(slug, []).get(slug)!).push(r);
  }

  // ---- A6: LOCK channels (tp > 0) ----
  const lock = [...bySlug.values()].filter((s) => s.tp > 0 && s.status === "armed").sort((a, b) => a.slug.localeCompare(b.slug));
  console.log(`  A6 · LOCK CHANNELS (armed, tp>0) — bar ${pct(BAR)} (pre-registered), own-bar = stop/(tp+stop) shown for context`);
  console.log(`  ${"channel".padEnd(28)} ${"N".padStart(3)} ${"win%".padStart(5)} ${"CI95".padStart(12)} ${"ownBar".padStart(6)} ${"g→r".padStart(4)} ${"tpΣ".padStart(8)} ${"stopΣ".padStart(8)}  verdict`);
  for (const s of lock) {
    const tr = perSlug.get(s.slug) ?? [];
    const n = tr.length;
    const wins = tr.filter((r) => Number(r.realized_pnl) > 0).length;
    const ci = wilson(wins, n);
    const g2r = tr.filter((r) => r.peak_mark != null && Number(r.avg_entry_price) > 0
      && (Number(r.peak_mark) - Number(r.avg_entry_price)) / Number(r.avg_entry_price) >= 0.20
      && Number(r.realized_pnl) <= 0).length;
    const tpSum = tr.filter((r) => r.close_reason === "target_premium").reduce((a, r) => a + Number(r.realized_pnl), 0);
    const stopSum = tr.filter((r) => r.close_reason === "stop_premium" || r.close_reason === "premium_stop").reduce((a, r) => a + Number(r.realized_pnl), 0);
    const ownBar = s.stop / (s.tp + s.stop);
    let verdict = `insufficient N (<${VERDICT_N})`;
    if (triggered && n >= VERDICT_N) {
      if (ci.hi < BAR) verdict = "⚑ FLAG: RIDE mode or bench (CI upper < bar)";
      else if (ci.lo >= BAR && g2r === 0) verdict = "✓ LOCK stands";
      else verdict = "inconclusive at bar — hold, re-read as N accrues";
    } else if (!triggered && n >= VERDICT_N) verdict = `N ready — awaiting session trigger`;
    const era = ERA_OVERRIDES[s.slug] ? ` (era ${ERA_OVERRIDES[s.slug]}→)` : "";
    console.log(`  ${(s.slug + era).padEnd(28)} ${String(n).padStart(3)} ${n ? pct(wins / n).padStart(5) : "   —"} ${n ? `[${pct(ci.lo)},${pct(ci.hi)}]`.padStart(12) : "           —"} ${pct(ownBar).padStart(6)} ${String(g2r).padStart(4)} ${usd(tpSum).padStart(8)} ${usd(stopSum).padStart(8)}  ${verdict}`);
  }

  // ---- A6b: near-miss (read WITH A6; ORB A/B excluded — no-TP probe spec by design) ----
  console.log(`\n  A6b · NEAR-MISS (peak ≥ 70% of TP level, closed ≤ $0) — ≥15% at N≥${VERDICT_N} reopens the arm-high-ratchet probe`);
  for (const s of lock) {
    const tr = perSlug.get(s.slug) ?? [];
    const n = tr.length;
    if (!n) continue;
    const nm = tr.filter((r) => r.peak_mark != null && Number(r.avg_entry_price) > 0
      && Number(r.peak_mark) >= Number(r.avg_entry_price) * (1 + 0.7 * s.tp / 100)
      && Number(r.realized_pnl) <= 0).length;
    const rate = nm / n;
    const flag = triggered && n >= VERDICT_N && rate >= 0.15 ? "⚑ reopen ratchet probe" : (rate >= 0.15 ? "(watch — under N)" : "");
    console.log(`  ${s.slug.padEnd(28)} ${String(nm).padStart(3)}/${String(n).padEnd(3)} = ${pct(rate).padStart(4)}  ${flag}`);
  }

  // ---- A9: breakout(base) gap/flat split ----
  const base = perSlug.get("breakout") ?? [];
  const withGap = base.filter((r) => r.entry_features && r.entry_features.gap != null && r.entry_features.gap !== "");
  const flat = withGap.filter((r) => Math.abs(Number(r.entry_features!.gap)) < 0.25);
  const gap = withGap.filter((r) => Math.abs(Number(r.entry_features!.gap)) >= 0.25);
  const exp = (a: Row[]) => (a.length ? a.reduce((s, r) => s + Number(r.realized_pnl), 0) / a.length : 0);
  console.log(`\n  A9 · breakout(base) era-4 gap split (|entry_features.gap| vs 0.25) — rule: flat exp < 0 at n≥15 AND gap exp ≥ 0 → gate validated`);
  console.log(`  flat-open: n=${flat.length}  Σ ${usd(flat.reduce((s, r) => s + Number(r.realized_pnl), 0))}  exp ${usd(exp(flat))}/t`);
  console.log(`  gap-day:   n=${gap.length}  Σ ${usd(gap.reduce((s, r) => s + Number(r.realized_pnl), 0))}  exp ${usd(exp(gap))}/t`);
  if (base.length !== withGap.length) console.log(`  ⚠ ${base.length - withGap.length} era-4 base trade(s) missing a gap stamp — run backfill-forensics before binding the read`);
  const a9Ready = flat.length >= 15;
  console.log(`  status: ${a9Ready ? (exp(flat) < 0 && exp(gap) >= 0 ? "⚑ RULE MET — gate validated; action (arm gap_min 0.25 vs consolidate SPY slot) is the A6-read roster decision" : "rule NOT met — base keeps trading ungated (kill path)") : `collecting (flat n=${flat.length}/15)`}`);

  // ---- Rides (informational — NO pre-registered gate; the known A6 coverage gap) ----
  const rides = [...bySlug.values()].filter((s) => s.tp === 0 && s.status === "armed").sort((a, b) => a.slug.localeCompare(b.slug));
  console.log(`\n  RIDES (tp=0, armed) — INFORMATIONAL ONLY: no pre-registered sizing/eval gate covers these (known gap)`);
  for (const s of rides) {
    const tr = perSlug.get(s.slug) ?? [];
    const sum = tr.reduce((a, r) => a + Number(r.realized_pnl), 0);
    console.log(`  ${s.slug.padEnd(28)} N ${String(tr.length).padStart(3)}  Σ ${usd(sum)}`);
  }
  console.log("");
}

main().catch((e) => { console.error(e); process.exit(1); });
