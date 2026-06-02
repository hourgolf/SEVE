// ============================================================================
//  scripts/health.ts   ·   run: npm run health
//
//  Day-2 (and beyond) live-desk health check — one command, no SQL. Reads the
//  desk tables via the anon key (.env.local) and prints a skimmable snapshot:
//  worker liveness, fund/equity/P&L, dispatcher aborts, per-channel isolation
//  failures (the 2026-06-01g guard), and a per-channel tally of signals /
//  blocked-reasons / fills / open positions / realized P&L today. Surfaces the
//  things we said to watch: cost_gate biting (and power NOT gated), premium_stop
//  exits, grind going quiet, and any channel that threw.
//
//  Read-only. Safe to run mid-session as often as you like.
// ============================================================================

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const ETF = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", weekday: "short",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
function etParts(ms: number) {
  const p: Record<string, string> = {};
  for (const x of ETF.formatToParts(new Date(ms))) p[x.type] = x.value;
  let h = Number(p.hour); if (h === 24) h = 0;
  return { date: `${p.year}-${p.month}-${p.day}`, min: h * 60 + Number(p.minute), clock: `${String(h).padStart(2, "0")}:${p.minute}:${p.second}`, wd: p.weekday };
}
const usd = (v: number) => (v < 0 ? "-$" : "$") + Math.abs(Math.round(v)).toLocaleString();
const ago = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`; };
const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n);
const padL = (s: string, n: number) => (" ".repeat(n) + s).slice(-n);

async function main() {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) { console.error("Missing NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY in .env.local"); process.exit(1); }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const nowMs = Date.now();
  const now = etParts(nowMs); const today = now.date;
  const since = new Date(nowMs - 20 * 3600 * 1000).toISOString();
  const marketOpen = now.wd !== "Sat" && now.wd !== "Sun" && now.min >= 570 && now.min < 960;

  const [stratR, fundR, evR, sigR, openR, closedR, eqR] = await Promise.all([
    sb.from("strategists").select("id,slug,status,sort_order").order("sort_order"),
    sb.from("fund_state").select("mode,is_halted,halted_reason").eq("id", 1).maybeSingle(),
    sb.from("events").select("level,message,created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(1500),
    sb.from("signals").select("strategist_id,acted_on,blocked_reason,signal_type,created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(1500),
    sb.from("positions").select("strategist_id,occ_symbol,qty,status,unrealized_pnl,opened_at").eq("status", "open"),
    sb.from("positions").select("strategist_id,realized_pnl,closed_at").gte("closed_at", since),
    sb.from("equity_snapshots").select("net_liquidation,unrealized_pnl,realized_pnl_day,captured_at").is("strategist_id", null).order("captured_at", { ascending: false }).limit(1),
  ]);

  const slugById = new Map<string, { slug: string; status: string }>();
  for (const s of (stratR.data ?? [])) slugById.set(s.id as string, { slug: s.slug as string, status: (s.status as string) ?? "armed" });
  const fund = fundR.data as { mode?: string; is_halted?: boolean; halted_reason?: string } | null;
  const evToday = (evR.data ?? []).filter((e) => etParts(Date.parse(e.created_at as string)).date === today);
  const sigToday = (sigR.data ?? []).filter((s) => etParts(Date.parse(s.created_at as string)).date === today);
  const openPos = openR.data ?? [];
  const closedToday = (closedR.data ?? []).filter((p) => p.closed_at && etParts(Date.parse(p.closed_at as string)).date === today);

  // ---- worker liveness: newest event or equity snapshot ----
  const lastEvMs = evR.data?.length ? Date.parse(evR.data[0].created_at as string) : 0;
  const lastEqMs = eqR.data?.length ? Date.parse(eqR.data[0].captured_at as string) : 0;
  const lastTick = Math.max(lastEvMs, lastEqMs);
  const tickAge = lastTick ? nowMs - lastTick : Infinity;
  const live = !marketOpen ? "(market closed)" : tickAge < 180_000 ? "[LIVE]" : `[STALE ${ago(tickAge)} — worker may not be running]`;

  // ---- aborts + per-channel isolation failures (g) ----
  const aborts = evToday.filter((e) => /dispatcher\) failed/.test(e.message as string)).length;
  const chFails = evToday.filter((e) => /dispatcher: channel .* failed/.test(e.message as string));

  // ---- per-channel rollups ----
  type Roll = { sig: number; acted: number; blocked: number; reasons: Record<string, number>; buys: number; sells: number; premStops: number; open: number; realized: number };
  const roll = new Map<string, Roll>();
  const ensure = (slug: string) => { let r = roll.get(slug); if (!r) { r = { sig: 0, acted: 0, blocked: 0, reasons: {}, buys: 0, sells: 0, premStops: 0, open: 0, realized: 0 }; roll.set(slug, r); } return r; };
  for (const [, v] of slugById) ensure(v.slug);
  for (const s of sigToday) { const slug = slugById.get(s.strategist_id as string)?.slug ?? "?"; const r = ensure(slug); r.sig++; if (s.acted_on) r.acted++; else { r.blocked++; const k = (s.blocked_reason as string) || "(none)"; r.reasons[k] = (r.reasons[k] ?? 0) + 1; } }
  for (const p of openPos) { const slug = slugById.get(p.strategist_id as string)?.slug ?? "?"; ensure(slug).open++; }
  for (const p of closedToday) { const slug = slugById.get(p.strategist_id as string)?.slug ?? "?"; ensure(slug).realized += Number(p.realized_pnl ?? 0); }
  for (const e of evToday) {
    if (e.level !== "EXEC") continue;
    const m = /^(\S+): (buy|exit)/.exec(e.message as string); if (!m) continue;
    const r = ensure(m[1]); if (m[2] === "buy") r.buys++; else { r.sells++; if (/premium_stop/.test(e.message as string)) r.premStops++; }
  }

  // ---- day P&L ----
  const realizedToday = closedToday.reduce((a, p) => a + Number(p.realized_pnl ?? 0), 0);
  const unreal = openPos.reduce((a, p) => a + Number(p.unrealized_pnl ?? 0), 0);
  const eq = eqR.data?.[0] ? Number(eqR.data[0].net_liquidation) : null;

  // ---- power-gated check (power should be cost-gate EXEMPT) ----
  const powerGated = (roll.get("power")?.reasons["cost_gate"] ?? 0);
  const costGateTotal = [...roll.values()].reduce((a, r) => a + (r.reasons["cost_gate"] ?? 0), 0);
  const premStopTotal = [...roll.values()].reduce((a, r) => a + r.premStops, 0);

  // ---- print ----
  console.log(`\n══ SEVE health · ${now.wd} ${today} ${now.clock} ET · ${marketOpen ? "market OPEN" : "market closed"} ══`);
  console.log(`Worker    : last tick ${lastTick ? ago(tickAge) + " ago" : "—"}  ${live}`);
  console.log(`Fund      : ${fund?.mode ?? "?"} · halted=${fund?.is_halted ? "TRUE ⚠" : "false"}${fund?.halted_reason ? ` (${fund.halted_reason})` : ""}` + (eq != null ? ` · equity ${usd(eq)}` : "") + ` · day P&L ${usd(realizedToday + unreal)} (realized ${usd(realizedToday)} / unreal ${usd(unreal)})`);
  console.log(`Aborts    : dispatcher-failed today: ${aborts}  ${aborts === 0 ? "✓" : "⚠ (whole-run crashes — should be 0 on 2026-06-01g)"}`);
  console.log(`Isolation : channel-failed today: ${chFails.length}  ${chFails.length === 0 ? "✓" : "⚠ a channel threw — see flags"}`);
  console.log(`Guards    : cost_gate blocks today: ${costGateTotal} · premium_stop exits: ${premStopTotal} · power gated? ${powerGated === 0 ? "NO ✓" : `YES ⚠ (${powerGated} — power should be EXEMPT)`}`);

  console.log(`\nPer channel (today):`);
  console.log("  " + pad("CHANNEL", 17) + padL("sig", 4) + padL("act", 4) + padL("blk", 4) + padL("buy", 5) + padL("sell", 5) + padL("open", 5) + padL("realized", 10) + "   top blocked reasons");
  const order = [...slugById.values()].map((v) => v.slug);
  for (const slug of order) {
    const r = roll.get(slug)!; const st = [...slugById.values()].find((v) => v.slug === slug)?.status ?? "";
    const reasons = Object.entries(r.reasons).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k}:${n}`).join(", ") || "—";
    console.log("  " + pad(`${slug}${st !== "armed" ? `(${st})` : ""}`, 17) + padL(String(r.sig), 4) + padL(String(r.acted), 4) + padL(String(r.blocked), 4) + padL(String(r.buys), 5) + padL(String(r.sells), 5) + padL(String(r.open), 5) + padL(usd(r.realized), 10) + "   " + reasons);
  }

  // ---- stuck-position check: open & opened before today (a 0DTE held overnight is odd) ----
  const stuck = openPos.filter((p) => p.opened_at && etParts(Date.parse(p.opened_at as string)).date < today);
  const warns = evToday.filter((e) => e.level === "WARN").slice(0, 6);
  if (warns.length) {
    console.log(`\nRecent WARN (newest first):`);
    for (const w of warns) console.log(`  ${etParts(Date.parse(w.created_at as string)).clock}  ${(w.message as string).slice(0, 110)}`);
  }

  // ---- flags ----
  const flags: string[] = [];
  if (marketOpen && tickAge >= 180_000) flags.push(`worker STALE (${ago(tickAge)} since last tick) — cron may be down`);
  if (fund?.is_halted) flags.push(`fund is HALTED${fund.halted_reason ? `: ${fund.halted_reason}` : ""}`);
  if (aborts > 0) flags.push(`${aborts} whole-run aborts today (expected 0 on 2026-06-01g)`);
  for (const e of chFails) flags.push((e.message as string).replace(/^dispatcher: /, ""));
  if (powerGated > 0) flags.push(`power was cost-gated ${powerGated}× — it should be EXEMPT (check COST_GATE_EXEMPT)`);
  for (const p of stuck) flags.push(`stuck OPEN position from before today: ${p.occ_symbol} (${slugById.get(p.strategist_id as string)?.slug})`);
  // an armed channel with many signals but ALL blocked = effectively dead (e.g. cost gate too tight)
  for (const [slug, r] of roll) if ((slugById.get([...slugById.keys()].find((id) => slugById.get(id)?.slug === slug) ?? "")?.status ?? "") === "armed" && r.sig >= 8 && r.acted === 0) flags.push(`${slug}: ${r.sig} signals, 0 acted — fully blocked (gate too tight / no quotes?)`);

  console.log(`\n${flags.length ? "⚠ flags:\n  - " + flags.join("\n  - ") : "✓ no flags — desk looks healthy"}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
