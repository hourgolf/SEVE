// ============================================================================
//  paper-trader — DISPATCHER DRAFT (multi-channel "one engine, two drivers").
//
//  ⚠️ DRAFT — review + backtest before replacing index.ts. Specifically:
//    • power & grind are first-draft theses — run `npm run backtest` on real
//      option_bars and Arm them before they trade live (the safety gate).
//    • position attribution: the desk `positions` table (strategist_id ↔
//      occ_symbol) is the source of truth per channel. If two channels pick the
//      SAME 0DTE contract, Alpaca nets them into one position — rare, but a
//      known edge case (mitigation noted below).
//    • this multi-channel worker itself is untested against live Alpaca.
//
//  What changed vs the single-strategy worker:
//    - loads ALL strategists, loops them, runs each one's registered strategy
//      on session features (computeFeatures), books orders tagged per channel.
//    - each channel sizes off ITS OWN capital_pct of the fund equity (independent
//      allocation), capped by its max_contracts.
//    - strategies + computeFeatures are inlined here (paste-deploy has no bundler)
//      but MIRROR engine/* — keep them in sync; the engine stays the backtest
//      source of truth.
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const ALPACA_KEY = Deno.env.get("ALPACA_KEY") ?? "";
const ALPACA_SECRET = Deno.env.get("ALPACA_SECRET") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DRY_RUN = (Deno.env.get("DRY_RUN") ?? "true").toLowerCase() !== "false";
const PAPER = "https://paper-api.alpaca.markets";

const sb = createClient(SB_URL, SB_SERVICE);

// ---- types (mirror engine/types.ts) ---------------------------------------
type OptType = "call" | "put";
interface Bar { ts: number; open: number; high: number; low: number; close: number; volume: number; vwap: number; }
interface Features {
  minute: number; minutesToClose: number; close: number; vwap: number;
  openRangeHi: number | null; openRangeLo: number | null; atr: number; mom: number; er: number; relVol: number;
}
interface Pos { optType: OptType; entryMinute: number; entryUnderlying: number; peakFavorable: number; }
type Intent = { kind: "enter"; direction: OptType; reason: string } | { kind: "exit"; reason: string } | null;
type Evaluate = (f: Features, pos: Pos | null) => Intent;

// ---- features (mirror engine/engine.ts — minutesToClose is patched live) ----
const OPEN_RANGE_MIN = 30, ATR_N = 14, ER_N = 30, VOL_N = 20;
function computeFeatures(bars: Bar[], i: number, minutesToClose: number): Features {
  const b = bars[i];
  let orHi: number | null = null, orLo: number | null = null;
  if (i >= OPEN_RANGE_MIN - 1) {
    orHi = -Infinity; orLo = Infinity;
    for (let j = 0; j < OPEN_RANGE_MIN; j++) { orHi = Math.max(orHi, bars[j].high); orLo = Math.min(orLo, bars[j].low); }
  }
  let atrSum = 0, atrCount = 0;
  for (let j = Math.max(0, i - ATR_N + 1); j <= i; j++) { atrSum += bars[j].high - bars[j].low; atrCount++; }
  const atr = atrCount ? atrSum / atrCount : 0;
  const mom = i >= 3 ? b.close - bars[i - 3].close : 0;
  let er = 0; const n = Math.min(ER_N, i);
  if (n > 0) { let path = 0; for (let j = i - n + 1; j <= i; j++) path += Math.abs(bars[j].close - bars[j - 1].close); er = path > 0 ? Math.abs(b.close - bars[i - n].close) / path : 0; }
  let relVol = 1;
  if (i >= 1) { let vSum = 0, vC = 0; for (let j = Math.max(0, i - VOL_N); j < i; j++) { vSum += bars[j].volume; vC++; } const avg = vC ? vSum / vC : 0; relVol = avg > 0 ? b.volume / avg : 1; }
  return { minute: i, minutesToClose, close: b.close, vwap: b.vwap, openRangeHi: orHi, openRangeLo: orLo, atr, mom, er, relVol };
}

