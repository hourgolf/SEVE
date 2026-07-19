// evening-digest — the ten-line ops push that replaces the operator's mental checklist.
//
// Runs nightly inside capture-forward (after the exports/reports). DETERMINISTIC — no
// LLM, no recommendations, just the numbers a hands-off operator needs each close:
//   · per-bucket day P&L (realized, desk attribution) + trade count + top mover
//   · era-4 / A6 progress (sessions toward the 15-session trigger)
//   · worker heartbeat (version + age) and tape-capture freshness
// Pushes via the app's /api/push-send (same path as the worker's alerts, tag
// 'seve-digest'); prints to stdout either way so the launchd log carries it.
//
//   npm run evening-digest            # trading days only
//   npm run evening-digest -- --force # test on a non-session day

import { existsSync, readdirSync } from "fs";
import { isTradingDay } from "../engine/market-calendar";
import { createServerSupabaseClient } from "./serverSupabase";

const FORCE = process.argv.includes("--force");
const sb = createServerSupabaseClient("evening-digest");
const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v)).toLocaleString();
const ERA4_START = "2026-06-30";
const A6_SESSIONS = 15;

function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function main() {
  const day = etToday();
  if (!isTradingDay(day) && !FORCE) { console.log(`  digest: ${day} not a session — skipped`); return; }

  // ---- per-bucket day P&L (desk attribution; NAV truth is the broker, this is the shape) ----
  const { data: closed } = await sb.from("positions")
    .select("realized_pnl,strategist_id,strategists(slug,account_id,accounts:account_id(name))")
    .eq("status", "closed").gte("opened_at", `${day}T00:00:00Z`);
  const byBucket = new Map<string, { pnl: number; n: number }>();
  const byChan = new Map<string, number>();
  for (const r of (closed ?? []) as any[]) {
    const acct = r.strategists?.accounts?.name ?? "?";
    const slug = r.strategists?.slug ?? "?";
    const p = Number(r.realized_pnl ?? 0);
    const b = byBucket.get(acct) ?? { pnl: 0, n: 0 };
    b.pnl += p; b.n += 1; byBucket.set(acct, b);
    byChan.set(slug, (byChan.get(slug) ?? 0) + p);
  }
  const total = [...byBucket.values()].reduce((a, b) => a + b.pnl, 0);
  const nTrades = [...byBucket.values()].reduce((a, b) => a + b.n, 0);
  const movers = [...byChan.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));

  // ---- era-4 / A6 progress ----
  const { data: sess } = await sb.from("positions").select("opened_at").eq("status", "closed").gte("opened_at", ERA4_START);
  const sessions = new Set(((sess ?? []) as any[]).map((r) => String(r.opened_at).slice(0, 10))).size;

  // ---- worker heartbeat ----
  const { data: hb } = await sb.from("worker_heartbeat").select("beat_at,note").eq("id", "stream").maybeSingle();
  const hbAge = hb ? Math.round((Date.now() - Date.parse((hb as any).beat_at)) / 60000) : null;
  // ⚠ only on a plausibly-dead worker (>4h): the digest runs post-close when idle beats
  // are legitimately sparse — the intraday stale-page (cron, 5m) owns the fast alarm.
  const hbLine = hb ? `${(hb as any).note} · ${hbAge}m ago${hbAge != null && hbAge > 240 ? " ⚠" : ""}` : "NO HEARTBEAT ⚠";

  // ---- tape freshness (local archive) ----
  const qDir = "data/quotes-archive";
  const qLatest = existsSync(qDir) ? readdirSync(qDir).filter((f) => f.endsWith(".json.gz")).sort().pop()?.slice(0, 10) : null;

  const lines = [
    `DESK ${usd(total)} · ${nTrades} trades`,
    ...[...byBucket.entries()].sort((a, b) => b[1].pnl - a[1].pnl).map(([k, v]) => `${k}: ${usd(v.pnl)} (${v.n})`),
    movers.length ? `top: ${movers[0][0]} ${usd(movers[0][1])}${movers[1] ? ` · ${movers[1][0]} ${usd(movers[1][1])}` : ""}` : "no closed trades",
    `era-4: ${sessions}/${A6_SESSIONS} sessions to A6`,
    `worker: ${hbLine}`,
    `tape: quotes archived → ${qLatest ?? "NONE ⚠"}`,
  ];
  const body = lines.join("\n");
  console.log(`\n  ── evening digest · ${day} ──\n  ${lines.join("\n  ")}\n`);

  const appUrl = process.env.APP_URL, secret = process.env.PUSH_SECRET;
  if (!appUrl || !secret) { console.log("  digest: APP_URL/PUSH_SECRET unset — printed only"); return; }
  try {
    const r = await fetch(`${appUrl}/api/push-send`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-push-secret": secret },
      body: JSON.stringify({ title: `SEVE close · ${usd(total)} · ${nTrades}t`, body, tag: "seve-digest", url: "/" }),
      signal: AbortSignal.timeout(8000),
    });
    console.log(`  digest: push ${r.ok ? "sent" : `failed ${r.status}`}`);
  } catch (e) { console.log(`  digest: push failed — ${(e as Error).message}`); }
}

main().catch((e) => { console.error(`evening-digest fatal — ${(e as Error).message}`); process.exit(1); });
