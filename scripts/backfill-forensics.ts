// ============================================================================
//  backfill-forensics — catch EVERY historical trade up to the durable per-trade
//  forensics dataset (44_trade_forensics), so we can mine entry/exit + whiplash
//  patterns across the whole book, not just trades since the 2026-06-24 deploy.
//
//  For each closed position it fills (COALESCE — never overwrites a live-captured
//  value, only gaps):
//    · entry_features — RECOMPUTED from the bars archive so VWAP + MACD (never
//      logged before today) exist for ALL trades: gap (signed overnight %), er,
//      relVol, atr, mom, session-VWAP (cumulative, not the per-bar quirk) + vwapDist,
//      MACD(12/26/9) line/signal/hist, opening range, minutesToClose. The matched
//      entry signal's cost context (ask/bid/roundTrip/expectedMove/spotClose) is
//      merged in where present (live values WIN on overlap).
//    · entry_reason  — the channel's trigger label, joined from `signals`.
//    · entry_delta   — from the matched signal's rationale.
//    · peak_mark     — running MAX option mid over the hold (MFE source), from
//      option_quotes (DB, ~7d) ∪ the quotes-archive (gz, banked) — NEVER overwrites
//      a live-ratcheted peak.
//
//  Read-only against the DB (anon). No service-role key locally → emits the UPDATEs
//  to data/backfill-forensics.sql for apply-via-MCP. Idempotent (all COALESCE/merge).
//
//    npm run backfill-forensics            (all trades)
//    npm run backfill-forensics -- --from 2026-06-05   (limit the start ET date)
// ============================================================================

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { loadRealSessions, type RealSession } from "../engine/realsource";
import { computeFeatures } from "../engine/engine";
import { macdAt } from "../engine/macd";
import type { Bar } from "../engine/types";

const sb: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } });

// Direct apply needs write access. With SUPABASE_SERVICE_ROLE_KEY in .env.local + --write,
// the script UPDATEs the rows itself (the live-wins merge done in JS); otherwise it emits the
// SQL file for apply-via-MCP. Read path is always anon.
const WRITE = process.argv.includes("--write");
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sbWrite = SERVICE ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, SERVICE, { auth: { persistSession: false } }) : null;

const fi = process.argv.indexOf("--from");
const FROM = fi >= 0 ? process.argv[fi + 1] : "2026-01-01";
const ET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const etDate = (iso: string) => ET.format(new Date(iso));
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const sqlStr = (s: string | null) => (s == null ? "NULL" : `'${s.replace(/'/g, "''")}'`);
const sqlNum = (v: number | null | undefined) => (v == null || !isFinite(v) ? "NULL" : String(v));

async function pageAll<T>(make: (from: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await make(from).range(from, from + 999);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    out.push(...batch);
    if (batch.length < 1000) break;
  }
  return out;
}

// floor an epoch-ms to its minute, so the entry bar = the last COMPLETED bar BEFORE the
// fill minute (the worker decides on bar-close then fills next minute — match that context).
const floorMin = (ms: number) => ms - (ms % 60_000);

type Pos = {
  id: string; strategist_id: string; occ_symbol: string; underlying: string | null; opt_type: string;
  qty: number; avg_entry_price: number; realized_pnl: number | null;
  opened_at: string; closed_at: string | null;
  entry_features: unknown; entry_reason: string | null; entry_delta: number | null; peak_mark: number | null;
  close_reason: string | null; strategists?: { slug?: string; name?: string } | null;
};
type Sig = { ts: number; signal_type: string | null; rationale: any };

// quotes-archive: dateET → occ → [{ts, mid, delta}], lazily gunzipped + indexed once.
const archiveCache = new Map<string, Map<string, Array<{ ts: number; mid: number; delta: number | null }>>>();
function archiveFor(dateET: string): Map<string, Array<{ ts: number; mid: number; delta: number | null }>> | null {
  if (archiveCache.has(dateET)) return archiveCache.get(dateET)!;
  const path = `data/quotes-archive/${dateET}.json.gz`;
  if (!existsSync(path)) { archiveCache.set(dateET, null as any); return null; }
  const rows = JSON.parse(gunzipSync(readFileSync(path)).toString()) as any[];
  const m = new Map<string, Array<{ ts: number; mid: number; delta: number | null }>>();
  for (const q of rows) {
    const occ = q.occ_symbol; if (!occ) continue;
    (m.get(occ) ?? m.set(occ, []).get(occ)!).push({ ts: Date.parse(q.captured_at), mid: Number(q.mid), delta: q.delta != null ? Number(q.delta) : null });
  }
  archiveCache.set(dateET, m);
  return m;
}

