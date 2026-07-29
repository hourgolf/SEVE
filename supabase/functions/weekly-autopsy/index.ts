// ⚑ WEEKLY-AUTOPSY VERSION: 2026-06-13d  (UNIFIED NAMING — the report now refers to every channel
//   by the operator's chosen display NAME (e.g. "BREAK(ALT)") everywhere a human reads it, never
//   the slug ("breakout-smart-entries"), which was the confusing two-name split. SYS prompt has an
//   OUTPUT NAMING rule; the rendered narrative + the exit lists resolve slug→name; the slug stays
//   the internal join key in channels[].slug only. Markdown channel header dropped the (slug)
//   parenthetical. Prior below.)
// ⚑ WEEKLY-AUTOPSY VERSION: 2026-07-28a  (ACCOUNT-CONGRUENT NAV — desk equity now aggregates
//   only fresh account-scoped snapshots from every configured paper account. Legacy account-null
//   snapshots and incomplete capture cohorts are never mixed into the weekly NAV curve.)
// ⚑ WEEKLY-AUTOPSY VERSION: 2026-06-13c  (EXIT-LOGGING TEMPORAL GUARD — the 2026-06-13b report
//   correctly read the data but cried "system bug: fix exit logging" because close_reason shipped
//   06-11 eve and 4/5 of the week predates it (06-12 = 34/34 stamped, prior days 0). The autopsy
//   had no notion of WHEN a feature shipped. FIX: the digest now self-calibrates an anchor =
//   earliest stamped exit in the table; each channel carries exitLogging.status ('ok'|'legacy'=
//   pre-feature NULLs, expected|'gap'=NULLs AFTER the feature = real regression) + a desk-wide
//   exitLoggingHealth{since,channelsWithGap}; SYS prompt flags a logging bug ONLY for status=
//   'gap'. Generalizes to any future mid-window feature ship — no magic date. Prior below.)
// ⚑ WEEKLY-AUTOPSY VERSION: 2026-06-13b  (DOCTRINE + ROSTER-AWARE rewrite — the prior report read
//   impressive but half-trap: it ranked channels by MFE "capture" (an inflated upper bound the
//   desk's research has repeatedly FALSIFIED), scolded SCALPERS for not capturing intraday peaks
//   (their fast-target exit is the design), made confident keep/mute verdicts off ONE chop week,
//   and recommended muting channels already benched. FIXES: (1) each channel carries `scalp` +
//   `liveStatus`; the capture leak board (worstCaptureChannels/totalUpsideLeft) EXCLUDES scalpers;
//   redThatRanGreen (genuine green→red giveback) stays all-channel = the one real exit signal.
//   (2) digest.roster (armed vs benched) so the LLM stops re-recommending the cull. (3) SYS prompt
//   now carries the DESK DOCTRINE (MFE is an upper bound, ride the convex tail, don't chase
//   capture, one week is noise, respect liveStatus). (4) dedup the LLM's channel list (killed the
//   06-12 "DUPLICATE-GUARD" rows). Body-only change; verify-JWT stays OFF. Prior below.)
// ⚑ WEEKLY-AUTOPSY VERSION: 2026-06-13a  (VERIFY-JWT OFF — RESOLVED 06-13. ROOT CAUSE: the 06-06
//   redeploy left this function's verify_jwt ON; its Friday cron passes a SERVICE_ROLE bearer
//   that the edge gateway then 401'd (daily-autopsy + paper-trader run verify-JWT OFF, so they
//   were spared — anon passes either way, service_role didn't). Result: 06-12's weekly never
//   generated (silent — the cron's net.http_post records "succeeded" on enqueue, not on the 401).
//   FIX: operator toggled verify_jwt OFF in the Supabase dashboard 06-13 (Edge Functions →
//   weekly-autopsy → Details); CONFIRMED via no-auth POST → 200 + get_edge_function verify_jwt:
//   false. The 06-08→06-12 report was BACKFILLED 06-13 via the {weekEnd} override (anon, 200).
//   ⚠ this function is paste-deployed — any FUTURE redeploy via the dashboard editor must keep
//   "Verify JWT" OFF or this bug returns. Prior below.)
// ⚑ WEEKLY-AUTOPSY VERSION: 2026-07-05a  (REGISTRY-AWARE: SYS gains the pre-registered-tests
//   guardrails — no recommendations that bypass docs/pre-registered-tests-2026-07.md; knows the
//   era-4/A6 timeline, the dark mechanisms, and the vb virtual fleet. Prior banner below.)
// ⚑ WEEKLY-AUTOPSY VERSION: 2026-06-05d  (the weekly synthesis now runs on OPUS (claude-opus-4-8)
//   — once a week, decision-driving, latency-insensitive, ~1.67x Sonnet cost = trivial; stronger
//   reasoning for the cross-day synthesis + ranked suggestions. Decoupled from the daily (still
//   Sonnet) via ANTHROPIC_MODEL_WEEKLY override; max_tokens 4096→8192 for Opus's room. Prior below.)
// ⚑ WEEKLY-AUTOPSY VERSION: 2026-06-05c  (NAV-truth fix: the equity_snapshots read was capped
//   at PostgREST's 1000 rows (no pagination), so the curve truncated to the first ~2 days and
//   NAV-truth read flat/negative (06-05 showed -$218 vs the real +$6,402). Now paginates the
//   full week + reports intraday peak-to-trough maxDrawdown. Prior below.)
// ⚑ WEEKLY-AUTOPSY VERSION: 2026-06-05b  (regime ledger now carries SPY + QQQ per day, from
//   the daily digest's market/marketQQQ — pairs with daily-autopsy 2026-06-05a. Prior below.)
// ⚑ WEEKLY-AUTOPSY VERSION: 2026-06-05a  (first cut — condenses the week's daily_reports
//   into one weekly report: fund roll-up + per-channel weekly metrics + regime ledger +
//   EXIT-EFFICIENCY (MFE / "left on the table") + Stage-2 LLM synthesis, upserted to
//   weekly_reports. THE CANONICAL WEEKLY GENERATOR (engine/weekly-autopsy.ts was
//   RETIRED 2026-06-13 → a thin read-only client of this fn); intrinsic-only MFE
//   (from underlying_bars — always present, no option_bars dependency).)
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
import {
  deriveAccountCongruentEquity,
  type AccountEquitySnapshot,
} from "../_shared/accountEquity.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
// The WEEKLY synthesis runs on Opus — once a week, decision-driving, latency-insensitive,
// so the ~1.67x cost over Sonnet is trivial and the stronger reasoning earns its keep on the
// cross-day/cross-channel synthesis + ranked suggestions. Decoupled from the daily's
// ANTHROPIC_MODEL (which stays Sonnet) via a weekly-specific override. (Daily = Sonnet.)
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL_WEEKLY") ?? "claude-opus-4-8";
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
  const { data: paperAccounts, error: accountError } = await sb.from("accounts")
    .select("id").eq("mode", "paper").order("id");
  if (accountError) throw new Error(`paper-account read failed: ${accountError.message}`);
  const paperAccountIds = ((paperAccounts ?? []) as { id: string }[]).map((row) => row.id);
  // PAGINATE — derive one desk series only from fresh, account-complete capture
  // cohorts. Unscoped legacy snapshots remain evidence but are never NAV authority.
  const snapRows: AccountEquitySnapshot[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("equity_snapshots")
      .select("account_id,net_liquidation,captured_at")
      .is("strategist_id", null)
      .in("account_id", paperAccountIds)
      .gte("captured_at", startIso)
      .order("captured_at", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`account-equity read failed: ${error.message}`);
    const rows = (data ?? []) as AccountEquitySnapshot[];
    snapRows.push(...rows);
    if (rows.length < 1000) break;
  }
  const accountEquity = deriveAccountCongruentEquity(snapRows, paperAccountIds, days);
  const equityCurve = accountEquity.daily;
  const navDelta = equityCurve.length >= 2 ? Math.round(equityCurve[equityCurve.length - 1].nav - equityCurve[0].nav) : null;
  const maxDrawdown = accountEquity.maxDrawdown;

  // slug→id + LIVE lifecycle status (so the report is roster-aware: don't recommend
  // muting a channel that's already benched, and frame verdicts against today's roster
  // not the status frozen into last week's daily digests).
  const { data: stratRows } = await sb.from("strategists").select("id,slug,status");
  const slugToId = new Map(((stratRows ?? []) as Any[]).map((r) => [r.slug, String(r.id)]));
  const liveStatusBySlug = new Map(((stratRows ?? []) as Any[]).map((r) => [r.slug, String(r.status ?? "armed")]));
  const { data: allPos } = await sb.from("positions").select("strategist_id,occ_symbol,opt_type,qty,avg_entry_price,realized_pnl,opened_at,closed_at,close_reason").eq("status", "closed").gte("closed_at", `${days[0]}T00:00:00Z`).limit(5000);
  const weekPos = ((allPos ?? []) as Any[]).filter((p) => p.closed_at && days.includes(etDate(Date.parse(p.closed_at))));

  // close_reason TEMPORAL GUARD (so the report never again misreads pre-instrumentation
  // history as a live "logging bug" — the 06-12 false alarm). Anchor = the EARLIEST stamped
  // exit anywhere in the table (self-calibrating, no magic date). A NULL exit BEFORE this is
  // legacy/pre-feature (not a bug); a NULL AFTER it is a genuine logging GAP worth flagging.
  const { data: firstStamp } = await sb.from("positions").select("closed_at").not("close_reason", "is", null).neq("close_reason", "").order("closed_at", { ascending: true }).limit(1).maybeSingle();
  const closeReasonSince = (firstStamp as Any)?.closed_at ? Date.parse((firstStamp as Any).closed_at) : null;

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
    // Exit-logging health (temporal guard): split this channel's NULL-reason closes into
    // legacy (closed before close_reason went live = expected) vs gap (closed AFTER = a real
    // logging regression). status 'gap' is the only one the LLM should call a SYSTEM bug.
    const nullCloses = chPos.filter((p) => !p.close_reason);
    const gapNull = closeReasonSince == null ? 0 : nullCloses.filter((p) => Date.parse(p.closed_at) >= closeReasonSince).length;
    const exitLogging = { status: gapNull > 0 ? "gap" : nullCloses.length ? "legacy" : "ok", gapNull, legacyNull: nullCloses.length - gapNull, total: chPos.length };
    const medHold = Number(median(allTrades.map((t: Any) => t.holdMin)).toFixed(1));
    // SCALP flag: a fast fixed-target / curfew exit by DESIGN — capture-vs-intrinsic-peak
    // is a meaningless grade for these (the mandate never aims at the peak). Detected by
    // sub-5-min median hold or an explicit scalp/grind mandate; excluded from the capture
    // leak board below so the "$ left on the table" headline stops being scalper noise.
    const scalp = medHold < 5 || /scalp|grind/i.test(String(meta.mandate ?? ""));
    channels.push({
      slug, name: meta.name, mandate: meta.mandate, status: meta.status,
      liveStatus: liveStatusBySlug.get(slug) ?? meta.status, scalp, exitLogging,
      metrics: { nTrades: allTrades.length, wins: wins.length, winRate: allTrades.length ? Number((wins.length / allTrades.length).toFixed(3)) : 0, realizedPnl: Math.round(allTrades.reduce((a: number, t: Any) => a + t.pnl, 0)), avgWin: Math.round(mean(wins.map((t: Any) => t.pnl))), avgLoss: Math.round(mean(losses.map((t: Any) => t.pnl))), avgR: Number(mean(allTrades.map((t: Any) => t.R)).toFixed(2)), medianHoldMin: medHold, bestTrade: Math.round(Math.max(0, ...allTrades.map((t: Any) => t.pnl))), worstTrade: Math.round(Math.min(0, ...allTrades.map((t: Any) => t.pnl))) },
      byDay, exitReasons, recurringFlaws,
      exitEfficiency: { trades: chPos.length, mfeUpside, captured, captureRatio, biggestRunner },
    });
  }
  // Capture leak board EXCLUDES scalpers (their fast-target exit is the design, not a leak)
  // — this stops grind-* dominating a "$X left on the table" headline that's a mirage for
  // them. redThatRanGreen (the GENUINE giveback signal: a trade that went green then exited
  // RED) stays across all channels — that's a real exit failure regardless of mandate.
  const nonScalp = channels.filter((c) => !c.scalp);
  const totalUpsideLeft = nonScalp.reduce((a, c) => a + Math.max(0, c.exitEfficiency.mfeUpside - c.exitEfficiency.captured), 0);
  const worstCaptureChannels = nonScalp.filter((c) => c.exitEfficiency.mfeUpside > 200).sort((a, b) => a.exitEfficiency.captureRatio - b.exitEfficiency.captureRatio).slice(0, 5).map((c) => ({ slug: c.slug, captureRatio: c.exitEfficiency.captureRatio, left: Math.round(c.exitEfficiency.mfeUpside - c.exitEfficiency.captured) }));
  const redThatRanGreen = channels.map((c) => c.exitEfficiency.biggestRunner ? { slug: c.slug, scalp: c.scalp, ...c.exitEfficiency.biggestRunner } : null).filter((x) => x && x.actual <= 0 && x.couldHave > 0).sort((a, b) => b.couldHave - a.couldHave).slice(0, 6);
  const roster = { armed: [...liveStatusBySlug.entries()].filter(([, s]) => s === "armed").map(([sl]) => sl), benched: [...liveStatusBySlug.entries()].filter(([, s]) => s !== "armed").map(([sl]) => sl) };
  // Desk-wide exit-logging health: close_reason live-since date + the channels (if any) with
  // POST-feature NULL closes (the only real "logging bug" signal; legacy NULLs are expected).
  const exitLoggingHealth = { since: closeReasonSince ? etDate(closeReasonSince) : null, channelsWithGap: channels.filter((c) => c.exitLogging.status === "gap").map((c) => ({ slug: c.slug, gapNull: c.exitLogging.gapNull })) };

  return { weekStart: days[0], weekEnd: days[days.length - 1], mode, days, roster, exitLoggingHealth, fund: { realized, navDelta, maxDrawdown: Math.round(maxDrawdown), trades: totalTrades, winRate: totalTrades ? Number((digests.reduce((a, d) => a + d.fund.winRate * d.fund.trades, 0) / totalTrades).toFixed(3)) : 0, bestDay, worstDay, equityCurve }, regimeLedger, channels, exitEfficiency: { totalUpsideLeft, worstCaptureChannels, redThatRanGreen } };
}

