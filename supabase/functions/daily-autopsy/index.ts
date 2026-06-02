// ⚑ DAILY-AUTOPSY VERSION: 2026-06-02b  (findings reliability: recurrence keys off
//   the deterministic per-channel `flaws` (always present) not the LLM's own
//   systemFindings; prompt now REQUIRES every deterministic flaw → a systemFinding
//   + 3–5 topActions, so the machine-readable ledger + recurrence loop don't depend
//   on LLM consistency. 02a left 06-02 with 0 findings / empty topActions.)
// ⚑ DAILY-AUTOPSY VERSION: 2026-06-02a  (first cut — Stage-1 deterministic digest
//   + Stage-2 Anthropic narration, written to daily_reports a few min after close.)
// ============================================================================
//  daily-autopsy — the desk's end-of-day report generator.
//
//  Mirrors engine/autopsy.ts (the local `npm run autopsy` dev tool) — paste-deploy
//  has no bundler, so the aggregator is INLINED here; keep the two in sync (this is
//  read-only analysis, lower-stakes than the trading worker, but the flaw-detector
//  thresholds + digest shape should match). It:
//    1. picks the ET trading day (today after close, or body.date for a manual run),
//    2. pulls that day's positions / signals / events / underlying_bars (service-role),
//    3. correlates each closed trade → its acted ENTRY signal (intent + conviction)
//       and EXIT event (reason) — the bulk of hooks/useTradeInsight,
//    4. computes per-channel metrics + universal flaw detectors,
//    5. feeds the compact digest (+ the last 7 days' findings, for RECURRENCE) to
//       the Anthropic API → narrative,
//    6. upserts {digest, narrative, markdown} into daily_reports.
//
//  Self-gating + idempotent so the two DST-spanning cron times fire it once:
//    • no body.date → only run when it's past 16:01 ET AND no report exists today.
//    • body.date    → explicit manual/backfill run (skips the gate).
//
//  It DIAGNOSES only — it never tunes anything. Deploy: paste into the Supabase
//  Edge Function editor (verify-JWT OFF). Needs ANTHROPIC_API_KEY in edge secrets
//  (+ optional ANTHROPIC_MODEL); SUPABASE_* are auto-injected.
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-4-5";
const sb = createClient(SB_URL, SB_SERVICE);

// ---- ET wall-clock helpers -------------------------------------------------
const ET_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const etDate = (ms: number): string => ET_DATE.format(new Date(ms));
const ET_HM = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
function etMinOf(ms: number): number { let h = 0, m = 0; for (const p of ET_HM.formatToParts(new Date(ms))) { if (p.type === "hour") h = Number(p.value); else if (p.type === "minute") m = Number(p.value); } return (h === 24 ? 0 : h) * 60 + m; }

const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const riskUsd = (entryPrice: number, qty: number) => 0.5 * entryPrice * Math.abs(qty) * 100;
const FEATURES = ["atr", "er", "relVol", "delta", "expectedMove", "roundTrip"];

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

async function fetchWindow(table: string, tsCol: string, cols: string, dayStartMs: number): Promise<Row[]> {
  const lo = new Date(dayStartMs - 36 * 3600_000).toISOString();
  const hi = new Date(dayStartMs + 36 * 3600_000).toISOString();
  const { data, error } = await sb.from(table).select(cols).gte(tsCol, lo).lte(tsCol, hi).order(tsCol, { ascending: true }).limit(5000);
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data ?? []) as Row[];
}

