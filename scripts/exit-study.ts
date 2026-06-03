// ============================================================================
//  exit-study — for a given ET date, compare MANUALLY-closed trades (closed via
//  the Alpaca app → recorded as "reconciled" exits) against how the channel's OWN
//  exit logic would have closed them. Answers: did the trigger finger cut winners
//  short, or did it save P&L the channel would have given back?
//
//  Read-only (anon). Replays each channel's evaluate() + the worker's premium
//  guards (premium −50% stop, power giveback trail, compiled profit/stop) on the
//  real underlying bars + the option's real per-minute mid path (option_quotes).
//  Both the manual exit and the strategy exit are priced off the SAME mid series,
//  so the comparison is apples-to-apples.
//
//  Run: npx tsx scripts/exit-study.ts [YYYY-MM-DD]
// ============================================================================

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { computeFeatures } from "../engine/engine";
import { getStrategy } from "../engine/registry";
import { specToStrategyDef, specPremiumExit } from "../engine/specEvaluate";
import type { Bar, Features, OptType, Position } from "../engine/types";
import type { StrategySpec } from "../lib/desk/strategySpec";

function loadEnv() { try { const t = readFileSync(".env.local", "utf8"); for (const l of t.split("\n")) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); } } catch { /* */ } }
loadEnv();
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });

const DAY = process.argv[2] || "2026-06-03";
const RTH_OPEN = 570, RTH_CLOSE = 960;
const POWER = new Set(["power", "power-smart-entries"]);

const ET = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
function etParts(ms: number) { const p: Record<string, string> = {}; for (const x of ET.formatToParts(new Date(ms))) p[x.type] = x.value; return { date: `${p.year}-${p.month}-${p.day}`, min: (Number(p.hour) % 24) * 60 + Number(p.minute) }; }
const usd = (n: number) => `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(0)}`;
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

