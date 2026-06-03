// ============================================================================
//  giveback-study — for trades opened in a window, did winners PEAK then GIVE IT
//  BACK, and was it strategy (no premium take-profit / late stop) or WIRING
//  (pre-market-polluted ATR → too-wide stops that let runners round-trip)?
//
//  For each trade: entry premium, PEAK mid reached during its life (option_quotes),
//  exit premium booked, exit reason (events), and the ATR the entry signal used
//  (signals.rationale.atr — if early-session ATR is inflated vs later, that's the
//  pre-market pollution showing up in the stop distance). Read-only (anon).
//
//  Run: npx tsx scripts/giveback-study.ts [YYYY-MM-DD] [startUTC] [endUTC]
//       default window 13:30–14:00 UTC = 09:30–10:00 ET = 06:30–07:00 PT
// ============================================================================

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv() { try { const t = readFileSync(".env.local", "utf8"); for (const l of t.split("\n")) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); } } catch { /* */ } }
loadEnv();
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });

const DAY = process.argv[2] || "2026-06-03";
const START = process.argv[3] || "13:30";
const END = process.argv[4] || "14:00";
const startISO = `${DAY}T${START}:00Z`, endISO = `${DAY}T${END}:00Z`;
const hhmmET = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
const pct = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(0)}%`;
const usd = (n: number) => `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(0)}`;

async function main() {
  const { data: pos } = await sb.from("positions").select("occ_symbol,opt_type,strike,qty,avg_entry_price,current_mark,realized_pnl,opened_at,closed_at,strategists(slug)").gte("opened_at", startISO).lt("opened_at", endISO).order("opened_at", { ascending: true });
  const { data: evs } = await sb.from("events").select("created_at,message").gte("created_at", `${DAY}T12:00:00Z`).order("created_at", { ascending: true });
  const exitReason = (occ: string, after: string): string => {
    const e = (evs ?? []).find((x: any) => x.message.includes(occ) && (x.message.includes(": exit ") || x.message.includes("reconciled")) && x.created_at >= after);
    if (!e) return "open/?";
    if (e.message.includes("reconciled")) return "MANUAL";
    return (e.message.match(/\(([^)]+)\)/) || [, "?"])[1];
  };
  // entry-signal ATR by occ (from acted signals' rationale) — proxy for stop width
  const { data: sigs } = await sb.from("signals").select("created_at,acted_on,rationale").gte("created_at", `${DAY}T12:00:00Z`).eq("acted_on", true);
  const atrOf = (occ: string): number | null => { const s = (sigs ?? []).find((x: any) => x.rationale?.occ === occ); return s?.rationale?.atr ?? null; };

  if (!pos?.length) { console.log(`no trades opened ${START}–${END} UTC on ${DAY}`); return; }
  console.log(`\n=== GIVE-BACK STUDY · ${DAY} · opened ${START}–${END} UTC (${hhmmET(startISO)}–${hhmmET(endISO)} ET) ===\n`);
  console.log("channel        occ              entry  PEAK   peakG  exit   exitG  reason         giveback  atr");
  let totGiveback = 0, totRealizedish = 0, atrs: number[] = [];
  for (const p of pos as any[]) {
    const slug = p.strategists?.slug ?? "?";
    const entry = Number(p.avg_entry_price ?? 0);
    const qty = Number(p.qty ?? 1);
    const exit = Number(p.current_mark ?? 0);
    const { data: qs } = await sb.from("option_quotes").select("mid,bid,captured_at").eq("occ_symbol", p.occ_symbol).gte("captured_at", p.opened_at).lte("captured_at", p.closed_at ?? endISO).order("mid", { ascending: false }).limit(1);
    const peak = Number((qs ?? [])[0]?.mid ?? exit);
    const reason = exitReason(p.occ_symbol, p.opened_at);
    const atr = atrOf(p.occ_symbol);
    const peakG = entry > 0 ? (peak - entry) / entry : 0;
    const exitG = entry > 0 ? (exit - entry) / entry : 0;
    const giveback = (peak - exit) * qty * 100;
    totGiveback += giveback; totRealizedish += (exit - entry) * qty * 100;
    if (atr != null) atrs.push(atr);
    console.log(
      `${slug.padEnd(14)} ${p.occ_symbol.padEnd(16)} ${entry.toFixed(2).padStart(5)} ${peak.toFixed(2).padStart(5)} ${pct(peakG).padStart(5)} ${exit.toFixed(2).padStart(5)} ${pct(exitG).padStart(5)}  ${reason.padEnd(13)} ${usd(giveback).padStart(8)}  ${atr != null ? atr.toFixed(2) : "—"}`
    );
  }
  const avgAtr = atrs.length ? atrs.reduce((a, b) => a + b, 0) / atrs.length : 0;
  console.log(`\n--- ${pos.length} trades · peak→exit give-back total ${usd(totGiveback)} · booked round-trip ${usd(totRealizedish)} · avg entry-ATR ${avgAtr.toFixed(2)} ---`);
}
main().catch((e) => { console.error(e); process.exit(1); });