// Universal flaw detectors (mirror engine/autopsy.ts detectFlaws).
function detectFlaws(m: Row, exitReasons: Record<string, number>, activity: Row): Row[] {
  const flaws: Row[] = [];
  const n = m.nTrades;
  if (n >= 3 && m.medianHoldMin <= 2) flaws.push({ type: "insta_exit", severity: "high", evidence: `median hold ${m.medianHoldMin.toFixed(1)}m over ${n} trades — exits almost immediately` });
  if (n >= 4) {
    const total = Object.values(exitReasons).reduce((a: number, b) => a + (b as number), 0) || 1;
    const top = Object.entries(exitReasons).sort((a, b) => (b[1] as number) - (a[1] as number))[0];
    if (top && (top[1] as number) / total >= 0.8) flaws.push({ type: "exit_monoculture", severity: "med", evidence: `${(((top[1] as number) / total) * 100).toFixed(0)}% of exits are "${top[0]}" (${top[1]}/${total}) — little/no active management variety` });
  }
  if (n >= 3 && m.sizePinnedPct >= 0.999) flaws.push({ type: "size_pinned", severity: "low", evidence: `every entry == max_contracts — capital/aggression knobs not modulating size` });
  const totalSig = activity.signals;
  if (totalSig >= 5 && activity.acted / totalSig < 0.3) {
    const topBlock = Object.entries(activity.blocked).sort((a, b) => (b[1] as number) - (a[1] as number))[0];
    flaws.push({ type: "gate_starved", severity: "med", evidence: `only ${activity.acted}/${totalSig} signals acted${topBlock ? ` — top block: ${topBlock[0]} (${topBlock[1]})` : ""}` });
  }
  if (n >= 3 && m.realizedPnl < 0) flaws.push({ type: "negative_day", severity: "low", evidence: `realized $${m.realizedPnl.toFixed(0)} over ${n} trades (winRate ${(m.winRate * 100).toFixed(0)}%)` });
  return flaws;
}

