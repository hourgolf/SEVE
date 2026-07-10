// ---------------------------------------------------------------------------
//  Desk briefing emitter — the deterministic 90% of the "desk sentinel".
//
//  Reads tonight's capture artifacts and prints the 3-artifact briefing
//  (COMPILE / UPDATE / CARRY-FORWARD) for a session. NO DB, NO network, NO
//  secrets — a pure function of data/forensics-dataset.jsonl + data/bars-archive
//  + data/gamma-open.json. The judgment 10% (expected-vs-anomalous prose, the
//  structural read, page-vs-quiet) is what the agent layer adds on top of this
//  factual skeleton. Spec + baseline: docs/desk-briefing-template.md.
//  Taxonomy: memory/channel-book-taxonomy.md.
//
//    npm run desk-briefing            # latest session in the forensics
//    npm run desk-briefing 2026-07-08 # a specific session
// ---------------------------------------------------------------------------
import fs from "fs";
import path from "path";
import { dayTags, upcomingEvents } from "../engine/market-events";
import { nextTradingDay, isEarlyClose } from "../engine/market-calendar";

const DATA = path.join(process.cwd(), "data");
const ERA4_START = "2026-06-30";
const A4_ARM = "2026-07-01";
const A13_BOUNDARY = "2026-07-09"; // momo-shape ratchet A/B — session 1
const FOMC = "2026-07-29";
const A6_TARGET = 15;
const GAP_MIN = 0.25; // % — validated spec gate (confirmed by the momo firing pattern)

// ---- auto S/R levels: swing pivots + prior-day OHLC + round numbers + dealer gamma walls ----
// Replaces the old hand-anchored ladder. Pure — reads bars-archive; gamma walls come from iv-bank.
// (function declarations → hoisted; they call rth/r2 at run time, after those are initialized.)
function recentDailyOHLC(sym: string, upto: string, n: number) {
  const dir = path.join(DATA, "bars-archive", sym);
  if (!fs.existsSync(dir)) return [] as { d: string; o: number; h: number; l: number; c: number }[];
  const days = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f.slice(0, 10) <= upto).map((f) => f.slice(0, 10)).sort().slice(-n);
  const out: { d: string; o: number; h: number; l: number; c: number }[] = [];
  for (const d of days) { const o = rth(d); if (o) out.push({ d, ...o }); }
  return out;
}
function computeLevels(sym: string, upto: string, spot: number, walls: { strike: number; gex: number }[]) {
  const hist = recentDailyOHLC(sym, upto, 25);
  const raw: { px: number; label: string; w: number }[] = [];
  const add = (px: number, label: string, w = 1) => { if (Number.isFinite(px)) raw.push({ px: r2(px), label, w }); };
  if (hist.length) {
    const prev = hist[hist.length - 1]; // the reference day = prior day for the NEXT open
    add(prev.h, "PDH", 2); add(prev.l, "PDL", 2); add(prev.c, "PDC", 1);
    for (let i = 2; i < hist.length - 2; i++) { // swing pivots (±2-day window)
      const w5 = hist.slice(i - 2, i + 3);
      if (hist[i].h === Math.max(...w5.map((x) => x.h))) add(hist[i].h, "swing-hi", 2);
      if (hist[i].l === Math.min(...w5.map((x) => x.l))) add(hist[i].l, "swing-lo", 2);
    }
    add(Math.max(...hist.map((x) => x.h)), `${hist.length}d-hi`, 1);
    add(Math.min(...hist.map((x) => x.l)), `${hist.length}d-lo`, 1);
  }
  for (let r = Math.ceil((spot * 0.985) / 5) * 5; r <= spot * 1.015; r += 5) add(r, "round", 1); // $5 grid ±1.5%
  for (const w of [...walls].sort((a, b) => Math.abs(b.gex) - Math.abs(a.gex)).slice(0, 3)) add(w.strike, "γ-wall", 2);
  raw.sort((a, b) => a.px - b.px); // cluster confluent levels within ~0.12%
  const tol = spot * 0.0012;
  const cl: { px: number; labels: Set<string>; w: number }[] = [];
  for (const lv of raw) {
    const c = cl[cl.length - 1];
    if (c && lv.px - c.px <= tol) { c.px = r2((c.px * c.w + lv.px * lv.w) / (c.w + lv.w)); c.labels.add(lv.label); c.w += lv.w; }
    else cl.push({ px: lv.px, labels: new Set([lv.label]), w: lv.w });
  }
  return cl.map((c) => ({ px: r2(c.px), label: [...c.labels].join("+"), w: c.w }));
}
// ---- IV / dealer positioning (iv-bank summary.jsonl + gamma-open implied move; both local) ----
type IVRow = { sym: string; day: string; spot: number; atm_iv: number; gex_proxy: number; walls: { strike: number; gex: number }[] };
function loadIV(upto: string): Record<string, IVRow> {
  const f = path.join(DATA, "iv-bank", "summary.jsonl");
  const out: Record<string, IVRow> = {};
  if (!fs.existsSync(f)) return out;
  for (const l of fs.readFileSync(f, "utf8").trim().split("\n")) { const d = JSON.parse(l) as IVRow; if (d.day <= upto) out[d.sym] = d; }
  return out; // file is chronological → last write per sym on/before `upto` wins
}
function impliedMove(sym: string, upto: string): number | null {
  const f = path.join(DATA, "gamma-open.json");
  if (!fs.existsSync(f)) return null;
  const g = JSON.parse(fs.readFileSync(f, "utf8")) as Record<string, { impliedMovePct?: number }>;
  const keys = Object.keys(g).filter((k) => k.startsWith(sym + "|") && k.split("|")[1] <= upto).sort();
  return keys.length ? (g[keys[keys.length - 1]].impliedMovePct ?? null) : null;
}

