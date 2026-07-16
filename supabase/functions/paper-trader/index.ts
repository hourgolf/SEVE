// ============================================================================
//  supabase/functions/paper-trader/index.ts
//  SEVE live paper-trading worker — runs the 15m EMA-cross strategist forward
//  on Alpaca's PAPER options API, every minute via pg_cron. Stateless: it
//  reconstructs state from Alpaca (positions/orders/account) each run, decides
//  entries/exits, places paper orders, and reconciles into the desk tables the
//  dashboard reads (positions / signals / equity_snapshots / events).
//
//  Trades as the `breakout` strategist, so the Console's Breakout knobs + mute
//  drive it. SAFETY: DRY_RUN (default ON) places no orders; honors the kill
//  switch (fund_state.is_halted) + mute; refuses any non-'paper' mode.
//
//  Mirrors engine DEFAULT_CROSS_PARAMS (the canonical backtest reference).
//  Secrets reused from market-ingest: ALPACA_KEY, ALPACA_SECRET. Auto-injected:
//  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Optional secret: DRY_RUN=false.
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const ALPACA_KEY = Deno.env.get("ALPACA_KEY") ?? "";
const ALPACA_SECRET = Deno.env.get("ALPACA_SECRET") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DRY_RUN = (Deno.env.get("DRY_RUN") ?? "true").toLowerCase() !== "false";

const PAPER = "https://paper-api.alpaca.markets";
const DATA = "https://data.alpaca.markets";
const STRAT_SLUG = "breakout"; // the EMA-cross bot trades as this strategist

// ---- strategy params (mirror engine/strategies/crossover DEFAULT) ----------
const TF = 15; // minutes
const EMA_FAST = 12;
const EMA_SLOW = 26;
const VOL_MULT = 1.2;
const STOP_FRAC = 0.5; // premium stop: exit if the option mark falls ≥50% from entry
const TIME_STOP = 45; // minutes
const FLATTEN = 35; // minutes-to-close
const ATR_N = 14;
const VOL_N = 20;

const H = {
  "APCA-API-KEY-ID": ALPACA_KEY,
  "APCA-API-SECRET-KEY": ALPACA_SECRET,
  accept: "application/json",
};

// ---- small math ------------------------------------------------------------
function ema(values: number[], period: number): number[] {
  const out: number[] = [];
  const k = 2 / (period + 1);
  let prev = values.length ? values[0] : 0;
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}
function crossDir(a: number[], b: number[], i: number): -1 | 0 | 1 {
  if (i < 1) return 0;
  const p = a[i - 1] - b[i - 1];
  const n = a[i] - b[i];
  if (p <= 0 && n > 0) return 1;
  if (p >= 0 && n < 0) return -1;
  return 0;
}

// ---- time (US Eastern) -----------------------------------------------------
const etFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
});
function etParts(ms: number) {
  const p: Record<string, string> = {};
  for (const x of etFmt.formatToParts(new Date(ms))) p[x.type] = x.value;
  let h = Number(p.hour);
  if (h === 24) h = 0;
  return { date: `${p.year}-${p.month}-${p.day}`, min: h * 60 + Number(p.minute) };
}

interface Bar { ts: number; open: number; high: number; low: number; close: number; volume: number; vwap: number }

// 1m → 15m, clock-aligned UTC buckets.
function aggregate(bars: Bar[], tf: number): Bar[] {
  const size = tf * 60_000;
  const out: Bar[] = [];
  let bucket = -1, volSum = 0, pvSum = 0;
  for (const b of bars) {
    const ms = Math.floor(b.ts / size) * size;
    if (ms !== bucket) {
      out.push({ ...b, ts: ms });
      bucket = ms; volSum = b.volume; pvSum = b.vwap * b.volume;
    } else {
      const c = out[out.length - 1];
      c.high = Math.max(c.high, b.high); c.low = Math.min(c.low, b.low); c.close = b.close;
      c.volume += b.volume; volSum += b.volume; pvSum += b.vwap * b.volume;
      c.vwap = volSum > 0 ? pvSum / volSum : b.vwap;
    }
  }
  return out;
}