async function buildDigest(date: string): Promise<Row> {
  const dayStartMs = Date.parse(`${date}T12:00:00Z`);
  const { data: stratRows } = await sb.from("strategists").select("id,slug,name,mandate,status,strategist_config(capital_pct,aggression,max_contracts,daily_stop_usd,muted,soloed)");
  const strategists = (stratRows ?? []).map((r: Row) => ({ id: String(r.id), slug: String(r.slug), name: String(r.name), mandate: String(r.mandate ?? ""), status: r.status ?? "armed", cfg: Array.isArray(r.strategist_config) ? r.strategist_config[0] : r.strategist_config }));
  const { data: fund } = await sb.from("fund_state").select("mode").eq("id", 1).maybeSingle();
  const mode = (fund as Row | null)?.mode ?? "paper";

  const posCols = "id,strategist_id,occ_symbol,opt_type,strike,qty,avg_entry_price,current_mark,realized_pnl,status,opened_at,closed_at,expiration";
  const posMap = new Map<string, Row>();
  for (const p of [...await fetchWindow("positions", "opened_at", posCols, dayStartMs), ...await fetchWindow("positions", "closed_at", posCols, dayStartMs)]) posMap.set(p.id, p);
  const dayClosed = [...posMap.values()].filter((p) => p.status === "closed" && p.closed_at && etDate(Date.parse(p.closed_at)) === date);

  const sigs = (await fetchWindow("signals", "created_at", "strategist_id,signal_type,direction,underlying_price,acted_on,blocked_reason,rationale,created_at", dayStartMs)).filter((s) => etDate(Date.parse(s.created_at)) === date);
  const events = (await fetchWindow("events", "created_at", "message,created_at", dayStartMs)).filter((e) => etDate(Date.parse(e.created_at)) === date);

  // exit-event index: `${slug}|${occ}` → [{ms, reason}]  (incl. the reconcile path)
  const exitByKey = new Map<string, { ms: number; reason: string }[]>();
  for (const e of events) {
    const ex = /^(\S+):\s*exit\s+(SPY\S+).*\(([^)]+)\)\s*$/.exec(e.message);
    const rc = !ex && /^(\S+):\s*reconciled\s+(SPY\S+)/.exec(e.message);
    const m = ex ?? rc;
    if (!m) continue;
    const k = `${m[1]}|${m[2]}`;
    (exitByKey.get(k) ?? exitByKey.set(k, []).get(k)!).push({ ms: Date.parse(e.created_at), reason: ex ? m[3] : "reconciled" });
  }
  // acted-entry-signal index: `${strategist_id}|${occ}` → signals (asc)
  const sigByKey = new Map<string, Row[]>();
  for (const s of sigs) {
    if (!s.acted_on || !s.rationale) continue;
    const occ = String(s.rationale.occ ?? "");
    if (!occ) continue;
    const k = `${s.strategist_id}|${occ}`;
    (sigByKey.get(k) ?? sigByKey.set(k, []).get(k)!).push(s);
  }

  // market regime
  const bars = (await fetchWindow("underlying_bars", "ts", "ts,open,high,low,close", dayStartMs)).filter((b) => { const ms = Date.parse(b.ts); return etDate(ms) === date && etMinOf(ms) >= 570 && etMinOf(ms) <= 960; });
  let market: Row | null = null;
  if (bars.length > 2) {
    const open = Number(bars[0].open ?? bars[0].close), close = Number(bars[bars.length - 1].close);
    const high = Math.max(...bars.map((b) => Number(b.high))), low = Math.min(...bars.map((b) => Number(b.low)));
    let path = 0; for (let i = 1; i < bars.length; i++) path += Math.abs(Number(bars[i].close) - Number(bars[i - 1].close));
    const eff = path > 0 ? Math.abs(close - open) / path : 0;
    const retPct = open > 0 ? ((close - open) / open) * 100 : 0;
    const note = eff >= 0.4 ? (retPct >= 0 ? "clean uptrend" : "clean downtrend") : Math.abs(retPct) < 0.2 ? "rangebound chop" : retPct >= 0 ? "choppy drift up" : "choppy drift down";
    market = { open, close, high, low, returnPct: retPct, rangePct: open > 0 ? ((high - low) / open) * 100 : 0, efficiency: eff, note };
  }

  const channels: Row[] = [];
  for (const st of strategists) {
    const chClosed = dayClosed.filter((p) => p.strategist_id === st.id);
    const chSigs = sigs.filter((s) => s.strategist_id === st.id);
    const trades = chClosed.map((p) => {
      const openedMs = p.opened_at ? Date.parse(p.opened_at) : 0, closedMs = p.closed_at ? Date.parse(p.closed_at) : openedMs;
      const holdMin = openedMs && closedMs ? Math.max(0, (closedMs - openedMs) / 60000) : 0;
      const cands = (sigByKey.get(`${p.strategist_id}|${p.occ_symbol}`) ?? []).filter((s) => Date.parse(s.created_at) <= openedMs + 90_000);
      const sig = cands.length ? cands[cands.length - 1] : null;
      const conviction = sig?.rationale ? Object.fromEntries(FEATURES.filter((f) => typeof sig.rationale[f] === "number").map((f) => [f, Number(sig.rationale[f])])) : null;
      const exits = exitByKey.get(`${st.slug}|${p.occ_symbol}`) ?? [];
      const exitReason = exits.length ? exits.reduce((b, e) => (Math.abs(e.ms - closedMs) < Math.abs(b.ms - closedMs) ? e : b)).reason : null;
      const entryPrice = Number(p.avg_entry_price), exitPrice = Number(p.current_mark ?? 0), pnl = Number(p.realized_pnl ?? 0);
      const r = riskUsd(entryPrice, p.qty);
      return { occ: p.occ_symbol, dir: p.opt_type, qty: Number(p.qty), entryPrice, exitPrice, pnl, holdMin, R: r > 0 ? pnl / r : 0, exitReason, signalType: sig?.signal_type ?? null, conviction };
    });
    const wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl <= 0);
    const exitReasons: Record<string, number> = {}; for (const t of trades) { const k = t.exitReason ?? "unknown"; exitReasons[k] = (exitReasons[k] ?? 0) + 1; }
    const blocked: Record<string, number> = {}; let acted = 0;
    for (const s of chSigs) { if (s.acted_on) acted++; else { const k = s.blocked_reason ?? "blocked"; blocked[k] = (blocked[k] ?? 0) + 1; } }
    const maxC = st.cfg?.max_contracts ?? 0;
    const sizePinned = trades.length ? trades.filter((t) => maxC > 0 && Math.abs(t.qty) >= maxC).length / trades.length : 0;
    const convAcc: Record<string, number[]> = {}; for (const t of trades) if (t.conviction) for (const [k, v] of Object.entries(t.conviction)) (convAcc[k] ??= []).push(v as number);
    const convictionAvg = Object.fromEntries(Object.entries(convAcc).map(([k, v]) => [k, Number(mean(v).toFixed(3))]));
    const metrics = {
      nTrades: trades.length, wins: wins.length, winRate: trades.length ? wins.length / trades.length : 0,
      realizedPnl: trades.reduce((a, t) => a + t.pnl, 0),
      avgWin: wins.length ? mean(wins.map((t) => t.pnl)) : 0, avgLoss: losses.length ? mean(losses.map((t) => t.pnl)) : 0,
      avgR: mean(trades.map((t) => t.R)), medianR: median(trades.map((t) => t.R)), medianHoldMin: median(trades.map((t) => t.holdMin)),
      sizePinnedPct: sizePinned,
    };
    const activity = { signals: chSigs.length, acted, blocked };
    channels.push({ slug: st.slug, name: st.name, mandate: st.mandate, status: st.status, config: st.cfg, metrics, exitReasons, activity, convictionAvg, flaws: detectFlaws(metrics, exitReasons, activity), trades });
  }
  const traded = channels.filter((c) => c.metrics.nTrades > 0);
  const allTrades = traded.flatMap((c) => c.trades);
  const fundDigest = { dayRealized: allTrades.reduce((a, t) => a + t.pnl, 0), trades: allTrades.length, winRate: allTrades.length ? allTrades.filter((t) => t.pnl > 0).length / allTrades.length : 0, channelsTraded: traded.length };
  return { date, mode, market, fund: fundDigest, channels };
}

