// iv-bank — nightly dealer-positioning snapshot from the desk's OWN Alpaca feed.
//
// WHY (registry-adjacent instrumentation, 2026-07-05): the conviction-sizing thread is
// CLOSED with an explicit reopening clause — "don't reopen without a new FEATURE
// (GEX/IV/gamma)". This banks that feature daily so the clock starts now: IV-rank needs
// months of IV history, and dealer-gamma context can't be reconstructed later (OI is
// published daily and overwritten). LOG-ONLY data — nothing live reads it.
//
// WHAT (per underlying SPY/QQQ/IWM, near-the-money surface: expiries ≤10d, strikes ±6%):
//   · snapshots (data API): impliedVolatility + greeks (gamma/delta) + NBBO
//   · contracts (trading API): open_interest (as-of open_interest_date)
//   → data/iv-bank/summary.jsonl   (one line per underlying-day: atm_iv, gex proxy, walls)
//   → data/iv-bank/detail/{day}-{sym}.json.gz  (the full joined per-strike surface)
//
// GEX PROXY (documented assumption): Σ gamma·OI·100·spot, calls +, puts − (the standard
// dealers-long-calls / short-puts convention). It is a PROXY for dealer positioning, not
// a measurement — treat splits on it as hypotheses, per the awareness-lever discipline.
// Empirical greeks only (Alpaca OPRA feed) — never Black-Scholes [[no-black-scholes]].
//
//   npm run iv-bank              # session days only (idempotent per day+underlying)
//   npm run iv-bank -- --force   # bank on a non-session day (testing)
//
// Runs nightly via capture-forward (tier 2). Backed up off-site by backup-archives.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { gzipSync } from "zlib";
import { join, resolve } from "path";
import { isTradingDay } from "../engine/market-calendar";

const UNDERLYINGS = (process.env.IV_BANK_SYMBOLS ?? "SPY,QQQ,IWM").split(",").map((s) => s.trim().toUpperCase());
const FORCE = process.argv.includes("--force");
const DATA_HOST = "https://data.alpaca.markets";
const PAPER_HOST = "https://paper-api.alpaca.markets";
const HDR = { "APCA-API-KEY-ID": process.env.ALPACA_KEY ?? "", "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET ?? "" };
const OUT_DIR = resolve(__dirname, "..", "data", "iv-bank");
const SUMMARY = join(OUT_DIR, "summary.jsonl");
const STRIKE_PCT = 0.06; // ±6% strike window
const EXP_DAYS = 10;     // expiries within 10 calendar days

const OCC_RE = /^([A-Z]+)(\d{6})([CP])(\d{8})$/;

function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function getJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: HDR, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`${r.status} ${url.slice(0, 120)}: ${(await r.text()).slice(0, 140)}`);
  return r.json();
}

interface Leg { occ: string; strike: number; cp: "C" | "P"; exp: string; iv: number | null; gamma: number | null; delta: number | null; bid: number; ask: number; oi: number | null; oiDate: string | null; }

