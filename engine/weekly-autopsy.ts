// ============================================================================
//  Weekly autopsy — condenses the week's daily autopsies into one report.
//
//  Reads the week's `daily_reports` (the Stage-1 digests already computed each
//  day) + re-derives the EXIT-EFFICIENCY / "left on the table" analysis from real
//  data, then rolls everything up per channel and across the fund, and (Stage 2)
//  asks the LLM for the week's key learnings + ranked suggestions.
//
//    npm run weekly-autopsy                 # the most recent ≤5 trading days
//    npm run weekly-autopsy -- --weekEnd 2026-06-05
//    npm run weekly-autopsy -- --json       # raw weekly digest only
//
//  EXIT EFFICIENCY (the headline new section): for every closed trade, the MAX
//  favorable option premium from entry → session close (MFE) → what a perfect exit
//  could have captured. captureRatio = actual ÷ best-available. Low ratio = exits
//  too tight (left money on the table on trend days); high ratio = exits timed well.
//  Source: real option_bars where present (exact), else intrinsic from the
//  underlying path (a conservative floor — good enough for the deep-ITM runners).
//
//  GROUND TRUTH = the numbers; the LLM explains + suggests, it never recomputes.
//  Diagnosis only — never auto-applies anything to live trading.
// ============================================================================

import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function loadEnv() {
  try { for (const line of readFileSync(".env.local", "utf8").split("\n")) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); } } catch { /* ignore */ }
}
const ET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const etDate = (ms: number): string => ET.format(new Date(ms));
const argStr = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// ---- daily digest shapes (what daily_reports.digest holds) -----------------
interface DayMarket { open: number; close: number; high: number; low: number; returnPct: number; rangePct: number; efficiency: number; note: string }
interface DayTrade { occ: string; dir: "call" | "put"; qty: number; entryPrice: number; exitPrice: number; pnl: number; holdMin: number; R: number; exitReason: string | null; signalType: string | null }
interface DayChannel { slug: string; name: string; mandate: string; status: string; metrics: { nTrades: number; wins: number; winRate: number; realizedPnl: number; avgWin: number; avgLoss: number; avgR: number; medianHoldMin: number }; exitReasons: Record<string, number>; flaws: { type: string; severity: string; evidence: string }[]; trades: DayTrade[] }
interface DayDigest { date: string; mode: string; market: DayMarket | null; marketQQQ?: DayMarket | null; fund: { dayRealized: number; trades: number; winRate: number; channelsTraded: number }; channels: DayChannel[] }

// ---- weekly shapes ---------------------------------------------------------
interface ChannelWeek {
  slug: string; name: string; mandate: string; status: string;
  metrics: { nTrades: number; wins: number; winRate: number; realizedPnl: number; avgWin: number; avgLoss: number; avgR: number; medianHoldMin: number; bestTrade: number; worstTrade: number };
  byDay: { date: string; pnl: number; trades: number }[];
  exitReasons: Record<string, number>;
  exitEfficiency: { trades: number; mfeUpside: number; captured: number; captureRatio: number; biggestRunner: { occ: string; actual: number; couldHave: number; date: string } | null };
  recurringFlaws: { type: string; days: number; severity: string }[];
}
interface WeeklyDigest {
  weekStart: string; weekEnd: string; mode: string; days: string[];
  fund: { realized: number; navDelta: number | null; maxDrawdown: number; trades: number; winRate: number; bestDay: { date: string; pnl: number } | null; worstDay: { date: string; pnl: number } | null; equityCurve: { date: string; nav: number }[] };
  regimeLedger: { date: string; instrument: string; returnPct: number; efficiency: number; note: string }[];
  channels: ChannelWeek[];
  exitEfficiency: { totalUpsideLeft: number; worstCaptureChannels: { slug: string; captureRatio: number; left: number }[]; redThatRanGreen: { slug: string; occ: string; date: string; actual: number; couldHave: number }[] };
}