function renderSkeleton(d: Row): string {
  const usd = (v: number) => (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(0);
  const L: string[] = [`# SEVE daily autopsy — ${d.date}  (${d.mode})`];
  if (d.market) L.push(`\n**Market:** SPY ${d.market.open.toFixed(2)} → ${d.market.close.toFixed(2)} (${d.market.returnPct >= 0 ? "+" : ""}${d.market.returnPct.toFixed(2)}%), range ${d.market.rangePct.toFixed(2)}%, efficiency ${d.market.efficiency.toFixed(2)} — _${d.market.note}_`);
  L.push(`\n**Fund:** ${d.fund.trades} trades across ${d.fund.channelsTraded} channels · realized ${usd(d.fund.dayRealized)} · win ${(d.fund.winRate * 100).toFixed(0)}%`);
  for (const c of d.channels) {
    const m = c.metrics;
    L.push(`\n## ${c.name} (\`${c.slug}\`) — ${c.status}`); L.push(`_${c.mandate}_`);
    if (!m.nTrades) { L.push(`- no trades · signals ${c.activity.signals} (acted ${c.activity.acted}, blocked ${JSON.stringify(c.activity.blocked)})`); continue; }
    L.push(`- trades **${m.nTrades}** · win **${(m.winRate * 100).toFixed(0)}%** · realized **${usd(m.realizedPnl)}** · avgWin ${usd(m.avgWin)} / avgLoss ${usd(m.avgLoss)} · avgR ${m.avgR.toFixed(2)} · median hold **${m.medianHoldMin.toFixed(1)}m**`);
    L.push(`- exits: ${JSON.stringify(c.exitReasons)}`);
    L.push(`- signals ${c.activity.signals} (acted ${c.activity.acted}, blocked ${JSON.stringify(c.activity.blocked)}) · conviction(avg) ${JSON.stringify(c.convictionAvg)}`);
    for (const f of c.flaws) L.push(`- ⚑ **${f.type}** (${f.severity}): ${f.evidence}`);
  }
  return L.join("\n");
}

const NARRATE_SYSTEM = `You are SEVE's daily trading-desk autopsy analyst. You receive a DETERMINISTIC digest of one paper-trading day plus the prior few days' findings — the numbers are ground truth; never recompute or invent figures, cite the ones given.
For EACH channel: (1) state its INTENT (from mandate + signal types), (2) read its CONVICTION from the entry rationale features (atr/er/relVol/delta, and expectedMove vs roundTrip = the cost-gate margin), (3) say what went RIGHT and WRONG vs the market regime, (4) a one-line verdict.
Then SYSTEM FINDINGS: diagnose flaws and DISTINGUISH a STRATEGY flaw (thesis wrong for the regime) from a SYSTEM/EXECUTION bug (a channel that never takes profit, exits within a minute, a trailing stop that never fires, sizing always at max_contracts). A "reconciled" exit means the channel's OWN logic did NOT close the position — the cause is AMBIGUOUS (a manual close on the broker, a same-OCC collision with another channel, or expiry); flag it as not-driven-by-the-channel, do NOT assert which. Map the deterministic flaw flags to the specific cause using each channel's mandate. Use the prior-days findings to note RECURRENCE (chronic vs new vs resolved). Propose ONE concrete falsifiable experiment per finding.
CRITICAL OUTPUT RULES: every deterministic flaw in any channel's \`flaws\` array MUST become a systemFinding — map it to its specific cause via the mandate, and mark recurrence "new"/"recurring"/"resolved" vs the prior-days findings. NEVER drop a flagged flaw because it recurs (a recurring flaw is the MOST important to surface). ALWAYS return 3–5 concrete topActions. Empty systemFindings or topActions is only acceptable when there were genuinely zero flaws AND zero trades.
You DIAGNOSE only — never tell the operator to auto-apply changes to live trading. Be specific and concise.`;

const NARRATE_TOOL = {
  name: "emit_autopsy",
  description: "Return the narrated daily autopsy.",
  input_schema: {
    type: "object", required: ["marketSummary", "channels", "systemFindings", "topActions"],
    properties: {
      marketSummary: { type: "string" },
      channels: { type: "array", items: { type: "object", required: ["slug", "intent", "conviction", "wentRight", "wentWrong", "verdict"], properties: { slug: { type: "string" }, intent: { type: "string" }, conviction: { type: "string" }, wentRight: { type: "array", items: { type: "string" } }, wentWrong: { type: "array", items: { type: "string" } }, verdict: { type: "string" } } } },
      systemFindings: { type: "array", items: { type: "object", required: ["type", "severity", "category", "channels", "evidence", "hypothesis", "suggestedExperiment", "recurrence"], properties: { type: { type: "string" }, severity: { type: "string", enum: ["low", "med", "high"] }, category: { type: "string", enum: ["strategy", "system", "config"] }, channels: { type: "array", items: { type: "string" } }, evidence: { type: "string" }, hypothesis: { type: "string" }, suggestedExperiment: { type: "string" }, recurrence: { type: "string", enum: ["new", "recurring", "resolved"] } } } },
      topActions: { type: "array", items: { type: "string" } },
    },
  },
};

async function narrate(digest: Row, priorFindings: Row[]): Promise<Row | null> {
  if (!ANTHROPIC_KEY) return null;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL, max_tokens: 3072, tools: [NARRATE_TOOL], tool_choice: { type: "tool", name: "emit_autopsy" },
      system: [{ type: "text", text: NARRATE_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `Prior ${priorFindings.length}-day findings (for recurrence):\n${JSON.stringify(priorFindings)}\n\nToday's digest:\n${JSON.stringify(digest)}` }],
    }),
  });
  if (!res.ok) { console.error(`narrate ${res.status}: ${(await res.text()).slice(0, 200)}`); return null; }
  const j = await res.json();
  return (j.content ?? []).find((b: Row) => b.type === "tool_use")?.input ?? null;
}

