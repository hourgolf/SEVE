// Reporting v3: logical trades, immutable account routes, coherent sampled held marks.
// Historical implementation notes below are not the current metric contract.
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

import { loadHistoricalAttribution } from "../_shared/loadHistoricalAttribution.ts";
import { historicalDigest } from "../_shared/historicalReporting.ts";
import { historicalCoverageText } from "../_shared/historicalAttribution.ts";
import { REPORTING_SCHEMA, summarizePeakDiagnostics, validatedNarrative } from "../_shared/reportingEvidence.ts";
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
  const monday = new Date(weekEnd + "T12:00:00Z");
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  if (weekEnd >= "2026-06-01" && weekEnd < "2026-09-14") return historicalDigest(await loadHistoricalAttribution(sb), monday.toISOString().slice(0,10), weekEnd, "weekly");
  const { data: reps, error: dailyError } = await sb.from("daily_reports").select("report_date,mode,digest").eq("mode", "paper").gte("report_date", monday.toISOString().slice(0,10)).lte("report_date", weekEnd).order("report_date", { ascending: false }).limit(7);
  if (dailyError) throw new Error(dailyError.message);
  const rows = ((reps ?? []) as Any[]).reverse();
  if (!rows.length) throw new Error(`no daily_reports at/before ${weekEnd}`);
  const days: string[] = rows.map((r) => r.report_date);
  const mode = rows[rows.length - 1].mode ?? "paper";
  const digests: Any[] = rows.map((r) => r.digest);
  const nonLogicalDays = rows.filter((row) => row.digest?.evidence?.producerVersion !== REPORTING_SCHEMA || row.digest?.evidence?.unit !== "logical_trade"
    || row.digest?.evidence?.reconciliation !== "immutable_execution_routes");
  if (nonLogicalDays.length) {
    throw new Error(`weekly logical-trade evidence blocked; daily reports require regeneration: ${nonLogicalDays.map((row) => row.report_date).join(",")}`);
  }

  const regimeLedger = digests.flatMap((d: Any) => [
    d.market ? { date: d.date, instrument: "SPY", returnPct: d.market.returnPct, efficiency: d.market.efficiency, note: d.market.note } : null,
    d.marketQQQ ? { date: d.date, instrument: "QQQ", returnPct: d.marketQQQ.returnPct, efficiency: d.marketQQQ.efficiency, note: d.marketQQQ.note } : null,
  ].filter(Boolean));

  const byDayFund = digests.map((d) => ({ date: d.date, pnl: d.fund.dayRealized, trades: d.fund.trades }));
  const realized = digests.reduce((sum, d) => sum + d.fund.dayRealized, 0);
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
      .gte("captured_at", startIso).lt("captured_at", new Date(Date.parse(`${weekEnd}T12:00:00Z`) + 24 * 3600_000).toISOString())
      .order("captured_at", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`account-equity read failed: ${error.message}`);
    const rows = (data ?? []) as AccountEquitySnapshot[];
    snapRows.push(...rows);
    if (rows.length < 1000) break;
  }
  let navIssue: string | null = null;
  let accountEquity: ReturnType<typeof deriveAccountCongruentEquity> = { points: [], daily: [], maxDrawdown: 0 };
  try {
    accountEquity = deriveAccountCongruentEquity(snapRows.filter(row => days.includes(etDate(Date.parse(row.captured_at)))), paperAccountIds, days);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("account-complete equity snapshots missing")) throw error;
    navIssue = error.message;
  }
  const equityCurve = accountEquity.daily;
  const navDelta = accountEquity.points.length >= 2 ? Number((accountEquity.points.at(-1)!.nav - accountEquity.points[0].nav).toFixed(2)) : null;
  const maxDrawdown = navIssue || accountEquity.points.length < 2 ? null : accountEquity.maxDrawdown;

  const slugs = [...new Set(digests.flatMap((d: Any) => d.channels.map((c: Any) => c.slug)))];
  const channels: Any[] = [];
  for (const slug of slugs) {
    const dayCh = digests.map((d: Any) => ({ date: d.date, ch: d.channels.find((c: Any) => c.slug === slug) })).filter((x) => x.ch);
    if (!dayCh.length) continue;
    const meta = dayCh[dayCh.length - 1].ch;
    const allTrades = dayCh.flatMap((x) => x.ch.trades.map((t: Any) => ({ ...t, date: x.date })));
    const wins = allTrades.filter((t: Any) => t.pnl > 0), losses = allTrades.filter((t: Any) => t.pnl <= 0);
    const exitReasons: Record<string, number> = {}; for (const x of dayCh) for (const [k, v] of Object.entries(x.ch.exitReasons)) exitReasons[k] = (exitReasons[k] ?? 0) + (v as number);
    const byDay = dayCh.map((x) => ({ date: x.date, pnl: x.ch.metrics.realizedPnl, trades: x.ch.metrics.nTrades }));
    const flawDays: Record<string, { days: number; severity: string }> = {};
    for (const x of dayCh) for (const f of x.ch.flaws) { const e = flawDays[f.type] ?? { days: 0, severity: f.severity }; e.days++; flawDays[f.type] = e; }
    const recurringFlaws = Object.entries(flawDays).filter(([, v]) => v.days >= 2).map(([type, v]) => ({ type, days: v.days, severity: v.severity }));
    const peakDiagnostic = summarizePeakDiagnostics(allTrades.map((t: Any) => t.peakObservation));
    const mfeUpside = peakDiagnostic.denominatorUsd, captured = peakDiagnostic.numeratorUsd;
    const captureRatio = peakDiagnostic.retainedPct == null ? null : peakDiagnostic.retainedPct / 100;
    const provenance = allTrades.flatMap((t: Any) => t.exitProvenance ?? []);
    const missing = provenance.filter((p: Any) => p.source === "unavailable").length;
    const exitLogging = { status: missing ? "unknown" : "recorded", gapNull: missing, legacyNull: 0, total: provenance.length };
    const medHold = Number(median(allTrades.map((t: Any) => t.holdMin)).toFixed(1));
    // SCALP flag: a fast fixed-target / curfew exit by DESIGN — capture-vs-intrinsic-peak
    // is a meaningless grade for these (the mandate never aims at the peak). Detected by
    // sub-5-min median hold or an explicit scalp/grind mandate; excluded from the capture
    // leak board below so the "$ left on the table" headline stops being scalper noise.
    const scalp = medHold < 5 || /scalp|grind/i.test(String(meta.mandate ?? ""));
    channels.push({
      slug, name: meta.name, mandate: meta.mandate, status: meta.status,
      liveStatus: "unverified", scalp, exitLogging,
      metrics: { nTrades: allTrades.length, wins: wins.length, winRate: allTrades.length ? Number((wins.length / allTrades.length).toFixed(3)) : 0, realizedPnl: allTrades.reduce((a: number, t: Any) => a + t.pnl, 0), avgWin: Math.round(mean(wins.map((t: Any) => t.pnl))), avgLoss: Math.round(mean(losses.map((t: Any) => t.pnl))), avgR: Number(mean(allTrades.map((t: Any) => t.R)).toFixed(2)), medianHoldMin: medHold, bestTrade: Math.round(Math.max(...allTrades.map((t: Any) => t.pnl))), worstTrade: Math.round(Math.min(...allTrades.map((t: Any) => t.pnl))) },
      byDay, exitReasons, recurringFlaws,
      exitEfficiency: { unit: "logical_trade", mfeUpside, captured, captureRatio, biggestRunner: null, peakDiagnostic },
    });
  }
  // Different held windows cannot identify recoverable portfolio upside or manager superiority.
  const totalUpsideLeft = null, worstCaptureChannels: Any[] = [], redThatRanGreen: Any[] = [];
  const roster = { state: "unverified", armed: [], benched: [] };
  const exitLoggingHealth = { since: null, channelsWithGap: channels.filter(c => c.exitLogging.gapNull > 0).map(c => ({ slug: c.slug, gapNull: c.exitLogging.gapNull })) };

  return { weekStart: days[0], weekEnd: days[days.length - 1], mode, days, roster, exitLoggingHealth, fund: { realized, navDelta, maxDrawdown, trades: totalTrades, wins: channels.reduce((sum, c) => sum + c.metrics.wins, 0), winRate: totalTrades ? Number((channels.reduce((sum, c) => sum + c.metrics.wins, 0) / totalTrades).toFixed(3)) : 0, bestDay, worstDay, equityCurve }, regimeLedger, channels, exitEfficiency: { totalUpsideLeft, worstCaptureChannels, redThatRanGreen }, evidence: {
    requestedThrough: weekEnd, sessionCoverage: "published_daily_reports_only", navIssue, snapshotBounds: { from: accountEquity.points[0]?.capturedAt ?? null, through: accountEquity.points.at(-1)?.capturedAt ?? null }, schemaVersion: 3, producerVersion: REPORTING_SCHEMA, moneyUnit: "whole_position_usd_gross", sessionTimezone: "America/New_York", layer: "historical_executed", unit: "logical_trade", scope: "all_configured_paper_accounts",
    reconciliation: navIssue ? "immutable_execution_routes_nav_unavailable" : "immutable_execution_routes_plus_account_complete_nav", sourceDailyReports: days,
    exitEfficiencyUnit: "logical_trade", limitations: ["Only published daily reports are included; omitted sessions are not zero-trade sessions and calendar completeness is unverified.", "Sampled held marks are diagnostic only; common-horizon executable capture is unavailable. Current posture requires the live receipt-bound passport."]
  } };
}