// ---- MFE: how far each trade's option COULD have run (entry → session close) -
const MFE_SESSION_END_MIN = 16 * 60; // 16:00 ET
async function tradeMFE(sb: SupabaseClient, occ: string, openedMs: number, dayDate: string, entry: number): Promise<number> {
  // 1) real option_bars (exact). The OCC root carries the ticker; filter by it + day.
  const startIso = new Date(openedMs).toISOString();
  const endIso = new Date(Date.parse(`${dayDate}T21:00:00Z`)).toISOString(); // ~16:00 ET (covers DST either way at this coarseness)
  const { data: ob } = await sb.from("option_bars").select("high,close,ts").eq("occ_symbol", occ).gte("ts", startIso).lte("ts", endIso).order("ts", { ascending: true }).limit(500);
  if (ob && ob.length) { const peak = Math.max(...(ob as { high: number; close: number }[]).map((b) => Number(b.high ?? b.close ?? 0))); if (peak > 0) return Math.max(peak, entry); }
  // 2) fallback: intrinsic from the underlying path. Parse strike+type+ticker from the OCC.
  const mm = /^([A-Z]+)(\d{6})([CP])(\d{8})$/.exec(occ);
  if (!mm) return entry;
  const [, sym, , cp, strk] = mm; const strike = Number(strk) / 1000; const isPut = cp === "P";
  const { data: ub } = await sb.from("underlying_bars").select("low,high").eq("symbol", sym).gte("ts", startIso).lte("ts", endIso).limit(900);
  if (!ub || !ub.length) return entry;
  const ext = isPut ? Math.min(...(ub as { low: number }[]).map((b) => Number(b.low))) : Math.max(...(ub as { high: number }[]).map((b) => Number(b.high)));
  const intrinsic = Math.max(0, isPut ? strike - ext : ext - strike);
  return Math.max(entry, intrinsic); // conservative: peak premium ≥ peak intrinsic
}

