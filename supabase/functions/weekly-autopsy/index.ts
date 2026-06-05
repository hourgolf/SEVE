// ⚑ WEEKLY-AUTOPSY VERSION: 2026-06-05c  (NAV-truth fix: the equity_snapshots read was capped
//   at PostgREST's 1000 rows (no pagination), so the curve truncated to the first ~2 days and
//   NAV-truth read flat/negative (06-05 showed -$218 vs the real +$6,402). Now paginates the
//   full week + reports intraday peak-to-trough maxDrawdown. Prior below.)
// ⚑ WEEKLY-AUTOPSY VERSION: 2026-06-05b  (regime ledger now carries SPY + QQQ per day, from
//   the daily digest's market/marketQQQ — pairs with daily-autopsy 2026-06-05a. Prior below.)
// ⚑ WEEKLY-AUTOPSY VERSION: 2026-06-05a  (first cut — condenses the week's daily_reports
//   into one weekly report: fund roll-up + per-channel weekly metrics + regime ledger +
//   EXIT-EFFICIENCY (MFE / "left on the table") + Stage-2 LLM synthesis, upserted to
//   weekly_reports. Mirrors engine/weekly-autopsy.ts; intrinsic-only MFE (from
//   underlying_bars — always present, no option_bars dependency).)
// ============================================================================
//  weekly-autopsy — the desk's end-of-WEEK report generator.
//
//  Reads the week's daily_reports (the Stage-1 digests already computed each day),
//  rolls them up, re-derives the EXIT-EFFICIENCY analysis from underlying_bars
//  (per-trade Max Favorable Excursion → capture ratio + "red trades that were green
//  runners"), feeds the weekly digest to Anthropic for the synthesis, and upserts
//  {digest, narrative, markdown} into weekly_reports.
//
//  Self-gating + idempotent (the two DST cron times fire it once):
//    • no body.weekEnd → only run Fri after 16:05 ET AND no report for this week_end.
//    • body.weekEnd    → explicit manual/backfill run (skips the gate).
//
//  DIAGNOSES only. Deploy: paste into the Supabase Edge Function editor (verify-JWT
//  OFF). Needs ANTHROPIC_API_KEY in edge secrets; SUPABASE_* auto-injected.
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-4-5";
const sb = createClient(SB_URL, SB_SERVICE);

const ET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const etDate = (ms: number): string => ET.format(new Date(ms));
const ET_HM = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
function etMinNow(): number { let h = 0, m = 0; for (const p of ET_HM.formatToParts(new Date())) { if (p.type === "hour") h = Number(p.value); else if (p.type === "minute") m = Number(p.value); } return (h === 24 ? 0 : h) * 60 + m; }
function etDow(): number { return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" })).getDay(); } // 0=Sun..5=Fri,6=Sat
const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const i = s.length >> 1; return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; };
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// deno-lint-ignore no-explicit-any
type Any = any;