function renderNarrative(skeleton: string, n: Row): string {
  const L = [skeleton, "", "─".repeat(60), "## Narrative", `\n**Market:** ${n.marketSummary}`];
  for (const c of (n.channels ?? [])) {
    L.push(`\n### \`${c.slug}\``, `- **Intent:** ${c.intent}`, `- **Conviction:** ${c.conviction}`);
    if (c.wentRight?.length) L.push(`- **Right:** ${c.wentRight.join("; ")}`);
    if (c.wentWrong?.length) L.push(`- **Wrong:** ${c.wentWrong.join("; ")}`);
    L.push(`- **Verdict:** ${c.verdict}`);
  }
  L.push(`\n### System findings`);
  for (const f of (n.systemFindings ?? [])) L.push(`- **[${f.category}/${f.severity}/${f.recurrence}] ${f.type}** (${(f.channels ?? []).join(",")}): ${f.evidence}\n  - hypothesis: ${f.hypothesis}\n  - experiment: ${f.suggestedExperiment}`);
  L.push(`\n### Top actions`);
  for (const a of (n.topActions ?? [])) L.push(`- ${a}`);
  return L.join("\n");
}

Deno.serve(async (req) => {
  try {
    let body: Row = {};
    try { body = await req.json(); } catch { /* cron sends {} */ }
    const nowMs = Date.now();
    const today = etDate(nowMs);
    const manual = typeof body.date === "string" && body.date;
    const date = manual ? String(body.date) : today;

    // self-gate (cron path only): wait until after the close, and run once/day.
    if (!manual) {
      if (etMinOf(nowMs) < 16 * 60 + 1) return Response.json({ ok: true, skipped: "before_close", etMin: etMinOf(nowMs) });
      const { data: existing } = await sb.from("daily_reports").select("report_date").eq("report_date", date).maybeSingle();
      if (existing && !body.force) return Response.json({ ok: true, skipped: "already_done", date });
    }

    const digest = await buildDigest(date);

    // recurrence: the last 7 days' DETERMINISTIC flaws (always present in the
    // digest — the LLM's own systemFindings can be inconsistent, so we don't rely
    // on them for the recurrence signal) + the LLM findings when present.
    const { data: prior } = await sb.from("daily_reports").select("report_date,digest,narrative").lt("report_date", date).order("report_date", { ascending: false }).limit(7);
    const priorFindings = (prior ?? []).map((r: Row) => ({
      date: r.report_date,
      flaws: (r.digest?.channels ?? []).flatMap((c: Row) => (c.flaws ?? []).map((f: Row) => ({ slug: c.slug, type: f.type }))),
      findings: (r.narrative?.systemFindings ?? []).map((f: Row) => ({ type: f.type, category: f.category, channels: f.channels })),
    }));

    const skeleton = renderSkeleton(digest);
    const narrative = await narrate(digest, priorFindings);
    const markdown = narrative ? renderNarrative(skeleton, narrative) : skeleton;

    const { error } = await sb.from("daily_reports").upsert({ report_date: date, mode: digest.mode, digest, narrative, markdown, updated_at: new Date().toISOString() }, { onConflict: "report_date" });
    if (error) throw new Error(`daily_reports upsert: ${error.message}`);
    // best-effort breadcrumb (level is the event_level enum — use INFO; never let
    // this fail the run after the report is already persisted).
    try { await sb.from("events").insert({ level: "INFO", message: `daily-autopsy ${date}: ${digest.fund.trades} trades, ${digest.fund.channelsTraded} channels, $${digest.fund.dayRealized.toFixed(0)}${narrative ? "" : " (no LLM — set ANTHROPIC_API_KEY)"}`, meta: { date, channels: digest.channels.length } }); } catch { /* */ }
    return Response.json({ ok: true, date, trades: digest.fund.trades, narrated: !!narrative });
  } catch (e) {
    try { await sb.from("events").insert({ level: "WARN", message: `daily-autopsy failed: ${(e as Error).message}` }); } catch { /* */ }
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
});