// ---- strategies (mirror engine/strategies/* — keep in sync) -----------------
function breakoutEval(f: Features, pos: Pos | null): Intent {
  const P = { breakAtr: 0.5, volMult: 1.3, erMin: 0.35, momConfirm: 0.3, trailAtr: 1.5, failAtr: 0.75, flatten: 35 };
  if (pos) {
    if (f.minutesToClose <= P.flatten) return { kind: "exit", reason: "eod_flatten" };
    if (pos.optType === "call") {
      if (f.close < pos.peakFavorable - P.trailAtr * f.atr) return { kind: "exit", reason: "trail_stop" };
      if (f.openRangeHi != null && f.close < f.openRangeHi - P.failAtr * f.atr) return { kind: "exit", reason: "failed_break" };
    } else {
      if (f.close > pos.peakFavorable + P.trailAtr * f.atr) return { kind: "exit", reason: "trail_stop" };
      if (f.openRangeLo != null && f.close > f.openRangeLo + P.failAtr * f.atr) return { kind: "exit", reason: "failed_break" };
    }
    return null;
  }
  if (f.openRangeHi == null || f.openRangeLo == null || f.minutesToClose <= P.flatten || f.atr <= 0) return null;
  if (f.er < P.erMin || f.relVol < P.volMult) return null;
  if (f.close > f.openRangeHi + P.breakAtr * f.atr && f.mom > P.momConfirm * f.atr) return { kind: "enter", direction: "call", reason: "break_high" };
  if (f.close < f.openRangeLo - P.breakAtr * f.atr && f.mom < -P.momConfirm * f.atr) return { kind: "enter", direction: "put", reason: "break_low" };
  return null;
}
function fadeEval(f: Features, pos: Pos | null): Intent {
  const P = { atrMult: 1.5, weakMom: 0.6, stopAtr: 1.0, timeStop: 20, flatten: 35, erMax: 0.4 };
  if (pos) {
    if (f.minutesToClose <= P.flatten) return { kind: "exit", reason: "eod_flatten" };
    if (f.minute - pos.entryMinute >= P.timeStop) return { kind: "exit", reason: "time_stop" };
    if (pos.optType === "put") { if (f.close <= f.vwap) return { kind: "exit", reason: "target_vwap" }; if (f.close > pos.entryUnderlying + P.stopAtr * f.atr) return { kind: "exit", reason: "stop" }; }
    else { if (f.close >= f.vwap) return { kind: "exit", reason: "target_vwap" }; if (f.close < pos.entryUnderlying - P.stopAtr * f.atr) return { kind: "exit", reason: "stop" }; }
    return null;
  }
  if (f.openRangeHi == null || f.openRangeLo == null || f.minutesToClose <= P.flatten || f.atr <= 0 || f.er > P.erMax) return null;
  if (Math.abs(f.mom) >= P.weakMom * f.atr) return null;
  if (f.close > f.openRangeHi && f.close - f.vwap > P.atrMult * f.atr) return { kind: "enter", direction: "put", reason: "fade_upside_stretch" };
  if (f.close < f.openRangeLo && f.vwap - f.close > P.atrMult * f.atr) return { kind: "enter", direction: "call", reason: "fade_downside_stretch" };
  return null;
}
function powerEval(f: Features, pos: Pos | null): Intent {
  const P = { windowMin: 60, momConfirm: 0.25, stopAtr: 1.0, flatten: 3 };
  if (pos) {
    if (f.minutesToClose <= P.flatten) return { kind: "exit", reason: "eod_flatten" };
    if (pos.optType === "call" && f.close < pos.entryUnderlying - P.stopAtr * f.atr) return { kind: "exit", reason: "stop" };
    if (pos.optType === "put" && f.close > pos.entryUnderlying + P.stopAtr * f.atr) return { kind: "exit", reason: "stop" };
    return null;
  }
  if (f.minutesToClose > P.windowMin || f.minutesToClose <= P.flatten || f.atr <= 0) return null;
  if (f.close > f.vwap && f.mom > P.momConfirm * f.atr) return { kind: "enter", direction: "call", reason: "power_hour_long" };
  if (f.close < f.vwap && f.mom < -P.momConfirm * f.atr) return { kind: "enter", direction: "put", reason: "power_hour_short" };
  return null;
}
function grindEval(f: Features, pos: Pos | null): Intent {
  const P = { momTrigger: 0.5, volMin: 1.1, targetAtr: 0.6, stopAtr: 0.5, timeStop: 5, flatten: 10 };
  if (pos) {
    if (f.minutesToClose <= P.flatten) return { kind: "exit", reason: "eod_flatten" };
    if (f.minute - pos.entryMinute >= P.timeStop) return { kind: "exit", reason: "time_stop" };
    if (pos.optType === "call") { if (f.close >= pos.entryUnderlying + P.targetAtr * f.atr) return { kind: "exit", reason: "target" }; if (f.close <= pos.entryUnderlying - P.stopAtr * f.atr) return { kind: "exit", reason: "stop" }; }
    else { if (f.close <= pos.entryUnderlying - P.targetAtr * f.atr) return { kind: "exit", reason: "target" }; if (f.close >= pos.entryUnderlying + P.stopAtr * f.atr) return { kind: "exit", reason: "stop" }; }
    return null;
  }
  if (f.minutesToClose <= P.flatten || f.atr <= 0 || f.relVol < P.volMin) return null;
  if (f.mom >= P.momTrigger * f.atr) return { kind: "enter", direction: "call", reason: "grind_up" };
  if (f.mom <= -P.momTrigger * f.atr) return { kind: "enter", direction: "put", reason: "grind_down" };
  return null;
}