async function buildWeekly(weekEnd: string): Promise<Any> {
  const { data: reps } = await sb.from("daily_reports").select("report_date,mode,digest").lte("report_date", weekEnd).order("report_date", { ascending: false }).limit(5);
  const rows = ((reps ?? []) as Any[]).reverse();
  if (!rows.length) throw new Error(`no daily_reports at/before ${weekEnd}`);
  const days: string[] = rows.map((r) => r.report_date);
  const mode = rows[rows.length - 1].mode ?? "paper";
  const digests: Any[] = rows.map((r) => r.digest);

  const regimeLedger = digests.flatMap((d: Any) => [
    d.market ? { date: d.date, instrument: "SPY", returnPct: d.market.returnPct, efficiency: d.market.efficiency, note: d.market.note } : null,
    d.marketQQQ ? { date: d.date, instrument: "QQQ", returnPct: d.marketQQQ.returnPct, efficiency: d.marketQQQ.efficiency, note: d.marketQQQ.note } : null,
  ].filter(Boolean));

  const byDayFund = digests.map((d) => ({ date: d.date, pnl: Math.round(d.fund.dayRealized), trades: d.fund.trades }));
  const realized = byDayFund.reduce((a, d) => a + d.pnl, 0);
  const totalTrades = digests.reduce((a, d) => a + d.fund.trades, 0);
  const bestDay = byDayFund.length ? byDayFund.reduce((b, d) => (d.pnl > b.pnl ? d : b)) : null;
  const worstDay = byDayFund.length ? byDayFund.reduce((b, d) => (d.pnl < b.pnl ? d : b)) : null;
  const startIso = new Date(Date.parse(`${days[0]}T00:00:00Z`) - 12 * 3600_000).toISOString();
  // PAGINATE — PostgREST caps at 1000 rows; ~480 snaps/day blew past it, truncating the
  // curve to the first ~2 days (NAV looked flat/negative). Read all + intraday max drawdown.
  const snapRows: Any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("equity_snapshots").select("net_liquidation,captured_at").is("strategist_id", null).gte("captured_at", startIso).order("captured_at", { ascending: true }).range(from, from + 999);
    const rows = (data ?? []) as Any[];
    snapRows.push(...rows);
    if (rows.length < 1000) break;
  }
  const byDayNav = new Map<string, number>();
  let peak = -Infinity, maxDrawdown = 0;
  for (const s of snapRows) { const d = etDate(Date.parse(s.captured_at)); if (!days.includes(d)) continue; const nav = Number(s.net_liquidation); byDayNav.set(d, nav); if (nav > peak) peak = nav; if (peak - nav > maxDrawdown) maxDrawdown = peak - nav; }
  const equityCurve = days.filter((d) => byDayNav.has(d)).map((d) => ({ date: d, nav: Math.round(byDayNav.get(d)!) }));
  const navDelta = equityCurve.length >= 2 ? Math.round(equityCurve[equityCurve.length - 1].nav - equityCurve[0].nav) : null;

  // slug→id + the week's closed positions (attribute MFE per channel by strategist_id)
  const { data: stratRows } = await sb.from("strategists").select("id,slug");
  const slugToId = new Map(((stratRows ?? []) as Any[]).map((r) => [r.slug, String(r.id)]));
  const { data: allPos } = await sb.from("positions").select("strategist_id,occ_symbol,opt_type,qty,avg_entry_price,realized_pnl,opened_at,closed_at").eq("status", "closed").gte("closed_at", `${days[0]}T00:00:00Z`).limit(5000);
  const weekPos = ((allPos ?? []) as Any[]).filter((p) => p.closed_at && days.includes(etDate(Date.parse(p.closed_at))));

  // intrinsic-MFE source: the week's underlying_bars (SPY+QQQ), indexed by symbol→day→{lo,hi}
  const { data: bars } = await sb.from("underlying_bars").select("symbol,ts,high,low").gte("ts", startIso).order("ts", { ascending: true }).limit(20000);
  const dayHL = new Map<string, { lo: number; hi: number }>(); // `${sym}|${date}` (RTH-agnostic; intraday extreme)
  for (const b of (bars ?? []) as Any[]) { const d = etDate(Date.parse(b.ts)); const k = `${b.symbol}|${d}`; const e = dayHL.get(k); const lo = Number(b.low), hi = Number(b.high); if (!e) dayHL.set(k, { lo, hi }); else { e.lo = Math.min(e.lo, lo); e.hi = Math.max(e.hi, hi); } }
  function mfe(occ: string, entry: number, day: string): number {
    const mm = /^([A-Z]+)(\d{6})([CP])(\d{8})$/.exec(occ); if (!mm) return entry;
    const sym = mm[1], isPut = mm[3] === "P", strike = Number(mm[4]) / 1000;
    const hl = dayHL.get(`${sym}|${day}`); if (!hl) return entry;
    const intrinsic = Math.max(0, isPut ? strike - hl.lo : hl.hi - strike);
    return Math.max(entry, intrinsic);
  }

  const slugs = [...new Set(digests.flatMap((d: Any) => d.channels.map((c: Any) => c.slug)))];
  const channels: Any[] = [];
  for (const slug of slugs) {
    const dayCh = digests.map((d: Any) => ({ date: d.date, ch: d.channels.find((c: Any) => c.slug === slug) })).filter((x) => x.ch);
    if (!dayCh.length) continue;
    const meta = dayCh[dayCh.length - 1].ch;
    const allTrades = dayCh.flatMap((x) => x.ch.trades.map((t: Any) => ({ ...t, date: x.date })));
    const wins = allTrades.filter((t: Any) => t.pnl > 0), losses = allTrades.filter((t: Any) => t.pnl <= 0);
    const exitReasons: Record<string, number> = {}; for (const x of dayCh) for (const [k, v] of Object.entries(x.ch.exitReasons)) exitReasons[k] = (exitReasons[k] ?? 0) + (v as number);
    const byDay = dayCh.map((x) => ({ date: x.date, pnl: Math.round(x.ch.metrics.realizedPnl), trades: x.ch.metrics.nTrades }));
    const flawDays: Record<string, { days: number; severity: string }> = {};
    for (const x of dayCh) for (const f of x.ch.flaws) { const e = flawDays[f.type] ?? { days: 0, severity: f.severity }; e.days++; flawDays[f.type] = e; }
    const recurringFlaws = Object.entries(flawDays).filter(([, v]) => v.days >= 2).map(([type, v]) => ({ type, days: v.days, severity: v.severity }));
    let mfeUpside = 0, captured = 0; let biggestRunner: Any = null;
    const chPos = weekPos.filter((p) => p.strategist_id === slugToId.get(slug));
    for (const p of chPos) {
      const day = etDate(Date.parse(p.closed_at)); const entry = Number(p.avg_entry_price), qty = Math.abs(Number(p.qty));
      const couldHave = Math.round((mfe(p.occ_symbol, entry, day) - entry) * qty * 100);
      const actual = Math.round(Number(p.realized_pnl ?? 0));
      if (couldHave > 0) { mfeUpside += couldHave; captured += Math.max(0, actual); }
      if (couldHave > 0 && (!biggestRunner || couldHave - actual > biggestRunner.couldHave - biggestRunner.actual)) biggestRunner = { occ: p.occ_symbol, actual, couldHave, date: day };
    }
    const captureRatio = mfeUpside > 0 ? Number((captured / mfeUpside).toFixed(2)) : 1;
    channels.push({
      slug, name: meta.name, mandate: meta.mandate, status: meta.status,
      metrics: { nTrades: allTrades.length, wins: wins.length, winRate: allTrades.length ? Number((wins.length / allTrades.length).toFixed(3)) : 0, realizedPnl: Math.round(allTrades.reduce((a: number, t: Any) => a + t.pnl, 0)), avgWin: Math.round(mean(wins.map((t: Any) => t.pnl))), avgLoss: Math.round(mean(losses.map((t: Any) => t.pnl))), avgR: Number(mean(allTrades.map((t: Any) => t.R)).toFixed(2)), medianHoldMin: Number(median(allTrades.map((t: Any) => t.holdMin)).toFixed(1)), bestTrade: Math.round(Math.max(0, ...allTrades.map((t: Any) => t.pnl))), worstTrade: Math.round(Math.min(0, ...allTrades.map((t: Any) => t.pnl))) },
      byDay, exitReasons, recurringFlaws,
      exitEfficiency: { trades: chPos.length, mfeUpside, captured, captureRatio, biggestRunner },
    });
  }
  const totalUpsideLeft = channels.reduce((a, c) => a + Math.max(0, c.exitEfficiency.mfeUpside - c.exitEfficiency.captured), 0);
  const worstCaptureChannels = channels.filter((c) => c.exitEfficiency.mfeUpside > 200).sort((a, b) => a.exitEfficiency.captureRatio - b.exitEfficiency.captureRatio).slice(0, 5).map((c) => ({ slug: c.slug, captureRatio: c.exitEfficiency.captureRatio, left: Math.round(c.exitEfficiency.mfeUpside - c.exitEfficiency.captured) }));
  const redThatRanGreen = channels.map((c) => c.exitEfficiency.biggestRunner ? { slug: c.slug, ...c.exitEfficiency.biggestRunner } : null).filter((x) => x && x.actual <= 0 && x.couldHave > 0).sort((a, b) => b.couldHave - a.couldHave).slice(0, 6);

  return { weekStart: days[0], weekEnd: days[days.length - 1], mode, days, fund: { realized, navDelta, maxDrawdown: Math.round(maxDrawdown), trades: totalTrades, winRate: totalTrades ? Number((digests.reduce((a, d) => a + d.fund.winRate * d.fund.trades, 0) / totalTrades).toFixed(3)) : 0, bestDay, worstDay, equityCurve }, regimeLedger, channels, exitEfficiency: { totalUpsideLeft, worstCaptureChannels, redThatRanGreen } };
}

