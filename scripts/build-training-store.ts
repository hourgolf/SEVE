// ============================================================================
//  build-training-store — the conviction spine's DATA half. Assembles one
//  (entry features → realized outcome) row per closed position, the fit-ready
//  dataset the desk has never had: conviction-fit, exit-confidence, and
//  feature-attribution all read it.
//
//  THE JOIN (no FK exists — verified): signals carries the entry feature vector
//  in rationale (er/relVol/gap/atr/expectedMove/roundTrip/delta/…) but has no
//  position_id; positions has the outcome (realized_pnl/close_reason) but no
//  signal_id. So each closed position is matched to its acted_on entry signal by
//  (strategist_id, rationale.occ == occ_symbol, created_at within [opened−3m,
//  opened+1m]) — the same reconstruction day-report.ts uses. ⚠ a same-channel
//  same-minute re-entry (backtest.ts:325 re-enters when flat) can match two
//  signals → flagged joinAmbiguous so the fit can drop corrupted labels.
//
//  Outcome target = R = realized_pnl / riskUsd (riskUsd = the −50% stop loss =
//  0.5·entry·qty·100) — P&L normalized by risk taken, the natural conviction
//  target (high conviction ⇒ high expected-R). Reads anon (read-only).
//
//    npm run build-training-store                       (all closed positions)
//    npm run build-training-store -- --from 2026-06-01 --to 2026-06-15
// ============================================================================

import { writeFileSync, mkdirSync } from "fs";
import { createServerSupabaseClient } from "./serverSupabase";

const sb = createServerSupabaseClient("build-training-store");
const arg = (n: string, d = "") => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const FROM = arg("from", "2024-01-01"), TO = arg("to", "2030-01-01");
const etDate = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(iso));
const num = (v: unknown): number | null => { const n = Number(v); return v != null && Number.isFinite(n) ? n : null; };

interface Row {
  id: string; date: string; slug: string; name: string; direction: string; strike: number; occ: string;
  features: { er: number | null; relVol: number | null; gap: number | null; atr: number | null; evMargin: number | null; expectedMove: number | null; roundTrip: number | null; delta: number | null; entryAsk: number | null; spotClose: number | null };
  entry: number; qty: number; riskUsd: number; realizedPnl: number; R: number | null; durationMin: number; closeReason: string | null;
  matched: boolean; joinAmbiguous: boolean;
}

async function pageAll<T>(build: (from: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await build(from).range(from, from + 999);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    out.push(...batch);
    if (batch.length < 1000) break;
  }
  return out;
}