async function buildWeekly(sb: SupabaseClient, weekEnd: string): Promise<WeeklyDigest> {
  // the week = the ≤5 most recent daily_reports at/<= weekEnd
  const { data: reps } = await sb.from("daily_reports").select("report_date,mode,digest").lte("report_date", weekEnd).order("report_date", { ascending: false }).limit(5);
  const rows = ((reps ?? []) as { report_date: string; mode: string; digest: DayDigest }[]).reverse();
  if (!rows.length) throw new Error(`no daily_reports at/before ${weekEnd} — run the daily autopsy first`);
  const days = rows.map((r) => r.report_date);
  const mode = rows[rows.length - 1].mode ?? "paper";
  const digests = rows.map((r) => r.digest);

  // ---- regime ledger (per day) ----
  const regimeLedger = digests.flatMap((d) => [
    d.market ? { date: d.date, instrument: "SPY", returnPct: d.market.returnPct, efficiency: d.market.efficiency, note: d.market.note } : null,
    d.marketQQQ ? { date: d.date, instrument: "QQQ", returnPct: d.marketQQQ.returnPct, efficiency: d.marketQQQ.efficiency, note: d.marketQQQ.note } : null,
  ].filter((x): x is { date: string; instrument: string; returnPct: number; efficiency: number; note: string } => !!x));

  // ---- fund weekly (realized + NAV-truth) ----
  const byDayFund = digests.map((d) => ({ date: d.date, pnl: Math.round(d.fund.dayRealized), trades: d.fund.trades }));
  const realized = byDayFund.reduce((a, d) => a + d.pnl, 0);
  const totalTrades = digests.reduce((a, d) => a + d.fund.trades, 0);
  const bestDay = byDayFund.length ? byDayFund.reduce((b, d) => (d.pnl > b.pnl ? d : b)) : null;
  const worstDay = byDayFund.length ? byDayFund.reduce((b, d) => (d.pnl < b.pnl ? d : b)) : null;
  // NAV-truth equity curve: last fund snapshot per ET day + intraday peak-to-trough
  // drawdown. PAGINATE — PostgREST caps at 1000 rows and ~480 snaps/day blows past it,
  // so a flat .limit() truncated the curve to the first ~2 days (NAV looked flat/negative).
  const startIso = new Date(Date.parse(`${days[0]}T00:00:00Z`) - 12 * 3600_000).toISOString();
  const snapRows: { net_liquidation: number; captured_at: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("equity_snapshots").select("net_liquidation,captured_at").is("strategist_id", null).gte("captured_at", startIso).order("captured_at", { ascending: true }).range(from, from + 999);
    const rows = (data ?? []) as { net_liquidation: number; captured_at: string }[];
    snapRows.push(...rows);
    if (rows.length < 1000) break;
  }
  const byDayNav = new Map<string, number>();
  let peak = -Infinity, maxDrawdown = 0;
  for (const s of snapRows) { const d = etDate(Date.parse(s.captured_at)); if (!days.includes(d)) continue; const nav = Number(s.net_liquidation); byDayNav.set(d, nav); if (nav > peak) peak = nav; if (peak - nav > maxDrawdown) maxDrawdown = peak - nav; }
  const equityCurve = days.filter((d) => byDayNav.has(d)).map((d) => ({ date: d, nav: Math.round(byDayNav.get(d)!) }));
  const navDelta = equityCurve.length >= 2 ? Math.round(equityCurve[equityCurve.length - 1].nav - equityCurve[0].nav) : null;

  // ---- per-channel roll-up (+ MFE) ----
  // slug → id + the week's closed positions ONCE, so MFE attributes per-channel by
  // strategist_id (NOT by OCC — two channels sharing an OCC must not double-count).
  const { data: stratRows } = await sb.from("strategists").select("id,slug");
  const slugToId = new Map(((stratRows ?? []) as { id: string; slug: string }[]).map((r) => [r.slug, String(r.id)]));
  const { data: allPos } = await sb.from("positions").select("strategist_id,occ_symbol,opt_type,qty,avg_entry_price,realized_pnl,opened_at,closed_at").eq("status", "closed").gte("closed_at", `${days[0]}T00:00:00Z`).limit(5000);
  const weekPos = ((allPos ?? []) as { strategist_id: string; occ_symbol: string; qty: number; avg_entry_price: number; realized_pnl: number; opened_at: string; closed_at: string }[]).filter((p) => p.closed_at && days.includes(etDate(Date.parse(p.closed_at))));
  const slugs = [...new Set(digests.flatMap((d) => d.channels.map((c) => c.slug)))];
  const channels: ChannelWeek[] = [];
  for (const slug of slugs) {
    const dayCh = digests.map((d) => ({ date: d.date, ch: d.channels.find((c) => c.slug === slug) })).filter((x) => x.ch);
    if (!dayCh.length) continue;
    const meta = dayCh[dayCh.length - 1].ch!;
    const allTrades = dayCh.flatMap((x) => x.ch!.trades.map((t) => ({ ...t, date: x.date })));
    const wins = allTrades.filter((t) => t.pnl > 0), losses = allTrades.filter((t) => t.pnl <= 0);
    const exitReasons: Record<string, number> = {}; for (const x of dayCh) for (const [k, v] of Object.entries(x.ch!.exitReasons)) exitReasons[k] = (exitReasons[k] ?? 0) + v;
    const byDay = dayCh.map((x) => ({ date: x.date, pnl: Math.round(x.ch!.metrics.realizedPnl), trades: x.ch!.metrics.nTrades }));
    // recurring flaws: same flaw type on ≥2 days
    const flawDays: Record<string, { days: number; severity: string }> = {};
    for (const x of dayCh) for (const f of x.ch!.flaws) { const e = flawDays[f.type] ?? { days: 0, severity: f.severity }; e.days++; flawDays[f.type] = e; }
    const recurringFlaws = Object.entries(flawDays).filter(([, v]) => v.days >= 2).map(([type, v]) => ({ type, days: v.days, severity: v.severity }));
    // exit efficiency: MFE per trade
    let mfeUpside = 0, captured = 0; let biggestRunner: ChannelWeek["exitEfficiency"]["biggestRunner"] = null;
    const chPos = weekPos.filter((p) => p.strategist_id === slugToId.get(slug)); // exact per-channel (by id)
    for (const p of chPos) {
      const openedMs = Date.parse(p.opened_at), day = etDate(Date.parse(p.closed_at));
      const entry = Number(p.avg_entry_price), qty = Math.abs(Number(p.qty));
      const mfe = await tradeMFE(sb, p.occ_symbol, openedMs, day, entry);
      const couldHave = Math.round((mfe - entry) * qty * 100);
      const actual = Math.round(Number(p.realized_pnl ?? 0));
      if (couldHave > 0) { mfeUpside += couldHave; captured += Math.max(0, actual); }
      if (couldHave > 0 && (!biggestRunner || couldHave - actual > biggestRunner.couldHave - biggestRunner.actual)) biggestRunner = { occ: p.occ_symbol, actual, couldHave, date: day };
    }
    const captureRatio = mfeUpside > 0 ? Number((captured / mfeUpside).toFixed(2)) : 1;
    channels.push({
      slug, name: meta.name, mandate: meta.mandate, status: meta.status,
      metrics: { nTrades: allTrades.length, wins: wins.length, winRate: allTrades.length ? Number((wins.length / allTrades.length).toFixed(3)) : 0, realizedPnl: Math.round(allTrades.reduce((a, t) => a + t.pnl, 0)), avgWin: Math.round(mean(wins.map((t) => t.pnl))), avgLoss: Math.round(mean(losses.map((t) => t.pnl))), avgR: Number(mean(allTrades.map((t) => t.R)).toFixed(2)), medianHoldMin: Number(median(allTrades.map((t) => t.holdMin)).toFixed(1)), bestTrade: Math.round(Math.max(0, ...allTrades.map((t) => t.pnl))), worstTrade: Math.round(Math.min(0, ...allTrades.map((t) => t.pnl))) },
      byDay, exitReasons, recurringFlaws,
      exitEfficiency: { trades: chPos.length, mfeUpside, captured, captureRatio, biggestRunner },
    });
  }

  // ---- fund-level exit efficiency ----
  const totalUpsideLeft = channels.reduce((a, c) => a + Math.max(0, c.exitEfficiency.mfeUpside - c.exitEfficiency.captured), 0);
  const worstCaptureChannels = channels.filter((c) => c.exitEfficiency.mfeUpside > 200).sort((a, b) => a.exitEfficiency.captureRatio - b.exitEfficiency.captureRatio).slice(0, 5).map((c) => ({ slug: c.slug, captureRatio: c.exitEfficiency.captureRatio, left: Math.round(c.exitEfficiency.mfeUpside - c.exitEfficiency.captured) }));
  const redThatRanGreen = channels.map((c) => c.exitEfficiency.biggestRunner ? { slug: c.slug, ...c.exitEfficiency.biggestRunner } : null).filter((x): x is NonNullable<typeof x> => !!x && x.actual <= 0 && x.couldHave > 0).sort((a, b) => b.couldHave - a.couldHave).slice(0, 6);

  return {
    weekStart: days[0], weekEnd: days[days.length - 1], mode, days,
    fund: { realized, navDelta, maxDrawdown: Math.round(maxDrawdown), trades: totalTrades, winRate: totalTrades ? Number((digests.reduce((a, d) => a + d.fund.winRate * d.fund.trades, 0) / totalTrades).toFixed(3)) : 0, bestDay, worstDay, equityCurve },
    regimeLedger, channels,
    exitEfficiency: { totalUpsideLeft, worstCaptureChannels, redThatRanGreen },
  };
}