// ---- alpaca helpers --------------------------------------------------------
async function aGet(base: string, path: string) {
  const r = await fetch(base + path, { headers: H });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} GET ${path.split("?")[0]} -> ${t.slice(0, 160)}`);
  return JSON.parse(t);
}
async function aPost(path: string, body: unknown) {
  const r = await fetch(PAPER + path, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} POST ${path} -> ${t.slice(0, 200)}`);
  return JSON.parse(t);
}

const occSymbol = (expISO: string, strike: number, type: "call" | "put") => {
  const [y, m, d] = expISO.split("-");
  return `SPY${y.slice(2)}${m}${d}${type === "call" ? "C" : "P"}${String(Math.round(strike * 1000)).padStart(8, "0")}`;
};

Deno.serve(async () => {
  const sb = createClient(SB_URL, SB_SERVICE);
  const journal = (level: string, message: string, meta?: unknown) =>
    sb.from("events").insert({ level, message, meta: meta ?? null });

  try {
    if (!ALPACA_KEY || !ALPACA_SECRET) throw new Error("ALPACA secrets not set");

    // 1) controls
    const { data: fund } = await sb.from("fund_state").select("*").eq("id", 1).maybeSingle();
    const { data: strat } = await sb
      .from("strategists")
      .select("id,slug,strategist_config(capital_pct,aggression,max_contracts,daily_stop_usd,muted)")
      .eq("slug", STRAT_SLUG)
      .maybeSingle();
    if (!fund || !strat) throw new Error("missing fund_state / breakout strategist");
    const cfg = Array.isArray(strat.strategist_config) ? strat.strategist_config[0] : strat.strategist_config;
    const stratId = strat.id as string;

    // 2) market data → 15m series
    const { data: rawBars } = await sb
      .from("underlying_bars")
      .select("ts,open,high,low,close,volume,vwap")
      .eq("symbol", "SPY")
      .order("ts", { ascending: false })
      .limit(900); // ~2 sessions of 1m
    const bars1m: Bar[] = (rawBars ?? [])
      .filter((b: Record<string, number | null>) => b.close != null)
      .reverse()
      .map((b: Record<string, number | null>) => ({
        ts: Date.parse(b.ts as unknown as string),
        open: Number(b.open ?? b.close), high: Number(b.high ?? b.close), low: Number(b.low ?? b.close),
        close: Number(b.close), volume: Number(b.volume ?? 0), vwap: Number(b.vwap ?? b.close),
      }));
    if (bars1m.length < EMA_SLOW * TF) {
      await journal("INFO", "paper-trader: not enough bars yet");
      return Response.json({ ok: true, note: "insufficient bars" });
    }
    const bars = aggregate(bars1m, TF);
    const nowMs = Date.now();
    // last COMPLETE 15m bar (its window has fully elapsed)
    let lastIdx = bars.length - 1;
    while (lastIdx >= 0 && bars[lastIdx].ts + TF * 60_000 > nowMs) lastIdx--;
    if (lastIdx < EMA_SLOW) {
      await journal("INFO", "paper-trader: not enough 15m bars yet");
      return Response.json({ ok: true, note: "insufficient 15m bars" });
    }
    const closes = bars.map((b) => b.close);
    const efA = ema(closes, EMA_FAST);
    const esA = ema(closes, EMA_SLOW);
    const last = bars[lastIdx];
    const spot = last.close;
    const cross = crossDir(efA, esA, lastIdx);
    // ATR + relVol on completed bars
    let atrSum = 0, atrCnt = 0;
    for (let j = Math.max(0, lastIdx - ATR_N + 1); j <= lastIdx; j++) { atrSum += bars[j].high - bars[j].low; atrCnt++; }
    const atr = atrCnt ? atrSum / atrCnt : 0;
    let volSum = 0, volCnt = 0;
    for (let j = Math.max(0, lastIdx - VOL_N + 1); j <= lastIdx; j++) { volSum += bars[j].volume; volCnt++; }
    const relVol = volCnt && volSum > 0 ? last.volume / (volSum / volCnt) : 0;
    const { min: etMin, date: etDate } = etParts(last.ts);
    const minutesToClose = Math.max(0, 16 * 60 - etMin); // 16:00 ET close
    const freshBar = nowMs - (last.ts + TF * 60_000) <= 90_000; // acts once right after a bar closes

    // 3) reconcile Alpaca state
    const account = await aGet(PAPER, "/v2/account");
    const positions: Record<string, unknown>[] = await aGet(PAPER, "/v2/positions").catch(() => []);
    const openOrders: Record<string, unknown>[] = await aGet(PAPER, "/v2/orders?status=open&limit=50").catch(() => []);
    const spyOptPos = positions.filter((p) => String(p.asset_class) === "us_option" && String(p.symbol).startsWith("SPY"));
    const pendingSpyOpt = openOrders.some((o) => String(o.symbol).startsWith("SPY"));
    const holding = spyOptPos[0]; // single-position strategy

    // equity snapshot (fund-level) — only on a fresh 15m bar (or while holding,
    // to capture entry/exit P&L) to avoid one row every single minute.
    if (freshBar || holding) {
      await sb.from("equity_snapshots").insert({
        strategist_id: null,
        net_liquidation: Number(account.equity),
        cash: Number(account.cash),
        unrealized_pnl: spyOptPos.reduce((a, p) => a + Number(p.unrealized_pl ?? 0), 0),
      });
    }

    const guards = {
      dryRun: DRY_RUN,
      halted: !!fund.is_halted,
      muted: !!cfg?.muted,
      notPaper: fund.mode !== "paper",
    };
    const canTrade = !guards.halted && !guards.muted && !guards.notPaper;

    // helper: place an order unless dry-run; journal either way
    async function order(side: "buy" | "sell", symbol: string, qty: number, why: string) {
      if (DRY_RUN) {
        await journal("INFO", `paper-trader[DRY]: would ${side} ${qty} ${symbol} (${why})`, { symbol, qty, side, why });
        return null;
      }
      const o = await aPost("/v2/orders", { symbol, qty: String(qty), side, type: "market", time_in_force: "day" });
      await journal("EXEC", `paper-trader: ${side} ${qty} ${symbol} (${why})`, { order_id: o.id, why });
      return o;
    }

    // --- mark / open / close reconcile of the desk `positions` rows ----------
    const { data: openRows } = await sb
      .from("positions").select("*").eq("strategist_id", stratId).eq("status", "open");
    const openRow = (openRows ?? [])[0];

    if (holding) {
      const occ = String(holding.symbol);
      const mark = Number(holding.current_price ?? 0);
      const uPnl = Number(holding.unrealized_pl ?? 0);
      const m = occ.match(/^SPY(\d{6})([CP])(\d{8})$/);
      if (!openRow && m) {
        // entry filled since last run → open a desk row
        await sb.from("positions").insert({
          strategist_id: stratId, occ_symbol: occ, underlying: "SPY",
          expiration: `20${m[1].slice(0, 2)}-${m[1].slice(2, 4)}-${m[1].slice(4, 6)}`,
          strike: Number(m[3]) / 1000, opt_type: m[2] === "C" ? "call" : "put",
          qty: Math.round(Number(holding.qty)), avg_entry_price: Number(holding.avg_entry_price),
          current_mark: mark, unrealized_pnl: uPnl, status: "open",
        });
      } else if (openRow) {
        await sb.from("positions").update({ current_mark: mark, unrealized_pnl: uPnl }).eq("id", openRow.id);
      }
    } else if (openRow) {
      // position is gone on Alpaca → it closed; book it (best-effort realized = last mark)
      await sb.from("positions").update({
        status: "closed", closed_at: new Date().toISOString(),
        unrealized_pnl: 0,
        realized_pnl: Number(openRow.unrealized_pnl ?? 0),
      }).eq("id", openRow.id).eq("status", "open");
      await journal("OK", `paper-trader: closed ${openRow.occ_symbol} · realized ~$${Number(openRow.unrealized_pnl ?? 0).toFixed(0)}`);
    }

    // --- exits (every minute while holding) ----------------------------------
    if (holding && canTrade) {
      const occ = String(holding.symbol);
      const isCall = /^SPY\d{6}C/.test(occ);
      const mark = Number(holding.current_price ?? 0);
      const entry = Number(holding.avg_entry_price ?? openRow?.avg_entry_price ?? 0);
      const heldMin = openRow?.opened_at ? (nowMs - Date.parse(openRow.opened_at as string)) / 60_000 : 0;
      let exitWhy = "";
      if (minutesToClose <= FLATTEN) exitWhy = "eod_flatten";
      else if (heldMin >= TIME_STOP) exitWhy = "time_stop";
      else if (isCall && cross === -1) exitWhy = "ema_cross_down";
      else if (!isCall && cross === 1) exitWhy = "ema_cross_up";
      else if (entry > 0 && mark > 0 && mark <= entry * (1 - STOP_FRAC)) exitWhy = "stop_premium";
      if (exitWhy) {
        await order("sell", occ, Math.round(Number(holding.qty)), exitWhy);
      }
    }

    // --- entry (flat + fresh cross + confirmations + guards) -----------------
    let signalDir: "call" | "put" | null = null;
    let blocked: string | null = null;
    if (!holding && !pendingSpyOpt && freshBar && cross !== 0) {
      signalDir = cross === 1 ? "call" : "put";
      if (minutesToClose <= FLATTEN) blocked = "near_close";
      else if (relVol < VOL_MULT) blocked = "low_volume";
      else if (atr <= 0) blocked = "no_atr";
      else if (!canTrade) blocked = guards.halted ? "halted" : guards.muted ? "muted" : "not_paper";

      // size off the ATM contract's ask (from the latest option_quotes snapshot)
      const strike = Math.round(spot);
      const occ = occSymbol(etDate, strike, signalDir);
      let ask = 0;
      if (!blocked) {
        const { data: q } = await sb.from("option_quotes")
          .select("ask,captured_at").eq("occ_symbol", occ)
          .order("captured_at", { ascending: false }).limit(1).maybeSingle();
        ask = Number(q?.ask ?? 0);
        if (!ask) blocked = "no_quote";
      }
      let qty = 0;
      if (!blocked) {
        const equity = Number(account.equity);
        const budget = equity * (Number(cfg.capital_pct) / 100) * (Number(cfg.aggression) / 100);
        qty = Math.max(0, Math.min(Math.floor(budget / (ask * 100)), Number(cfg.max_contracts)));
        if (qty === 0) blocked = "insufficient_capital";
      }

      await sb.from("signals").insert({
        strategist_id: stratId, signal_type: "EMA-CROSS", underlying_price: spot,
        direction: signalDir, acted_on: !blocked, blocked_reason: blocked,
        rationale: { tf: TF, emaFast: EMA_FAST, emaSlow: EMA_SLOW, relVol: Number(relVol.toFixed(2)), atr: Number(atr.toFixed(2)), occ, ask, qty },
      });

      if (!blocked && qty > 0) {
        await order("buy", occ, qty, `ema_cross_${signalDir === "call" ? "up" : "down"}`);
      }
    }

    return Response.json({
      ok: true, dryRun: DRY_RUN, mode: fund.mode, spot, cross, relVol: Number(relVol.toFixed(2)),
      minutesToClose, holding: holding ? holding.symbol : null, freshBar, signalDir, blocked, guards,
    });
  } catch (e) {
    const msg = (e as Error).message;
    await journal("WARN", `paper-trader failed: ${msg}`);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
});