// Channels muted as of the template date (config snapshot — verify vs DB).
const MUTED = new Set(["breakout-alt-v3-qqq", "breakout-smart-entries-qqq", "breakout-qqq"]);

type Rec = { date: string; channel: string; slug: string; sym: string; gap: number; pnl: number; minutesToClose?: number };
type Book = "TREND" | "GAP" | "EXPANSION" | "NEITHER" | "OTHER";

const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => (n < 0 ? "−$" : "+$") + Math.abs(Math.round(n)).toLocaleString();
const pct = (n: number) => (n > 0 ? "+" : "") + n + "%";

function book(slug: string): Book {
  if (slug.startsWith("pb-ride") || slug.startsWith("power")) return "TREND";
  if (slug.startsWith("momo-shape")) return "GAP";
  if (slug.startsWith("grind") || slug.startsWith("fade")) return "NEITHER";
  if (slug.includes("alt-v3") || slug.includes("smart-entries")) return "GAP"; // V3/ALT
  if (slug.startsWith("breakout") || slug.startsWith("orb") || slug.includes("thrust")) return "EXPANSION";
  return "OTHER";
}

// ---- load ------------------------------------------------------------------
const all: Rec[] = fs.readFileSync(path.join(DATA, "forensics-dataset.jsonl"), "utf8")
  .trim().split("\n").map((l) => JSON.parse(l));
const dates = [...new Set(all.map((r) => r.date))].sort();
const date = process.argv[2] || dates[dates.length - 1];
const day = all.filter((r) => r.date === date);
if (!day.length) { console.error(`No trades for ${date}. Latest is ${dates[dates.length - 1]}.`); process.exit(1); }

// ---- gaps by symbol (session constant) ------------------------------------
const gap: Record<string, number> = {};
for (const sym of ["SPY", "QQQ", "IWM"]) { const r = day.find((x) => x.sym === sym); if (r) gap[sym] = r.gap; }
const spyGap = gap["SPY"];
const cleared = Number.isFinite(spyGap) && Math.abs(spyGap) >= GAP_MIN;

// ---- book attribution ------------------------------------------------------
type Line = { slug: string; n: number; pnl: number; muted: boolean };
const byChannel = new Map<string, Line>();
for (const r of day) {
  const c = byChannel.get(r.slug) ?? { slug: r.slug, n: 0, pnl: 0, muted: MUTED.has(r.slug) };
  c.n += 1; c.pnl += r.pnl; byChannel.set(r.slug, c);
}
const byBook = new Map<Book, Line[]>();
for (const l of byChannel.values()) { l.pnl = r2(l.pnl); (byBook.get(book(l.slug)) ?? byBook.set(book(l.slug), []).get(book(l.slug))!).push(l); }
const bookOrder: Book[] = ["TREND", "GAP", "EXPANSION", "NEITHER", "OTHER"];
const dayPnl = r2(day.reduce((s, r) => s + r.pnl, 0));