function renderSkeleton(w: Any): string {
  const usd = (v: number) => (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(0);
  const L: string[] = [`# SEVE WEEKLY autopsy — ${w.weekStart} → ${w.weekEnd}  (${w.mode}, ${w.days.length} sessions)`];
  L.push(`\n**Fund:** realized ${usd(w.fund.realized)}${w.fund.navDelta != null ? ` · NAV-truth ${usd(w.fund.navDelta)}` : ""} · maxDD ${usd(-(w.fund.maxDrawdown ?? 0))} · ${w.fund.trades} trades · win ${(w.fund.winRate * 100).toFixed(0)}%`);
  if (w.fund.bestDay && w.fund.worstDay) L.push(`- best ${w.fund.bestDay.date} ${usd(w.fund.bestDay.pnl)} · worst ${w.fund.worstDay.date} ${usd(w.fund.worstDay.pnl)}`);
  L.push(`\n**Regime ledger:**`); for (const r of w.regimeLedger) L.push(`- ${r.date}: ${r.note} (${r.returnPct >= 0 ? "+" : ""}${r.returnPct.toFixed(2)}%, eff ${r.efficiency.toFixed(2)})`);
  L.push(`\n**Exit efficiency (left on the table):** total upside left ${usd(w.exitEfficiency.totalUpsideLeft)}`);
  for (const r of w.exitEfficiency.redThatRanGreen) L.push(`- ⤴ \`${r.slug}\` ${r.occ} (${r.date}): exited ${usd(r.actual)} but ran to ${usd(r.couldHave)} — red trade, green runner`);
  for (const c of w.exitEfficiency.worstCaptureChannels) L.push(`- 📉 \`${c.slug}\` captured ${(c.captureRatio * 100).toFixed(0)}% (${usd(c.left)} left)`);
  for (const c of w.channels) {
    const m = c.metrics; L.push(`\n## ${c.name} (\`${c.slug}\`) — ${c.status}`); L.push(`_${c.mandate}_`);
    if (!m.nTrades) { L.push(`- no trades this week`); continue; }
    L.push(`- trades **${m.nTrades}** · win **${(m.winRate * 100).toFixed(0)}%** · realized **${usd(m.realizedPnl)}** · avgWin ${usd(m.avgWin)}/avgLoss ${usd(m.avgLoss)} · avgR ${m.avgR.toFixed(2)} · median hold ${m.medianHoldMin}m`);
    L.push(`- best ${usd(m.bestTrade)}/worst ${usd(m.worstTrade)} · exits ${JSON.stringify(c.exitReasons)} · by day ${c.byDay.map((d: Any) => `${d.date.slice(5)} ${usd(d.pnl)}`).join(" · ")}`);
    L.push(`- exit capture **${(c.exitEfficiency.captureRatio * 100).toFixed(0)}%**${c.exitEfficiency.biggestRunner ? ` · biggest runner ${c.exitEfficiency.biggestRunner.occ}: ${usd(c.exitEfficiency.biggestRunner.actual)} of ${usd(c.exitEfficiency.biggestRunner.couldHave)}` : ""}`);
    if (c.recurringFlaws.length) for (const f of c.recurringFlaws) L.push(`- ⚑ **${f.type}** recurred ${f.days} days (${f.severity})`);
  }
  return L.join("\n");
}

const SYS = `You are SEVE's WEEKLY trading-desk autopsy analyst. You receive a deterministic weekly digest condensing a paper-trading week (the numbers are GROUND TRUTH — never recompute or invent, cite what's given).
Synthesize the WEEK: (1) the week's character (regime ledger + which channel edges showed up in which regime), (2) EXIT EFFICIENCY — where exits left money on the table (low capture ratio, red trades that were green runners) vs exited well; tie it to whether a channel's trail/stop is too tight or too loose for the regime; note the MFE is a best-case upper bound (peaks revert in chop, not fully capturable). (3) recurring flaws (same flaw multiple days = systemic). (4) per-channel weekly verdict.
Then KEY LEARNINGS (3-6 durable takeaways) and a RANKED list of concrete, falsifiable SUGGESTIONS. Distinguish STRATEGY flaws from SYSTEM/EXECUTION bugs. DIAGNOSE only — never auto-apply to live. Specific and concise.`;
const TOOL = { name: "emit_weekly", description: "Return the narrated weekly autopsy.", input_schema: { type: "object", required: ["weekSummary", "channels", "keyLearnings", "suggestions"], properties: { weekSummary: { type: "string" }, channels: { type: "array", items: { type: "object", required: ["slug", "verdict", "exitQuality", "note"], properties: { slug: { type: "string" }, verdict: { type: "string", enum: ["keep", "retune", "mute", "watch"] }, exitQuality: { type: "string" }, note: { type: "string" } } } }, keyLearnings: { type: "array", items: { type: "string" } }, suggestions: { type: "array", items: { type: "object", required: ["action", "rationale", "priority"], properties: { action: { type: "string" }, rationale: { type: "string" }, priority: { type: "string", enum: ["high", "med", "low"] } } } } } } };

async function narrate(digest: Any): Promise<Any | null> {
  if (!ANTHROPIC_KEY) return null;
  const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 4096, tools: [TOOL], tool_choice: { type: "tool", name: "emit_weekly" }, system: [{ type: "text", text: SYS, cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content: `Weekly digest:\n\n${JSON.stringify(digest)}` }] }) });
  if (!res.ok) { console.error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`); return null; }
  const j = await res.json();
  return (j.content ?? []).find((b: Any) => b.type === "tool_use")?.input ?? null;
}
function renderNarrative(n: Any): string {
  const L: string[] = ["", "─".repeat(60), "## LLM weekly synthesis", "", `**Week:** ${n.weekSummary}`];
  for (const c of (n.channels ?? [])) L.push(`\n### \`${c.slug}\` — **${c.verdict}**\n- exit quality: ${c.exitQuality}\n- ${c.note}`);
  L.push(`\n### Key learnings`); for (const k of (n.keyLearnings ?? [])) L.push(`- ${k}`);
  L.push(`\n### Ranked suggestions`); for (const s of (n.suggestions ?? [])) L.push(`- **[${s.priority}]** ${s.action} — _${s.rationale}_`);
  return L.join("\n");
}

Deno.serve(async (req) => {
  try {
    let weekEnd = "";
    try { weekEnd = (await req.json())?.weekEnd ?? ""; } catch { /* no body */ }
    if (!weekEnd) {
      // self-gate: only Fri after 16:05 ET, and only if no report for this week yet
      if (etDow() !== 5 || etMinNow() < 16 * 60 + 5) return Response.json({ ok: true, skipped: "not Friday after close" });
      weekEnd = etDate(Date.now());
      const { data: existing } = await sb.from("weekly_reports").select("week_end").eq("week_end", weekEnd).maybeSingle();
      if (existing) return Response.json({ ok: true, skipped: "already exists", weekEnd });
    }
    const digest = await buildWeekly(weekEnd);
    const narrative = await narrate(digest);
    const markdown = renderSkeleton(digest) + (narrative ? "\n" + renderNarrative(narrative) : "");
    const { error } = await sb.from("weekly_reports").upsert({ week_end: digest.weekEnd, week_start: digest.weekStart, mode: digest.mode, digest, narrative, markdown }, { onConflict: "week_end" });
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    return Response.json({ ok: true, weekEnd: digest.weekEnd, narrated: !!narrative });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
});