async function main() {
  // closed positions in window + the channel label
  const positions = await pageAll<any>((from) => sb.from("positions")
    .select("id,strategist_id,occ_symbol,opt_type,strike,qty,avg_entry_price,realized_pnl,opened_at,closed_at,close_reason,strategists(slug,name)")
    .eq("status", "closed").gte("opened_at", `${FROM}T00:00:00Z`).lte("opened_at", `${TO}T23:59:59Z`).order("opened_at", { ascending: true }));

  // acted_on entry signals over the same window (+ a small buffer) — the feature source
  const signals = await pageAll<any>((from) => sb.from("signals")
    .select("strategist_id,created_at,rationale").eq("acted_on", true)
    .gte("created_at", `${FROM}T00:00:00Z`).lte("created_at", `${TO}T23:59:59Z`).order("created_at", { ascending: true }));

  // index acted_on signals by strategist_id|occ for the join
  const sigByKey = new Map<string, Array<{ ts: number; rationale: any }>>();
  for (const s of signals) {
    const occ = s.rationale?.occ;
    if (!occ) continue;
    const k = `${s.strategist_id}|${occ}`;
    (sigByKey.get(k) ?? sigByKey.set(k, []).get(k)!).push({ ts: Date.parse(s.created_at), rationale: s.rationale });
  }

  const rows: Row[] = [];
  for (const p of positions) {
    const openMs = Date.parse(p.opened_at);
    const cands = (sigByKey.get(`${p.strategist_id}|${p.occ_symbol}`) ?? [])
      .filter((s) => s.ts >= openMs - 180_000 && s.ts <= openMs + 60_000);
    cands.sort((a, b) => Math.abs(a.ts - openMs) - Math.abs(b.ts - openMs));
    const r = cands[0]?.rationale ?? null;
    const slug = p.strategists?.slug ?? "?", name = p.strategists?.name ?? slug;
    const entry = Number(p.avg_entry_price), qty = Number(p.qty), pnl = Number(p.realized_pnl ?? 0);
    const riskUsd = 0.5 * entry * qty * 100;
    const em = num(r?.expectedMove), rt = num(r?.roundTrip);
    rows.push({
      id: p.id, date: etDate(p.opened_at), slug, name, direction: p.opt_type, strike: Number(p.strike), occ: p.occ_symbol,
      features: { er: num(r?.er), relVol: num(r?.relVol), gap: num(r?.gap), atr: num(r?.atr), evMargin: em != null && rt && rt > 0 ? em / rt : null, expectedMove: em, roundTrip: rt, delta: num(r?.delta), entryAsk: num(r?.ask), spotClose: num(r?.spotClose) },
      entry, qty, riskUsd, realizedPnl: Math.round(pnl), R: riskUsd > 0 ? +(pnl / riskUsd).toFixed(3) : null,
      durationMin: Math.round((Date.parse(p.closed_at) - openMs) / 60000), closeReason: p.close_reason ?? null,
      matched: !!r, joinAmbiguous: cands.length > 1,
    });
  }

  mkdirSync("data/training", { recursive: true });
  const outPath = `data/training/${FROM}_${TO}.jsonl`;
  writeFileSync(outPath, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

  // ---- summary -----------------------------------------------------------------
  const matched = rows.filter((r) => r.matched);
  // The unmatched are NOT pre-logging/cron (verified: first signal == first position == 2026-06-01).
  // They split into manual twins (the signal logs at decision time, the human opens the lot minutes
  // later — structurally unjoinable by time) and auto RE-ENTRIES into a re-ATM'd strike (a same-occ
  // signal exists but >3m before open). The tight window CORRECTLY drops both — the nearest signal's
  // features are hours-stale (wrong regime); do NOT widen it to "recover" them.
  const unmatched = rows.filter((r) => !r.matched);
  const unmatchedManual = unmatched.filter((r) => /-manual$/i.test(r.slug)).length;
  const featureComplete = matched.filter((r) => r.features.er != null && r.features.gap != null && r.features.evMargin != null);
  const ambiguous = rows.filter((r) => r.joinAmbiguous);
  const withR = matched.filter((r) => r.R != null).map((r) => r.R!);
  const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const sd = (a: number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
  const evm = featureComplete.map((r) => r.features.evMargin!);

  console.log(`\nTRAINING STORE — ${FROM} → ${TO}\n`);
  console.log(`positions (closed):   ${rows.length}`);
  console.log(`matched to a signal:  ${matched.length} (${Math.round((100 * matched.length) / Math.max(1, rows.length))}%)`);
  console.log(`unmatched (dropped):  ${unmatched.length}  = ${unmatchedManual} manual-twin (human fill-lag) + ${unmatched.length - unmatchedManual} auto re-entry (same-strike signal >3m pre-open) — NOT pre-logging; their nearest signal is stale, so the join correctly drops them`);
  console.log(`feature-complete:     ${featureComplete.length} (er + gap + evMargin)`);
  console.log(`⚠ join-ambiguous:     ${ambiguous.length}${ambiguous.length ? "  (same strat+occ matched >1 entry signal — drop or hand-check before fitting)" : "  (clean)"}`);
  if (withR.length) console.log(`R (realized/risk):    mean ${mean(withR).toFixed(2)} · sd ${sd(withR).toFixed(2)} · n ${withR.length}`);
  if (evm.length) console.log(`EV-margin (conviction seed): min ${Math.min(...evm).toFixed(1)} · max ${Math.max(...evm).toFixed(1)} · sd ${sd(evm).toFixed(2)} · n ${evm.length}  ← continuous = a real signal to fit`);

  // per-channel cut (the fit is per-channel; surface where n is too thin)
  const byCh = new Map<string, Row[]>();
  for (const r of matched) byCh.set(r.name, [...(byCh.get(r.name) ?? []), r]);
  console.log(`\nby channel (matched):`);
  for (const [nm, rs] of [...byCh.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const rr = rs.filter((r) => r.R != null).map((r) => r.R!);
    const tagged = rs.filter((r) => r.closeReason).length;
    console.log(`  ${nm.padEnd(24)} ${String(rs.length).padStart(3)}t  meanR ${mean(rr).toFixed(2).padStart(6)}  Σpnl ${(rs.reduce((s, r) => s + r.realizedPnl, 0) >= 0 ? "+" : "") + Math.round(rs.reduce((s, r) => s + r.realizedPnl, 0))}  tagged ${tagged}/${rs.length}${rs.length < 30 ? "  ⚠ thin" : ""}`);
  }
  console.log(`\n→ ${outPath} (${rows.length} rows)\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
