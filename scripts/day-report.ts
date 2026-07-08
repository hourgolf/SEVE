// ============================================================================
//  day-report — the deterministic daily forensics the LLM autopsy isn't.
//
//  Answers, with numbers, the questions that matter after a session:
//    · NAV truth vs per-channel attribution (does the book reconcile?)
//    · what SHAPE was the tape (trend / V / chop — and how whipsawy)?
//    · per trade: entry → PEAK → exit, MFE%, giveback%, hold, exit reason
//    · the systemic flags: green→red round-trips ($ left from peak),
//      same-minute multi-channel entry CLUSTERS (correlation = one bet ×N),
//      re-lean churn (re-entry <10m after a stop, same side), stop overshoots,
//      daily-stop latches
//
//    npm run day-report                  (today ET)
//    npm run day-report -- --date 2026-06-10
//
//  Read-only (anon). Peaks come from option_quotes (7-day retention — run it
//  same-week). Exit reasons parsed from the worker journal in `events`.
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { upcomingEvents, tableHorizonDays } from "../engine/market-events";
import {
  upsertLedger, loadLedger, scorecardLines, scorecardData, type LedgerEntry,
  simulateFoulout, upsertFoulout, loadFoulout, fouloutScorecardLines, fouloutScorecardData, type FouloutEntry, type RideLeg,
} from "./override-ledger";
import { benchedVsLive, type BenchedVsLive } from "./benched-sim";
import { runOneAccountShadow, type ShadowResult } from "./one-account-shadow";
import { ratchetShadowSummary, type RatchetSummary } from "./ratchet-shadow";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });

const di = process.argv.indexOf("--date");
const ET_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const DATE = di >= 0 && process.argv[di + 1] ? process.argv[di + 1] : ET_DATE.format(new Date());

// UTC instant of a given ET wall-clock (hh:mm) on DATE — DST-correct via a noon probe
// (offset = how far UTC leads ET that day: 240 EDT / 300 EST).
function etWallToUtcMs(dateET: string, hh: number, mm: number): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date(Date.parse(`${dateET}T12:00:00Z`)));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "12") % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const offsetMin = 12 * 60 - (h * 60 + m);
  return Date.parse(`${dateET}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`) + offsetMin * 60_000;
}
// The native ride-flatten the counterfactual holds to: 15:25 ET. EXACT for the ride
// channels (pullback flattenMtc=35; V3/ALT armed time_before 15:25); the −50% premium
// stop (universal, decide.ts) usually binds first on the losers regardless.
const FLATTEN_MS = etWallToUtcMs(DATE, 15, 25);
const PREMIUM_STOP_FRAC = 0.5; // mid ≤ 0.5×entry ⇒ −50% stop (worker PREMIUM_STOP_PCT)

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" });
const sgn = (v: number) => (v >= 0 ? "+" : "") + Math.round(v);
const pct = (v: number | null) => (v == null ? "  —" : `${v >= 0 ? "+" : ""}${Math.round(v)}%`);

interface Trade {
  id: string; slug: string; name: string; cp: "call" | "put"; strike: number; qty: number; occ: string;
  entry: number; exit: number; pnl: number; openedAt: string; closedAt: string;
  peak: number | null; mfePct: number | null; gavePct: number | null; reason: string;
  manual: boolean;
  closeReason: string | null; // durable column (31_close_reason.sql) — authoritative once stamped
  // ride-to-close counterfactual (reconstructed from option_quotes, same-week only):
  ride: number | null;        // P&L if held from entry to the native 15:25 flatten / −50% stop
  rideDelta: number | null;   // actual pnl − ride  (>0 ⇒ the actual exit beat riding)
  rideStop: boolean;          // the ride would have hit the −50% premium stop
  rideOk: boolean;            // reconstruction usable (quotes present through the flatten)
  rideExitMs: number | null;  // when the ride would have exited (stop fill / flatten) — for exit-timing
}