async function main() {
  // --- session bars (RTH, cumulative session VWAP — matches the engine) ---
  const { data: barRows } = await sb.from("underlying_bars").select("ts,open,high,low,close,volume").eq("symbol", "SPY").gte("ts", `${DAY}T08:00:00Z`).lte("ts", `${DAY}T23:00:00Z`).order("ts", { ascending: true }).limit(2000);
  let cumPV = 0, cumV = 0;
  const session: Bar[] = (barRows ?? []).filter((b: any) => { const p = etParts(Date.parse(b.ts)); return p.min >= RTH_OPEN && p.min < RTH_CLOSE; }).map((b: any) => {
    const high = Number(b.high), low = Number(b.low), close = Number(b.close), volume = Number(b.volume ?? 0) || 1;
    cumPV += ((high + low + close) / 3) * volume; cumV += volume;
    return { ts: Date.parse(b.ts), open: Number(b.open), high, low, close, volume, vwap: cumPV / cumV };
  });
  const sessMin = session.map((b) => etParts(b.ts).min);
  const minToIdx = new Map<number, number>(); sessMin.forEach((m, i) => minToIdx.set(m, i));
  if (!session.length) { console.log(`no RTH bars for ${DAY}`); return; }

  // --- closed positions + the channels' spec_json ---
  const { data: posRows } = await sb.from("positions").select("id,occ_symbol,opt_type,strike,qty,avg_entry_price,current_mark,realized_pnl,opened_at,closed_at,strategist_id,strategists(slug,name,spec_json)").eq("status", "closed").gte("closed_at", `${DAY}T08:00:00Z`).order("closed_at", { ascending: true });
  const { data: evs } = await sb.from("events").select("created_at,message").gte("created_at", `${DAY}T08:00:00Z`).order("created_at", { ascending: true });
  const reconciledOcc = new Set((evs ?? []).filter((e: any) => /reconciled/.test(e.message)).map((e: any) => (e.message.match(/reconciled\s+(\S+)/) || [])[1]));

  let stratCount = 0, manualCount = 0;
  const manual: any[] = [];
  for (const p of (posRows ?? []) as any[]) {
    const isManual = reconciledOcc.has(p.occ_symbol);
    if (isManual) { manualCount++; manual.push(p); } else stratCount++;
  }

  console.log(`\n=== EXIT STUDY · ${DAY} ===`);
  console.log(`strategy-closed: ${stratCount}   manual/reconciled: ${manualCount}\n`);
  if (!manual.length) { console.log("no manual closes to study."); return; }

  // --- per manual trade: replay the channel's natural exit, price both off mid ---
  let totalDiff = 0, cutShort = 0, goodClose = 0;
  console.log("channel              occ              entry  yourExit       stratExit(reason)        Δ/contract   Δ$(qty)   verdict");
  for (const p of manual) {
    const slug = p.strategists?.slug ?? "?";
    const optType: OptType = p.opt_type;
    const entryPrem = Number(p.avg_entry_price ?? 0);
    const qty = Number(p.qty ?? 1);
    const entryMin = etParts(Date.parse(p.opened_at)).min;
    const manualMin = etParts(Date.parse(p.closed_at)).min;
    const ei = minToIdx.get(entryMin) ?? session.findIndex((b) => etParts(b.ts).min >= entryMin);
    if (ei < 0) continue;

    // option mid path for this occ, forward-filled by session minute
    const { data: qs } = await sb.from("option_quotes").select("captured_at,mid,bid,ask").eq("occ_symbol", p.occ_symbol).gte("captured_at", `${DAY}T08:00:00Z`).order("captured_at", { ascending: true });
    const midAtMin: number[] = new Array(session.length).fill(0);
    { let last = entryPrem; let qi = 0; const qq = (qs ?? []) as any[];
      for (let i = 0; i < session.length; i++) { const m = sessMin[i]; while (qi < qq.length && etParts(Date.parse(qq[qi].captured_at)).min <= m) { const v = Number(qq[qi].mid ?? qq[qi].bid ?? 0); if (v > 0) last = v; qi++; } midAtMin[i] = last; } }
    const occMid = (i: number) => (i >= 0 && i < session.length ? midAtMin[i] : 0);

    // build the evaluator (registry code OR compiled spec)
    const code = getStrategy(slug);
    const spec: StrategySpec | null = !code && p.strategists?.spec_json ? (p.strategists.spec_json as StrategySpec) : null;
    if (!code && !spec) continue;
    const evaluate = code ? code.build(session, code.timeframeMin) : specToStrategyDef(spec!).build(session, 1, {});
    const premExit = spec ? specPremiumExit(spec) : undefined;

    // replay from entry to EOD; first exit (strategy OR premium guard) wins
    let entryUnderlying = session[ei].close, peakFav = entryUnderlying, peakPrem = entryPrem;
    let sx = { min: sessMin[session.length - 1], reason: "eod", mid: occMid(session.length - 1) };
    for (let i = ei + 1; i < session.length; i++) {
      peakFav = optType === "call" ? Math.max(peakFav, session[i].close) : Math.min(peakFav, session[i].close);
      const mid = occMid(i); if (mid > 0) peakPrem = Math.max(peakPrem, mid);
      const f: Features = { ...computeFeatures(session, i), minutesToClose: Math.max(0, RTH_CLOSE - sessMin[i]) };
      const pos: Position = { slug, strike: Number(p.strike), optType, qty: 1, entryPrice: entryPrem, entryMinute: ei, entryUnderlying, peakFavorable: peakFav };
      let intent = evaluate(f, pos);
      if (mid > 0 && entryPrem > 0 && (!intent || intent.kind !== "exit")) {
        if (premExit?.profitPct != null && mid >= entryPrem * (1 + premExit.profitPct / 100)) intent = { kind: "exit", reason: "target_premium" } as any;
        else if (premExit?.stopPct != null && mid <= entryPrem * (1 - premExit.stopPct / 100)) intent = { kind: "exit", reason: "stop_premium" } as any;
        else if (mid <= entryPrem * 0.5) intent = { kind: "exit", reason: "premium_stop" } as any;
        else if (POWER.has(slug) && peakPrem >= entryPrem * 2 && mid <= entryPrem + (peakPrem - entryPrem) * 0.6) intent = { kind: "exit", reason: "trail_giveback" } as any;
      }
      if (intent?.kind === "exit") { sx = { min: sessMin[i], reason: intent.reason, mid }; break; }
    }

    const mi = minToIdx.get(manualMin) ?? session.findIndex((b) => etParts(b.ts).min >= manualMin);
    const manualMid = mi >= 0 ? occMid(mi) : Number(p.current_mark ?? 0);
    const diffPer = sx.mid - manualMid;          // >0 → strategy would have sold higher (you cut it short)
    const diffUsd = diffPer * qty * 100;
    totalDiff += diffUsd;
    const verdict = diffUsd > 5 ? "cut short" : diffUsd < -5 ? "good close" : "~even";
    if (diffUsd > 5) cutShort++; else if (diffUsd < -5) goodClose++;
    console.log(
      `${slug.padEnd(20)} ${p.occ_symbol.padEnd(16)} ${entryPrem.toFixed(2).padStart(5)}  ${hhmm(manualMin)}@${manualMid.toFixed(2).padStart(5)}  ` +
      `${hhmm(sx.min)}@${sx.mid.toFixed(2).padStart(5)} (${sx.reason.padEnd(13)}) ${diffPer >= 0 ? "+" : ""}${diffPer.toFixed(2).padStart(5)}     ${usd(diffUsd).padStart(7)}   ${verdict}`
    );
  }
  console.log(`\n--- net: leaving them to the channel would have been ${usd(totalDiff)} vs your manual closes (mid basis) ---`);
  console.log(`cut short (channel would've made more): ${cutShort}   good close (you beat the channel): ${goodClose}\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
