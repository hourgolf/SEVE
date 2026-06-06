// ============================================================================
//  Daily autopsy — deterministic aggregator (Stage 1 of the daily report).
//
//  Pulls ONE ET trading day's positions / signals / events / underlying_bars
//  (anon reads), correlates each closed trade to its acted ENTRY signal (intent +
//  conviction features) and its EXIT event (exit reason) — the bulk version of
//  hooks/useTradeInsight — and computes per-channel metrics + universal flaw
//  detectors. Emits a compact JSON digest + a deterministic markdown skeleton.
//
//  Stage 2 (LLM narration) consumes the digest: locally via --llm if
//  ANTHROPIC_API_KEY is set, otherwise print the digest and narrate in-chat. The
//  production path is a cron'd `daily-autopsy` edge function that inlines this
//  logic (paste-deploy, like the worker) + the Anthropic call.
//
//    npm run autopsy -- --date 2026-06-01
//    npm run autopsy -- --date today --json     # print the raw digest only
//
//  The numbers here are GROUND TRUTH; the LLM explains, it does not recompute.
//  Honest labeling: this reports what the worker DID (real paper fills) — it does
//  not retune anything. Diagnosis only.
// ============================================================================

import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function loadEnv() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch { /* ignore */ }
}

const ET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const etDate = (ms: number): string => ET.format(new Date(ms)); // "YYYY-MM-DD"
const ET_HM = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
function etMin(ms: number): number { let h = 0, m = 0; for (const p of ET_HM.formatToParts(new Date(ms))) { if (p.type === "hour") h = Number(p.value); else if (p.type === "minute") m = Number(p.value); } return (h === 24 ? 0 : h) * 60 + m; }

const argStr = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };

// ---- shapes ----------------------------------------------------------------
interface Cfg { capital_pct: number; aggression: number; max_contracts: number; daily_stop_usd: number; muted: boolean; soloed: boolean; }
interface Strat { id: string; slug: string; name: string; mandate: string; status?: string; cfg: Cfg | null; }
interface PosRow { id: string; strategist_id: string; occ_symbol: string; opt_type: "call" | "put"; strike: number; qty: number; avg_entry_price: number; current_mark: number | null; realized_pnl: number | null; status: string; opened_at: string | null; closed_at: string | null; expiration: string | null; }
interface SigRow { strategist_id: string; signal_type: string; direction: string | null; underlying_price: number | null; acted_on: boolean; blocked_reason: string | null; rationale: Record<string, unknown> | null; created_at: string; }

interface TradeView {
  occ: string; dir: "call" | "put"; qty: number; entryPrice: number; exitPrice: number; pnl: number;
  holdMin: number; R: number; exitReason: string | null; signalType: string | null;
  conviction: Record<string, number> | null; // rationale features at entry
}
interface ChannelDigest {
  slug: string; name: string; mandate: string; status: string;
  config: Cfg | null;
  metrics: { nTrades: number; wins: number; winRate: number; realizedPnl: number; avgWin: number; avgLoss: number; avgR: number; medianR: number; medianHoldMin: number; sizePinnedPct: number };
  exitReasons: Record<string, number>;
  activity: { signals: number; acted: number; blocked: Record<string, number> };
  convictionAvg: Record<string, number>; // mean of entry rationale features over acted trades
  flaws: { type: string; severity: "low" | "med" | "high"; evidence: string }[];
  trades: TradeView[];
}
type MarketRegime = { open: number; close: number; high: number; low: number; returnPct: number; rangePct: number; efficiency: number; note: string };
interface Digest {
  date: string; mode: string;
  market: MarketRegime | null;        // SPY (default-ticker rows)
  marketQQQ?: MarketRegime | null;    // QQQ (present once the QQQ tape is live)
  fund: { dayRealized: number; trades: number; winRate: number; channelsTraded: number };
  channels: ChannelDigest[];
}

// ---- helpers ---------------------------------------------------------------
const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const riskUsd = (entryPrice: number, qty: number) => 0.5 * entryPrice * Math.abs(qty) * 100; // desk R = 50%-premium proxy (matches PositionsPanel)