// ---- levels: SPY RTH OHLC --------------------------------------------------
function rth(d: string) {
  const f = path.join(DATA, "bars-archive", "SPY", `${d}.json`);
  if (!fs.existsSync(f)) return null;
  const bars = JSON.parse(fs.readFileSync(f, "utf8")) as any[];
  const b = bars.filter((x) => { const t = x.ts.slice(11, 16); return t >= "13:30" && t < "20:00"; });
  if (!b.length) return null;
  return { o: r2(b[0].open), h: r2(Math.max(...b.map((x) => x.high))), l: r2(Math.min(...b.map((x) => x.low))), c: r2(b[b.length - 1].close) };
}
const ohlc = rth(date);
const iv = loadIV(date);
// auto S/R ladder (replaces the hand-anchored one) — SPY, from bars-archive + SPY gamma walls
const LADDER = ohlc ? computeLevels("SPY", date, ohlc.c, iv["SPY"]?.walls ?? []) : [];

// ---- accrual ---------------------------------------------------------------
const era4 = dates.filter((d) => d >= ERA4_START && d <= date);
const a4 = ["orb-ustop", "orb-ustop-ctl"].map((slug) => {
  const rs = all.filter((r) => r.slug === slug && r.date >= A4_ARM && r.date <= date);
  return { slug, n: rs.length, pnl: r2(rs.reduce((s, r) => s + r.pnl, 0)) };
});
const fomcDays = Math.round((Date.parse(FOMC) - Date.parse(date)) / 86400000);

// ---- emit ------------------------------------------------------------------
const O: string[] = [];
const P = (s = "") => O.push(s);

P(`# Desk briefing — ${date}`);
P();
P(`**Day-type:** SPY gap **${pct(spyGap)}** → ${cleared ? `CLEARED ${GAP_MIN}% (gap book eligible)` : `below ${GAP_MIN}% (gap book dark by design)`}` +
  (Number.isFinite(gap["IWM"]) ? ` · IWM ${pct(gap["IWM"])} · QQQ ${pct(gap["QQQ"])}` : ""));
if (ohlc) P(`**SPY RTH:** O ${ohlc.o} · H ${ohlc.h} · L ${ohlc.l} · **C ${ohlc.c}**`);
P();

// ① COMPILE
P(`## ① COMPILE (${date}, closed) — day P&L ${money(dayPnl)}, ${day.length} trades`);
P();
P(`| Book | P&L | Channels |`);
P(`|---|---|---|`);
for (const b of bookOrder) {
  const ls = byBook.get(b); if (!ls) continue;
  const tot = r2(ls.reduce((s, l) => s + l.pnl, 0));
  const chans = ls.slice().sort((a, c) => a.pnl - c.pnl)
    .map((l) => `${l.slug}${l.muted ? "🔇" : ""} ${money(l.pnl)}`).join(" · ");
  P(`| **${b}** | ${money(tot)} | ${chans} |`);
}
P();

// mechanical anomaly flags
const flags: string[] = [];
const gapActive = (byBook.get("GAP") ?? []).filter((l) => !l.muted);
if (cleared && !gapActive.some((l) => l.slug.startsWith("momo-shape")))
  flags.push(`⚠ SPY gap cleared ${GAP_MIN}% but momo silent — verify (fail-closed bug / data hole?).`);
if (!cleared && (byBook.get("EXPANSION") ?? []).length)
  flags.push(`ℹ flat-open (<${GAP_MIN}%) + EXPANSION traded — ungated A9 exposure; any loss here is expected, not signal.`);
P(flags.length ? `**Flags:**` : `**Flags:** none — books behaved to design.`);
flags.forEach((f) => P(`- ${f}`));
P();

// ② UPDATE — ladder tests
P(`## ② UPDATE — what ${date} resolved`);
P();
if (ohlc) {
  const TOL = 0.25; // levels are approximate — a wick within a quarter-point counts as a test
  for (const lv of LADDER) {
    const tested = ohlc.l - TOL <= lv.px && lv.px <= ohlc.h + TOL;
    if (!tested) continue;
    const held = ohlc.c >= lv.px ? "held (close above)" : "rejected (close below)";
    P(`- **${lv.px}** ${lv.label} — tested (L ${ohlc.l} / H ${ohlc.h}) → ${held}, C ${ohlc.c}`);
  }
  const near = LADDER.reduce((a, b) => Math.abs(b.px - ohlc.c) < Math.abs(a.px - ohlc.c) ? b : a);
  P(`- Close **${ohlc.c}** sits at **${near.px} (${near.label})**.`);
}
const clearedDays = era4.filter((d) => { const r = all.find((x) => x.date === d && x.sym === "SPY"); return r && Math.abs(r.gap) >= GAP_MIN; });
P(`- Gap regime: **${clearedDays.length} of ${era4.length}** era-4 sessions cleared ${GAP_MIN}% (${clearedDays.join(", ") || "none"}).`);
P();