async function bankOne(sym: string, day: string): Promise<void> {
  // ---- spot (last trade; fallback daily-bar close) ----
  const snap = await getJson(`${DATA_HOST}/v2/stocks/${sym}/snapshot?feed=sip`);
  const spot = Number(snap?.latestTrade?.p ?? snap?.dailyBar?.c ?? 0);
  if (!(spot > 0)) { console.log(`  iv-bank[${sym}]: no spot — skipped`); return; }
  const loK = Math.floor(spot * (1 - STRIKE_PCT)), hiK = Math.ceil(spot * (1 + STRIKE_PCT));
  const expLo = day;
  const expHi = new Date(Date.parse(`${day}T12:00:00Z`) + EXP_DAYS * 86400_000).toISOString().slice(0, 10);

  // ---- option snapshots (greeks + IV + NBBO), paged ----
  const legs = new Map<string, Leg>();
  let pageToken: string | null = null;
  for (let page = 0; page < 20; page++) {
    const url = `${DATA_HOST}/v1beta1/options/snapshots/${sym}?feed=opra&limit=1000` +
      `&expiration_date_gte=${expLo}&expiration_date_lte=${expHi}&strike_price_gte=${loK}&strike_price_lte=${hiK}` +
      (pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : "");
    const res = await getJson(url);
    for (const [occ, s] of Object.entries<any>(res?.snapshots ?? {})) {
      const m = occ.match(OCC_RE);
      if (!m) continue;
      const [, , yymmdd, cp, strk] = m;
      legs.set(occ, {
        occ, strike: Number(strk) / 1000, cp: cp as "C" | "P",
        exp: `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`,
        iv: s.impliedVolatility != null ? Number(s.impliedVolatility) : null,
        gamma: s.greeks?.gamma != null ? Number(s.greeks.gamma) : null,
        delta: s.greeks?.delta != null ? Number(s.greeks.delta) : null,
        bid: Number(s.latestQuote?.bp ?? 0), ask: Number(s.latestQuote?.ap ?? 0),
        oi: null, oiDate: null,
      });
    }
    pageToken = res?.next_page_token ?? null;
    if (!pageToken) break;
  }

  // ---- open interest (trading API contracts), paged ----
  pageToken = null;
  for (let page = 0; page < 20; page++) {
    const url = `${PAPER_HOST}/v2/options/contracts?underlying_symbols=${sym}&limit=1000` +
      `&expiration_date_gte=${expLo}&expiration_date_lte=${expHi}&strike_price_gte=${loK}&strike_price_lte=${hiK}` +
      (pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : "");
    const res = await getJson(url);
    for (const c of res?.option_contracts ?? []) {
      const leg = legs.get(c.symbol);
      if (leg) { leg.oi = c.open_interest != null ? Number(c.open_interest) : null; leg.oiDate = c.open_interest_date ?? null; }
    }
    pageToken = res?.next_page_token ?? null;
    if (!pageToken) break;
  }

  const rows = [...legs.values()];
  // ---- ATM IV: nearest strike, nearest expiry with IV present (avg of call+put) ----
  const withIv = rows.filter((l) => l.iv != null);
  withIv.sort((a, b) => (a.exp === b.exp ? Math.abs(a.strike - spot) - Math.abs(b.strike - spot) : a.exp < b.exp ? -1 : 1));
  const atmExp = withIv[0]?.exp ?? null;
  const atmLegs = withIv.filter((l) => l.exp === atmExp).slice(0, 4);
  const atmIv = atmLegs.length ? atmLegs.reduce((a, l) => a + l.iv!, 0) / atmLegs.length : null;

  // ---- GEX proxy + gamma walls (rows with BOTH gamma and OI) ----
  const gRows = rows.filter((l) => l.gamma != null && l.oi != null && l.oi > 0);
  let gex = 0;
  const byStrike = new Map<number, number>();
  for (const l of gRows) {
    const contrib = l.gamma! * l.oi! * 100 * spot * (l.cp === "C" ? 1 : -1);
    gex += contrib;
    byStrike.set(l.strike, (byStrike.get(l.strike) ?? 0) + contrib);
  }
  const walls = [...byStrike.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 5)
    .map(([strike, g]) => ({ strike, gex: Math.round(g) }));

  const summary = {
    day, sym, spot: Math.round(spot * 100) / 100,
    legs: rows.length, legs_with_iv: withIv.length, legs_with_gamma_oi: gRows.length,
    atm_exp: atmExp, atm_iv: atmIv != null ? Math.round(atmIv * 10000) / 10000 : null,
    gex_proxy: Math.round(gex), walls,
    banked_at: new Date().toISOString(), forced: FORCE || undefined,
  };
  appendFileSync(SUMMARY, JSON.stringify(summary) + "\n");
  writeFileSync(join(OUT_DIR, "detail", `${day}-${sym}.json.gz`), gzipSync(JSON.stringify(rows)));
  console.log(`  iv-bank[${sym}]: ${rows.length} legs (${gRows.length} w/ gamma+OI) · atm_iv ${summary.atm_iv ?? "—"} @ ${atmExp ?? "—"} · GEX ${summary.gex_proxy.toLocaleString()}`);
}

async function main() {
  if (!HDR["APCA-API-KEY-ID"]) { console.error("  iv-bank: no ALPACA_KEY in env — skipped"); process.exit(1); }
  const day = etToday();
  if (!isTradingDay(day) && !FORCE) { console.log(`  iv-bank: ${day} is not a session — skipped (use --force to test)`); return; }
  mkdirSync(join(OUT_DIR, "detail"), { recursive: true });
  const seen = existsSync(SUMMARY) ? new Set(readFileSync(SUMMARY, "utf8").trim().split("\n").filter(Boolean).map((l) => { const j = JSON.parse(l); return `${j.day}:${j.sym}`; })) : new Set<string>();
  for (const sym of UNDERLYINGS) {
    if (seen.has(`${day}:${sym}`)) { console.log(`  iv-bank[${sym}]: already banked ${day}`); continue; }
    try { await bankOne(sym, day); } catch (e) { console.error(`  iv-bank[${sym}]: FAILED — ${(e as Error).message}`); }
  }
}

main();