async function fetchWindow<T>(sb: SupabaseClient, table: string, tsCol: string, cols: string, dayStartMs: number): Promise<T[]> {
  // coarse UTC window covering the ET day ±1d (refined to the exact ET date by the caller).
  // PAGINATE via .range() — PostgREST silently caps at 1000 rows, and SPY+QQQ bars over a
  // ±36h window blow past that, so a flat .limit() truncated to early-morning (mirrors the
  // edge fn's 2026-06-04b fix).
  const lo = new Date(dayStartMs - 36 * 3600_000).toISOString();
  const hi = new Date(dayStartMs + 36 * 3600_000).toISOString();
  const out: T[] = []; const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select(cols).gte(tsCol, lo).lte(tsCol, hi).order(tsCol, { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as T[]; out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

// Universal, strategy-agnostic flaw detectors. They report FACTS + a structural
// flag; the LLM (fed the mandate) maps them to the specific cause (e.g. "0 trail
// exits for a momentum channel that should trail" → dead trailing stop).
function detectFlaws(m: ChannelDigest["metrics"], exitReasons: Record<string, number>, activity: ChannelDigest["activity"]): ChannelDigest["flaws"] {
  const flaws: ChannelDigest["flaws"] = [];
  const n = m.nTrades;
  if (n >= 3 && m.medianHoldMin <= 2) flaws.push({ type: "insta_exit", severity: "high", evidence: `median hold ${m.medianHoldMin.toFixed(1)}m over ${n} trades — exits almost immediately` });
  if (n >= 4) {
    const total = Object.values(exitReasons).reduce((a, b) => a + b, 0) || 1;
    const top = Object.entries(exitReasons).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] / total >= 0.8) flaws.push({ type: "exit_monoculture", severity: "med", evidence: `${((top[1] / total) * 100).toFixed(0)}% of exits are "${top[0]}" (${top[1]}/${total}) — little/no active management variety` });
  }
  if (n >= 3 && m.sizePinnedPct >= 0.999) flaws.push({ type: "size_pinned", severity: "low", evidence: `every entry == max_contracts — capital/aggression knobs not modulating size` });
  const totalSig = activity.signals;
  if (totalSig >= 5 && activity.acted / totalSig < 0.3) {
    const topBlock = Object.entries(activity.blocked).sort((a, b) => b[1] - a[1])[0];
    flaws.push({ type: "gate_starved", severity: "med", evidence: `only ${activity.acted}/${totalSig} signals acted${topBlock ? ` — top block: ${topBlock[0]} (${topBlock[1]})` : ""}` });
  }
  if (n >= 3 && m.realizedPnl < 0) flaws.push({ type: "negative_day", severity: "low", evidence: `realized $${m.realizedPnl.toFixed(0)} over ${n} trades (winRate ${(m.winRate * 100).toFixed(0)}%)` });
  return flaws;
}

const FEATURES = ["atr", "er", "relVol", "delta", "expectedMove", "roundTrip"]; // rationale conviction features

async function buildDigest(sb: SupabaseClient, date: string): Promise<Digest> {
  const dayStartMs = Date.parse(`${date}T12:00:00Z`); // noon-UTC anchor within the ET day for the coarse window
  // channels
  const { data: stratRows } = await sb.from("strategists").select("id,slug,name,mandate,status,strategist_config(capital_pct,aggression,max_contracts,daily_stop_usd,muted,soloed)");
  const strategists: Strat[] = (stratRows ?? []).map((r: Record<string, unknown>) => ({ id: String(r.id), slug: String(r.slug), name: String(r.name), mandate: String(r.mandate ?? ""), status: (r.status as string) ?? "armed", cfg: (Array.isArray(r.strategist_config) ? r.strategist_config[0] : r.strategist_config) as Cfg | null }));
  const byId = new Map(strategists.map((s) => [s.id, s]));

  const { data: fund } = await sb.from("fund_state").select("mode").eq("id", 1).maybeSingle();
  const mode = (fund as { mode?: string } | null)?.mode ?? "paper";

  // positions opened or closed on the ET date
  const posAll = await fetchWindow<PosRow>(sb, "positions", "opened_at", "id,strategist_id,occ_symbol,opt_type,strike,qty,avg_entry_price,current_mark,realized_pnl,status,opened_at,closed_at,expiration", dayStartMs);
  const posClosedExtra = await fetchWindow<PosRow>(sb, "positions", "closed_at", "id,strategist_id,occ_symbol,opt_type,strike,qty,avg_entry_price,current_mark,realized_pnl,status,opened_at,closed_at,expiration", dayStartMs);
  const posMap = new Map<string, PosRow>();
  for (const p of [...posAll, ...posClosedExtra]) posMap.set(p.id, p);
  const dayClosed = [...posMap.values()].filter((p) => p.status === "closed" && p.closed_at && etDate(Date.parse(p.closed_at)) === date);

  // signals + events for the ET date
  const sigs = (await fetchWindow<SigRow>(sb, "signals", "created_at", "strategist_id,signal_type,direction,underlying_price,acted_on,blocked_reason,rationale,created_at", dayStartMs)).filter((s) => etDate(Date.parse(s.created_at)) === date);
  const events = (await fetchWindow<{ message: string; created_at: string }>(sb, "events", "created_at", "message,created_at", dayStartMs)).filter((e) => etDate(Date.parse(e.created_at)) === date);

  // exit-event index: `${slug}|${occ}` → [{ms, reason}] (parse "slug: exit <occ> ×n
  // (reason)"). SLUG-keyed so two channels holding the same OCC don't cross-
  // attribute each other's exit reasons (the worker tags every journal with its slug).
  const exitByKey = new Map<string, { ms: number; reason: string }[]>();
  for (const e of events) {
    // "slug: exit <occ> ×n (reason)"  OR  "slug: reconciled <occ> — ..." (the
    // orphan-close path when two channels shared an OCC — itself worth surfacing).
    const ex = /^(\S+):\s*exit\s+(SPY\S+).*\(([^)]+)\)\s*$/.exec(e.message);
    const rc = !ex && /^(\S+):\s*reconciled\s+(SPY\S+)/.exec(e.message);
    const m = ex ?? rc;
    if (!m) continue;
    const reason = ex ? m[3] : "reconciled";
    const k = `${m[1]}|${m[2]}`;
    const arr = exitByKey.get(k) ?? []; arr.push({ ms: Date.parse(e.created_at), reason }); exitByKey.set(k, arr);
  }
  // acted-entry-signal index: `${strategist_id}|${occ}` → signals (asc)
  const sigByKey = new Map<string, SigRow[]>();
  for (const s of sigs) {
    if (!s.acted_on || !s.rationale) continue;
    const occ = String((s.rationale as { occ?: string }).occ ?? "");
    if (!occ) continue;
    const k = `${s.strategist_id}|${occ}`;
    const arr = sigByKey.get(k) ?? []; arr.push(s); sigByKey.set(k, arr);
  }

  // market regime from underlying_bars (RTH) — PER SYMBOL. The tape carries SPY + QQQ
  // at the same timestamps; an unfiltered read interleaves them into a Frankenstein
  // candle (SPY's open vs QQQ's close), so split by symbol and compute each separately.
  const allBars = (await fetchWindow<{ ts: string; open: number; high: number; low: number; close: number; symbol: string }>(sb, "underlying_bars", "ts", "ts,open,high,low,close,symbol", dayStartMs))
    .filter((b) => { const ms = Date.parse(b.ts); return etDate(ms) === date && etMin(ms) >= 570 && etMin(ms) <= 960; });
  const computeMarket = (bars: typeof allBars): MarketRegime | null => {
    if (bars.length <= 2) return null;
    const open = Number(bars[0].open ?? bars[0].close), close = Number(bars[bars.length - 1].close);
    const high = Math.max(...bars.map((b) => Number(b.high))), low = Math.min(...bars.map((b) => Number(b.low)));
    let path = 0; for (let i = 1; i < bars.length; i++) path += Math.abs(Number(bars[i].close) - Number(bars[i - 1].close));
    const eff = path > 0 ? Math.abs(close - open) / path : 0;
    const retPct = open > 0 ? ((close - open) / open) * 100 : 0;
    const note = eff >= 0.4 ? (retPct >= 0 ? "clean uptrend" : "clean downtrend") : Math.abs(retPct) < 0.2 ? "rangebound chop" : retPct >= 0 ? "choppy drift up" : "choppy drift down";
    return { open, close, high, low, returnPct: retPct, rangePct: open > 0 ? ((high - low) / open) * 100 : 0, efficiency: eff, note };
  };
  const market = computeMarket(allBars.filter((b) => (b.symbol ?? "SPY") === "SPY"));
  const marketQQQ = computeMarket(allBars.filter((b) => b.symbol === "QQQ"));

  // per-channel
  const channels: ChannelDigest[] = [];
  for (const st of strategists) {
    const chClosed = dayClosed.filter((p) => p.strategist_id === st.id);
    const chSigs = sigs.filter((s) => s.strategist_id === st.id);
    const trades: TradeView[] = chClosed.map((p) => {
      const openedMs = p.opened_at ? Date.parse(p.opened_at) : 0, closedMs = p.closed_at ? Date.parse(p.closed_at) : openedMs;
      const holdMin = openedMs && closedMs ? Math.max(0, (closedMs - openedMs) / 60000) : 0;
      // entry signal: this channel's acted signal for this occ nearest at/just before open
      const cands = (sigByKey.get(`${p.strategist_id}|${p.occ_symbol}`) ?? []).filter((s) => Date.parse(s.created_at) <= openedMs + 90_000);
      const sig = cands.length ? cands[cands.length - 1] : null;
      const conviction = sig?.rationale ? Object.fromEntries(FEATURES.filter((f) => typeof (sig.rationale as Record<string, unknown>)[f] === "number").map((f) => [f, Number((sig.rationale as Record<string, unknown>)[f])])) : null;
      // exit reason: nearest exit event for THIS channel's occ to the close time
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
    const convAcc: Record<string, number[]> = {}; for (const t of trades) if (t.conviction) for (const [k, v] of Object.entries(t.conviction)) (convAcc[k] ??= []).push(v);
    const convictionAvg = Object.fromEntries(Object.entries(convAcc).map(([k, v]) => [k, Number(mean(v).toFixed(3))]));
    const metrics = {
      nTrades: trades.length, wins: wins.length, winRate: trades.length ? wins.length / trades.length : 0,
      realizedPnl: trades.reduce((a, t) => a + t.pnl, 0),
      avgWin: wins.length ? mean(wins.map((t) => t.pnl)) : 0, avgLoss: losses.length ? mean(losses.map((t) => t.pnl)) : 0,
      avgR: mean(trades.map((t) => t.R)), medianR: median(trades.map((t) => t.R)), medianHoldMin: median(trades.map((t) => t.holdMin)),
      sizePinnedPct: sizePinned,
    };
    const activity = { signals: chSigs.length, acted, blocked };
    const flaws = detectFlaws(metrics, exitReasons, activity);
    channels.push({ slug: st.slug, name: st.name, mandate: st.mandate, status: st.status ?? "armed", config: st.cfg, metrics, exitReasons, activity, convictionAvg, flaws, trades });
  }

  const traded = channels.filter((c) => c.metrics.nTrades > 0);
  const allTrades = traded.flatMap((c) => c.trades);
  const fundDigest = { dayRealized: allTrades.reduce((a, t) => a + t.pnl, 0), trades: allTrades.length, winRate: allTrades.length ? allTrades.filter((t) => t.pnl > 0).length / allTrades.length : 0, channelsTraded: traded.length };
  return { date, mode, market, marketQQQ, fund: fundDigest, channels };
}

// ---- deterministic markdown skeleton (useful even without the LLM) ---------
function renderSkeleton(d: Digest): string {
  const usd = (v: number) => (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(0);
  const L: string[] = [];
  L.push(`# SEVE daily autopsy — ${d.date}  (${d.mode})`);
  if (d.market) L.push(`\n**Market (SPY):** ${d.market.open.toFixed(2)} → ${d.market.close.toFixed(2)} (${d.market.returnPct >= 0 ? "+" : ""}${d.market.returnPct.toFixed(2)}%), range ${d.market.rangePct.toFixed(2)}%, efficiency ${d.market.efficiency.toFixed(2)} — _${d.market.note}_`);
  if (d.marketQQQ) L.push(`**Market (QQQ):** ${d.marketQQQ.open.toFixed(2)} → ${d.marketQQQ.close.toFixed(2)} (${d.marketQQQ.returnPct >= 0 ? "+" : ""}${d.marketQQQ.returnPct.toFixed(2)}%), range ${d.marketQQQ.rangePct.toFixed(2)}%, efficiency ${d.marketQQQ.efficiency.toFixed(2)} — _${d.marketQQQ.note}_`);
  L.push(`\n**Fund:** ${d.fund.trades} trades across ${d.fund.channelsTraded} channels · realized ${usd(d.fund.dayRealized)} · win ${(d.fund.winRate * 100).toFixed(0)}%`);
  for (const c of d.channels) {
    const m = c.metrics;
    L.push(`\n## ${c.name} (\`${c.slug}\`) — ${c.status}`);
    L.push(`_${c.mandate}_`);
    if (!m.nTrades) { L.push(`- no trades · signals ${c.activity.signals} (acted ${c.activity.acted}, blocked ${JSON.stringify(c.activity.blocked)})`); continue; }
    L.push(`- trades **${m.nTrades}** · win **${(m.winRate * 100).toFixed(0)}%** · realized **${usd(m.realizedPnl)}** · avgWin ${usd(m.avgWin)} / avgLoss ${usd(m.avgLoss)} · avgR ${m.avgR.toFixed(2)} · median hold **${m.medianHoldMin.toFixed(1)}m**`);
    L.push(`- exits: ${JSON.stringify(c.exitReasons)}`);
    L.push(`- signals ${c.activity.signals} (acted ${c.activity.acted}, blocked ${JSON.stringify(c.activity.blocked)}) · conviction(avg) ${JSON.stringify(c.convictionAvg)}`);
    if (c.flaws.length) for (const f of c.flaws) L.push(`- ⚑ **${f.type}** (${f.severity}): ${f.evidence}`);
  }
  return L.join("\n");
}

// ---- Stage 2: LLM narration (used by the edge fn; local only if key present) ---
const NARRATE_SYSTEM = `You are SEVE's daily trading-desk autopsy analyst. You receive a DETERMINISTIC digest of one paper-trading day — the numbers are ground truth; never recompute or invent figures, cite the ones given.
The digest carries TWO market regimes: \`market\` (SPY) and \`marketQQQ\` (QQQ, present once QQQ channels are live — it can differ materially from SPY). In marketSummary cover BOTH when QQQ is present, and judge each channel against ITS OWN underlying's regime (slugs ending -qqq, or QQQ-rooted OCCs, are QQQ; everything else is SPY).
For EACH channel: (1) state its INTENT (from mandate + signal types), (2) read its CONVICTION from the entry rationale features (atr/er/relVol/delta, and expectedMove vs roundTrip = the cost-gate margin), (3) say what went RIGHT and WRONG vs its underlying's regime, (4) a one-line verdict.
Then SYSTEM FINDINGS: diagnose flaws, and crucially DISTINGUISH a STRATEGY flaw (the thesis is wrong for the regime) from a SYSTEM/EXECUTION bug (e.g. a channel that never takes profit, exits within a minute, a trailing stop that never fires, sizing that's always max_contracts). Map the deterministic flaw flags to the specific cause using each channel's mandate. A "reconciled" exit means the channel's OWN logic did NOT close the position — the cause is AMBIGUOUS (a manual close on the broker, a same-OCC collision, or expiry); flag it as not-driven-by-the-channel, do NOT assert which. Propose ONE concrete, falsifiable experiment per finding.
CRITICAL OUTPUT RULES: every deterministic flaw in any channel's \`flaws\` array MUST become a systemFinding (map it to its specific cause via the mandate); never drop one. ALWAYS return 3–5 concrete topActions. Empty systemFindings/topActions is only acceptable when there were genuinely zero flaws AND zero trades.
You DIAGNOSE only — never tell the operator to auto-apply changes to live trading. Be specific and concise.`;

const NARRATE_TOOL = {
  name: "emit_autopsy",
  description: "Return the narrated daily autopsy.",
  input_schema: {
    type: "object", required: ["marketSummary", "channels", "systemFindings", "topActions"],
    properties: {
      marketSummary: { type: "string" },
      channels: { type: "array", items: { type: "object", required: ["slug", "intent", "conviction", "wentRight", "wentWrong", "verdict"], properties: { slug: { type: "string" }, intent: { type: "string" }, conviction: { type: "string" }, wentRight: { type: "array", items: { type: "string" } }, wentWrong: { type: "array", items: { type: "string" } }, verdict: { type: "string" } } } },
      systemFindings: { type: "array", items: { type: "object", required: ["type", "severity", "channels", "evidence", "hypothesis", "suggestedExperiment", "category"], properties: { type: { type: "string" }, severity: { type: "string", enum: ["low", "med", "high"] }, category: { type: "string", enum: ["strategy", "system", "config"] }, channels: { type: "array", items: { type: "string" } }, evidence: { type: "string" }, hypothesis: { type: "string" }, suggestedExperiment: { type: "string" } } } },
      topActions: { type: "array", items: { type: "string" } },
    },
  },
};

async function narrate(digest: Digest): Promise<unknown | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";  // current Sonnet (4-5 is now legacy)
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model, max_tokens: 3072, tools: [NARRATE_TOOL], tool_choice: { type: "tool", name: "emit_autopsy" },
      system: [{ type: "text", text: NARRATE_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `Digest:\n\n${JSON.stringify(digest)}` }],
    }),
  });
  if (!res.ok) { console.error(`  (LLM narration failed: ${res.status} ${(await res.text()).slice(0, 200)})`); return null; }
  const j = await res.json();
  return (j.content ?? []).find((b: { type: string }) => b.type === "tool_use")?.input ?? null;
}