// ---- deterministic markdown skeleton ---------------------------------------
function renderSkeleton(w: WeeklyDigest): string {
  const usd = (v: number) => (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(0);
  const L: string[] = [];
  L.push(`# SEVE WEEKLY autopsy — ${w.weekStart} → ${w.weekEnd}  (${w.mode}, ${w.days.length} sessions)`);
  L.push(`\n**Fund:** realized ${usd(w.fund.realized)}${w.fund.navDelta != null ? ` · NAV-truth ${usd(w.fund.navDelta)}` : ""} · maxDD ${usd(-w.fund.maxDrawdown)} · ${w.fund.trades} trades · win ${(w.fund.winRate * 100).toFixed(0)}%`);
  if (w.fund.bestDay && w.fund.worstDay) L.push(`- best day ${w.fund.bestDay.date} ${usd(w.fund.bestDay.pnl)} · worst ${w.fund.worstDay.date} ${usd(w.fund.worstDay.pnl)}`);
  L.push(`\n**Regime ledger:**`);
  for (const r of w.regimeLedger) L.push(`- ${r.date}: ${r.note} (${r.returnPct >= 0 ? "+" : ""}${r.returnPct.toFixed(2)}%, eff ${r.efficiency.toFixed(2)})`);
  L.push(`\n**Exit efficiency (left on the table):** total upside left unrealized ${usd(w.exitEfficiency.totalUpsideLeft)}`);
  for (const r of w.exitEfficiency.redThatRanGreen) L.push(`- ⤴ \`${r.slug}\` ${r.occ} (${r.date}): exited ${usd(r.actual)} but ran to ${usd(r.couldHave)} — a RED trade that was a green runner`);
  for (const c of w.exitEfficiency.worstCaptureChannels) L.push(`- 📉 \`${c.slug}\` captured only ${(c.captureRatio * 100).toFixed(0)}% of available move (${usd(c.left)} left)`);
  for (const c of w.channels) {
    const m = c.metrics;
    L.push(`\n## ${c.name} (\`${c.slug}\`) — ${c.status}`);
    L.push(`_${c.mandate}_`);
    if (!m.nTrades) { L.push(`- no trades this week`); continue; }
    L.push(`- trades **${m.nTrades}** · win **${(m.winRate * 100).toFixed(0)}%** · realized **${usd(m.realizedPnl)}** · avgWin ${usd(m.avgWin)}/avgLoss ${usd(m.avgLoss)} · avgR ${m.avgR.toFixed(2)} · median hold ${m.medianHoldMin}m`);
    L.push(`- best ${usd(m.bestTrade)} / worst ${usd(m.worstTrade)} · exits ${JSON.stringify(c.exitReasons)}`);
    L.push(`- by day: ${c.byDay.map((d) => `${d.date.slice(5)} ${usd(d.pnl)}`).join(" · ")}`);
    L.push(`- exit capture **${(c.exitEfficiency.captureRatio * 100).toFixed(0)}%** of available move${c.exitEfficiency.biggestRunner ? ` · biggest runner ${c.exitEfficiency.biggestRunner.occ}: got ${usd(c.exitEfficiency.biggestRunner.actual)} of ${usd(c.exitEfficiency.biggestRunner.couldHave)}` : ""}`);
    if (c.recurringFlaws.length) for (const f of c.recurringFlaws) L.push(`- ⚑ **${f.type}** recurred ${f.days} days (${f.severity})`);
  }
  return L.join("\n");
}

// ---- Stage 2: LLM weekly synthesis -----------------------------------------
const SYS = `You are SEVE's WEEKLY trading-desk autopsy analyst. You receive a deterministic weekly digest condensing a paper-trading week (the numbers are GROUND TRUTH — never recompute or invent, cite what's given).
Synthesize the WEEK, not single trades: (1) the week's character (regime ledger + which channel edges showed up in which regime), (2) EXIT EFFICIENCY — where exits left money on the table (low capture ratio, red trades that were green runners) vs exited well; tie this to whether a channel's trail/stop is too tight or too loose for the regime, (3) recurring flaws (same flaw multiple days = systemic, not noise), (4) per-channel weekly verdict (keep / retune / mute, with the evidence).
Then KEY LEARNINGS (3-6, the durable takeaways) and a RANKED list of concrete, falsifiable SUGGESTIONS (specific: 'tighten X's trail to k=0.75', 'mute Y — red 4/5 days, no regime it likes', 'add a chop gate to Z'). Distinguish STRATEGY flaws (thesis wrong for regime) from SYSTEM/EXECUTION bugs.
You DIAGNOSE only — never tell the operator to auto-apply to live trading. Specific and concise.`;
const TOOL = { name: "emit_weekly", description: "Return the narrated weekly autopsy.", input_schema: { type: "object", required: ["weekSummary", "channels", "keyLearnings", "suggestions"], properties: { weekSummary: { type: "string" }, channels: { type: "array", items: { type: "object", required: ["slug", "verdict", "exitQuality", "note"], properties: { slug: { type: "string" }, verdict: { type: "string", enum: ["keep", "retune", "mute", "watch"] }, exitQuality: { type: "string" }, note: { type: "string" } } } }, keyLearnings: { type: "array", items: { type: "string" } }, suggestions: { type: "array", items: { type: "object", required: ["action", "rationale", "priority"], properties: { action: { type: "string" }, rationale: { type: "string" }, priority: { type: "string", enum: ["high", "med", "low"] } } } } } } };

async function narrate(digest: WeeklyDigest): Promise<Record<string, unknown> | null> {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) return null;
  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";
  const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model, max_tokens: 4096, tools: [TOOL], tool_choice: { type: "tool", name: "emit_weekly" }, system: [{ type: "text", text: SYS, cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content: `Weekly digest:\n\n${JSON.stringify(digest)}` }] }) });
  if (!res.ok) { console.error(`  (LLM failed: ${res.status} ${(await res.text()).slice(0, 200)})`); return null; }
  const j = await res.json();
  return (j.content ?? []).find((b: { type: string }) => b.type === "tool_use")?.input ?? null;
}
function renderNarrative(n: Record<string, unknown>): string {
  const L: string[] = ["", "─".repeat(60), "## LLM weekly synthesis", "", `**Week:** ${n.weekSummary}`];
  for (const c of (n.channels as Record<string, unknown>[] ?? [])) L.push(`\n### \`${c.slug}\` — **${c.verdict}**\n- exit quality: ${c.exitQuality}\n- ${c.note}`);
  L.push(`\n### Key learnings`); for (const k of (n.keyLearnings as string[] ?? [])) L.push(`- ${k}`);
  L.push(`\n### Ranked suggestions`); for (const s of (n.suggestions as Record<string, unknown>[] ?? [])) L.push(`- **[${s.priority}]** ${s.action} — _${s.rationale}_`);
  return L.join("\n");
}

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY in .env.local");
  const sb = createClient(url, anon, { auth: { persistSession: false } });
  let weekEnd = argStr("weekEnd", "today"); if (weekEnd === "today") weekEnd = etDate(Date.now());
  const digest = await buildWeekly(sb, weekEnd);
  if (process.argv.includes("--json")) { console.log(JSON.stringify(digest, null, 2)); return; }
  console.log("\n" + renderSkeleton(digest));
  const n = await narrate(digest);
  if (n) console.log("\n" + renderNarrative(n));
  else console.log(`\n  (no ANTHROPIC_API_KEY locally — Stage-1 digest above is ground truth; the weekly-autopsy edge fn adds the LLM synthesis. Run with --json for the raw digest.)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