// ③ CARRY FORWARD
P(`## ③ CARRY FORWARD — next-open readiness`);
P();
if (ohlc) {
  const band = r2((ohlc.c * GAP_MIN) / 100);
  P(`- **GAP book (SPY):** arms IFF next open **≤ ${r2(ohlc.c - band)} or ≥ ${r2(ohlc.c + band)}** (±${GAP_MIN}% = ±$${band}). Below → puts, above → calls.`);
  P(`- **IWM / QQQ gap:** independent, on their own opens.`);
  P(`- **breakout-base:** fires on any 30-min range break — ungated (A9 exposure on a flat-open chop day).`);
  P(`- **pb-ride:** needs a ribbon-stacked trend off the open (its lane).`);
  const above = LADDER.filter((l) => l.px > ohlc.c).slice(0, 3);
  const below = LADDER.filter((l) => l.px < ohlc.c).slice(-3).reverse();
  const fmt = (l: { px: number; label: string }) => `${l.px} (${l.label})`;
  P(`- **Levels** (auto — pivots·PD·round·γ-walls): above ${above.map(fmt).join(" · ") || "—"} | below ${below.map(fmt).join(" · ") || "—"}`);
}
P();
P(`**Watch-list:**`);
if (date < A13_BOUNDARY) P(`- ⭐ **A13 ratchet goes live ${A13_BOUNDARY} open** — momo-shape (arm+50%/keep-⅔) vs momo-shape-2 control. Watch first \`trail_giveback\`; KILL = one genuine ≥120% tail the ratchet caps.`);
else P(`- ⭐ **A13 live** (ratcheted momo since ${A13_BOUNDARY}). Watch for the first genuine ≥120% tail the ratchet caps (KILL trip).`);
P(`- Confirm the SPY gap book arms only if it clears the band above — else it is correctly dark (don't re-make the coil-vs-gap read).`);
P();

// ---- EVENTS & CALENDAR (next session) ----
const nextDay = nextTradingDay(date);
const nTags = dayTags(nextDay);
P(`## EVENTS & CALENDAR`);
P();
if (nTags.length) {
  const notes: string[] = [];
  if (nTags.includes("fomc")) notes.push("FOMC 14:00 ET — auto stand-down 13:50→14:30");
  if (nTags.includes("opex")) notes.push("OPEX — pin risk on the 0DTE book");
  if (nTags.includes("cpi") || nTags.includes("nfp")) notes.push("08:30 ET pre-open print → gaps the open (gap-book fuel)");
  P(`- ⚠ **Next session ${nextDay}: ${nTags.map((t) => t.toUpperCase()).join(" + ")}** — ${notes.join("; ")}.`);
} else P(`- Next session **${nextDay}** — no scheduled macro event (CPI/NFP/OPEX/FOMC).`);
if (isEarlyClose(nextDay)) P(`- ⏰ **${nextDay} early close (13:00 ET)** — EOD flatten is wall-clock anchored.`);
const fomcs = upcomingEvents(date, 45).filter((e) => e.kind === "fomc");
if (fomcs.length) P(`- Next FOMC: **${fomcs[0].date}** (${Math.round((Date.parse(fomcs[0].date) - Date.parse(date)) / 86_400_000)}d out).`);
P();

// ---- DEALER POSITIONING (IV / GEX) ----
if (iv["SPY"]) {
  P(`## DEALER POSITIONING (IV / GEX — banked ${iv["SPY"].day})`);
  P();
  for (const sym of ["SPY", "QQQ", "IWM"]) {
    const s = iv[sym]; if (!s) continue;
    const short = s.gex_proxy < 0;
    const im = impliedMove(sym, date);
    const wallTxt = [...s.walls].sort((a, b) => Math.abs(b.gex) - Math.abs(a.gex)).slice(0, 3).map((w) => w.strike).join(" / ");
    P(`- **${sym}** — atm-IV **${(s.atm_iv * 100).toFixed(1)}%**${im != null ? ` · implied move ±${im.toFixed(2)}%` : ""} · GEX ${short ? "**−** short-gamma (moves amplify → breakout book)" : "**+** long-gamma (dampened → fade/scalp)"} · walls ${wallTxt}`);
  }
  P();
  P(`  *GEX sign is the read: − = dealers amplify, + = dealers pin. Descriptive context, not a trade signal.*`);
  P();
}

