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

const DATA = path.join(process.cwd(), "data");
const ERA4_START = "2026-06-30";
const A4_ARM = "2026-07-01";
const A13_BOUNDARY = "2026-07-09"; // momo-shape ratchet A/B — session 1
const FOMC = "2026-07-29";
const A6_TARGET = 15;
const GAP_MIN = 0.25; // % — validated spec gate (confirmed by the momo firing pattern)

// Human-anchored SPY level ladder. The briefing tracks price against these and flags
// when a new one should be added (a close beyond the range). Update by hand.
const LADDER: { px: number; label: string }[] = [
  { px: 752.4, label: "range top / breakout line" },
  { px: 748.5, label: "resistance shelf" },
  { px: 745.0, label: "fulcrum" },
  { px: 739.5, label: "near-arbiter (support)" },
  { px: 730.0, label: "lower shelf" },
  { px: 717.0, label: "macro shelf (era low)" },
];

// Channels muted as of the template date (config snapshot — verify vs DB).
const MUTED = new Set(["breakout-alt-v3-qqq", "breakout-smart-entries-qqq", "breakout-qqq"]);

type Rec = { date: string; channel: string; slug: string; sym: string; gap: number; pnl: number };
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
}
P();
P(`**Watch-list:**`);
if (date < A13_BOUNDARY) P(`- ⭐ **A13 ratchet goes live ${A13_BOUNDARY} open** — momo-shape (arm+50%/keep-⅔) vs momo-shape-2 control. Watch first \`trail_giveback\`; KILL = one genuine ≥120% tail the ratchet caps.`);
else P(`- ⭐ **A13 live** (ratcheted momo since ${A13_BOUNDARY}). Watch for the first genuine ≥120% tail the ratchet caps (KILL trip).`);
P(`- Confirm the SPY gap book arms only if it clears the band above — else it is correctly dark (don't re-make the coil-vs-gap read).`);
P();

// accrual
P(`## Gate / test accrual (as of ${date})`);
P(`- **A6** — ${era4.length} of ${A6_TARGET} era-4 sessions.`);
P(`- **A13** — ${date < A13_BOUNDARY ? `session 1 = ${A13_BOUNDARY} (0 ratcheted trades yet)` : `live since ${A13_BOUNDARY}`}.`);
P(`- **A4** — ${a4.map((x) => `${x.slug} ${x.n}t ${money(x.pnl)}`).join(" vs ")}.`);
P(`- **FOMC #6** — ${FOMC} (${fomcDays} days out).`);

console.log(O.join("\n"));