// Ride-to-close counterfactual: hold the position from entry to the native 15:25 flatten,
// exiting early ONLY on the −50% premium stop. Reads the quote stream that keeps flowing
// AFTER the operator's actual close (the override insight), so it answers "what would
// riding have booked". Two tiny indexed point-queries (no path transfer):
//   · first mid ≤ 0.5×entry in [entry, flatten]  → the −50% stop fill (at the stop level)
//   · last mid ≤ flatten                          → the flatten-exit mid (if it never stopped)
async function reconstructRide(occ: string, entry: number, qty: number, openedAt: string) {
  if (!(entry > 0) || !(qty > 0)) return null;
  // The eod_flatten FILLS at the 15:25 cycle (~15:25:01), so the faithful flatten mid is the
  // quote AT the flatten minute, not strictly before it — grace the window +30s to capture it.
  const flattenIso = new Date(FLATTEN_MS + 30_000).toISOString();
  const stopLevel = PREMIUM_STOP_FRAC * entry;
  const [{ data: stop }, { data: last }] = await Promise.all([
    sb.from("option_quotes").select("mid,captured_at").eq("occ_symbol", occ)
      .gte("captured_at", openedAt).lte("captured_at", flattenIso).lte("mid", stopLevel)
      .order("captured_at", { ascending: true }).limit(1).maybeSingle(),
    sb.from("option_quotes").select("mid,captured_at").eq("occ_symbol", occ)
      .gte("captured_at", openedAt).lte("captured_at", flattenIso)
      .order("captured_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!stop && last?.mid == null) return null; // no quotes in window → can't reconstruct
  const rideStop = !!stop;
  const rideExit = rideStop ? stopLevel : Number(last!.mid);
  const ride = (rideExit - entry) * qty * 100;
  // when the RIDE would have exited (the −50% stop's fill, else the flatten) — for the
  // exit-timing family (cost-of-early-exit / auto-arbiter): how long the operator held vs ride.
  const rideExitMs = rideStop ? Date.parse(stop!.captured_at) : last ? Date.parse(last.captured_at) : null;
  // data-quality guard: if it never stopped, the flatten mid must actually reach the
  // flatten (an OCC that drifts off the tracked ATM chain stops being quoted early —
  // a stale last-mid would fabricate the ride). Stop-hit rides are flatten-independent.
  const reached = rideStop || (last != null && FLATTEN_MS - Date.parse(last.captured_at) < 6 * 60_000);
  return { ride, rideStop, rideOk: reached, rideExitMs };
}

// Publish the computed forensics to the §03 dashboard panel (best-effort, env-gated). The CLI
// is anon/read-only, so it POSTs to the service-role route. Needs APP_URL + PUSH_SECRET in
// .env.local (the same vars the worker uses); absent → skipped, the terminal report is unaffected.
async function publishForensics(date: string, payload: unknown): Promise<string> {
  const url = process.env.APP_URL, secret = process.env.PUSH_SECRET;
  if (!url || !secret) return "skipped (set APP_URL + PUSH_SECRET in .env.local to publish)";
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}/api/forensics-report`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-push-secret": secret },
      body: JSON.stringify({ date, payload }),
      signal: AbortSignal.timeout(10_000),
    });
    return r.ok ? "published to dashboard ✓" : `publish failed (${r.status})`;
  } catch (e) { return `publish failed (${(e as Error).message})`; }
}

async function main() {
  console.log(`\nDAY REPORT — ${DATE} (ET)\n`);

  // ---- catalyst calendar (market-events.ts): what's ahead + table freshness ----
  // The events table is hand-maintained code (a stale table fails SAFE — no
  // stand-down), so the report is the instrumented reminder: it announces the
  // coming week's events and nags when the horizon thins (Fed posts ~1yr ahead).
  const ahead = upcomingEvents(DATE, 7);
  for (const e of ahead) {
    const when = e.date === DATE ? "TODAY" : e.date;
    console.log(`⚑ ${e.kind.toUpperCase()} ${when} — ${e.label}${e.minET != null ? " · worker stand-down 13:50–14:30 ET (stream channels)" : ""}`);
  }
  const horizon = tableHorizonDays(DATE);
  if (horizon < 120) console.log(`⚠ market-events table horizon: ${horizon}d — fetch the next year's Fed schedule and extend engine/market-events.ts`);
  if (ahead.length || horizon < 120) console.log("");

  // ---- tape shape (per underlying traded today) -------------------------------
  const { data: barsRaw } = await sb.from("underlying_bars").select("symbol,ts,close")
    .gte("ts", `${DATE}T13:25:00Z`).lte("ts", `${DATE}T20:05:00Z`).order("ts");
  const bySym = new Map<string, Array<{ ts: number; c: number }>>();
  for (const b of (barsRaw ?? []) as Array<{ symbol: string; ts: string; close: number | null }>) {
    if (b.close == null) continue;
    const arr = bySym.get(b.symbol) ?? [];
    arr.push({ ts: Date.parse(b.ts), c: Number(b.close) });
    bySym.set(b.symbol, arr);
  }
  for (const [sym, bs] of bySym) {
    const o = bs[0].c, c = bs[bs.length - 1].c;
    const hi = Math.max(...bs.map((b) => b.c)), lo = Math.min(...bs.map((b) => b.c));
    // whipsaw read: count direction flips of ≥0.30% legs on the close path
    let legs = 0, anchor = o, dir = 0;
    for (const b of bs) {
      const move = (b.c - anchor) / anchor;
      if (Math.abs(move) >= 0.003) {
        const d = Math.sign(move);
        if (d !== dir && dir !== 0) legs++;
        if (d !== dir) dir = d;
        anchor = b.c;
      }
    }
    console.log(`${sym}: open ${o.toFixed(2)} → close ${c.toFixed(2)} (${(100 * (c / o - 1)).toFixed(2)}%) · range ${(100 * (hi - lo) / o).toFixed(2)}% · ${legs} reversal leg(s) ≥0.3%${legs >= 3 ? "  ⚠ WHIPSAW" : ""}`);
  }

  // ---- per-bucket NAV (cockpit P3 — the 3-hypothesis forward test) + true total --
  // equity_snapshots carries PER-ACCOUNT rows (account_id set, strategist_id null), written by
  // the worker each cycle. The OLD read filtered strategist_id-null but NOT account_id → it
  // mixed the two $1M buckets, the ~$98k account, AND the desk-total into one first-vs-last
  // delta = garbage ("NAV truth +419" on a −$6.5k day). Read per-account, delta each bucket,
  // SUM for the real total. (Same-day snapshots are interleaved but per-account order holds, so
  // first-seen = open, last-seen = close per bucket.)
  const { data: acctRows } = await sb.from("accounts").select("id,name,cred_ref");
  const acctName = new Map(((acctRows ?? []) as Array<{ id: string; name: string }>).map((a) => [a.id, String(a.name)]));
  // Paginated (audit M5): the worker snapshots every cycle per bucket — a full session easily
  // exceeds PostgREST's silent 1000-row cap, which cut off the CLOSING snapshots and understated
  // every bucket's NAV delta. Same loop pattern as the events read below.
  const snapRaw: Array<{ account_id: string; net_liquidation: number }> = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data } = await sb.from("equity_snapshots").select("account_id,net_liquidation,captured_at")
      .not("account_id", "is", null).is("strategist_id", null)
      .gte("captured_at", `${DATE}T13:00:00Z`).lte("captured_at", `${DATE}T22:00:00Z`)
      .order("captured_at").range(from, from + 999);
    const batch = (data ?? []) as typeof snapRaw;
    snapRaw.push(...batch);
    if (batch.length < 1000) break;
  }
  const navByAcct = new Map<string, { open: number; close: number }>();
  for (const s of snapRaw) {
    const v = Number(s.net_liquidation);
    const cur = navByAcct.get(s.account_id);
    if (!cur) navByAcct.set(s.account_id, { open: v, close: v }); else cur.close = v;
  }
  const buckets = [...navByAcct.entries()]
    .map(([id, v]) => ({ name: acctName.get(id) ?? id.slice(0, 8), open: v.open, close: v.close, delta: v.close - v.open }))
    .sort((a, b) => a.delta - b.delta);
  const navDelta = buckets.length ? buckets.reduce((a, b) => a + b.delta, 0) : null;

  // ---- trades -------------------------------------------------------------------
  // Paginated (audit M5): an UNPAGINATED read silently drops late-day closes past 1000 rows —
  // exactly where the exit reasons live (the same failure mode the events read below had).
  const posRaw: Array<Record<string, unknown>> = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data } = await sb.from("positions")
      .select("id,strategist_id,occ_symbol,opt_type,strike,qty,avg_entry_price,realized_pnl,opened_at,closed_at,close_reason,strategists(slug,name)")
      .eq("status", "closed").gte("closed_at", `${DATE}T13:00:00Z`).lte("closed_at", `${DATE}T22:00:00Z`)
      .order("opened_at").range(from, from + 999);
    const batch = (data ?? []) as typeof posRaw;
    posRaw.push(...batch);
    if (batch.length < 1000) break;
  }
  // Paginate past PostgREST's 1000-row cap — a busy session logs ~2k events, and an
  // UNORDERED capped fetch silently drops the tail (which is where the late-day exit
  // reasons AND the MGMT close shadows live → "exit —" / "managed-exit none" mirages).
  const events: Array<{ message: string; created_at: string; meta: Record<string, unknown> | null }> = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data } = await sb.from("events").select("message,created_at,meta")
      .gte("created_at", `${DATE}T13:00:00Z`).lte("created_at", `${DATE}T22:00:00Z`)
      .order("created_at", { ascending: true }).range(from, from + 999);
    const batch = (data ?? []) as typeof events;
    events.push(...batch);
    if (batch.length < 1000) break;
  }

  // Per-channel executor + arm state (W2 migration: which executor OWNS each channel).
  // NOTE: this is CURRENT config, not the config at trade time — accurate for a
  // same-day report (the normal use), approximate when re-running an old date.
  const { data: stratRaw } = await sb.from("strategists").select("slug,name,executor,status,strategist_config(muted,daily_stop_usd)");
  const execBySlug = new Map<string, { executor: string; armed: boolean; muted: boolean }>();
  const nameBySlug = new Map<string, string>();
  const dailyStopBySlug = new Map<string, number>(); // for the foul-out replay (live decide.ts:304 gate)
  for (const s of (stratRaw ?? []) as any[]) {
    const cfg = Array.isArray(s.strategist_config) ? s.strategist_config[0] : s.strategist_config;
    execBySlug.set(s.slug, { executor: String(s.executor ?? "cron"), armed: s.status === "armed", muted: !!cfg?.muted });
    nameBySlug.set(s.slug, s.name ?? s.slug);
    dailyStopBySlug.set(s.slug, Number(cfg?.daily_stop_usd ?? 0));
  }
  const execOf = (slug: string) => execBySlug.get(slug)?.executor ?? "cron";

  const trades: Trade[] = [];
  for (const p of (posRaw ?? []) as any[]) {
    const slug = p.strategists?.slug ?? "?";
    const name = p.strategists?.name ?? slug; // operator's display label (slug stays the internal key)
    const entry = Number(p.avg_entry_price), qty = Number(p.qty), pnl = Number(p.realized_pnl ?? 0);
    const exit = entry + (qty > 0 ? pnl / (qty * 100) : 0);
    const { data: pk } = await sb.from("option_quotes").select("mid").eq("occ_symbol", p.occ_symbol)
      .gte("captured_at", p.opened_at).lte("captured_at", p.closed_at)
      .order("mid", { ascending: false }).limit(1).maybeSingle();
    const peak = pk?.mid != null ? Number(pk.mid) : null;
    const mfePct = peak != null && entry > 0 ? ((peak - entry) / entry) * 100 : null;
    const gavePct = peak != null && peak > entry && exit < peak ? ((peak - exit) / (peak - entry)) * 100 : null;
    const r = await reconstructRide(p.occ_symbol, entry, qty, p.opened_at);
    const ride = r ? r.ride : null;
    // exit reason from the worker journal: "<slug>: exit <occ> ×N @ px (reason)" / reconciled
    const ev = events.find((e) =>
      e.message.includes(p.occ_symbol) && e.message.includes(slug)
      && Math.abs(Date.parse(e.created_at) - Date.parse(p.closed_at)) < 180_000
      && /exit|reconcil/i.test(e.message));
    const reason = ev?.message.match(/\(([a-z_0-9]+)\)\s*$/i)?.[1] ?? (ev && /reconcil/i.test(ev.message) ? "reconciled" : "—");
    trades.push({
      id: p.id, slug, name, cp: p.opt_type, strike: Number(p.strike), qty, occ: p.occ_symbol,
      entry, exit, pnl, openedAt: p.opened_at, closedAt: p.closed_at,
      peak, mfePct, gavePct,
      reason: p.close_reason ?? reason, // column beats journal-parse once stamped
      manual: /-manual$/i.test(slug),
      closeReason: p.close_reason ?? null,
      ride, rideDelta: ride != null ? pnl - ride : null, rideStop: !!r?.rideStop, rideOk: !!r?.rideOk, rideExitMs: r?.rideExitMs ?? null,
    });
  }

  const auto = trades.filter((t) => !t.manual);
  const tot = trades.reduce((a, t) => a + t.pnl, 0);
  console.log(`\nNAV truth — per bucket (cockpit P3, the 3-hypothesis forward test):`);
  if (!buckets.length) console.log(`  (no per-account snapshots for ${DATE} — worker down, or pre-cockpit date)`);
  for (const b of buckets)
    console.log(`  ${b.name.padEnd(14)} ${Math.round(b.open).toLocaleString().padStart(11)} → ${Math.round(b.close).toLocaleString().padStart(11)}   ${sgn(b.delta).padStart(7)}`);
  console.log(`  ── TOTAL ${navDelta == null ? "n/a" : sgn(navDelta)} · Σ attribution ${sgn(tot)} (auto ${sgn(auto.reduce((a, t) => a + t.pnl, 0))}, manual ${sgn(trades.filter((t) => t.manual).reduce((a, t) => a + t.pnl, 0))}) · ${trades.length} trades`);
  if (navDelta != null && Math.abs(navDelta - tot) > 300) console.log(`  ⚠ attribution drifts ${sgn(tot - navDelta)} from NAV (per-account snapshot timing / shared-OCC residue / a mis-booked close — e.g. the close-route account bug)`);

  // ---- coverage: per-bucket account fills vs desk rows (cockpit P3 account-aware) --
  // Each channel routes to its bucket (strategists.account_id → accounts.cred_ref →
  // ALPACA_KEY[_<ref>]). The OLD check used ONLY the default keys and compared ALL desk rows
  // (every bucket) against the default account's fills → a false "ghost qty" for every
  // Core/Resurrected OCC (those lots live in a DIFFERENT Alpaca account; that false alarm filled
  // the 06-24 report). Now: resolve each desk row to its bucket and compare per-account against
  // THAT bucket's Alpaca. A bucket whose creds aren't in .env.local is SKIPPED with a note (never
  // a false alarm) — add ALPACA_KEY_<ref>/ALPACA_SECRET_<ref> there for full coverage. Both the
  // 06-11 partial-fill and the 06-24 orphaned-lot classes surface here (buys-vs-rows + held-vs-rows).
  const AK = process.env.ALPACA_KEY, AS = process.env.ALPACA_SECRET;
  const credsFor = (credRef: string | null): { k: string; s: string } | null => {
    const k = credRef ? process.env[`ALPACA_KEY_${credRef}`] : AK;
    const s = credRef ? process.env[`ALPACA_SECRET_${credRef}`] : AS;
    return k && s ? { k, s } : null;
  };
  const defaultAcctId = ((acctRows ?? []) as Array<{ id: string; cred_ref: string | null }>).find((a) => !a.cred_ref)?.id ?? "__none__";
  const { data: chAcctRaw } = await sb.from("strategists").select("id,account_id");
  const acctOfCh = new Map(((chAcctRaw ?? []) as Array<{ id: string; account_id: string | null }>).map((c) => [c.id, c.account_id ?? defaultAcctId]));
  const grpByAcct = (rows: Array<{ strategist_id: string; occ_symbol: string; qty: number }>): Map<string, Map<string, number>> => {
    const m = new Map<string, Map<string, number>>();
    for (const p of rows) {
      const aid = acctOfCh.get(p.strategist_id) ?? defaultAcctId;
      if (!m.has(aid)) m.set(aid, new Map());
      const mm = m.get(aid)!; mm.set(p.occ_symbol, (mm.get(p.occ_symbol) ?? 0) + Number(p.qty));
    }
    return m;
  };
  const { data: openedRaw } = await sb.from("positions").select("strategist_id,occ_symbol,qty")
    .gte("opened_at", `${DATE}T13:00:00Z`).lte("opened_at", `${DATE}T22:00:00Z`);
  const { data: openRowsRaw } = await sb.from("positions").select("strategist_id,occ_symbol,qty").eq("status", "open");
  const boughtByAcct = grpByAcct((openedRaw ?? []) as Array<{ strategist_id: string; occ_symbol: string; qty: number }>);
  const openByAcct = grpByAcct((openRowsRaw ?? []) as Array<{ strategist_id: string; occ_symbol: string; qty: number }>);

  console.log(`\ncoverage (per bucket — account fills vs desk rows)`);
  const PAPER = "https://paper-api.alpaca.markets";
  for (const a of (acctRows ?? []) as Array<{ id: string; name: string; cred_ref: string | null }>) {
    const dBought = boughtByAcct.get(a.id) ?? new Map<string, number>();
    const dOpen = openByAcct.get(a.id) ?? new Map<string, number>();
    if (!dBought.size && !dOpen.size) continue; // bucket didn't trade today
    const creds = credsFor(a.cred_ref);
    if (!creds) { console.log(`  ${a.name}: skipped — no creds in .env.local (ALPACA_KEY_${a.cred_ref}); ${dBought.size} OCC(s) untested`); continue; }
    try {
      const aHdr = { "APCA-API-KEY-ID": creds.k, "APCA-API-SECRET-KEY": creds.s };
      const orders: Array<{ symbol: string; side: string; filled_qty: string; submitted_at: string }> = [];
      let until = `${DATE}T22:00:00Z`;
      for (let page = 0; page < 6; page++) {
        const r = await fetch(`${PAPER}/v2/orders?status=closed&limit=500&direction=desc&after=${DATE}T13:00:00Z&until=${until}`, { headers: aHdr });
        if (!r.ok) throw new Error(`orders ${r.status}`);
        const batch = await r.json() as typeof orders;
        orders.push(...batch);
        if (batch.length < 500) break;
        until = batch[batch.length - 1].submitted_at;
      }
      const acctBuy = new Map<string, number>();
      for (const o of orders) { const q = Number(o.filled_qty); if (q > 0 && o.side === "buy") acctBuy.set(o.symbol, (acctBuy.get(o.symbol) ?? 0) + q); }
      const pr = await fetch(`${PAPER}/v2/positions`, { headers: aHdr });
      const alpPos = pr.ok ? (await pr.json() as Array<{ symbol: string; qty: string }>) : [];
      const issues: string[] = [];
      for (const [occ, b] of acctBuy) {
        const rows = dBought.get(occ) ?? 0;
        if (b !== rows) issues.push(`${occ}: account bought ${b} / desk rows ${rows} → ${b > rows ? `+${b - rows} UNCOVERED (partial-fill)` : `${rows - b} over-recorded (ghost qty)`}`);
      }
      for (const ap of alpPos) {
        const held = Math.abs(Math.round(Number(ap.qty)));
        const rows = dOpen.get(ap.symbol) ?? 0;
        if (held !== rows) issues.push(`${ap.symbol}: Alpaca holds ${held} / open desk rows ${rows} → ${held > rows ? "UNCOVERED — orphan, close it" : "ghost rows"}`);
      }
      if (issues.length) { console.log(`  ${a.name}:`); for (const i of issues) console.log(`    ⚠ ${i}`); }
      else console.log(`  ${a.name}: ✓ clean (${acctBuy.size} OCC(s) — buys == desk rows, held == open rows)`);
    } catch (e) {
      console.log(`  ${a.name}: check failed (${(e as Error).message})`);
    }
  }

  // ---- per-trade table ------------------------------------------------------------
  console.log(`\ntime        channel                 trade        entry→peak→exit      P&L     MFE   gave   hold  exit`);
  console.log(`  (MFE/gave are option-MID based — an UPPER BOUND on what a sell would have realized at the bid)`);
  for (const t of trades) {
    const hold = Math.round((Date.parse(t.closedAt) - Date.parse(t.openedAt)) / 60000);
    console.log(
      `${hhmm(t.openedAt)}–${hhmm(t.closedAt)}  ${(t.name + (t.manual ? " ✋" : "")).padEnd(22)} ${(t.strike.toFixed(0) + (t.cp === "call" ? "C" : "P") + "×" + t.qty).padEnd(12)} ` +
      `${t.entry.toFixed(2)}→${t.peak != null ? t.peak.toFixed(2) : "  ? "}→${t.exit.toFixed(2)}`.padEnd(20) +
      ` ${sgn(t.pnl).padStart(6)}  ${pct(t.mfePct).padStart(5)} ${(t.gavePct != null ? Math.round(t.gavePct) + "%" : "—").padStart(6)} ${String(hold).padStart(4)}m  ${t.reason}`,
    );
  }

  // ---- flags -----------------------------------------------------------------------
  console.log(`\nFLAGS`);
  // green→red: was up ≥20%, closed ≤ 0
  const g2r = auto.filter((t) => (t.mfePct ?? 0) >= 20 && t.pnl <= 0);
  const left = g2r.reduce((a, t) => a + (t.peak! - t.exit) * t.qty * 100, 0);
  console.log(`  green→red (MFE ≥+20% → closed ≤0): ${g2r.length} trades · $${Math.round(left).toLocaleString()} given back from peaks${g2r.length ? "  ← " + g2r.map((t) => t.name).join(", ") : ""}`);
  // entry clusters: same minute + same side across ≥3 channels
  const clusters = new Map<string, Trade[]>();
  for (const t of auto) {
    const k = `${hhmm(t.openedAt)}|${t.cp}`;
    clusters.set(k, [...(clusters.get(k) ?? []), t]);
  }
  for (const [k, ts] of clusters) {
    if (ts.length >= 3) {
      const [min, side] = k.split("|");
      console.log(`  CLUSTER ${min} ${side.toUpperCase()}: ${ts.length} channels entered together (${ts.map((t) => t.slug).join(", ")}) → Σ ${sgn(ts.reduce((a, t) => a + t.pnl, 0))}  ← one bet ×${ts.length}`);
    }
  }
  // re-lean churn: entry within 10m after the same channel's same-side loss
  for (const t of auto) {
    const prior = auto.find((u) => u.slug === t.slug && u.cp === t.cp && u.pnl < 0 && u.id !== t.id
      && Date.parse(t.openedAt) - Date.parse(u.closedAt) > 0
      && Date.parse(t.openedAt) - Date.parse(u.closedAt) < 10 * 60_000);
    if (prior) console.log(`  RE-LEAN ${t.slug}: re-entered ${t.cp} ${Math.round((Date.parse(t.openedAt) - Date.parse(prior.closedAt)) / 60000)}m after a ${sgn(prior.pnl)} stop → ${sgn(t.pnl)}`);
  }
  // stop overshoot beyond design
  for (const t of auto) {
    const ret = t.entry > 0 ? (t.exit - t.entry) / t.entry : 0;
    if (ret < -0.62) console.log(`  OVERSHOOT ${t.slug} ${t.strike}${t.cp === "call" ? "C" : "P"}: closed ${Math.round(ret * 100)}% vs −50% design`);
  }
  // daily-stop latches
  const { data: latches } = await sb.from("signals").select("strategist_id,created_at,strategists(slug)")
    .eq("blocked_reason", "daily_stop").gte("created_at", `${DATE}T13:00:00Z`).lte("created_at", `${DATE}T21:00:00Z`);
  const latchSlugs = [...new Set(((latches ?? []) as any[]).map((l) => l.strategists?.slug ?? "?"))];
  if (latchSlugs.length) console.log(`  DAILY-STOP latched: ${latchSlugs.join(", ")}`);

  // ---- channel rollup -----------------------------------------------------------------
  console.log(`\nchannel rollup (auto)`);
  const bySlug = new Map<string, Trade[]>();
  for (const t of auto) bySlug.set(t.slug, [...(bySlug.get(t.slug) ?? []), t]);
  for (const [slug, ts] of [...bySlug.entries()].sort((a, b) => b[1].reduce((x, t) => x + t.pnl, 0) - a[1].reduce((x, t) => x + t.pnl, 0))) {
    const p = ts.reduce((a, t) => a + t.pnl, 0);
    const w = ts.filter((t) => t.pnl > 0).length;
    console.log(`  ${slug.padEnd(24)} ${`[${execOf(slug)}]`.padEnd(8)} ${String(ts.length).padStart(2)}t  ${w}/${ts.length} win  ${sgn(p).padStart(7)}`);
  }
  // EXECUTOR SPLIT (W2 migration validation): where did the day's trades run? After
  // the cutover the stream line should carry the migrated roster; a stream channel
  // you EXPECTED to trade sitting in the 0-trade list = a cron→stream handoff miss.
  const splitOf = (exec: string) => {
    const ts = auto.filter((t) => execOf(t.slug) === exec);
    return `${new Set(ts.map((t) => t.slug)).size}ch ${ts.length}t ${sgn(ts.reduce((a, x) => a + x.pnl, 0))}`;
  };
  console.log(`  ── executors: stream ${splitOf("stream")} · cron ${splitOf("cron")}`);
  const traded = new Set(auto.map((t) => t.slug));
  const silentStream = [...execBySlug.entries()].filter(([slug, m]) => m.executor === "stream" && m.armed && !m.muted && !traded.has(slug)).map(([slug]) => slug);
  if (silentStream.length) console.log(`  ── stream armed+unmuted · 0 trades: ${silentStream.join(", ")}  (selectivity, or a handoff miss — eyeball vs the worker log)`);

  // ---- participation (the operator-selection dataset, close_reason 31) -------------
  // Manual twins: the machine enters and pushes "your exit"; the operator either
  // ENGAGES (closes it himself → close_reason 'manual'/'manual:<tag>', or a
  // "manual: close" journal line for pre-column rows) or SKIPS (the 15:57 bell
  // backstop flattens it → manual_eod_backstop). Selection is his compilable half —
  // this is the dataset that lets it inform machine entry filters.
  const manualTrades = trades.filter((t) => t.manual);
  if (manualTrades.length) {
    console.log(`\nparticipation (manual twins — taken = operator closed · skipped = bell backstop)`);
    const manualCloseEv = (t: Trade) => events.some((e) =>
      /manual: close /.test(e.message) && e.message.includes(t.occ)
      && Math.abs(Date.parse(e.created_at) - Date.parse(t.closedAt)) < 180_000);
    const kind = (t: Trade): "taken" | "skipped" | "other" => {
      if (t.closeReason?.startsWith("manual:") || t.closeReason === "manual" || manualCloseEv(t)) return "taken";
      if (t.closeReason === "manual_eod_backstop" || t.reason === "manual_eod_backstop") return "skipped";
      return "other"; // reconciled / sibling-drained / unknown
    };
    const byTwin = new Map<string, Trade[]>();
    for (const t of manualTrades) byTwin.set(t.slug, [...(byTwin.get(t.slug) ?? []), t]);
    for (const [slug, ts] of byTwin) {
      const grp: Record<"taken" | "skipped" | "other", Trade[]> = { taken: [], skipped: [], other: [] };
      for (const t of ts) grp[kind(t)].push(t);
      const fmt = (g: Trade[]) => `${g.length}t ${sgn(g.reduce((a, x) => a + x.pnl, 0))}`;
      const tags = ts.map((t) => t.closeReason?.match(/^manual:(.+)$/)?.[1]).filter(Boolean);
      console.log(`  ${slug.padEnd(24)} taken ${fmt(grp.taken).padEnd(11)} skipped ${fmt(grp.skipped).padEnd(11)}${grp.other.length ? ` other ${fmt(grp.other)}` : ""}${tags.length ? `  tags: ${tags.join(",")}` : ""}`);
    }
    const overrides = auto.filter((t) => t.closeReason === "manual" || t.closeReason?.startsWith("manual:"));
    if (overrides.length) console.log(`  operator overrides on AUTO channels: ${overrides.length} (${[...new Set(overrides.map((t) => t.slug))].join(", ")})`);
  }

  // ---- override counterfactual: did the human beat the ride? (the LIVE scalp-twin) -----
  // Per closed trade, ride-to-close is reconstructed from option_quotes (hold from entry to
  // the 15:25 flatten, exit early only on the −50% stop) — reading the quote stream that keeps
  // flowing AFTER the operator's close. Δ = actual − ride (>0 ⇒ the actual exit beat riding).
  // The OPERATOR OVERRIDES (close_reason manual/manual:*) accumulate into the durable scorecard:
  // ride-to-close is a hypothesis the tape keeps testing, and the tally is its honest arbiter
  // (one giveback day ≠ overturning the distribution). Run SAME-WEEK (quotes prune 7d).
  const isOverride = (t: Trade) => t.closeReason === "manual" || !!t.closeReason?.startsWith("manual:");
  const recon = trades.filter((t) => t.ride != null);
  if (recon.length) {
    console.log(`\noverride counterfactual — actual vs ride-to-close (hold to 15:25 ET flatten / −50% stop)`);
    console.log(`channel                 trade        actual    ride    Δ act−ride   note`);
    for (const t of recon) {
      const ovr = isOverride(t);
      const note = !t.rideOk ? "⚠ ride mid stale (drifted off the tracked chain)"
        : ovr ? `OVR ✋ override ${t.rideDelta! > 0 ? "WON" : t.rideDelta! < 0 ? "LOST" : "≈"} ${t.rideStop ? "(ride → −50% stop)" : "(rode to flatten)"}`
        : `${t.reason}${t.rideStop ? " · ride → −50% stop" : ""}`;
      console.log(
        `${t.name.padEnd(22)} ${(t.strike.toFixed(0) + (t.cp === "call" ? "C" : "P") + "×" + t.qty).padEnd(12)} ` +
        `${sgn(t.pnl).padStart(6)}  ${sgn(t.ride!).padStart(6)}  ${sgn(t.rideDelta!).padStart(9)}   ${note}`,
      );
    }
    const dayOvr = recon.filter((t) => isOverride(t) && t.rideOk);
    if (dayOvr.length) {
      const a = dayOvr.reduce((s, t) => s + Math.round(t.pnl), 0), rd = dayOvr.reduce((s, t) => s + Math.round(t.ride!), 0);
      const w = dayOvr.filter((t) => t.rideDelta! > 0).length;
      console.log(`  ── today's overrides: ${dayOvr.length} · actual ${sgn(a)} vs ride ${sgn(rd)} · Δ ${sgn(a - rd)} · beat ride ${w}/${dayOvr.length}`);
      const entries: LedgerEntry[] = dayOvr.map((t) => ({
        id: t.id, date: DATE, slug: t.slug, name: t.name, occ: t.occ, cp: t.cp, strike: t.strike, qty: t.qty,
        closeReason: t.closeReason, tag: t.closeReason?.match(/^manual:(.+)$/)?.[1] ?? null,
        actual: Math.round(t.pnl), ride: Math.round(t.ride!), delta: Math.round(t.pnl) - Math.round(t.ride!), stopHit: t.rideStop, // delta from the rounded fields → ΣΔ == Σactual−Σride
        // exit-timing (run #4 enablement): operator's hold vs the ride's would-be hold
        actualHoldMin: Math.round((Date.parse(t.closedAt) - Date.parse(t.openedAt)) / 60000),
        rideHoldMin: t.rideExitMs != null ? Math.round((t.rideExitMs - Date.parse(t.openedAt)) / 60000) : null,
        recordedAt: new Date().toISOString(),
      }));
      const { added, updated } = await upsertLedger(entries);
      console.log(`  ── ledger: +${added} new / ${updated} refreshed → override_ledger (Supabase)`);
    }
    const stale = recon.filter((t) => isOverride(t) && !t.rideOk);
    if (stale.length) console.log(`  ⚠ ${stale.length} override(s) not ledgered — quote stream didn't reach the flatten (re-run earlier in the week / off-chain OCC)`);
  }

  // ---- foul-out-aware re-score (the capital-path correction) --------------------------
  // The counterfactual above scores each override against an INDEPENDENT ride-to-close —
  // a per-position "was this exit early?" read. But a channel is ONE-AT-A-TIME (worker
  // decide.ts: openRows keyed by strategist_id, entry gated on !row), so you can't ride
  // EVERY override: riding one OCCUPIES the book through its hold and forecloses the later
  // re-entries that actually booked (slot occupancy), and a bigger ride loss can trip the
  // daily_stop. This replays the day's legs per channel under those live constraints — the
  // honest "would riding-as-a-policy have beaten me" (vs the gross sum of phantom
  // simultaneous rides). It is the modeled answer to "letting a winner bleed fouls out the
  // player so they can't make it back even with a signal".
  const overrideSlugs = [...new Set(trades.filter((t) => isOverride(t) && t.rideOk).map((t) => t.slug))];
  if (overrideSlugs.length) {
    console.log(`\nfoul-out-aware re-score — can't ride EVERY override (one-at-a-time book): riding occupies the channel + can trip the daily stop, foreclosing the re-entries that actually booked`);
    console.log(`channel                 trades  actual  ride(gross)  ride(foul)   Δgross   Δfoul    adj   foreclosed`);
    const fouloutEntries: FouloutEntry[] = [];
    for (const slug of overrideSlugs) {
      const chTrades = trades.filter((t) => t.slug === slug);
      const legs: RideLeg[] = chTrades.map((t) => ({
        openedMs: Date.parse(t.openedAt),
        actualCloseMs: Date.parse(t.closedAt),
        actualPnl: t.pnl,
        isOverride: isOverride(t) && t.rideOk && t.ride != null, // stale overrides degrade to their actual exit
        ridePnl: t.ride ?? t.pnl,
        rideExitMs: t.rideExitMs ?? FLATTEN_MS,
      }));
      const stop = dailyStopBySlug.get(slug) ?? 0;
      const r = simulateFoulout(legs, stop, FLATTEN_MS);
      const name = nameBySlug.get(slug) ?? slug;
      const foreclosed = r.blockedSlot || r.blockedStop ? `${r.blockedSlot}slot${r.blockedStop ? `/${r.blockedStop}stop` : ""}` : "—";
      console.log(
        `  ${name.padEnd(22)} ${String(chTrades.length).padStart(5)}  ${sgn(r.actualTotal).padStart(6)}  ${sgn(r.rideGross).padStart(9)}  ${sgn(r.rideFoulAware).padStart(8)}  ${sgn(r.deltaGross).padStart(7)} ${sgn(r.deltaFoulAware).padStart(7)} ${sgn(r.foulAdjustment).padStart(6)}   ${foreclosed}`,
      );
      fouloutEntries.push({
        key: `${DATE}|${slug}`, date: DATE, slug, name, dailyStopUsd: stop,
        nOverrides: legs.filter((l) => l.isOverride).length, nTrades: legs.length,
        actualTotal: Math.round(r.actualTotal), rideGross: Math.round(r.rideGross), rideFoulAware: Math.round(r.rideFoulAware),
        deltaGross: Math.round(r.deltaGross), deltaFoulAware: Math.round(r.deltaFoulAware), foulAdjustment: Math.round(r.foulAdjustment),
        blockedSlot: r.blockedSlot, blockedStop: r.blockedStop, recordedAt: new Date().toISOString(),
      });
    }
    const { added, updated } = await upsertFoulout(fouloutEntries);
    const dg = fouloutEntries.reduce((s, e) => s + e.deltaGross, 0), df = fouloutEntries.reduce((s, e) => s + e.deltaFoulAware, 0);
    console.log(`  ── today: ride beats you (gross) ${sgn(-dg)} → (foul-aware) ${sgn(-df)} · foul-out adjustment ${sgn(df - dg)} (phantom re-entries riding can't take)`);
    console.log(`  ── foulout ledger: +${added} new / ${updated} refreshed → foulout_ledger (Supabase)`);
  }

  // ---- managed-exit shadow (shadowManage MGMT) — the OTHER counterfactual --------------
  // For MANAGED channels (a `management` block: scale-out / breakeven / trail) the live
  // worker already runs the managed-vs-actual what-if each cycle and writes a `MGMT …`
  // shadow event when the position closes (worker/src/shadowManage.ts). Surfaced here so the
  // day's counterfactual shows BOTH baselines — ride-to-close (above, ride channels) and the
  // managed exit (here, managed channels) — without an offline manage.ts replay.
  const mgmt = events.filter((e) => e.message.includes("MGMT "));
  console.log(`\nmanaged-exit shadow (shadowManage MGMT — managed channels)`);
  if (!mgmt.length) console.log(`  none today (no managed channel closed; ride/scalp channels use ride-to-close above)`);
  else for (const e of mgmt.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const m = e.message.match(/MGMT\s+(\S+)\s+(\S+)/);
    const meta = (e.meta ?? {}) as { managed?: number; actual?: number; delta?: number };
    const slug = m?.[1] ?? "?", occ = m?.[2] ?? "";
    console.log(`  ${(nameBySlug.get(slug) ?? slug).padEnd(22)} ${occ.padEnd(20)} managed ${sgn(meta.managed ?? 0).padStart(6)} vs actual ${sgn(meta.actual ?? 0).padStart(6)} (Δ ${sgn(meta.delta ?? 0)})`);
  }

  // ---- override SCORECARD (accumulated — the only honest arbiter) ----------------------
  console.log(`\nOVERRIDE SCORECARD (accumulated — does the manual close systematically beat ride-to-close?)`);
  for (const l of scorecardLines(await loadLedger())) console.log(l);
  // The foul-out-aware companion: the SAME overrides re-scored as ride-AS-A-POLICY on a
  // one-at-a-time book (you can't ride every re-entry). The gross headline above answers
  // "was each exit early?"; this answers "would riding have beaten me?".
  console.log(`\nOVERRIDE SCORECARD — FOUL-OUT-AWARE (ride-as-a-policy: one-at-a-time + daily-stop)`);
  for (const l of fouloutScorecardLines(await loadFoulout())) console.log(l);

  // ---- benched would-be vs live (did the cut channels earn their bench today?) ---------
  // Replays each benched (draft) channel's REAL strategy + exits on today's real NBBO with
  // its real config (scripts/benched-sim.ts) — the live-day equivalent of the cull's backtest.
  // Same-week only (option_quotes 7d); sims only channels that signaled (rest traded nothing).
  let bvl: BenchedVsLive | null = null;
  try {
    bvl = await benchedVsLive(DATE);
    if (bvl.sameWeek) {
      console.log(`\nbenched would-be vs live actual (cut channels — did they earn the bench?)`);
      if (!bvl.benched.length) console.log(`  no benched channel signaled today${bvl.skipped.length ? ` (${bvl.skipped.length} silent)` : ""}`);
      for (const b of bvl.benched) console.log(`  ${b.name.padEnd(24)} ${b.ran ? `${String(b.trades).padStart(2)}t  ${sgn(b.pnl).padStart(7)}  [${b.useSpec ? "spec" : "builtin"}/${b.underlying}]` : `— ${b.note}`}`);
      if (bvl.benched.some((b) => b.ran)) console.log(`  ── Σ benched would-be ${sgn(bvl.benchedTotal)} vs Σ live actual ${sgn(bvl.liveTotal)} → arming the (comparable) bench today would have ${bvl.benchedTotal >= 0 ? "ADDED" : "COST"} $${Math.abs(bvl.benchedTotal).toLocaleString()} (one day = noise; cull rests on the 5-window evidence)`);
    } else {
      console.log(`\nbenched would-be vs live: skipped (${DATE} outside the 7-day option_quotes window — run same-week)`);
    }
  } catch (e) {
    console.log(`\nbenched would-be vs live: failed (${(e as Error).message})`);
  }

  // ---- ONE-ACCOUNT SHADOW (live-transition rehearsal, 2026-07-07) --------------------------
  // The dream team's ACTUAL trades replayed through ONE $50k cash pool since the era-4 epoch
  // (scripts/one-account-shadow.ts) — measures the capital layer (contention, stack
  // concentration, would-be NAV) that per-channel verdicts can't see. Deterministic full
  // replay each night → banked curve is idempotent, no state to chain.
  let oas: ShadowResult | null = null;
  let oasScenarios: { equity: number; rescale: boolean; endNav: number; retPct: number; maxDDpct: number; rejected: number; downsized: number }[] = [];
  try {
    oas = await runOneAccountShadow({ to: DATE });
    const today = oas.days.find((day) => day.date === DATE);
    const seshN = oas.days.length;
    console.log(`\nONE-ACCOUNT SHADOW ($${oas.params.equity.toLocaleString()} · ${oas.params.bucket} · since ${oas.params.from})`);
    if (today) {
      console.log(`  today: NAV $${today.navEnd.toLocaleString()} (${sgn(today.dayPnl)}) · ${today.admitted}/${today.entries} entries admitted${today.downsized ? ` · ${today.downsized} downsized` : ""}${today.rejected ? ` · ${today.rejected} REJECTED` : ""} · peak deployed $${today.peakDeployedUsd.toLocaleString()}${today.peakOcc ? ` · deepest stack ${today.peakOcc.channels}ch/${today.peakOcc.contracts}ct` : ""}`);
    } else console.log(`  (no ${DATE} session rows in the shadow window)`);
    const contested = oas.days.filter((day) => day.rejected + day.downsized > 0).length;
    console.log(`  curve: ${sgn(oas.totalPnl)} over ${seshN} sessions (paper same-trades ${sgn(oas.actualPnl)}) · maxDD ${sgn(-oas.maxDDusd)} (${oas.maxDDpct}%) · contention on ${contested}/${seshN} days · max OCC stack ${oas.maxStackChannels} channels`);
    // per-pool RESCALED profiles (RISK sized to the pool) — the honest "runnable at $X" mini-table.
    // $50k is the as-lived reference (rescale is a no-op at REF). Small pools drop sub-1-contract trades.
    for (const eq of [5_000, 10_000, 25_000, 50_000]) {
      const s = await runOneAccountShadow({ to: DATE, equity: eq, rescale: true });
      oasScenarios.push({ equity: eq, rescale: true, endNav: s.navEnd, retPct: Math.round((1000 * s.totalPnl) / eq) / 10,
        maxDDpct: s.maxDDpct, rejected: s.days.reduce((a, x) => a + x.rejected, 0), downsized: s.days.reduce((a, x) => a + x.downsized, 0) });
    }
    console.log(`  rescaled runnable: ${oasScenarios.map((s) => `$${s.equity / 1000}k→${s.retPct >= 0 ? "+" : ""}${s.retPct}%/DD${s.maxDDpct}%${s.rejected ? `/${s.rejected}drop` : ""}`).join(" · ")}`);
  } catch (e) {
    console.log(`\none-account shadow: failed (${(e as Error).message})`);
  }

  // ---- RATCHET SHADOW (A4 third arm, registry instrumentation vi) --------------------------
  // Ledger-first (Mac, incl. archive-replayed June predecessor trades); the worker image
  // recomputes same-week twins from the DB (labeled source:"live"). Log-only, never a gate.
  let ratchet: RatchetSummary | null = null;
  try {
    ratchet = await ratchetShadowSummary(sb);
    if (ratchet) console.log(`\nRATCHET SHADOW (${ratchet.params} · ${ratchet.source}): actual ${sgn(ratchet.actualUsd)} vs ratchet ${sgn(ratchet.ratchetUsd)} → Δ ${sgn(ratchet.deltaUsd)} over ${ratchet.scored}t · armed ${ratchet.armed}/${ratchet.scored}`);
  } catch (e) {
    console.log(`\nratchet shadow: failed (${(e as Error).message})`);
  }

  // ---- DAILY GIVE-BACK / CAPTURE (the take-profit policy's success metric) -----------------
  // Over trades that PEAKED above entry (with option_quotes coverage): how much of the peak gain
  // did the desk KEEP? capturePct = realized ÷ peak-gain (→100 = kept it all; →0 = gave it all
  // back; <0 = closed red after peaking). The take-profit policy should push capture UP and the
  // $ given-back DOWN. Published daily → accrues one point/day in the §03 panel (watch the trend).
  const gbPeakers = trades.filter((t) => t.peak != null && t.peak > t.entry && t.qty > 0);
  const peakGainUsd = (t: Trade) => (t.peak! - t.entry) * t.qty * 100;
  const gbPeaked = gbPeakers.reduce((a, t) => a + peakGainUsd(t), 0);
  const gbKept = gbPeakers.reduce((a, t) => a + t.pnl, 0);
  const gbChan = new Map<string, { name: string; peaked: number; kept: number; n: number }>();
  for (const t of gbPeakers) { const e = gbChan.get(t.slug) ?? { name: t.name, peaked: 0, kept: 0, n: 0 }; e.peaked += peakGainUsd(t); e.kept += t.pnl; e.n++; gbChan.set(t.slug, e); }
  const giveback = {
    date: DATE,
    nPeakers: gbPeakers.length,
    nClosed: trades.length,
    peakedUsd: Math.round(gbPeaked),
    keptUsd: Math.round(gbKept),
    givenBackUsd: Math.round(gbPeaked - gbKept),
    capturePct: gbPeaked > 0 ? Math.round((gbKept / gbPeaked) * 100) : null,
    byChannel: [...gbChan.values()]
      .map((e) => ({ key: e.name, capturePct: e.peaked > 0 ? Math.round((e.kept / e.peaked) * 100) : 0, givenBackUsd: Math.round(e.peaked - e.kept), n: e.n }))
      .sort((a, b) => b.givenBackUsd - a.givenBackUsd),
  };
  console.log(`\nGIVE-BACK (peak→close) — ${giveback.nPeakers}/${giveback.nClosed} trades peaked +; kept ${giveback.capturePct ?? "—"}% of peak · $${giveback.givenBackUsd} given back (peaked ${sgn(giveback.peakedUsd)} → kept ${sgn(giveback.keptUsd)})`);

  // ---- publish to the §03 dashboard panel (override scorecard + benched-vs-live) ----------
  const [ledgerNow, fouloutNow] = await Promise.all([loadLedger(), loadFoulout()]);
  const payload = {
    generatedAt: new Date().toISOString(),
    overrideScorecard: scorecardData(ledgerNow),
    // TODAY's slice of the same ledger (panel toggle: today ⇄ cumulative)
    overrideToday: scorecardData(Object.fromEntries(Object.entries(ledgerNow).filter(([, e]) => e.date === DATE))),
    overrideFouloutScorecard: fouloutScorecardData(fouloutNow), // capital-path re-score (additive; panel may ignore)
    benchedVsLive: bvl ? { sameWeek: bvl.sameWeek, benched: bvl.benched, skipped: bvl.skipped, benchedTotal: bvl.benchedTotal, liveTotal: bvl.liveTotal } : null,
    giveback,
    // full deterministic replay each night — the banked curve self-heals on re-runs
    oneAccountShadow: oas ? { params: oas.params, navEnd: oas.navEnd, totalPnl: oas.totalPnl, actualPnl: oas.actualPnl,
      maxStackChannels: oas.maxStackChannels, maxDDusd: oas.maxDDusd, maxDDpct: oas.maxDDpct,
      curve: oas.days.map((day) => ({ d: day.date, nav: day.navEnd, adm: day.admitted, dwn: day.downsized, rej: day.rejected, peak: day.peakDeployedUsd })),
      scenarios: oasScenarios,
      today: oas.days.find((day) => day.date === DATE) ?? null } : null,
    ratchetShadow: ratchet,
  };
  console.log(`\n  dashboard: ${await publishForensics(DATE, payload)}`);

  console.log("");
}

main().catch((e) => { console.error(e); process.exit(1); });