function renderNarrative(n: Record<string, unknown>): string {
  const L: string[] = ["", "─".repeat(60), "## LLM narrative", ""];
  L.push(`**Market:** ${n.marketSummary}`);
  for (const c of (n.channels as Record<string, unknown>[] ?? [])) {
    L.push(`\n### \`${c.slug}\``);
    L.push(`- **Intent:** ${c.intent}`);
    L.push(`- **Conviction:** ${c.conviction}`);
    if ((c.wentRight as string[])?.length) L.push(`- **Right:** ${(c.wentRight as string[]).join("; ")}`);
    if ((c.wentWrong as string[])?.length) L.push(`- **Wrong:** ${(c.wentWrong as string[]).join("; ")}`);
    L.push(`- **Verdict:** ${c.verdict}`);
  }
  L.push(`\n### System findings`);
  for (const f of (n.systemFindings as Record<string, unknown>[] ?? [])) L.push(`- **[${f.category}/${f.severity}] ${f.type}** (${(f.channels as string[]).join(",")}): ${f.evidence}\n  - hypothesis: ${f.hypothesis}\n  - experiment: ${f.suggestedExperiment}`);
  L.push(`\n### Top actions`);
  for (const a of (n.topActions as string[] ?? [])) L.push(`- ${a}`);
  return L.join("\n");
}

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY in .env.local");
  const sb = createClient(url, anon, { auth: { persistSession: false } });
  let date = argStr("date", "today");
  if (date === "today") date = etDate(Date.now());
  const jsonOnly = process.argv.includes("--json");

  const digest = await buildDigest(sb, date);
  if (jsonOnly) { console.log(JSON.stringify(digest, null, 2)); return; }

  console.log("\n" + renderSkeleton(digest));
  const narration = await narrate(digest);
  if (narration) console.log("\n" + renderNarrative(narration as Record<string, unknown>));
  else console.log(`\n  (no ANTHROPIC_API_KEY locally — digest above is the Stage-1 ground truth; the production edge fn adds the LLM narrative. Run with --json to print the raw digest for in-chat narration.)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