function renderSkeleton(w: Any): string {
  const usd = (v: number | null | undefined) => v == null || !Number.isFinite(v) ? "unavailable" : (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(0);
  // Channels are referenced by the operator's chosen NAME everywhere a human reads them;
  // the slug stays an internal key. nm resolves slug→name for the exit lists below.
  const nm: Record<string, string> = Object.fromEntries(((w.channels ?? []) as Any[]).map((c) => [c.slug, c.name]));
  const historical = Boolean(w.evidence?.historicalAttribution);
  const L: string[] = [`# SEVE WEEKLY autopsy — ${w.weekStart} → ${w.weekEnd}  (${w.mode}, ${w.days.length} ${historical ? "observed close dates" : "reported sessions"})`];
  if (historical) L.push(`\n**Historical coverage:** ${historicalCoverageText(w.evidence.historicalAttribution)} Matched-trade economics only; zero-trade sessions and full-calendar coverage are unverified.`);
  L.push(`\n**Fund:** realized ${usd(w.fund.realized)}${w.fund.navDelta != null ? ` · NAV-truth ${usd(w.fund.navDelta)}` : ""} · maxDD ${w.fund.maxDrawdown == null ? "unknown" : usd(-w.fund.maxDrawdown)} · ${w.fund.trades} trades · win ${w.fund.winRate == null ? "unavailable" : (w.fund.winRate * 100).toFixed(0) + "%"}`);
  if (w.fund.bestDay && w.fund.worstDay) L.push(`- best ${w.fund.bestDay.date} ${usd(w.fund.bestDay.pnl)} · worst ${w.fund.worstDay.date} ${usd(w.fund.worstDay.pnl)}`);
  L.push(`\n**Regime ledger:**`); for (const r of w.regimeLedger) L.push(`- ${r.date}: ${r.note} (${r.returnPct >= 0 ? "+" : ""}${r.returnPct.toFixed(2)}%, eff ${r.efficiency.toFixed(2)})`);
  L.push("\n**Capture:** sampled held marks only; executable capture and recoverable portfolio upside are unavailable.");
  for (const r of w.exitEfficiency.redThatRanGreen) L.push(`- ⤴ ${nm[r.slug] ?? r.slug} ${r.occ} (${r.date}): exited ${usd(r.actual)} but ran to ${usd(r.couldHave)} — red trade, green runner`);
  for (const c of w.exitEfficiency.worstCaptureChannels) L.push(`- 📉 ${nm[c.slug] ?? c.slug} captured ${(c.captureRatio * 100).toFixed(0)}% (${usd(c.left)} left)`);
  for (const c of w.channels) {
    const m = c.metrics; L.push(`\n## ${c.name} — ${c.status}`); L.push(`_${c.mandate}_`);
    if (!m.nTrades) { L.push(`- no trades this week`); continue; }
    L.push(`- trades **${m.nTrades}** · win **${m.winRate == null ? "unavailable" : (m.winRate * 100).toFixed(0) + "%"}** · realized **${usd(m.realizedPnl)}** · avgWin ${usd(m.avgWin)}/avgLoss ${usd(m.avgLoss)} · avgR ${m.avgR == null ? "unavailable" : m.avgR.toFixed(2)} · median hold ${m.medianHoldMin == null ? "unavailable" : `${m.medianHoldMin}m`}`);
    L.push(`- best ${usd(m.bestTrade)}/worst ${usd(m.worstTrade)} · exits ${JSON.stringify(c.exitReasons)} · by day ${c.byDay.map((d: Any) => `${d.date.slice(5)} ${usd(d.pnl)}`).join(" · ")}`);
    L.push(`- exit capture **${(c.exitEfficiency.captureRatio == null ? "unknown" : `${(c.exitEfficiency.captureRatio * 100).toFixed(1)}%`)}**${c.exitEfficiency.biggestRunner ? ` · biggest runner ${c.exitEfficiency.biggestRunner.occ}: ${usd(c.exitEfficiency.biggestRunner.actual)} of ${usd(c.exitEfficiency.biggestRunner.couldHave)}` : ""}`);
    if (c.recurringFlaws.length) for (const f of c.recurringFlaws) L.push(`- ⚑ **${f.type}** recurred ${f.days} days (${f.severity})`);
  }
  return L.join("\n");
}

const SYS = `You are SEVE's weekly paper-trading evidence analyst. You receive a deterministic weekly digest. Explain the week's observed results and what they do or do not establish. Historical desk doctrine is a hypothesis record, not a prohibition on contrary evidence.
Synthesize the observed regimes, channel-specific entry/exit behavior, recurrent diagnostics, verified platform defects and the strongest uncertainty. Use this week's expression rather than an enduring verdict unless compatible multi-window evidence supports one. Keep full-window accounting and latest-configuration subsets explicitly separate. Do not call a recorded position-ledger result broker verified without its reconciliation.
Use the existing output schema for weekSummary, channels, keyLearnings and suggestions. A channel's keep/watch/retune/mute verdict is an analytical proposal, never execution authority. Do not recommend restricting a channel already non-trading when that current posture is actually verified. If current authority is not supplied, say it is unknown instead of equating legacy draft/disabled labels with the present roster. Suggestions may be empty when no action is supported.
EVIDENCE RULES: Cite the supplied figures with their actual date window, configuration scope and provenance. A deterministic calculation is recorded evidence, not independent certification of its inputs. Do not invent or recompute missing figures. Distinguish broker-account NAV, broker-matched fills, recorded position-ledger attribution, historically allocated P&L, executable paired counterfactuals and overlapping virtual/replay paths. Counts of fills, logical roots, runner legs, signals, arms and sessions are different units. Never add these evidence layers together. If reconciliation or provenance is absent, say so; do not imply an exact broker audit occurred.
CURRENT AUTHORITY: Do not infer evidence class, execution posture, evaluator, risk budget or enabled manager from a slug, name, legacy status, old narrative or historical preregistration. Some vb-* channels have actual paper executions. Current receipt-bound authority must be supplied to establish current posture; otherwise report it as unavailable. Historical execution and current posture are separate. A July instruction that a mechanism was off does not establish its current state. Do not infer whether an earlier sizing input survived a later quantity override.
UNDERLYING: Use explicit underlying or exact OCC root when supplied. Analyze SPY, QQQ and IWM against their own market data. A suffix alone cannot establish instrument identity. If the relevant underlying's market data is missing, state that limitation; never substitute SPY and call it the channel's observed regime.
EXIT AND ENTRY REASONING: Separate entry selection, delayed permission, contract/affordability, submitted/fill quantities and management. An unchanged persistent predicate can produce a later, more extended entry, but this is a hypothesis until timestamps and same-opportunity evidence support it. Stored MFE/peak capture is a diagnostic, not a tradable target or proof of bad exits. Green-to-red giveback is one diagnostic, not the only valid exit concern. A profitable early exit can still merit a paired native-stop-preserving test; a runner can also destroy a banked gain. Do not presume that tighter exits always help or always harm. Require channel-specific compatible pairs, quote timing/spread/depth, native triggers, chronological stability, tail checks and account displacement before a production-facing recommendation. Missing paths remain censored; overlapping path sums are not portfolio returns.
UNCERTAINTY: Separate observed facts, supported inference, hypotheses and missing evidence. Report each supplied deterministic flag and its scope, but do not promote a flag or old narrative into a proven cause. A legacy missing exit reason can be expected without proving all exit logging healthy. Absence of an observed signal, quote or peak is not proof of absence without collection coverage. State the strongest counterargument for each consequential recommendation. When evidence contradicts a historical desk conclusion, explain the conflict instead of enforcing the old conclusion. A single week cannot settle marginal channel expectancy.
CHANGE BOUNDARY: Diagnose only. Treat all size, stop, target, entry, roster, routing, capacity, quote-admission and infrastructure changes as unapproved proposals. Preserve native stops and existing-position management in every proposed comparison. Respect currently supplied preregistrations and their scope; if their current applicability is missing, request verification rather than assume an old review date remains the next decision gate. Never recommend automatic application or infer approval from profitable outcomes. No needless action is required merely to fill a quota.
OUTPUT NAMING: Use each channel's supplied display name in prose. Keep exact slugs only in machine-key fields required by the output schema. Do not invent names, evidence or missing authority.`;
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
    const history = await sb.from("reporting_publication_versions").select("id").limit(1);
    if (history.error) throw new Error("Version-preserving reporting migration is required before publication");
    const digest = await buildWeekly(weekEnd);
    const narrative = digest.evidence?.historicalAttribution ? null : validatedNarrative(await narrate(digest), "weekly");
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