// ---- REGIME-CONDITIONED PRIORS (gap-state = the doctrine-primary regime axis) ----
P(`## REGIME-CONDITIONED PRIORS (era-4, gap-state split)`);
P();
P(`| Book | gap-day (≥${GAP_MIN}%) | flat-day (<${GAP_MIN}%) |`);
P(`|---|---|---|`);
const era4Recs = all.filter((r) => r.date >= ERA4_START && r.date <= date);
const statOf = (rs: Rec[]) => rs.length ? `${rs.length}t · ${money(r2(rs.reduce((s, r) => s + r.pnl, 0) / rs.length))}/t · ${Math.round((100 * rs.filter((r) => r.pnl > 0).length) / rs.length)}% win` : "—";
for (const b of bookOrder) {
  const bs = era4Recs.filter((r) => book(r.slug) === b);
  if (!bs.length) continue;
  P(`| **${b}** | ${statOf(bs.filter((r) => Math.abs(r.gap) >= GAP_MIN))} | ${statOf(bs.filter((r) => Math.abs(r.gap) < GAP_MIN))} |`);
}
P();
P(`  *Descriptive base rate, not a forecast — tomorrow's regime is unknown until the open. IF it gaps ≥${GAP_MIN}%, the gap-day column is the prior; IF flat, the flat column.*`);
P();

// ---- TRAP WINDOWS (descriptive: expectancy by entry time-of-day) ----
// minutesToClose → entry session-minute (390 = 9:30 open). Structural tendency across ALL sessions
// (time-of-day microstructure is era-stable); NOT an ex-ante "don't trade now" — chop can't be classified
// ahead of the fact (doctrine). For attention/sizing only.
const TBUCKETS: { lo: number; hi: number; label: string }[] = [
  { lo: 330, hi: 391, label: "09:30–10:30 · open" },
  { lo: 240, hi: 330, label: "10:30–12:00 · morning" },
  { lo: 150, hi: 240, label: "12:00–13:30 · midday" },
  { lo: 60, hi: 150, label: "13:30–15:00 · afternoon" },
  { lo: 0, hi: 60, label: "15:00–16:00 · close" },
];
const timed = all.filter((r) => typeof r.minutesToClose === "number");
P(`## TRAP WINDOWS (all sessions, expectancy by entry time — descriptive tendency, NOT a signal)`);
P();
P(`| Window | n | $/trade | win% |`);
P(`|---|---|---|---|`);
for (const b of TBUCKETS) {
  const rs = timed.filter((r) => (r.minutesToClose as number) >= b.lo && (r.minutesToClose as number) < b.hi);
  if (!rs.length) { P(`| ${b.label} | 0 | — | — |`); continue; }
  const avg = rs.reduce((s, r) => s + r.pnl, 0) / rs.length;
  const win = Math.round((100 * rs.filter((r) => r.pnl > 0).length) / rs.length);
  P(`| ${b.label}${avg < 0 ? " ⚠" : ""} | ${rs.length} | ${money(r2(avg))} | ${win}% |`);
}
P();
P(`  *⚠ = historically negative expectancy in that window. Descriptive base rate for attention/sizing only — never an ex-ante stand-down (chop can't be classified ahead of the fact — doctrine).*`);
P();

// accrual
P(`## Gate / test accrual (as of ${date})`);
P(`- **A6** — ${era4.length} of ${A6_TARGET} era-4 sessions.`);
P(`- **A13** — ${date < A13_BOUNDARY ? `session 1 = ${A13_BOUNDARY} (0 ratcheted trades yet)` : `live since ${A13_BOUNDARY}`}.`);
P(`- **A4** — ${a4.map((x) => `${x.slug} ${x.n}t ${money(x.pnl)}`).join(" vs ")}.`);
P(`- **FOMC #6** — ${FOMC} (${fomcDays} days out).`);

console.log(O.join("\n"));