// peak option mid over [open, close] + the delta nearest entry. DB first (recent), archive next.
async function peakAndDelta(occ: string, openMs: number, closeMs: number, dateET: string): Promise<{ peak: number | null; delta: number | null }> {
  // DB (option_quotes, ~7d retention)
  const { data: pk } = await sb.from("option_quotes").select("mid").eq("occ_symbol", occ)
    .gte("captured_at", new Date(openMs).toISOString()).lte("captured_at", new Date(closeMs ?? openMs).toISOString())
    .order("mid", { ascending: false }).limit(1).maybeSingle();
  if (pk?.mid != null) {
    const { data: dq } = await sb.from("option_quotes").select("delta").eq("occ_symbol", occ)
      .gte("captured_at", new Date(openMs).toISOString()).order("captured_at", { ascending: true }).limit(1).maybeSingle();
    return { peak: Number(pk.mid), delta: dq?.delta != null ? Number(dq.delta) : null };
  }
  // archive (gz)
  const arc = archiveFor(dateET);
  const qs = arc?.get(occ);
  if (qs && qs.length) {
    const inHold = qs.filter((q) => q.ts >= openMs && q.ts <= (closeMs ?? openMs) && isFinite(q.mid));
    if (inHold.length) {
      const peak = Math.max(...inHold.map((q) => q.mid));
      const first = inHold.slice().sort((a, b) => a.ts - b.ts)[0];
      return { peak, delta: first?.delta ?? null };
    }
  }
  return { peak: null, delta: null };
}

// option mid PATH over [open,close] from option_quotes (DB ~7d) ∪ the gz archive — substrate for the empirical greek.
async function optionPath(occ: string, openMs: number, closeMs: number, dateET: string): Promise<Array<{ ts: number; mid: number }>> {
  const { data } = await sb.from("option_quotes").select("captured_at,mid").eq("occ_symbol", occ)
    .gte("captured_at", new Date(openMs).toISOString()).lte("captured_at", new Date(closeMs ?? openMs).toISOString())
    .order("captured_at", { ascending: true });
  if (data && data.length) return (data as Array<{ captured_at: string; mid: number | null }>).filter((q) => q.mid != null).map((q) => ({ ts: Date.parse(q.captured_at), mid: Number(q.mid) }));
  const qs = archiveFor(dateET)?.get(occ);
  if (qs && qs.length) return qs.filter((q) => q.ts >= openMs && q.ts <= (closeMs ?? openMs) && isFinite(q.mid)).sort((a, b) => a.ts - b.ts).map((q) => ({ ts: q.ts, mid: q.mid }));
  return [];
}

// EMPIRICAL greeks (NO Black-Scholes [[no-black-scholes]]): per-trade levels regression mid ~ α + β·U + γ·τ over the
// minute-resampled path. β = realized delta (what the option ACTUALLY did per $ of underlying — pin/skew baked in),
// γ = realized theta/min (the intercept IS the model-free decay). The verified theta-v2 method
// (engine/theta-empirical-probe.ts, 43e3383). Reliable for HOLD channels (≥10min); short premium-exit scalps return
// null (too short a path + selection bias flips γ positive — theta-impossible). decayPerCtHr = γ·60·100.
function empiricalGreeks(optPath: Array<{ ts: number; mid: number }>, sess: RealSession | undefined, holdMin: number): { realizedDelta: number; realizedThetaPerMin: number; decayPerCtHr: number; nPts: number } | null {
  if (holdMin < 10 || !sess || optPath.length < 4) return null;
  const uMap = new Map<number, number>(); for (const b of sess.bars) uMap.set(floorMin(b.ts), b.close);
  const minuteMid = new Map<number, number>(); for (const q of optPath) if (q.mid > 0) minuteMid.set(floorMin(q.ts), q.mid);
  const path = [...minuteMid.keys()].sort((a, b) => a - b).map((m) => ({ t: m, mid: minuteMid.get(m)!, u: uMap.get(m) })).filter((x): x is { t: number; mid: number; u: number } => x.u != null);
  if (path.length < 4) return null;
  const t0 = path[0].t, pts = path.map((x) => ({ u: x.u, tau: (x.t - t0) / 60000, mid: x.mid }));
  const nP = pts.length, mU = pts.reduce((a, q) => a + q.u, 0) / nP, mT = pts.reduce((a, q) => a + q.tau, 0) / nP, mM = pts.reduce((a, q) => a + q.mid, 0) / nP;
  let Suu = 0, Stt = 0, Sut = 0, Sum = 0, Stm = 0;
  for (const q of pts) { const du = q.u - mU, dt = q.tau - mT, dm = q.mid - mM; Suu += du * du; Stt += dt * dt; Sut += du * dt; Sum += du * dm; Stm += dt * dm; }
  const corrUT = Suu > 0 && Stt > 0 ? Sut / Math.sqrt(Suu * Stt) : 1;
  if (Math.abs(corrUT) > 0.9) return null; // U & time too collinear (monotonic-trend hold) → β/γ split unreliable (the theta-v2 caveat, gated per-trade); the choppier holds (low corr) carry the channel's estimate
  const denom = Suu * Stt - Sut * Sut; if (Math.abs(denom) < 1e-9) return null;
  const beta = (Sum * Stt - Stm * Sut) / denom, gamma = (Stm * Suu - Sum * Sut) / denom;
  return { realizedDelta: Math.round(beta * 1000) / 1000, realizedThetaPerMin: Math.round(gamma * 10000) / 10000, decayPerCtHr: Math.round(gamma * 6000 * 100) / 100, nPts: nP };
}

