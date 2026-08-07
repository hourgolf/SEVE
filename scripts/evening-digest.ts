// evening-digest — the short close report that replaces the operator's mental checklist.
//
// Runs nightly inside capture-forward (after the exports/reports). DETERMINISTIC — no
// LLM, no recommendations, just the numbers a hands-off operator needs each close:
//   · per-bucket day P&L (realized, desk attribution) + trade count + top mover
//   · worker heartbeat (version + age) and tape-capture freshness
// Pushes via the app's /api/push-send (same path as the worker's alerts, tag
// 'seve-digest'); prints to stdout either way so the launchd log carries it.
//
//   npm run evening-digest            # trading days only
//   npm run evening-digest -- --force # test on a non-session day

import { isTradingDay } from "../engine/market-calendar";
import { etDayRangeUtc } from "../lib/research/afterCloseResearch";
import { buildEveningDigest, EVENING_DIGEST_READ_FAILURE, type EveningDigestBucket, type EveningDigestMover } from "../lib/ops/eveningDigest";
import { createServerSupabaseClient } from "./serverSupabase";

const FORCE = process.argv.includes("--force");
const sb = createServerSupabaseClient("evening-digest");
function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function main() {
  const day = etToday();
  if (!isTradingDay(day) && !FORCE) { console.log(`  digest: ${day} not a session — skipped`); return; }
  const range = etDayRangeUtc(day);

  // ---- per-bucket day P&L (desk attribution; NAV truth is the broker, this is the shape) ----
  const closedRead = await sb.from("positions")
    .select("realized_pnl,strategist_id,strategists(slug,account_id,accounts:account_id(name))")
    .eq("status", "closed").gte("opened_at", range.start).lt("opened_at", range.end);
  if (closedRead.error) throw new Error(`positions read failed: ${closedRead.error.message}`);
  const closed = closedRead.data ?? [];
  const byBucket = new Map<string, { pnl: number; n: number }>();
  const byChan = new Map<string, number>();
  for (const r of closed as any[]) {
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

  // ---- worker heartbeat ----
  const heartbeatRead = await sb.from("worker_heartbeat").select("beat_at,note").eq("id", "stream").maybeSingle();
  if (heartbeatRead.error) throw new Error(`worker heartbeat read failed: ${heartbeatRead.error.message}`);
  const hb = heartbeatRead.data;
  const hbAge = hb ? Math.round((Date.now() - Date.parse((hb as any).beat_at)) / 60000) : null;
  const archiveRead = await sb.from("events").select("message")
    .like("message", `stream: archive: quotes ${day} → R2 verified%`)
    .gte("created_at", range.start).lt("created_at", range.end)
    .order("created_at", { ascending: false }).limit(1);
  if (archiveRead.error) throw new Error(`archive receipt read failed: ${archiveRead.error.message}`);
  const archiveMessage = String(archiveRead.data?.[0]?.message ?? "");
  const digest = buildEveningDigest({
    session: day, totalPnl: total, trades: nTrades,
    buckets: [...byBucket.entries()].map(([label, value]): EveningDigestBucket => ({ label, pnl: value.pnl, trades: value.n })),
    movers: movers.map(([slug, pnl]): EveningDigestMover => ({ slug, pnl })),
    workerNote: hb ? String((hb as any).note ?? "worker receipt") : null,
    workerAgeMinutes: hbAge,
    archiveReceipt: archiveMessage.match(/\(([^)]+)\)/)?.[1] ?? null,
  });
  console.log(`\n  ── evening digest · ${day} ──\n  ${digest.body.split("\n").join("\n  ")}\n`);
  await sendPush(digest.title, digest.body);
}

async function sendPush(title: string, body: string): Promise<void> {
  const appUrl = process.env.APP_URL, secret = process.env.PUSH_SECRET;
  if (!appUrl || !secret) { console.log("  digest: APP_URL/PUSH_SECRET unset — printed only"); return; }
  try {
    const response = await fetch(`${appUrl}/api/push-send`, { method: "POST", headers: { "content-type": "application/json", "x-push-secret": secret }, body: JSON.stringify({ title, body, tag: "seve-digest", url: "/" }), signal: AbortSignal.timeout(8000) });
    console.log(`  digest: push ${response.ok ? "sent" : `failed ${response.status}`}`);
  } catch (error) { console.log(`  digest: push failed — ${(error as Error).message}`); }
}

main().catch(async (error) => {
  console.error(`evening-digest fatal — ${(error as Error).message}`);
  await sendPush(EVENING_DIGEST_READ_FAILURE.title, EVENING_DIGEST_READ_FAILURE.body);
  process.exitCode = 1;
});