// slug → { evaluate, timeframeMin, warmupBars }  (mirrors engine/registry.ts)
const REGISTRY: Record<string, { evaluate: Evaluate; tf: number; warmup: number }> = {
  breakout: { evaluate: breakoutEval, tf: 1, warmup: 30 },
  fade:     { evaluate: fadeEval,     tf: 1, warmup: 30 },
  power:    { evaluate: powerEval,    tf: 1, warmup: 30 },
  grind:    { evaluate: grindEval,    tf: 1, warmup: 30 },
};

// ---- helpers ---------------------------------------------------------------
const aHdr = { "APCA-API-KEY-ID": ALPACA_KEY, "APCA-API-SECRET-KEY": ALPACA_SECRET };
async function aGet(path: string) { const r = await fetch(PAPER + path, { headers: aHdr }); if (!r.ok) throw new Error(`${r.status} GET ${path}`); return r.json(); }
async function aPost(path: string, body: unknown) { const r = await fetch(PAPER + path, { method: "POST", headers: { ...aHdr, "content-type": "application/json" }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`${r.status} POST ${path}`); return r.json(); }
async function journal(level: string, message: string, meta?: unknown) { try { await sb.from("events").insert({ level, message, meta: meta ?? null }); } catch { /* */ } }
function occSymbol(etDate: string, strike: number, type: OptType) { const [y, m, d] = etDate.split("-"); return `SPY${y.slice(2)}${m}${d}${type === "call" ? "C" : "P"}${String(Math.round(strike * 1000)).padStart(8, "0")}`; }
function aggregate(bars: Bar[], tf: number): Bar[] {
  if (tf <= 1) return bars;
  const out: Bar[] = []; let bk = -1;
  for (const b of bars) { const ms = Math.floor(b.ts / (tf * 60000)) * (tf * 60000); if (ms !== bk) { out.push({ ...b, ts: ms }); bk = ms; } else { const c = out[out.length - 1]; c.high = Math.max(c.high, b.high); c.low = Math.min(c.low, b.low); c.close = b.close; c.volume += b.volume; } }
  return out;
}
function etParts(ms: number) { const d = new Date(ms); const et = new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" })); return { min: et.getHours() * 60 + et.getMinutes(), date: `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, "0")}-${String(et.getDate()).padStart(2, "0")}` }; }

Deno.serve(async () => {
  try {
    const { data: fund } = await sb.from("fund_state").select("*").eq("id", 1).maybeSingle();
    const { data: strategists } = await sb.from("strategists").select("id,slug,strategist_config(*)");
    const account = await aGet("/v2/account");
    const positions: Record<string, unknown>[] = await aGet("/v2/positions").catch(() => []);
    const openOrders: Record<string, unknown>[] = await aGet("/v2/orders?status=open&limit=100").catch(() => []);

    // today's session 1m bars (oldest→newest), from market open
    const { data: rawBars } = await sb.from("underlying_bars").select("ts,open,high,low,close,volume,vwap").eq("symbol", "SPY").order("ts", { ascending: false }).limit(900);
    const all1m: Bar[] = (rawBars ?? []).filter((b: Record<string, number | null>) => b.close != null).reverse().map((b: Record<string, number | null>) => ({ ts: Date.parse(b.ts as unknown as string), open: Number(b.open ?? b.close), high: Number(b.high ?? b.close), low: Number(b.low ?? b.close), close: Number(b.close), volume: Number(b.volume ?? 0), vwap: Number(b.vwap ?? b.close) }));
    const nowMs = Date.now();
    const todayET = etParts(nowMs).date;
    const session1m = all1m.filter((b) => etParts(b.ts).date === todayET);

    // fund-level equity snapshot
    await sb.from("equity_snapshots").insert({ strategist_id: null, net_liquidation: Number(account.equity), cash: Number(account.cash), unrealized_pnl: positions.reduce((a, p) => a + Number(p.unrealized_pl ?? 0), 0) });

    const out: Record<string, unknown>[] = [];
    for (const s of (strategists ?? [])) {
      const cfg = Array.isArray(s.strategist_config) ? s.strategist_config[0] : s.strategist_config;
      const def = REGISTRY[s.slug];
      if (!def || !cfg) continue;                                   // no edge / no config → idle
      const guardBlocked = fund?.is_halted ? "halted" : cfg.muted ? "muted" : fund?.mode !== "paper" ? "not_paper" : null;

      const bars = aggregate(session1m, def.tf);
      if (bars.length < def.warmup) { out.push({ slug: s.slug, note: "warmup" }); continue; }
      const i = bars.length - 1;
      const last = bars[i];
      const { min: etMin } = etParts(last.ts);
      const minutesToClose = Math.max(0, 16 * 60 - etMin);          // real time-to-close (16:00 ET)
      const f = computeFeatures(bars, i, minutesToClose);

      // this channel's open position (desk row = source of truth) + Alpaca match
      const { data: rows } = await sb.from("positions").select("*").eq("strategist_id", s.id).eq("status", "open");
      const row = (rows ?? [])[0];
      const alp = row ? positions.find((p) => String(p.symbol) === String(row.occ_symbol)) : undefined;
      // entryUnderlying ≈ strike: the worker enters ATM, so strike = round(spot
      // at entry), within ~$0.50 — fine for the ATR stops, and needs no extra
      // column (uses the existing positions schema as-is).
      const pos: Pos | null = row ? { optType: row.opt_type, entryMinute: 0, entryUnderlying: Number(row.strike), peakFavorable: f.close } : null;

      const intent = def.evaluate(f, pos);
      const canTrade = !guardBlocked;

      // ---- exit ----
      if (intent?.kind === "exit" && row && alp && canTrade) {
        if (!DRY_RUN) await aPost("/v2/orders", { symbol: row.occ_symbol, qty: String(Math.round(Number(alp.qty))), side: "sell", type: "market", time_in_force: "day" });
        await sb.from("positions").update({ status: "closed", closed_at: new Date().toISOString(), realized_pnl: Number(alp.unrealized_pl ?? 0) }).eq("id", row.id);
        await journal("EXEC", `${s.slug}: exit ${row.occ_symbol} (${intent.reason})`);
      }

      // ---- entry ----
      if (intent?.kind === "enter" && !row) {
        const dir = intent.direction;
        const strike = Math.round(f.close);
        const occ = occSymbol(todayET, strike, dir);
        let blocked = guardBlocked;
        // Belt-and-suspenders: never double-buy a contract we already hold or
        // have a working order for — even if our desk-row tracking failed. This
        // alone breaks the silent re-buy loop regardless of any write failure.
        if (!blocked && (positions.some((p) => String(p.symbol) === occ) || openOrders.some((o) => String(o.symbol) === occ))) blocked = "already_open";
        let qty = 0, ask = 0;
        if (!blocked) {
          const { data: q } = await sb.from("option_quotes").select("ask").eq("occ_symbol", occ).order("captured_at", { ascending: false }).limit(1).maybeSingle();
          ask = Number(q?.ask ?? 0);
          if (!ask) blocked = "no_quote";
        }
        if (!blocked) {
          // INDEPENDENT per-channel allocation: this channel's slice of fund equity
          const budget = Number(account.equity) * (Number(cfg.capital_pct) / 100) * (Number(cfg.aggression) / 100);
          qty = Math.max(0, Math.min(Math.floor(budget / (ask * 100)), Number(cfg.max_contracts)));
          if (qty === 0) blocked = "insufficient_capital";
        }
        await sb.from("signals").insert({ strategist_id: s.id, signal_type: intent.reason, underlying_price: f.close, direction: dir, acted_on: !blocked, blocked_reason: blocked, rationale: { occ, ask, qty, atr: Number(f.atr.toFixed(2)), er: Number(f.er.toFixed(2)), relVol: Number(f.relVol.toFixed(2)) } });
        if (!blocked && qty > 0 && !DRY_RUN) {
          const o = await aPost("/v2/orders", { symbol: occ, qty: String(qty), side: "buy", type: "market", time_in_force: "day" });
          // CRITICAL: confirm the position row was recorded. A silent insert
          // failure here is what caused the re-buy loop — if it fails, journal
          // LOUD (the `already_open` guard above still prevents another buy).
          const { error: posErr } = await sb.from("positions").insert({ strategist_id: s.id, occ_symbol: occ, underlying: "SPY", expiration: todayET, strike, opt_type: dir, qty, avg_entry_price: ask, current_mark: ask, unrealized_pnl: 0, status: "open" });
          if (posErr) await journal("WARN", `${s.slug}: ORDER FILLED but position insert FAILED (${posErr.message}) — reconcile manually`, { occ, order_id: o.id });
          else await journal("EXEC", `${s.slug}: buy ${qty} ${occ} (${intent.reason})`, { order_id: o.id });
        }
        out.push({ slug: s.slug, dir, blocked, qty });
      } else if (row && alp) {
        // mark-to-market the open desk row
        await sb.from("positions").update({ current_mark: Number(alp.current_price ?? 0), unrealized_pnl: Number(alp.unrealized_pl ?? 0) }).eq("id", row.id);
      }
    }
    return Response.json({ ok: true, dryRun: DRY_RUN, channels: out });
  } catch (e) {
    await journal("WARN", `paper-trader(dispatcher) failed: ${(e as Error).message}`);
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
});