async function main() {
  console.log(`backfill-forensics — closed positions opened ≥ ${FROM} (ET)\n`);

  const positions = await pageAll<Pos>((from) => sb.from("positions")
    .select("id,strategist_id,occ_symbol,underlying,opt_type,qty,avg_entry_price,realized_pnl,opened_at,closed_at,entry_features,entry_reason,entry_delta,peak_mark,close_reason,strategists(slug,name)")
    .eq("status", "closed").gte("opened_at", `${FROM}T00:00:00Z`).order("opened_at", { ascending: true }));

  // acted_on entry signals → index by strategist_id|occ (the no-FK join, build-training-store rule)
  const signals = await pageAll<any>((from) => sb.from("signals")
    .select("strategist_id,created_at,signal_type,rationale").eq("acted_on", true)
    .gte("created_at", `${FROM}T00:00:00Z`).order("created_at", { ascending: true }));
  const sigByKey = new Map<string, Sig[]>();
  for (const s of signals) {
    const occ = s.rationale?.occ; if (!occ) continue;
    const k = `${s.strategist_id}|${occ}`;
    (sigByKey.get(k) ?? sigByKey.set(k, []).get(k)!).push({ ts: Date.parse(s.created_at), signal_type: s.signal_type ?? null, rationale: s.rationale });
  }
  const matchSig = (p: Pos): Sig | null => {
    const cands = (sigByKey.get(`${p.strategist_id}|${p.occ_symbol}`) ?? [])
      .filter((s) => s.ts >= Date.parse(p.opened_at) - 180_000 && s.ts <= Date.parse(p.opened_at) + 60_000)
      .sort((a, b) => Math.abs(a.ts - Date.parse(p.opened_at)) - Math.abs(b.ts - Date.parse(p.opened_at)));
    return cands[0] ?? null;
  };

  // RTH sessions (cumulative VWAP + gap) per traded symbol, from the bars archive
  const symbols = [...new Set(positions.map((p) => (p.underlying ?? "SPY").toUpperCase()))];
  const sessByKey = new Map<string, RealSession>();
  for (const sym of symbols) {
    const sess = await loadRealSessions({ symbol: sym, sinceDaysAgo: 400 });
    for (const s of sess) sessByKey.set(`${sym}|${s.dateET}`, s);
    console.log(`  bars[${sym}]: ${sess.length} sessions ${sess[0]?.dateET ?? "—"}…${sess[sess.length - 1]?.dateET ?? "—"}`);
  }

  // ── concentration derivations (stackAtEntry / occShare) + booking-delta, from the live record ──
  // The desk shares strikes massively (~70% of trades on an OCC held by 2-7 channels). These fields
  // expose the correlated concentration each trade joined + how mis-booked it was pre-correction, so
  // the analysis substrate carries them. Regenerated nightly off the clean books.
  const byOcc = new Map<string, Pos[]>();
  for (const p of positions) (byOcc.get(p.occ_symbol) ?? byOcc.set(p.occ_symbol, []).get(p.occ_symbol)!).push(p);
  const tOpen = (p: Pos) => Date.parse(p.opened_at);
  const bookingDeltaById = new Map<string, number>(); // corrupted-booked − clean (per position id), from the reconcile audit
  try {
    if (existsSync("data/reconcile-applied.json")) {
      const corr = (JSON.parse(readFileSync("data/reconcile-applied.json", "utf8")).corrections ?? []) as Array<{ id: string; old: number; neu: number }>;
      for (const c of corr) bookingDeltaById.set(c.id, Math.round((c.old - c.neu) * 100) / 100);
    }
  } catch { /* no audit yet → bookingDelta defaults to 0 */ }

  const rows: Array<{ id: string; entry_features: Record<string, unknown> | null; entry_reason: string | null; entry_delta: number | null; peak_mark: number | null }> = [];
  const dataset: Record<string, unknown>[] = []; // flat per-trade rows for the pattern-mining pass
  const stat = { total: 0, feat: 0, reason: 0, delta: 0, peak: 0, greeks: 0, noSession: 0, noSignal: 0 };
  for (const p of positions) {
    stat.total++;
    const sym = (p.underlying ?? "SPY").toUpperCase();
    const d = etDate(p.opened_at);
    const openMs = Date.parse(p.opened_at);
    const closeMs = p.closed_at ? Date.parse(p.closed_at) : openMs;

    // ---- entry features from the session bars (gap/er/relVol/atr/mom/VWAP/MACD/openRange) ----
    let feat: Record<string, number | null> | null = null;
    const sess = sessByKey.get(`${sym}|${d}`);
    if (sess && sess.bars.length) {
      const cut = floorMin(openMs);
      let idx = -1;
      for (let i = 0; i < sess.bars.length; i++) { if (sess.bars[i].ts < cut) idx = i; else break; }
      if (idx < 0) idx = 0; // entered at/before the first RTH bar
      const f = computeFeatures(sess.bars as Bar[], idx);
      const m = macdAt(sess.bars.slice(0, idx + 1).map((b) => b.close));
      feat = {
        gap: sess.gap != null ? r3(sess.gap) : null,
        er: r3(f.er), relVol: r3(f.relVol), atr: r3(f.atr), mom: r3(f.mom),
        vwap: r3(sess.bars[idx].vwap), vwapDist: r3(f.close - sess.bars[idx].vwap),
        macd: m?.macd ?? null, macdSignal: m?.signal ?? null, macdHist: m?.hist ?? null,
        orHi: r3(f.openRangeHi), orLo: r3(f.openRangeLo), minutesToClose: f.minutesToClose, close: r3(f.close),
      };
      stat.feat++;
    } else stat.noSession++;

    // ---- matched entry signal: reason + cost context + delta ----
    const sig = matchSig(p);
    if (!sig) stat.noSignal++;
    const reason = sig?.signal_type ?? null;
    const rat = sig?.rationale ?? {};
    // cost context the bars can't give — the lowest layer of the merge
    const cost: Record<string, number> = {};
    for (const k of ["ask", "bid", "roundTrip", "expectedMove", "spotClose"]) if (typeof rat[k] === "number") cost[k] = rat[k];

    // ---- peak (MFE) + entry delta ----
    const { peak, delta: qDelta } = await peakAndDelta(p.occ_symbol, openMs, closeMs, d);
    const entryDelta = typeof rat.delta === "number" ? rat.delta : qDelta;
    if (reason) stat.reason++;
    if (entryDelta != null) stat.delta++;
    if (peak != null) stat.peak++;

    // ---- empirical greeks (realized delta + realized theta from the price path; NO Black-Scholes) ----
    const holdMinTr = Math.round((closeMs - openMs) / 60000);
    const greeks = empiricalGreeks(await optionPath(p.occ_symbol, openMs, closeMs, d), sess, holdMinTr);
    if (greeks) stat.greeks++;

    // ---- merge: cost < computed < EXISTING (live ground-truth always wins, only fill gaps) ----
    const greekFields = greeks ? { realizedDelta: greeks.realizedDelta, realizedThetaPerMin: greeks.realizedThetaPerMin, decayPerCtHr: greeks.decayPerCtHr } : {};
    const mergedFeat = (feat || Object.keys(cost).length || greeks)
      ? { ...cost, ...(feat ?? {}), ...((p.entry_features as Record<string, unknown>) ?? {}), ...greekFields } // greeks last: freshly COMPUTED each run (not live ground-truth) → recompute-wins
      : null;
    rows.push({
      id: p.id,
      entry_features: mergedFeat,
      entry_reason: p.entry_reason ?? reason,
      entry_delta: p.entry_delta ?? entryDelta,
      peak_mark: p.peak_mark ?? peak,
    });

    // flat analysis row: entry context (incl VWAP/MACD) + trajectory + outcome
    const entryPx = Number(p.avg_entry_price), q = Number(p.qty), realized = Number(p.realized_pnl ?? 0);
    const exitPx = q > 0 ? entryPx + realized / (q * 100) : entryPx;
    const pkUsed = p.peak_mark ?? peak;
    // ⚠ mid-basis (audit M6): peak_mark ratchets on the NBBO MID; a sell realizes the bid, so
    // mfePct/givebackPct are UPPER BOUNDS on realizable — treat as such in any analysis.
    const mfePct = pkUsed != null && entryPx > 0 ? r3(((pkUsed - entryPx) / entryPx) * 100) : null;
    const givebackPct = pkUsed != null && pkUsed > entryPx && exitPx < pkUsed ? r3(((pkUsed - exitPx) / (pkUsed - entryPx)) * 100) : null;
    // concentration: # OTHER channels concurrently on this strike at entry + this row's qty-share of the lot
    const sib = byOcc.get(p.occ_symbol) ?? [p];
    const stackAtEntry = new Set(sib.filter((o) => o.id !== p.id && ((tOpen(o) <= openMs && (o.closed_at ? Date.parse(o.closed_at) : Infinity) >= openMs) || Math.abs(tOpen(o) - openMs) <= 120_000)).map((o) => o.strategist_id)).size;
    const occTotQty = sib.reduce((s, o) => s + Math.abs(Number(o.qty)), 0);
    const occShare = occTotQty > 0 ? r3(Math.abs(q) / occTotQty) : 1;
    dataset.push({
      id: p.id, date: d, channel: p.strategists?.name ?? p.strategists?.slug ?? sym, slug: p.strategists?.slug ?? null,
      sym, dir: p.opt_type, reason: p.entry_reason ?? reason,
      ...(mergedFeat ?? {}),
      entryDelta: p.entry_delta ?? entryDelta,
      realizedDelta: greeks?.realizedDelta ?? null, realizedThetaPerMin: greeks?.realizedThetaPerMin ?? null, decayPerCtHr: greeks?.decayPerCtHr ?? null,
      entry: r3(entryPx), exit: r3(exitPx), qty: q, pnl: realized,
      peak: pkUsed != null ? r3(pkUsed) : null, mfePct, givebackPct,
      holdMin: Math.round((closeMs - openMs) / 60000), exitReason: p.close_reason ?? null,
      stackAtEntry, occShare, bookingDelta: bookingDeltaById.get(p.id) ?? 0,
    });
  }

  console.log(`\n${stat.total} trades · features ${stat.feat} · reason ${stat.reason} · delta ${stat.delta} · peak ${stat.peak} · realized-greeks ${stat.greeks}`);
  console.log(`  gaps: ${stat.noSession} no-session-bars · ${stat.noSignal} no-matched-signal`);

  // Always emit the flat analysis dataset (the pattern-mining substrate), independent of the DB apply.
  writeFileSync("data/forensics-dataset.jsonl", dataset.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`→ data/forensics-dataset.jsonl (${dataset.length} trades · entry context + MFE/giveback + outcome + concentration + empirical-greeks[realizedDelta/realizedThetaPerMin/decayPerCtHr, no BS])`);

  if (WRITE && sbWrite) {
    console.log(`\napplying ${rows.length} rows via service role…`);
    let done = 0, failed = 0;
    const CONC = 8;
    for (let i = 0; i < rows.length; i += CONC) {
      await Promise.all(rows.slice(i, i + CONC).map(async (r) => {
        const patch: Record<string, unknown> = { entry_reason: r.entry_reason, entry_delta: r.entry_delta, peak_mark: r.peak_mark };
        if (r.entry_features) patch.entry_features = r.entry_features;
        const { error } = await sbWrite!.from("positions").update(patch).eq("id", r.id);
        if (error) { failed++; if (failed <= 5) console.error(`  ${r.id}: ${error.message}`); } else done++;
      }));
      process.stdout.write(`  ${done + failed}/${rows.length}\r`);
    }
    console.log(`\n✓ wrote ${done} · failed ${failed}`);
  } else {
    const sql = rows.map((r) => {
      const sets = [
        r.entry_features ? `entry_features = ${sqlStr(JSON.stringify(r.entry_features))}::jsonb` : null,
        `entry_reason = ${sqlStr(r.entry_reason)}`,
        `entry_delta = ${sqlNum(r.entry_delta)}`,
        `peak_mark = ${sqlNum(r.peak_mark)}`,
      ].filter(Boolean);
      return `update positions set ${sets.join(", ")} where id = '${r.id}';`;
    }).join("\n");
    writeFileSync("data/backfill-forensics.sql", sql + "\n");
    console.log(`\n→ data/backfill-forensics.sql (${rows.length} UPDATEs)`);
    console.log(`  to apply: add SUPABASE_SERVICE_ROLE_KEY to .env.local + re-run with --write (direct), or apply the .sql via MCP`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
