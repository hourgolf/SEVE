// ---------------------------------------------------------------------------
//  sentinel (deterministic core) — the nightly opportunity + drift scanner.
//
//  Applies the avg-peak harvest lens (memory/avg-peak-harvest-lens) across the
//  WHOLE roster in one pass — live channels (forensics-dataset.jsonl mfePct, real
//  fills / clean books) + the virtual bench (virtual_trades mfe_pct, mid-basis) —
//  nets the bench to a real-fill estimate via the measured exit half-spread, and
//  surfaces the two things a human keeps having to point out:
//    · BENCH promote candidates — net-positive after spread + a real peak
//    · LIVE harvest leaks       — big peak surrendered → a TP/ratchet lever
//  plus a first cut of DRIFT flags. Read-only. This is the SENSOR layer of the
//  sentinel; the judgment (prose), paging, and capture-chain schedule wrap it
//  (docs/desk-briefing-template.md). NO arm from bench data (mid-basis, capital-
//  blind) — this ranks hypotheses, it does not decide.
//
//    tsx --env-file=.env.local scripts/sentinel.ts [--days N]
// ---------------------------------------------------------------------------
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { dayTags } from "../engine/market-events";
import { nextTradingDay } from "../engine/market-calendar";

// Service role (when present, e.g. the nightly capture / .env.local) lets the digest publish to the
// events table for the §03 panel; anon still reads virtual_trades fine, just skips the publish.
const SB_URL = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL) as string;
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) as string;
const HAS_SERVICE = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(SB_URL, SB_KEY);

const ERA4 = "2026-06-30";
// Measured NTM exit half-spread ($/ct) — the mid-basis → real-fill haircut on bench
// pnl (2026-07-09: QQQ ~5, IWM ~2, SPY tightest). Bench pnl is entry-at-ask / exit-at-mid,
// so only the exit half-spread is optimistic. Refresh from option_quotes periodically.
const EXIT_HALF: Record<string, number> = { SPY: 2, QQQ: 5, IWM: 2 };

const idxOf = (slug: string) => (slug.includes("qqq") ? "QQQ" : slug.includes("iwm") ? "IWM" : "SPY");
const r1 = (x: number) => Math.round(x * 10) / 10;
const money = (n: number) => (n < 0 ? "−$" : "+$") + Math.abs(Math.round(n));

// ---- LIVE: avg-peak per channel from forensics (real fills, clean books) ----
type F = { date: string; slug: string; mfePct: number | null; givebackPct: number | null; pnl: number };
function liveScan() {
  const all: F[] = readFileSync(path.join("data", "forensics-dataset.jsonl"), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l));
  const era = all.filter((r) => r.date >= ERA4 && r.mfePct != null);
  const by = new Map<string, F[]>();
  for (const r of era) { const a = by.get(r.slug) ?? []; a.push(r); by.set(r.slug, a); }
  return [...by.entries()].map(([slug, rs]) => {
    const g = rs.filter((r) => r.givebackPct != null);
    return {
      slug, n: rs.length,
      avgPeak: r1(rs.reduce((s, r) => s + (r.mfePct || 0), 0) / rs.length),
      winPct: Math.round((100 * rs.filter((r) => r.pnl > 0).length) / rs.length),
      avgGive: g.length ? Math.round(g.reduce((s, r) => s + (r.givebackPct || 0), 0) / g.length) : 0,
      pnl: Math.round(rs.reduce((s, r) => s + r.pnl, 0)),
    };
  });
}