function renderSkeleton(w: Any): string {
  const usd = (v: number) => (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(0);
  // Channels are referenced by the operator's chosen NAME everywhere a human reads them;
  // the slug stays an internal key. nm resolves slug→name for the exit lists below.
  const nm: Record<string, string> = Object.fromEntries(((w.channels ?? []) as Any[]).map((c) => [c.slug, c.name]));
  const L: string[] = [`# SEVE WEEKLY autopsy — ${w.weekStart} → ${w.weekEnd}  (${w.mode}, ${w.days.length} sessions)`];
  L.push(`\n**Fund:** realized ${usd(w.fund.realized)}${w.fund.navDelta != null ? ` · NAV-truth ${usd(w.fund.navDelta)}` : ""} · maxDD ${usd(-(w.fund.maxDrawdown ?? 0))} · ${w.fund.trades} trades · win ${(w.fund.winRate * 100).toFixed(0)}%`);
  if (w.fund.bestDay && w.fund.worstDay) L.push(`- best ${w.fund.bestDay.date} ${usd(w.fund.bestDay.pnl)} · worst ${w.fund.worstDay.date} ${usd(w.fund.worstDay.pnl)}`);
  L.push(`\n**Regime ledger:**`); for (const r of w.regimeLedger) L.push(`- ${r.date}: ${r.note} (${r.returnPct >= 0 ? "+" : ""}${r.returnPct.toFixed(2)}%, eff ${r.efficiency.toFixed(2)})`);
  L.push(`\n**Exit efficiency** — green→red givebacks (the real signal) + upper-bound capture, scalpers excluded; non-scalp upside left ${usd(w.exitEfficiency.totalUpsideLeft)}`);
  for (const r of w.exitEfficiency.redThatRanGreen) L.push(`- ⤴ ${nm[r.slug] ?? r.slug} ${r.occ} (${r.date}): exited ${usd(r.actual)} but ran to ${usd(r.couldHave)} — red trade, green runner`);
  for (const c of w.exitEfficiency.worstCaptureChannels) L.push(`- 📉 ${nm[c.slug] ?? c.slug} captured ${(c.captureRatio * 100).toFixed(0)}% (${usd(c.left)} left)`);
  for (const c of w.channels) {
    const m = c.metrics; L.push(`\n## ${c.name} — ${c.status}`); L.push(`_${c.mandate}_`);
    if (!m.nTrades) { L.push(`- no trades this week`); continue; }
    L.push(`- trades **${m.nTrades}** · win **${(m.winRate * 100).toFixed(0)}%** · realized **${usd(m.realizedPnl)}** · avgWin ${usd(m.avgWin)}/avgLoss ${usd(m.avgLoss)} · avgR ${m.avgR.toFixed(2)} · median hold ${m.medianHoldMin}m`);
    L.push(`- best ${usd(m.bestTrade)}/worst ${usd(m.worstTrade)} · exits ${JSON.stringify(c.exitReasons)} · by day ${c.byDay.map((d: Any) => `${d.date.slice(5)} ${usd(d.pnl)}`).join(" · ")}`);
    L.push(`- exit capture **${(c.exitEfficiency.captureRatio * 100).toFixed(0)}%**${c.exitEfficiency.biggestRunner ? ` · biggest runner ${c.exitEfficiency.biggestRunner.occ}: ${usd(c.exitEfficiency.biggestRunner.actual)} of ${usd(c.exitEfficiency.biggestRunner.couldHave)}` : ""}`);
    if (c.recurringFlaws.length) for (const f of c.recurringFlaws) L.push(`- ⚑ **${f.type}** recurred ${f.days} days (${f.severity})`);
  }
  return L.join("\n");
}

const SYS = `You are SEVE's WEEKLY trading-desk autopsy analyst. You receive a deterministic weekly digest condensing a paper-trading week (the numbers are GROUND TRUTH — never recompute or invent, cite what's given).

DESK DOCTRINE — these are SETTLED findings from months of multi-window real-NBBO research. Apply them; do NOT re-derive or contradict them:
• MFE / "upside left on the table" is an INFLATED UPPER BOUND — intraday peaks revert and are NOT fully capturable, especially in chop. A low capture ratio is NOT a verdict by itself. The capture board (worstCaptureChannels / totalUpsideLeft) already EXCLUDES scalp-mandate channels (each channel carries a \`scalp\` flag) — never scold a scalper for low capture; its fast fixed-target exit IS the design.
• The desk deliberately RIDES the convex tail on its edge channels. "Tighten the target/trail to capture more" is a MECHANICAL MIRAGE that this desk has falsified repeatedly (it caps the tail and kills the edge). Do NOT recommend tighter exits to raise capture. The ONLY real exit signal is a GREEN→RED GIVEBACK: a trade that was meaningfully in profit and still exited red (see redThatRanGreen) — call those out specifically; everything else labeled "leak" is regime noise.
• ONE WEEK IS NOISE for ranking the marginal channels — they scramble across regimes. Frame per-channel notes as "THIS WEEK'S EXPRESSION," not a durable verdict. Use verdict='mute' ONLY for a channel already failing on multi-window/live evidence, and NEVER recommend muting/cutting a channel whose \`liveStatus\` is already 'draft' or 'disabled' — it is ALREADY BENCHED; note that instead of re-recommending it. Respect digest.roster (armed vs benched) — your audience already culled the benched set.

• EXIT-LOGGING is TEMPORALLY GUARDED — do NOT call 'unknown'/NULL exit reasons a logging bug on your own. Trust the digest: each channel carries \`exitLogging.status\` ('ok' | 'legacy' = NULLs predate the close_reason feature, EXPECTED, NOT a bug | 'gap' = NULLs recorded AFTER the feature went live, a REAL regression). digest.exitLoggingHealth gives the live-since date + the channels with a genuine gap. Flag a SYSTEM logging bug ONLY for status='gap' channels; if every NULL is 'legacy', state plainly that exit logging is healthy and the blanks are pre-instrumentation history (the feature shipped mid-window) — never make it an engineering item.

REGISTRY GUARDRAILS (docs/pre-registered-tests-2026-07.md, embedded 2026-07-05): every gate/TP/stop/size/roster change on this desk is governed by PRE-REGISTERED decision rules (items A1–A10, C1, R1) whose thresholds were fixed before outcomes were visible. Era 4 = trades opened ≥ 2026-06-30; the A6 read (at 15 era-4 sessions, ~Jul 21) owns the LOCK verdicts (each channel judged against its OWN breakeven bar = stop/(tp+stop)), the C1 stack-cap arming, the A9 breakout(base) gap_min decision, the A10 ride-sizing rule, and the R1 runner A/B. NEVER suggest a config/knob/roster change that would bypass this — when the data motivates one, phrase the suggestion as "queue for the A6 read" or "needs a pre-registered item", never "change X now". DARK mechanisms exist in the worker (gap_min knob, stack_cap, runner tranche — all at config 0/off): do not describe them as armed or active. Channels slugged vb-* are VIRTUAL (signal-only drafts; their "trades" are replays) — hypothesis substrate, never evidence for arming.

Synthesize: (1) the week's character (regime ledger + which edges showed up in which regime); (2) GENUINE exit problems = green→red givebacks + asymmetric win/loss distributions (avgLoss ≫ avgWin even at high win-rate) — NOT capture-vs-peak; (3) recurring flaws (same flaw multiple days = systemic); (4) SYSTEM/EXECUTION bugs called out SEPARATELY from strategy — but for exit-logging obey the temporal guard above (legacy NULLs are NOT a bug); (5) per-channel weekly EXPRESSION with a verdict that respects liveStatus.
Then KEY LEARNINGS (3-6) and a RANKED list of concrete, falsifiable SUGGESTIONS that obey the doctrine. DIAGNOSE only — never auto-apply to live. Specific and concise.

OUTPUT NAMING: refer to every channel by its display \`name\` (the operator's chosen label, given per channel in the digest — e.g. "BREAK(ALT)", not "breakout-smart-entries") in ALL prose: weekSummary, every channel note, keyLearnings, and suggestions. The slug is an internal key — keep it ONLY in your channels[].slug output field (so the UI can match), never in prose.`;
const TOOL = { name: "emit_weekly", description: "Return the narrated weekly autopsy.", input_schema: { type: "object", required: ["weekSummary", "channels", "keyLearnings", "suggestions"], properties: { weekSummary: { type: "string" }, channels: { type: "array", items: { type: "object", required: ["slug", "verdict", "exitQuality", "note"], properties: { slug: { type: "string" }, verdict: { type: "string", enum: ["keep", "retune", "mute", "watch"] }, exitQuality: { type: "string" }, note: { type: "string" } } } }, keyLearnings: { type: "array", items: { type: "string" } }, suggestions: { type: "array", items: { type: "object", required: ["action", "rationale", "priority"], properties: { action: { type: "string" }, rationale: { type: "string" }, priority: { type: "string", enum: ["high", "med", "low"] } } } } } } };

async function narrate(digest: Any): Promise<Any | null> {
  if (!ANTHROPIC_KEY) return null;
  const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 8192, tools: [TOOL], tool_choice: { type: "tool", name: "emit_weekly" }, system: [{ type: "text", text: SYS, cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content: `Weekly digest:\n\n${JSON.stringify(digest)}` }] }) });
  if (!res.ok) { console.error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`); return null; }
  const j = await res.json();
  return (j.content ?? []).find((b: Any) => b.type === "tool_use")?.input ?? null;
}
function renderNarrative(n: Any, nameBySlug: Record<string, string>): string {
  const L: string[] = ["", "─".repeat(60), "## LLM weekly synthesis", "", `**Week:** ${n.weekSummary}`];
  for (const c of (n.channels ?? [])) L.push(`\n### ${nameBySlug[c.slug] ?? c.slug} — **${c.verdict}**\n- exit quality: ${c.exitQuality}\n- ${c.note}`);
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
    // Dedup the LLM's per-channel list by slug (it occasionally emits a channel twice —
    // the "DUPLICATE-GUARD" rows in the 06-12 run). Keep the first, drop repeats.
    if (narrative?.channels && Array.isArray(narrative.channels)) {
      const seen = new Set<string>();
      narrative.channels = narrative.channels.filter((c: Any) => c?.slug && !seen.has(c.slug) && (seen.add(c.slug), true));
    }
    const nameBySlug: Record<string, string> = Object.fromEntries(((digest.channels ?? []) as Any[]).map((c) => [c.slug, c.name]));
    const markdown = renderSkeleton(digest) + (narrative ? "\n" + renderNarrative(narrative, nameBySlug) : "");
    const { error } = await sb.from("weekly_reports").upsert({ week_end: digest.weekEnd, week_start: digest.weekStart, mode: digest.mode, digest, narrative, markdown }, { onConflict: "week_end" });
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    return Response.json({ ok: true, weekEnd: digest.weekEnd, narrated: !!narrative });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
});