// ---- BENCH: avg-peak per vb channel from virtual_trades (mid-basis), netted to real-fill ----
async function benchScan(days: number) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await sb.from("virtual_trades")
    .select("slug,mfe_pct,giveback_pct,pnl_per_contract")
    .like("slug", "vb-%").gte("signal_at", since).not("mfe_pct", "is", null).limit(5000);
  if (error) throw new Error(`virtual_trades read: ${error.message}`);
  const by = new Map<string, any[]>();
  for (const r of (data ?? []) as any[]) { const a = by.get(r.slug) ?? []; a.push(r); by.set(r.slug, a); }
  return [...by.entries()].map(([slug, rs]) => {
    const eh = EXIT_HALF[idxOf(slug)] ?? 3;
    const avgPeak = rs.reduce((s, r) => s + (r.mfe_pct || 0), 0) / rs.length;
    const midCt = rs.reduce((s, r) => s + (r.pnl_per_contract || 0), 0) / rs.length;
    // win% on the REAL-FILL basis (net of the exit half-spread) — mid-basis would overstate it
    const wins = rs.filter((r) => (r.pnl_per_contract || 0) - eh > 0).length;
    const g = rs.filter((r) => r.giveback_pct != null).map((r) => r.giveback_pct);
    return {
      slug, n: rs.length, avgPeak: r1(avgPeak),
      netCt: r1(midCt - eh),
      winPct: Math.round((100 * wins) / rs.length),
      avgGive: g.length ? Math.round(g.reduce((s: number, x: number) => s + x, 0) / g.length) : null,
    };
  });
}

// ---- judgment layer (LLM) — turns the deterministic facts into an operator digest ----
// Matches the desk's raw-fetch Anthropic pattern (app/api/compile-strategy, the daily-autopsy
// edge fn) rather than pulling in the SDK for a script. Key-gated: no ANTHROPIC_API_KEY →
// deterministic-only (the sensor layer stands alone). Model defaults to opus-4-8, ANTHROPIC_MODEL
// overrides. Guardrails mirror the autopsy prompt: registry governs, no arm from bench, magnitude
// not direction.
async function judge(terrain: string, facts: string): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
  let brief = "";
  try { brief = readFileSync(path.join("docs", "sentinel-context.md"), "utf8").trim(); } catch { /* no brief → thinner, guardrail-only judge */ }
  const system = [
    brief && `DESK CONTEXT — your durable learnings; reason FROM these, they are the desk's settled doctrine:\n\n${brief}\n───`,
    "You are the SEVE desk sentinel. You are given the MORNING TERRAIN briefing (forward — auto S/R levels, event calendar, dealer positioning, regime priors) AND the deterministic opportunity+drift scan (backward — as of last close). Produce a terse operator digest grounded in the DESK CONTEXT above (the avg-peak/book lens, LOCK/RIDE/NEITHER, the live gates).",
    "Reinforced guardrails: registry governs every knob change (say 'queue for the gate', never 'change X now'); NO ARM FROM BENCH (mid-basis, capital-blind — hypotheses only); direction is noise, magnitude is the gate; bench numbers are an upper bound (n<8 thin, giveback>100% = peak-then-loss).",
    "PEAK × WIN is the core read: a high avg-peak is only an edge if the WIN rate confirms it. High peak + high win = reliable (clean promote / RIDE). High peak + LOW win = spike/giveback-carried — a harvest-FIX (tighter TP to bank the peak before the fade), NOT a clean promote; call that out explicitly. Low peak (<5%) = scalp, nothing to harvest.",
    "Use the TERRAIN as context, never a forecast: an event day changes the stand-down; dealer short-gamma (−GEX) favors the breakout book while long-gamma (+GEX) favors fades/scalps; the regime priors are historical base rates, not predictions. Surface it in SO WHAT only when it changes today's posture. Never predict direction.",
    "OUTPUT (no preamble, do not restate the raw table verbatim):",
    "1. OPPORTUNITIES — the 1-3 items worth a human look; each: what it is, why (expected vs anomalous, via the avg-peak/book lens), and the gate/venue it belongs to.",
    "2. DRIFT — anything that changed or looks off vs how the desk should behave; 'none' if clean.",
    "3. SO WHAT — one line: anything to queue before the next gate, or hold.",
    "Terse. The operator scans this in 20 seconds.",
  ].filter(Boolean).join("\n");
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model, max_tokens: 1024, output_config: { effort: "medium" },
        system, messages: [{ role: "user", content: `MORNING TERRAIN (forward):\n\n${terrain || "(none)"}\n\n${"═".repeat(48)}\n\nOPPORTUNITY + DRIFT SCAN (backward, as of last close):\n\n${facts}\n\nProduce the digest.` }],
      }),
    });
    if (!res.ok) { console.error(`sentinel judge: ${res.status} ${(await res.text()).slice(0, 200)}`); return null; }
    const data = (await res.json()) as any;
    const text = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    return text || null;
  } catch (e) { console.error(`sentinel judge: ${(e as Error).message}`); return null; }
}

// FORWARD terrain: fold in the desk-briefing (auto levels, events, dealer positioning, regime priors)
// by spawning the standalone emitter (keeps it independently runnable). --silent strips npm's banner;
// slice from the first header as belt-and-suspenders. Empty string on any failure (the scan stands alone).
function briefing(): string {
  try {
    const r = spawnSync("npm", ["run", "--silent", "desk-briefing"], { encoding: "utf8", env: process.env });
    const out = (r.stdout || "").trim();
    const i = out.indexOf("# Desk briefing");
    return i >= 0 ? out.slice(i).trim() : "";
  } catch { return ""; }
}

// ── DRIFT baselines: diff this session's scan vs the prior SESSION's snapshot (changes, not static
//    thresholds). Snapshots keyed by `through` (latest forensics date), upsert-by-through so the twice-
//    daily cadence doesn't self-diff. Persisted to data/sentinel/snapshots.jsonl. ──
type Snap = { through: string; runAt: string; ch: Record<string, { p: number; w: number; n: number }>; promote: string[]; leak: string[]; crater: string[] };
function throughDate(): string {
  try { let mx = ""; for (const l of readFileSync(path.join("data", "forensics-dataset.jsonl"), "utf8").trim().split("\n")) { const d = JSON.parse(l).date as string; if (d > mx) mx = d; } return mx; } catch { return ""; }
}
function loadSnaps(): Snap[] {
  try { return readFileSync(path.join("data", "sentinel", "snapshots.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Snap); } catch { return []; }
}
function saveSnap(snaps: Snap[], cur: Snap) {
  try {
    const kept = snaps.filter((s) => s.through !== cur.through); kept.push(cur); // upsert-by-through
    kept.sort((a, b) => (a.through < b.through ? -1 : 1));
    mkdirSync(path.join("data", "sentinel"), { recursive: true });
    writeFileSync(path.join("data", "sentinel", "snapshots.jsonl"), kept.map((s) => JSON.stringify(s)).join("\n") + "\n");
  } catch (e) { console.error(`sentinel: snapshot write failed — ${(e as Error).message}`); }
}
function driftDiff(cur: Snap, prior: Snap | null): { lines: string[]; anomalies: string[] } {
  const lines: string[] = [], anomalies: string[] = [];
  if (!prior) { lines.push(`   (no prior session snapshot — baseline set for next run)`); return { lines, anomalies }; }
  const newIn = (a: string[], b: string[]) => a.filter((x) => !b.includes(x));
  const np = newIn(cur.promote, prior.promote); if (np.length) { const m = `NEW clean-promote candidate: ${np.join(", ")}`; lines.push(`   ⤴ ${m}`); anomalies.push(m); }
  const nl = newIn(cur.leak, prior.leak); if (nl.length) { const m = `NEW live harvest leak: ${nl.join(", ")}`; lines.push(`   ⤴ ${m}`); anomalies.push(m); }
  const nc = newIn(cur.crater, prior.crater); if (nc.length) lines.push(`   ⤵ new bench crater: ${nc.join(", ")}`);
  const gp = newIn(prior.promote, cur.promote); if (gp.length) lines.push(`   ⤵ off the promote list: ${gp.join(", ")}`);
  for (const slug of Object.keys(cur.ch)) {
    const a = cur.ch[slug], b = prior.ch[slug]; if (!b) continue;
    const dp = a.p - b.p, dw = a.w - b.w;
    if (Math.abs(dp) >= 8 || Math.abs(dw) >= 15) {
      const m = `${slug}: peak ${b.p}→${a.p}%, win ${b.w}→${a.w}%`;
      lines.push(`   ~ ${m}`);
      if (Math.abs(dp) >= 12 || Math.abs(dw) >= 20) anomalies.push(m); // only the big moves page
    }
  }
  if (!lines.length) lines.push(`   (no material change vs ${prior.through})`);
  return { lines, anomalies };
}
// ── PAGING (shadow-first): push on genuine anomaly only. SENTINEL_PAGE=1 actually sends (else logs
//    WOULD-PAGE). Mirrors the a6-watch / evening-digest push pattern (APP_URL + PUSH_SECRET → /api/push-send). ──
async function page(anomalies: string[]) {
  if (!anomalies.length) { console.log(`   sentinel: no page (quiet — nothing anomalous).`); return; }
  const body = anomalies.slice(0, 4).join(" · ");
  const title = `SEVE sentinel · ${anomalies.length} flag${anomalies.length > 1 ? "s" : ""}`;
  if (process.env.SENTINEL_PAGE !== "1") { console.log(`   sentinel: WOULD PAGE (shadow — set SENTINEL_PAGE=1 to send): ${body}`); return; }
  const appUrl = process.env.APP_URL, secret = process.env.PUSH_SECRET;
  if (!appUrl || !secret) { console.error(`   sentinel: page skipped — APP_URL/PUSH_SECRET missing`); return; }
  try {
    const r = await fetch(`${appUrl}/api/push-send`, { method: "POST", headers: { "content-type": "application/json", "x-push-secret": secret }, body: JSON.stringify({ title, body, tag: "seve-sentinel", url: "/" }) });
    console.log(r.ok ? `   sentinel: PAGED — ${body}` : `   sentinel: page failed ${r.status}`);
  } catch (e) { console.error(`   sentinel: page error — ${(e as Error).message}`); }
}

async function main() {
  const dArg = process.argv.indexOf("--days");
  const days = dArg > 0 ? Number(process.argv[dArg + 1]) || 7 : 7;

  const live = liveScan().filter((c) => c.n >= 3);
  const bench = (await benchScan(days)).filter((c) => c.n >= 4);

  const O: string[] = [];
  const P = (s = "") => O.push(s);
  P(`# SENTINEL — opportunity + drift scan   (bench window: last ${days}d)`);
  P();

  // BENCH clean-promote: net-positive after spread + a real peak + a real WIN RATE. win% is on the
  // real-fill basis; a high peak with a LOW win rate is spike/giveback-carried, not an edge (a capped-
  // upside LOCK channel can't pay for many losers) — that's a harvest-FIX candidate below, not a promote.
  const WINFLOOR = 40;
  const promote = bench.filter((c) => c.netCt > 0 && c.avgPeak >= 12 && (c.winPct ?? 0) >= WINFLOOR).sort((a, b) => b.netCt - a.netCt);
  P(`## OPPORTUNITIES · BENCH  (clean promote: net>0 after spread + peak≥12% + win≥${WINFLOOR}% → real-fill test)`);
  if (!promote.length) P(`   (none clear the bar this window)`);
  for (const c of promote)
    P(`   ${c.slug.padEnd(24)} peak ${String(c.avgPeak).padStart(5)}%   win ${String(c.winPct).padStart(3)}%   net ${money(c.netCt).padStart(5)}/ct   give ${String(c.avgGive ?? "-").padStart(4)}%   n=${c.n}`);
  P();

  // FIXABLE: high peak but LOW win — the net (if any) is carried by rare spikes / the giveback eats it.
  // Not a clean promote; the lever is a tighter LOCK (bank the peak before the fade), then re-measure.
  const promoteSet = new Set(promote.map((c) => c.slug));
  const fixable = bench.filter((c) => c.avgPeak >= 15 && (c.winPct ?? 0) < WINFLOOR && !promoteSet.has(c.slug)).sort((a, b) => b.avgPeak - a.avgPeak);
  P(`## BENCH · high peak / LOW win  (spike-carried → needs a harvest fix, e.g. tighter TP, before any promote)`);
  if (!fixable.length) P(`   (none)`);
  for (const c of fixable)
    P(`   ${c.slug.padEnd(24)} peak ${String(c.avgPeak).padStart(5)}%   win ${String(c.winPct).padStart(3)}%   net ${money(c.netCt).padStart(5)}/ct   give ${String(c.avgGive ?? "-").padStart(4)}%   n=${c.n}`);
  P();

  // LIVE harvest leaks: high peak + high giveback → a TP/ratchet would capture it
  const leaks = live.filter((c) => c.avgPeak >= 25 && c.avgGive >= 50).sort((a, b) => b.avgPeak - a.avgPeak);
  P(`## OPPORTUNITIES · LIVE  (harvest leaks: high peak surrendered → TP/ratchet lever)`);
  if (!leaks.length) P(`   (none)`);
  for (const c of leaks)
    P(`   ${c.slug.padEnd(24)} peak ${String(c.avgPeak).padStart(5)}%   win ${String(c.winPct).padStart(3)}%   give ${String(c.avgGive).padStart(4)}%   ${money(c.pnl)}   n=${c.n}`);
  P();

  // DRIFT / ANOMALY — diff vs the prior SESSION snapshot (changes, not static thresholds) + a mechanical floor
  P(`## DRIFT / ANOMALY`);
  const scalps = live.filter((c) => c.avgPeak < 5).map((c) => c.slug);
  const craters = bench.filter((c) => c.avgGive != null && (c.avgGive as number) > 500).map((c) => c.slug);
  const through = throughDate();
  const cur: Snap = { through, runAt: new Date().toISOString(), ch: Object.fromEntries(live.map((c) => [c.slug, { p: c.avgPeak, w: c.winPct, n: c.n }])), promote: promote.map((c) => c.slug), leak: leaks.map((c) => c.slug), crater: craters };
  const snaps = loadSnaps();
  const prior = snaps.filter((s) => s.through && s.through < through).sort((a, b) => (a.through < b.through ? 1 : -1))[0] ?? null;
  const drift = driftDiff(cur, prior);
  P(`   vs last session (${prior?.through ?? "none"}):`);
  for (const l of drift.lines) P(l);
  if (scalps.length) P(`   · mechanical: live scalps (<5% peak) ${scalps.join(", ")}`);
  if (craters.length) P(`   · mechanical: bench craters (giveback >500%) ${craters.join(", ")}`);
  P();
  P(`   ⚠ SENSOR LAYER (deterministic). Bench is mid-basis + capital-blind — no arm from it.`);
  saveSnap(snaps, cur); // advance the baseline (upsert by through)

  const facts = O.join("\n");
  const terrain = briefing(); // forward desk-briefing (levels/events/dealer/regime priors), spawned
  const judged = await judge(terrain, facts);
  const combined = (terrain ? terrain + "\n\n" + "═".repeat(64) + "\n\n" : "") + facts;
  const full = combined + (judged
    ? "\n\n" + "─".repeat(64) + "\nSENTINEL DIGEST — judgment layer\n\n" + judged
    : "\n\n(judgment layer inactive — set ANTHROPIC_API_KEY in .env.local to enable the prose digest)");
  console.log(full);
  const et = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  // shadow-first: bank the digest as a dated, reviewable artifact (the durable local copy)
  try {
    mkdirSync(path.join("data", "sentinel"), { recursive: true });
    writeFileSync(path.join("data", "sentinel", `${et}.md`), full);
    writeFileSync(path.join("data", "sentinel-latest.md"), full);
  } catch (e) { console.error(`sentinel: digest write failed — ${(e as Error).message}`); }
  // surface to the §03 dashboard: publish the digest to the events table (service role only; the
  // panel reads the latest `sentinel:` event via anon). Upsert-by-day so a re-run replaces the day.
  if (HAS_SERVICE) {
    try {
      await sb.from("events").delete().like("message", `sentinel: ${et}%`);
      await sb.from("events").insert({ level: "INFO", message: `sentinel: ${et}`, meta: { kind: "sentinel", date: et, digest: full } });
    } catch (e) { console.error(`sentinel: event publish failed — ${(e as Error).message}`); }
  }

  // PAGING (shadow-first) — quiet unless anomaly: drift-detected changes + an event day next session.
  const nextDay = nextTradingDay(through);
  const eventTags = dayTags(nextDay);
  const anomalies = [...drift.anomalies, ...(eventTags.length ? [`event ${nextDay}: ${eventTags.map((t) => t.toUpperCase()).join("+")}`] : [])];
  await page(anomalies);
}
main().catch((e) => { console.error(`sentinel: ${(e as Error).message}`); process.exit(1); });
